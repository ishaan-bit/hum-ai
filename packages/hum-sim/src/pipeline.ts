/**
 * PRODUCTION-PIPELINE RUNNER — the heart of the Hum Simulator.
 *
 * Every simulated hum goes through the EXACT runtime path a real microphone capture
 * takes: `orchestrateHumAudio(rawPcm)` runs `computeFeatures` (preprocessing → DSP
 * feature extraction) and then `orchestrateHumRead` (quality gate → domain → experts
 * → fusion → axis read → personalization → relapse/longitudinal → intervention →
 * safety copy) with NO bypass. We do not re-implement or approximate any stage; we
 * only OBSERVE the intermediates by re-running the pure read functions on the same
 * derived features and by reading the returned `OrchestratedRead`.
 *
 * The captured `SimResult` records enough to fully reconstruct and debug a run:
 * latent profile, synthesis controls, audio summary, the full extracted feature
 * vector, every stage's outputs, the user-facing read, and any warnings (NaN /
 * abstention / rejection / fallback). The raw PCM buffer is intentionally NOT stored
 * (it is reproducible from `latent` via `renderHum`) — matching the product's own
 * "derived only, raw audio is ephemeral" privacy posture.
 */
import { mean, type ConsentState, type IsoTimestamp } from "@hum-ai/shared-types";
import { computeFeatures, type AcousticFeatures, type AudioInput } from "@hum-ai/audio-features";
import {
  acousticAffectAxes,
  axisReadConfidence,
  clinicalRiskScore,
  orchestrateHumAudio,
  resolveAxisRead,
  type HumHistory,
  type OrchestratedRead,
} from "@hum-ai/orchestrator";
import { renderControls, renderHum } from "./synth";
import { latentToControls, type LatentHumProfile, type SynthControls } from "./latent";
import { consentLocal, SIM_MODEL_VERSION, simTimestamp } from "./context";

/** The 9 user-visible headline zones (mirrors `axisHeadline` in orchestrator copy.ts, T=0.2). */
export const ZONE_THRESHOLD = 0.2;
export function zoneOf(valence: number, arousal: number): string {
  const T = ZONE_THRESHOLD;
  const hiA = arousal > T, loA = arousal < -T, hiV = valence > T, loV = valence < -T;
  if (hiA && hiV) return "Bright/Energised";
  if (hiA && loV) return "Tense/Wound-up";
  if (loA && hiV) return "Calm/Content";
  if (loA && loV) return "Low/Flat";
  if (hiA) return "Restless";
  if (loA) return "Quiet/Subdued";
  if (hiV) return "Warm/Steady";
  if (loV) return "A-little-flat";
  return "Steady/Even";
}

/** A compact valence/arousal pair. */
export interface VA {
  readonly valence: number;
  readonly arousal: number;
}

/** Everything captured for one simulated hum run. */
export interface SimResult {
  readonly id: string;
  readonly seed: number;
  readonly latent: LatentHumProfile;
  readonly controls: SynthControls;
  readonly audio: {
    readonly sampleRate: number;
    readonly durationSec: number;
    readonly nSamples: number;
    readonly peak: number;
    readonly rms: number;
  };
  /** The full extracted feature vector (numeric fields; nulls preserved). */
  readonly features: AcousticFeatures;
  readonly quality: {
    readonly decision: string;
    readonly captureQuality: string;
    readonly captureQualityScore: number;
    readonly confidenceCap: number;
    readonly baselineEligible: boolean;
    readonly reasons: readonly string[];
  };
  readonly domain: { readonly predicted: string; readonly confidence: number; readonly domainMatch: number };
  readonly stage: string;
  readonly eligibleHumCount: number;
  /** Stage-by-stage V-A so collapse can be localized: */
  readonly axisAcoustic: VA & { readonly signalStrength: number }; // transparent acoustic backbone
  readonly axisRead: VA & { readonly confidence: number }; // resolveAxisRead (priors absent ⇒ == acoustic)
  readonly displayAxis: VA; // USER-FACING headline read (acoustic re-referenced against history)
  readonly internalDimensional: VA; // fusion-derived, personalized internal inference.dimensional
  readonly zone: string; // headline zone from displayAxis
  readonly affectHint: string | null;
  readonly broadStates: Readonly<Record<string, number>>;
  readonly riskScore: number;
  readonly userFacing: {
    readonly abstained: boolean;
    readonly isEarlyBaseline: boolean;
    readonly evidenceLevel: string;
    readonly headline: string;
    readonly innerState: string | null;
    readonly note: string;
    readonly suggestionType: string | null;
    readonly interventionOfDay: string;
    readonly interventionCategory: string;
  };
  readonly longitudinal: {
    readonly trendDirection: string;
    readonly monitoring: boolean;
    readonly relapseClass: string | null;
    readonly relapseDrift: number;
  };
  /**
   * The WITHIN-HUM trajectory (v13) the production read produced for this hum — chunk count,
   * the recovered shape + variation mode (musical vs inner-state), and the chunk-to-chunk arcs.
   * Null when the read abstained or no temporal analysis ran. Lets an inner-state run be scored
   * against the recovered chunks/trajectory, not just the whole-hum V/A.
   */
  readonly temporal: {
    readonly segmentCount: number;
    readonly shape: string;
    readonly variationMode: string;
    readonly valenceArc: number;
    readonly arousalArc: number;
    readonly energyArc: number;
  } | null;
  readonly warnings: readonly string[];
  readonly timingMs: number;
}

