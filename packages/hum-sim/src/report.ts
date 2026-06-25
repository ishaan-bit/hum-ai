/**
 * REPORTING LAYER — runs the scenario suite through the real pipeline and renders both
 * a machine-readable artifact (JSON) and a human-readable markdown report. The markdown
 * leads with the center-collapse diagnosis, then the supporting evidence: extractor
 * fidelity, feature variance, reachability/zone histogram, sensitivity Jacobian, the
 * fidelity→affect leak, robustness/failure handling, and the longitudinal un-pin check.
 */
import {
  archetypeScenarios,
  failureScenarios,
  fidelityInvarianceScenarios,
  interactionScenarios,
  malformedAudioCases,
  reachabilitySweeps,
  robustnessScenarios,
  type ScenarioItem,
} from "./scenarios";
import { runBatch, type SimResult } from "./pipeline";
import {
  diagnoseCollapse,
  extractorFidelity,
  featureVariance,
  fidelityLeaks,
  sweepSensitivities,
  zoneHistogram,
  vaBox,
  type CollapseDiagnosis,
  type DriverSensitivity,
  type FeatureVariance,
  type FidelityLeak,
  type RecoveryCheck,
} from "./analysis";
import {
  distinctAcousticZones,
  distinctDisplayZones,
  personalizationDampSequence,
  pinUnpinSequence,
  runSequence,
} from "./longitudinal";
import { computeFeatures } from "@hum-ai/audio-features";
import { orchestrateHumAudio } from "@hum-ai/orchestrator";
import { consentLocal, SIM_MODEL_VERSION, simTimestamp } from "./context";

export interface AnalyzeOptions {
  readonly sweepSteps?: number;
  readonly sweepReps?: number;
  readonly archetypeReps?: number;
  /** Skip the (slow) longitudinal sequences. */
  readonly skipLongitudinal?: boolean;
}

export interface MalformedOutcome {
  readonly id: string;
  readonly note: string;
  readonly threw: boolean;
  readonly error: string | null;
  readonly decision: string | null;
  readonly abstained: boolean | null;
}

export interface LongitudinalSummary {
  readonly pinUnpin: {
    readonly hums: number;
    readonly acousticZones: number;
    readonly displayZones: number;
    readonly acousticValenceSpan: number;
    readonly displayValenceSpan: number;
    readonly unpinned: boolean;
  };
  readonly damp: {
    readonly baselineHums: number;
    readonly finalAcousticVA: { valence: number; arousal: number };
    readonly finalDisplayVA: { valence: number; arousal: number };
    readonly finalInternalVA: { valence: number; arousal: number };
    readonly internalDampedTowardOrigin: boolean;
  };
}

export interface AnalysisArtifact {
  readonly meta: {
    readonly modelVersion: string;
    readonly counts: Record<string, number>;
    readonly totalHums: number;
    readonly totalTimingMs: number;
  };
  readonly diagnosis: CollapseDiagnosis;
  readonly extractorFidelity: readonly RecoveryCheck[];
  readonly featureVariance: readonly FeatureVariance[];
  readonly sensitivities: readonly DriverSensitivity[];
  readonly fidelityLeaks: readonly FidelityLeak[];
  readonly robustness: ReadonlyArray<Pick<SimResult, "id" | "zone"> & { decision: string; captureQuality: string; abstained: boolean; warnings: readonly string[]; displayValence: number; displayArousal: number }>;
  readonly failures: ReadonlyArray<Pick<SimResult, "id" | "zone"> & { decision: string; abstained: boolean; warnings: readonly string[] }>;
  readonly malformed: readonly MalformedOutcome[];
  readonly longitudinal: LongitudinalSummary | null;
}

const num = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : "—");

async function runMalformed(): Promise<MalformedOutcome[]> {
  const out: MalformedOutcome[] = [];
  const now = simTimestamp(0);
  for (const c of malformedAudioCases()) {
    try {
      // computeFeatures must not throw on valid-but-degenerate audio; orchestrate must
      // return a safe (rejected/abstained) read. Some cases (bad sampleRate) MUST throw.
      computeFeatures(c.audio);
      const read = await orchestrateHumAudio({ audio: c.audio, consent: consentLocal(now), modelVersion: SIM_MODEL_VERSION, now });
      out.push({ id: c.id, note: c.note, threw: false, error: null, decision: read.internal.quality.decision, abstained: read.userFacing.abstained });
    } catch (e) {
      out.push({ id: c.id, note: c.note, threw: true, error: e instanceof Error ? e.message : String(e), decision: null, abstained: null });
    }
  }
  return out;
}

/** Run the full suite + analyses and return the machine-readable artifact. */
export async function analyze(opts: AnalyzeOptions = {}): Promise<AnalysisArtifact> {
  const t0 = Date.now();
  const sweeps = reachabilitySweeps(opts.sweepSteps, opts.sweepReps);
  const archetypes = archetypeScenarios(opts.archetypeReps);
  const interactions = interactionScenarios();
  const fidelity = fidelityInvarianceScenarios();
  const robustnessItems = robustnessScenarios();
  const failureItems = failureScenarios();

  const sweepResults = await runBatch(sweeps);
  const archetypeResults = await runBatch(archetypes);
  const interactionResults = await runBatch(interactions);
  const fidelityResults = await runBatch(fidelity);
  const robustnessResults = await runBatch(robustnessItems);
  const failureResults = await runBatch(failureItems);
  const malformed = await runMalformed();

  // The "broad" set for the collapse diagnosis: realistic varied hums (archetypes +
  // interactions + the affect/voice-quality sweeps), EXCLUDING fidelity/robustness/failure
  // scenarios that deliberately degrade capture (those bias the zone histogram).
  const affectSweeps = sweepResults.filter((r) => !/(noiseLevel|micBandwidth|roomReverb)/.test(r.id));
  const broad = [...archetypeResults, ...interactionResults, ...affectSweeps];

  const sensitivities = sweepSensitivities(sweepResults);
  const leaks = fidelityLeaks(fidelityResults);
  const diagnosis = diagnoseCollapse(broad, sensitivities, leaks);
  const recovery = extractorFidelity(sensitivities);
  const fv = featureVariance(broad);

  let longitudinal: LongitudinalSummary | null = null;
  if (!opts.skipLongitudinal) {
    const pin = await runSequence(pinUnpinSequence());
    const damp = await runSequence(personalizationDampSequence());
    const acVals = pin.steps.map((s) => s.result.axisAcoustic.valence);
    const dispVals = pin.steps.map((s) => s.result.displayAxis.valence);
    const acSpan = Math.max(...acVals) - Math.min(...acVals);
    const dispSpan = Math.max(...dispVals) - Math.min(...dispVals);
    const last = damp.steps[damp.steps.length - 1]!.result;
    longitudinal = {
      pinUnpin: {
        hums: pin.steps.length,
        acousticZones: distinctAcousticZones(pin).size,
        displayZones: distinctDisplayZones(pin).size,
        acousticValenceSpan: acSpan,
        displayValenceSpan: dispSpan,
        unpinned: distinctDisplayZones(pin).size >= 3 && dispSpan > acSpan * 1.3,
      },
      damp: {
        baselineHums: damp.steps.length - 1,
        finalAcousticVA: last.axisAcoustic,
        finalDisplayVA: last.displayAxis,
        finalInternalVA: last.internalDimensional,
        internalDampedTowardOrigin:
          Math.hypot(last.internalDimensional.valence, last.internalDimensional.arousal) <
          0.5 * Math.hypot(last.axisAcoustic.valence, last.axisAcoustic.arousal),
      },
    };
  }

  const totalHums =
    sweepResults.length + archetypeResults.length + interactionResults.length +
    fidelityResults.length + robustnessResults.length + failureResults.length;

  return {
    meta: {
      modelVersion: String(SIM_MODEL_VERSION),
      counts: {
        sweeps: sweepResults.length,
        archetypes: archetypeResults.length,
        interactions: interactionResults.length,
        fidelity: fidelityResults.length,
        robustness: robustnessResults.length,
        failure: failureResults.length,
        malformed: malformed.length,
      },
      totalHums,
      totalTimingMs: Date.now() - t0,
    },
    diagnosis,
    extractorFidelity: recovery,
    featureVariance: fv,
    sensitivities,
    fidelityLeaks: leaks,
    robustness: robustnessResults.map((r) => ({
      id: r.id, zone: r.zone, decision: r.quality.decision, captureQuality: r.quality.captureQuality,
      abstained: r.userFacing.abstained, warnings: r.warnings, displayValence: r.displayAxis.valence, displayArousal: r.displayAxis.arousal,
    })),
    failures: failureResults.map((r) => ({ id: r.id, zone: r.zone, decision: r.quality.decision, abstained: r.userFacing.abstained, warnings: r.warnings })),
    malformed,
    longitudinal,
  };
}