/** Summarize a raw PCM buffer (peak + RMS) without storing it. */
function audioSummary(audio: AudioInput): { peak: number; rms: number; nSamples: number } {
  const s = audio.samples;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i] as number;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
  }
  return { peak, rms: s.length ? Math.sqrt(sumSq / s.length) : 0, nSamples: s.length };
}

/** Collect warnings: non-finite numerics, abstention, rejection, degenerate extraction. */
function collectWarnings(f: AcousticFeatures, read: OrchestratedRead): string[] {
  const w: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "number" && !Number.isFinite(v)) w.push(`feature ${k} is non-finite (${v})`);
  }
  if (f.pitchMeanHz === null) w.push("pitch unresolved (pitchMeanHz=null) — unvoiced/too-short");
  if (read.userFacing.abstained) w.push("read ABSTAINED");
  if (read.internal.quality.decision === "rejected") {
    w.push(`quality REJECTED: ${read.internal.quality.reasons.join(", ")}`);
  }
  return w;
}

export interface RunOptions {
  readonly consent?: ConsentState;
  readonly now?: IsoTimestamp;
  readonly history?: HumHistory;
}

/**
 * Capture a `SimResult` from a completed read + its source audio/latent. Shared by the
 * single-hum runner and the longitudinal harness so both record identical structure.
 */
export function captureResult(
  id: string,
  latent: LatentHumProfile,
  audio: AudioInput,
  read: OrchestratedRead,
  timingMs: number,
): SimResult {
  const controls = latentToControls(latent);
  const asum = audioSummary(audio);
  const f = read.internal.features;

  // Re-run the PURE read functions on the SAME derived features to observe the
  // pre-personalization / pre-re-reference stages (no bypass — these are the very
  // functions the orchestrator calls, evaluated for transparency).
  const ac = acousticAffectAxes(f);
  const axisRead = resolveAxisRead(f);
  const display = read.internal.axis; // the re-referenced read the orchestrator built
  const inf = read.internal.inference;

  const result: SimResult = {
    id,
    seed: latent.seed,
    latent,
    controls,
    audio: {
      sampleRate: audio.sampleRate,
      durationSec: latent.durationSec,
      nSamples: asum.nSamples,
      peak: asum.peak,
      rms: asum.rms,
    },
    features: f,
    quality: {
      decision: read.internal.quality.decision,
      captureQuality: read.internal.quality.captureQuality,
      captureQualityScore: read.internal.quality.captureQualityScore,
      confidenceCap: read.internal.quality.confidenceCap,
      baselineEligible: read.internal.quality.baselineEligible,
      reasons: read.internal.quality.reasons,
    },
    domain: {
      predicted: read.internal.domain.predicted,
      confidence: read.internal.domain.confidence,
      domainMatch: read.internal.domainMatch,
    },
    stage: read.internal.stage,
    eligibleHumCount: read.internal.eligibleHumCount,
    axisAcoustic: { valence: ac.valence, arousal: ac.arousal, signalStrength: ac.signalStrength },
    axisRead: {
      valence: axisRead.dimensional.valence,
      arousal: axisRead.dimensional.arousal,
      confidence: axisReadConfidence(axisRead),
    },
    displayAxis: { valence: display.dimensional.valence, arousal: display.dimensional.arousal },
    internalDimensional: { valence: inf.dimensional.valence, arousal: inf.dimensional.arousal },
    zone: zoneOf(display.dimensional.valence, display.dimensional.arousal),
    affectHint: read.internal.affectHint,
    broadStates: { ...read.internal.twoHead.broad.states } as Record<string, number>,
    riskScore: clinicalRiskScore(inf),
    userFacing: {
      abstained: read.userFacing.abstained,
      isEarlyBaseline: read.userFacing.isEarlyBaseline,
      evidenceLevel: read.userFacing.confidence.evidenceLevel,
      headline: read.userFacing.headline,
      innerState: read.userFacing.innerState,
      note: read.userFacing.note,
      suggestionType: read.userFacing.suggestion?.type ?? null,
      interventionOfDay: read.userFacing.interventionOfDay.title,
      interventionCategory: read.userFacing.interventionOfDay.category,
    },
    longitudinal: {
      trendDirection: read.internal.longitudinal.trendDirection,
      monitoring: read.internal.longitudinal.monitoringFlag,
      relapseClass: read.internal.relapse?.class ?? null,
      relapseDrift: inf.relapseDrift ?? 0,
    },
    temporal: read.internal.temporal
      ? {
          segmentCount: read.internal.temporal.segmentCount,
          shape: read.internal.temporal.shape,
          variationMode: read.internal.temporal.variationMode,
          valenceArc: read.internal.temporal.valenceArc,
          arousalArc: read.internal.temporal.arousalArc,
          energyArc: read.internal.temporal.energyArc,
        }
      : null,
    warnings: collectWarnings(f, read),
    timingMs,
  };
  return result;
}