/** Render the analysis artifact as a markdown report. */
export function renderMarkdown(a: AnalysisArtifact): string {
  const L: string[] = [];
  const d = a.diagnosis;
  L.push(`# Hum Simulator — Pipeline Validation Report`);
  L.push("");
  L.push(`_Mechanistic pipeline validation, NOT clinical evidence. Model \`${a.meta.modelVersion}\`. ${a.meta.totalHums} synthesized hums through the exact \`computeFeatures → orchestrateHumRead\` path in ${(a.meta.totalTimingMs / 1000).toFixed(1)}s._`);
  L.push("");

  L.push(`## 1. Center-collapse diagnosis`);
  if (d.verdicts.length === 0) L.push(`No collapse verdicts triggered on this run.`);
  for (const v of d.verdicts) L.push(`- ⚠️ ${v}`);
  L.push("");
  L.push(`**Headline-zone histogram** (${d.zones.total} varied hums):`);
  L.push("");
  L.push(`| Zone | Count | % |`);
  L.push(`|---|---:|---:|`);
  for (const [z, c] of Object.entries(d.zones.counts).sort((x, y) => y[1] - x[1])) {
    L.push(`| ${z} | ${c} | ${((c / d.zones.total) * 100).toFixed(0)}% |`);
  }
  L.push("");
  L.push(`Center "Steady/Even": **${(d.zones.centerFraction * 100).toFixed(0)}%** · diagonal corners: ${(d.zones.diagonalFraction * 100).toFixed(0)}% · distinct zones reached: ${d.zones.distinctZones}/9`);
  L.push("");
  L.push(`**V-A reachability by stage** (P05…P95):`);
  L.push("");
  L.push(`| Stage | Valence P05…P95 (span) | Arousal P05…P95 (span) |`);
  L.push(`|---|---|---|`);
  for (const [name, box] of [["acoustic backbone", d.acousticBox], ["displayed (user-facing)", d.displayBox], ["internal (fusion+personalization)", d.internalBox]] as const) {
    L.push(`| ${name} | ${num(box.valence.p05)}…${num(box.valence.p95)} (${num(box.valence.p95 - box.valence.p05)}) | ${num(box.arousal.p05)}…${num(box.arousal.p95)} (${num(box.arousal.p95 - box.arousal.p05)}) |`);
  }
  L.push("");

  L.push(`## 2. Extractor fidelity — does the DSP recover each synthesis control?`);
  L.push("");
  L.push(`| Latent control | Target feature | Expect | Observed | Low→High | Recovered |`);
  L.push(`|---|---|:--:|:--:|---|:--:|`);
  for (const r of a.extractorFidelity) {
    const arrow = r.expectedSign > 0 ? "↑" : "↓";
    const obs = r.observedSlopeSign > 0 ? "↑" : r.observedSlopeSign < 0 ? "↓" : "·";
    L.push(`| ${r.driver} | ${r.feature.replace("feat.", "")} | ${arrow} | ${obs} | ${num(r.atLow, 3)} → ${num(r.atHigh, 3)} | ${r.recovered ? "✅" : "❌"} |`);
  }
  const recovered = a.extractorFidelity.filter((r) => r.recovered).length;
  L.push("");
  L.push(`Recovered ${recovered}/${a.extractorFidelity.length}. A ✅ means realistic audio carrying that quality produces the right feature movement — so the collapse (where present) is NOT a feature-extraction failure but lives in the read math.`);
  L.push("");

  L.push(`## 3. Sensitivity Jacobian — what drives the user-facing read`);
  L.push("");
  L.push(`**Displayed VALENCE drivers** (span across each control's 0→1 sweep):`);
  L.push("");
  L.push(`| Driver | Span | Dir | Monotonic | Saturated |`);
  L.push(`|---|---:|:--:|:--:|:--:|`);
  for (const dr of d.valenceDrivers.slice(0, 8)) {
    L.push(`| ${dr.driver} | ${num(dr.span)} | ${dr.slopeSign > 0 ? "↑" : dr.slopeSign < 0 ? "↓" : "·"} | ${dr.monotonic ? "yes" : "no"} | ${dr.saturated ? "yes" : "no"} |`);
  }
  L.push("");
  L.push(`**Displayed AROUSAL drivers:**`);
  L.push("");
  L.push(`| Driver | Span | Dir | Monotonic | Saturated |`);
  L.push(`|---|---:|:--:|:--:|:--:|`);
  for (const dr of d.arousalDrivers.slice(0, 8)) {
    L.push(`| ${dr.driver} | ${num(dr.span)} | ${dr.slopeSign > 0 ? "↑" : dr.slopeSign < 0 ? "↓" : "·"} | ${dr.monotonic ? "yes" : "no"} | ${dr.saturated ? "yes" : "no"} |`);
  }
  L.push("");

  L.push(`## 4. Fidelity → affect leak (mood fixed, recording quality varied)`);
  L.push("");
  L.push(`Fidelity must not MANUFACTURE affect. "Drift" is the raw span across the sweep (includes honest fade-toward-neutral under noise); "Manufactured" is movement toward a wrong pole / beyond the clean read — the real leak (tolerance ${0.15}).`);
  L.push("");
  L.push(`| Fixed mood | Control | Drift V/A | Manufactured V | Manufactured A | Leak |`);
  L.push(`|---|---|---|---:|---:|:--:|`);
  for (const l of a.fidelityLeaks) {
    L.push(`| ${l.mood} | ${l.control} | ${num(l.valenceDrift)}/${num(l.arousalDrift)} | ${num(l.directionalValence)} | ${num(l.directionalArousal)} | ${l.leaks ? "❌" : "✅"} |`);
  }
  L.push("");

  L.push(`## 5. Feature variance (lowest-variance / dead first)`);
  L.push("");
  L.push(`| Feature | mean | std | span | CV | null% | low-var |`);
  L.push(`|---|---:|---:|---:|---:|---:|:--:|`);
  for (const f of a.featureVariance.slice(0, 18)) {
    L.push(`| ${f.feature} | ${num(f.stat.mean, 3)} | ${num(f.stat.std, 3)} | ${num(f.stat.span, 3)} | ${num(f.coefVar, 2)} | ${(f.nullFraction * 100).toFixed(0)}% | ${f.lowVariance ? "⚠️" : ""} |`);
  }
  L.push("");

  L.push(`## 6. Robustness & failure handling`);
  L.push("");
  const rejected = a.robustness.filter((r) => r.decision === "rejected").length;
  const abst = a.robustness.filter((r) => r.abstained).length;
  L.push(`Robustness scenarios: ${a.robustness.length} (rejected ${rejected}, abstained ${abst}). Failure scenarios: ${a.failures.length} (rejected ${a.failures.filter((f) => f.decision === "rejected").length}, abstained ${a.failures.filter((f) => f.abstained).length}).`);
  L.push("");
  L.push(`**Malformed raw-audio handling:**`);
  L.push("");
  L.push(`| Case | Note | Threw | Decision | Abstained |`);
  L.push(`|---|---|:--:|---|:--:|`);
  for (const m of a.malformed) {
    L.push(`| ${m.id.replace("malformed/", "")} | ${m.note} | ${m.threw ? "yes" : "no"} | ${m.decision ?? (m.threw ? `(${m.error?.slice(0, 28)})` : "—")} | ${m.abstained === null ? "—" : m.abstained ? "yes" : "no"} |`);
  }
  L.push("");

  if (a.longitudinal) {
    const lp = a.longitudinal.pinUnpin;
    const ld = a.longitudinal.damp;
    L.push(`## 7. Longitudinal (stateful) checks`);
    L.push("");
    L.push(`**Pin / un-pin** — fixed-voice user, ${lp.hums} hums: absolute-acoustic zones ${lp.acousticZones} (valence span ${num(lp.acousticValenceSpan)}) → displayed zones ${lp.displayZones} (valence span ${num(lp.displayValenceSpan)}). Within-user re-reference ${lp.unpinned ? "**re-opened**" : "did NOT re-open"} the read.`);
    L.push("");
    L.push(`**Personalization damp (H3)** — ${ld.baselineHums} calm baseline hums then one strong hum: acoustic ${num(ld.finalAcousticVA.valence)},${num(ld.finalAcousticVA.arousal)} · displayed ${num(ld.finalDisplayVA.valence)},${num(ld.finalDisplayVA.arousal)} · internal ${num(ld.finalInternalVA.valence)},${num(ld.finalInternalVA.arousal)}. Internal read ${ld.internalDampedTowardOrigin ? "**damped toward origin**" : "preserved the deviation"}.`);
    L.push("");
  }

  return L.join("\n");
}