/**
 * Run ONE latent profile through the full production pipeline from raw PCM. Async
 * because the production experts expose an async `predict` (real models slot in
 * behind the same contract). Pure given `latent` + options (deterministic synth +
 * deterministic read).
 */
export async function runHum(id: string, latent: LatentHumProfile, opts: RunOptions = {}): Promise<SimResult> {
  const t0 = Date.now();
  const audio = renderHum(latent);
  const now = opts.now ?? simTimestamp(0);
  const consent = opts.consent ?? consentLocal(now);

  // EXACT production entry point — computeFeatures runs INSIDE orchestrateHumAudio.
  const read = await orchestrateHumAudio({
    audio,
    consent,
    modelVersion: SIM_MODEL_VERSION,
    now,
    history: opts.history,
  });
  return captureResult(id, latent, audio, read, Date.now() - t0);
}

/**
 * Run ONE latent profile through the full pipeline WITH an explicit within-hum CONTOUR override
 * (v13). The contour (`energyShift` / `pitchShiftSemis` / `shiftCenter` / `shiftSharpness`) is the
 * within-hum arc an inner state requests — e.g. a depressive FADING + falling-pitch arc, or an
 * anxious RISING/jittery arc — so a single inner-state hum shapes BOTH the mean latent AND its
 * trajectory. The contour is applied to the controls AFTER `latentToControls`, exactly the seam the
 * v12 temporal gate uses. No label is fed into the pipeline (the expectation is scored separately).
 */
export async function runHumWithContour(
  id: string,
  latent: LatentHumProfile,
  contour: Partial<SynthControls>,
  opts: RunOptions = {},
): Promise<SimResult> {
  const t0 = Date.now();
  const audio = renderControls({ ...latentToControls(latent), ...contour });
  const now = opts.now ?? simTimestamp(0);
  const consent = opts.consent ?? consentLocal(now);
  const read = await orchestrateHumAudio({
    audio,
    consent,
    modelVersion: SIM_MODEL_VERSION,
    now,
    history: opts.history,
  });
  return captureResult(id, latent, audio, read, Date.now() - t0);
}

/** Run a batch of latent profiles (sequential — keeps memory + determinism simple). */
export async function runBatch(
  items: ReadonlyArray<{ id: string; latent: LatentHumProfile }>,
  opts: RunOptions = {},
): Promise<SimResult[]> {
  const out: SimResult[] = [];
  for (const it of items) out.push(await runHum(it.id, it.latent, opts));
  return out;
}

/** Mean of a numeric array, NaN-safe (used by the analysis layer). */
export function meanOf(xs: readonly number[]): number {
  return mean(xs);
}
