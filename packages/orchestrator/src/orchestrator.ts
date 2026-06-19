import {
  assertNoRawAudioFields,
  clamp01,
  hasConsent,
  MODALITIES,
  type ConsentState,
  type IsoTimestamp,
  type ModelVersion,
  type UnitInterval,
} from "@hum-ai/shared-types";
import { computeFeatures, metricsFromFeatures } from "@hum-ai/audio-features";
import type { AcousticFeatures, AudioInput } from "@hum-ai/audio-features";
import { evaluateQuality } from "@hum-ai/quality-gate";
import type { QualityResult } from "@hum-ai/quality-gate";
import { HeuristicDomainClassifier, HumDomainAdapter } from "@hum-ai/domain-classifier";
import type { DomainClassification } from "@hum-ai/domain-classifier";
import { defaultAudioExperts } from "@hum-ai/expert-ser";
import { FusionEngine, combineCaps, modalityReliability } from "@hum-ai/fusion-engine";
import type { FusionContext } from "@hum-ai/fusion-engine";
import {
  applyPersonalization,
  baselineDivergence,
  buildDualBaseline,
  buildRelapseReferences,
  ingestHum,
  stagePolicy,
  zDeltasAgainstBaseline,
} from "@hum-ai/personalization-engine";
import type {
  BaselineDivergence,
  DualBaseline,
  HumObservation,
  PersonalizationApplication,
  PersonalizationStage,
  PersonalizationState,
} from "@hum-ai/personalization-engine";
import { assessRelapse } from "@hum-ai/relapse-engine";
import type { RelapseReferenceKind, RelapseSample, RelapseVerdict } from "@hum-ai/relapse-engine";
import { selectInterventionFromView } from "@hum-ai/intervention-engine";
import type { InterventionContext } from "@hum-ai/intervention-engine";
import {
  assertNoClinicalLeak,
  splitInference,
  toRecommendationView,
} from "@hum-ai/affect-model-contracts";
import type {
  AffectStateHead,
  InterventionType,
  MultiHeadAffectInference,
  RecommendationView,
  TwoHeadAffectOutput,
} from "@hum-ai/affect-model-contracts";
import {
  assertSafeUserFacingText,
  isConfidenceCopySafe,
  userFacingConfidence,
} from "@hum-ai/safety-language";
import type { UserFacingConfidence } from "@hum-ai/safety-language";
import { clinicalRiskScore } from "./risk";
import { INTERVENTION_COPY, broadHeadline, readNote } from "./copy";

/**
 * END-TO-END ORCHESTRATOR (NEXT_PROMPT goal; composes ADR-0006/0007/0008/0009).
 *
 * One module that runs the full read path over DERIVED features only:
 *
 *   audio-features → quality-gate → domain-classifier → expert-ser →
 *   fusion-engine → personalization (dual baseline) → relapse-engine →
 *   intervention-engine → safety-language
 *
 * and enforces the three closed architecture decisions at the seams:
 *
 *  - **Two-head separation (ADR-0006).** `splitInference(inf, consent)` applies the
 *    consent gate; only `toRecommendationView(inf)` reaches the intervention
 *    engine; `assertNoClinicalLeak` guards both the recommendation view and the
 *    user-facing output. Clinical-risk labels never leave the internal object.
 *  - **Dual baseline (ADR-0007).** `buildDualBaseline` from eligible-hum features;
 *    `baselineDivergence` informs both the `relapseDrift` head and
 *    `longitudinalTrendStrength` (which tempers fusion confidence).
 *  - **Qualitative confidence (ADR-0008).** `userFacingConfidence(...)` only; the
 *    raw number is never surfaced, and every user string is screened.
 *
 * Voice-first (ADR-0009): the orchestrator consumes audio-derived features only;
 * no camera/visual modality is wired.
 *
 * Raw audio never reaches here — the input is the derived `AcousticFeatures`.
 */

/** Prior eligible-hum history that feeds the dual baseline and relapse engine. */
export interface HumHistory {
  /** Per-feature sample arrays over prior ELIGIBLE hums (most-recent last). */
  readonly eligibleSamplesByFeature: Record<string, readonly number[]>;
  /** Count of prior eligible hums (account maturity for stage + confidence copy). */
  readonly priorEligibleCount: number;
  /** Personal relapse references (previous stable / high-risk / 7d / 30d), optional. */
  readonly relapseReferences?: Partial<Record<RelapseReferenceKind, RelapseSample>>;
}

export interface OrchestratorInput {
  /** Derived features for the current hum. Raw audio never enters the orchestrator. */
  readonly features: AcousticFeatures;
  /** User consent state — gates clinical-risk surfacing (defaults to local-only). */
  readonly consent: ConsentState;
  readonly modelVersion: ModelVersion;
  readonly now: IsoTimestamp;
  readonly history?: HumHistory;
}

/**
 * The SAFE-to-render projection. Carries qualitative confidence, plain copy, and
 * a single suggestion — and provably no clinical-risk marker key and no raw
 * confidence number.
 */
export interface UserFacingRead {
  readonly abstained: boolean;
  readonly isEarlyBaseline: boolean;
  /** Qualitative only (High/Medium/Low evidence or Early baseline) — never a number. */
  readonly confidence: UserFacingConfidence;
  readonly headline: string;
  readonly note: string;
  readonly suggestion: { readonly type: InterventionType; readonly copy: string } | null;
}

/** Internal, NEVER-rendered detail (logging, eval, consent-gated risk surfacing). */
export interface InternalRead {
  /** The DERIVED features this read was computed from (never raw audio). */
  readonly features: AcousticFeatures;
  readonly inference: MultiHeadAffectInference;
  /** Two heads; the clinical head is consent-gated (withheld by default). */
  readonly twoHead: TwoHeadAffectOutput;
  readonly relapse: RelapseVerdict | null;
  readonly dualBaseline: DualBaseline;
  readonly divergence: BaselineDivergence;
  readonly quality: QualityResult;
  readonly domain: DomainClassification;
  /** How the read was re-referenced against the user's own baseline (transparency). */
  readonly personalization: PersonalizationApplication;
  /**
   * Per-modality reliability fusion observed this hum, in `MODALITIES` order
   * `[audio, face, text]` (feeds reliability learning). An ARRAY, not an object,
   * so the read carries no `audio`-keyed field through the raw-audio name guard.
   */
  readonly observedModalityReliabilityByOrder: readonly number[];
  /** Live hum-domain match used to weight the read (feeds domain-trust learning). */
  readonly domainMatch: UnitInterval;
  readonly stage: PersonalizationStage;
  readonly eligibleHumCount: number;
}

export interface OrchestratedRead {
  /** Safe to render directly. */
  readonly userFacing: UserFacingRead;
  /** Exactly what the recommendation engine received (sanitized bands, no labels). */
  readonly recommendationView: RecommendationView;
  /** Internal-only. Must never be handed to UI/recommendation code. */
  readonly internal: InternalRead;
}

const EMPTY_HISTORY: HumHistory = { eligibleSamplesByFeature: {}, priorEligibleCount: 0 };

/** Argmax over the benign broad-affect states (risk markers are absent here). */
function dominantBroadState(states: TwoHeadAffectOutput["broad"]["states"]): AffectStateHead | null {
  let best: AffectStateHead | null = null;
  let bestVal = 0;
  for (const [head, value] of Object.entries(states) as [AffectStateHead, number | undefined][]) {
    if (value !== undefined && value > bestVal) {
      bestVal = value;
      best = head;
    }
  }
  return best;
}

/** Divergence magnitude → longitudinal trend strength [0,1] (≈2.5σ ⇒ full). */
function longitudinalTrend(divergence: BaselineDivergence): number {
  return divergence.anchored ? clamp01(divergence.magnitude / 2.5) : 0;
}

/** Gather every user-facing string for the safety screen. */
function userFacingStrings(read: UserFacingRead): string[] {
  const strings = [
    read.headline,
    read.note,
    read.confidence.signalClarity,
    read.confidence.basedOn,
    read.confidence.summary,
  ];
  if (read.suggestion) strings.push(read.suggestion.copy);
  return strings;
}

/**
 * Run the full read. Async because the audio experts expose an async `predict`
 * (real models slot in behind the same contract later).
 */
export async function orchestrateHumRead(input: OrchestratorInput): Promise<OrchestratedRead> {
  const { features, consent, modelVersion, now } = input;
  const history = input.history ?? EMPTY_HISTORY;

  // 1. Dual baseline (history only) → divergence → longitudinal trend strength.
  const dualBaseline = buildDualBaseline(history.eligibleSamplesByFeature);
  const divergence = baselineDivergence(dualBaseline);
  const longitudinalTrendStrength = longitudinalTrend(divergence);

  // 2. Quality gate (RMS measured against the rolling baseline center when present).
  const rollingRms = dualBaseline.rolling.vector["meanRms"];
  const baselineRmsRatio =
    rollingRms && rollingRms.median > 0 ? features.meanRms / rollingRms.median : null;
  const quality = evaluateQuality(metricsFromFeatures(features, baselineRmsRatio));

  const eligibleHumCount = history.priorEligibleCount + (quality.baselineEligible ? 1 : 0);
  const stage = stagePolicy(eligibleHumCount);

  // 3. Domain classification + hum-compatibility penalty.
  const domain = new HeuristicDomainClassifier().classify(features);
  const domainAdaptation = new HumDomainAdapter().scoreCapture(domain);

  // 4. Audio-stream experts.
  const meta = { modality: "audio" as const, captureQuality: quality.captureQualityScore };
  const experts = await Promise.all(defaultAudioExperts().map((e) => e.predict(features, meta)));
  const observedModalityReliability = modalityReliability(experts);

  // 5. Strictest of the personalization-stage, capture-quality and domain caps.
  const caps = combineCaps([
    { cap: stage.confidenceCap, reason: stage.capReason },
    { cap: quality.confidenceCap, reason: `capture quality (${quality.captureQuality})` },
    { cap: domainAdaptation.confidencePenalty, reason: `domain match (heard ${domain.predicted})` },
  ]);

  // 6. Late fusion → calibrated multi-head inference.
  const fusionCtx: FusionContext = {
    modelVersion,
    captureQuality: quality.captureQualityScore,
    domainMatch: domainAdaptation.domainMatch,
    caps,
    calibrationMaturity: stage.calibrationMaturity,
    longitudinalTrendStrength,
  };
  const baseInf = new FusionEngine().fuse(experts, fusionCtx);

  // 6b. PERSONALIZATION — re-reference the population-prior read against the user's
  //     OWN rolling baseline so the read is INDIVIDUAL, not population-derived. The
  //     more this hum matches the user's usual, the more it reads as their usual;
  //     the more it departs, the more the prior is preserved. Influence is 0 until
  //     the baseline is active and grows up the ladder (`applyPersonalization`).
  const currentSamples = humFeatureSamples(features);
  const personalZDeltas = stage.baselineActive
    ? zDeltasAgainstBaseline(currentSamples, dualBaseline.rolling.vector)
    : {};
  const { inference: personalizedInf, application: personalization } = applyPersonalization(
    baseInf,
    personalZDeltas,
    stage,
  );

  // 7. Relapse (within-user) + dual-baseline-informed drift, on the PERSONALIZED
  //    read. The relapse engine receives only an opaque riskScore from the clinical
  //    head — now an individual one, scored against the user's own baseline.
  const currentRiskScore = clinicalRiskScore(personalizedInf);
  const references = history.relapseReferences ?? {};
  const relapseActive = stage.relapseModelActive && Object.keys(references).length > 0;
  const relapse: RelapseVerdict | null = relapseActive
    ? assessRelapse(
        { capturedAt: now, dimensional: personalizedInf.dimensional, riskScore: currentRiskScore },
        references,
      )
    : null;

  const divergenceDrift = divergence.anchored ? clamp01(divergence.magnitude / 2.5) : 0;
  const relapseDrift = clamp01(Math.max(relapse ? relapse.drift : 0, divergenceDrift));

  const inferenceWithLongitudinal: MultiHeadAffectInference = {
    ...personalizedInf,
    relapseDrift,
    recoveryWorseningUnchanged: relapse ? relapse.dvdsa : null,
  };

  // 8. Recommendation path — the engine sees ONLY the sanitized view (no labels).
  const recommendationView = toRecommendationView(inferenceWithLongitudinal);
  assertNoClinicalLeak(recommendationView); // defense in depth before the engine touches it

  const interventionCtx: InterventionContext = {
    persistentRiskPattern:
      relapse !== null && (relapse.class === "relapse_drift" || relapse.class === "worsening"),
    // Escalation copy is sensitive: only ever offered to a user who opted into
    // clinical-risk surfacing. Conservative by design (never alarm the unconsented).
    safetyAllowsEscalation: hasConsent(consent, "clinical_risk_surfacing"),
  };
  const suggestion = selectInterventionFromView(recommendationView, interventionCtx);

  const inference: MultiHeadAffectInference = {
    ...inferenceWithLongitudinal,
    recommendedIntervention: suggestion.type === "none" ? null : suggestion.type,
  };

  // 9. Two-head split with the consent gate (clinical head withheld by default).
  const twoHead = splitInference(inference, consent);

  // 10. Qualitative confidence + plain copy, then SCREEN everything.
  const confidence = userFacingConfidence(inference.confidence, eligibleHumCount);
  const dominant = inference.abstained ? null : dominantBroadState(twoHead.broad.states);
  const userFacing: UserFacingRead = {
    abstained: inference.abstained,
    isEarlyBaseline: confidence.isEarlyBaseline,
    confidence,
    headline: broadHeadline(dominant, inference.abstained),
    note: readNote({
      abstained: inference.abstained,
      isEarlyBaseline: confidence.isEarlyBaseline,
      divergenceActive: divergence.anchored,
      divergenceMagnitude: divergence.magnitude,
    }),
    suggestion: inference.abstained
      ? null
      : { type: suggestion.type, copy: INTERVENTION_COPY[suggestion.type] },
  };

  // Lexical screen (no diagnosis/clinical-certainty phrasing; no raw % confidence).
  for (const text of userFacingStrings(userFacing)) {
    assertSafeUserFacingText(text);
    if (!isConfidenceCopySafe(text)) {
      throw new Error(`user-facing copy leaked a raw confidence number: "${text}"`);
    }
  }
  // Structural backstop: no clinical-risk marker key may appear in the rendered object.
  assertNoClinicalLeak(userFacing);

  return {
    userFacing,
    recommendationView,
    internal: {
      features,
      inference,
      twoHead,
      relapse,
      dualBaseline,
      divergence,
      quality,
      domain,
      personalization,
      observedModalityReliabilityByOrder: MODALITIES.map((m) => observedModalityReliability[m]),
      domainMatch: domainAdaptation.domainMatch,
      stage: stage.stage,
      eligibleHumCount,
    },
  };
}

/** Audio-buffer entry: raw PCM in, full orchestrated read out. */
export interface AudioOrchestratorInput {
  /** Raw, EPHEMERAL audio. Used only to extract derived features; never stored/returned. */
  readonly audio: AudioInput;
  readonly consent: ConsentState;
  readonly modelVersion: ModelVersion;
  readonly now: IsoTimestamp;
  readonly history?: HumHistory;
}

/**
 * Run the full read from a raw audio buffer. Feature extraction happens HERE,
 * on-device; the raw buffer is consumed by `computeFeatures` and then dropped —
 * it is never persisted, synced, or placed in the returned object (which carries
 * only the derived `AcousticFeatures`). This is the typed-audio entry point that
 * mirrors what a real capture surface would call.
 */
export async function orchestrateHumAudio(input: AudioOrchestratorInput): Promise<OrchestratedRead> {
  const features = computeFeatures(input.audio);
  return orchestrateHumRead({
    features,
    consent: input.consent,
    modelVersion: input.modelVersion,
    now: input.now,
    history: input.history,
  });
}

/**
 * Project the derived `AcousticFeatures` into the flat `Record<string, number>`
 * the baseline / personalization layer works in: every finite numeric field
 * (booleans and the `featureMode` string are excluded). Exported so callers build
 * `HumHistory.eligibleSamplesByFeature` with the SAME keys the read re-references
 * against.
 */
export function humFeatureSamples(features: AcousticFeatures): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * THE PERSONALIZATION LOOP — bridges (1/2).
 *
 * Derive the read-time `HumHistory` from a persisted `PersonalizationState` so the
 * orchestrator personalizes against the user's accumulated model: the bounded
 * feature windows become the baseline samples, the eligible count sets the stage,
 * and the relapse history is collapsed into the four personal references.
 */
export function humHistoryFromState(state: PersonalizationState, now: IsoTimestamp): HumHistory {
  return {
    eligibleSamplesByFeature: state.featureWindows,
    priorEligibleCount: state.eligibleHumCount,
    relapseReferences: buildRelapseReferences(state.relapseHistory, now),
  };
}

/**
 * THE PERSONALIZATION LOOP — bridges (2/2).
 *
 * Derive the learning `HumObservation` from a completed read. The full loop is:
 *
 *   const history = humHistoryFromState(state, now);
 *   const read = await orchestrateHumRead({ features, consent, modelVersion, now, history });
 *   state = ingestHum(state, observationFromRead(read, now));   // learn from this hum
 *
 * `ingestHum` is re-exported here so a caller has the whole loop from one module.
 */
export function observationFromRead(read: OrchestratedRead, capturedAt: IsoTimestamp): HumObservation {
  const internal = read.internal;
  const rel = internal.observedModalityReliabilityByOrder;
  return {
    capturedAt,
    features: humFeatureSamples(internal.features),
    eligible: internal.quality.baselineEligible,
    // Rebuild the modality reliability object from the order-indexed array.
    observedModalityReliability: { audio: rel[0] ?? 0, face: rel[1] ?? 0, text: rel[2] ?? 0 },
    heardDomain: internal.domain.predicted,
    domainMatch: internal.domainMatch,
    dimensional: internal.inference.dimensional,
    riskScore: clinicalRiskScore(internal.inference),
  };
}

export { ingestHum };
export type { HumObservation, PersonalizationState };

/**
 * The derived, sync-safe projection of a read. Carries ONLY derived features and
 * qualitative/abstracted summaries — never raw audio, never a clinical-risk label,
 * never the raw numeric confidence.
 */
export interface HumSyncPayload {
  readonly featureMode: string;
  readonly capturedAt: IsoTimestamp;
  readonly modelVersion: ModelVersion;
  /** Derived features only — the single representation the privacy posture allows to sync. */
  readonly derivedFeatures: AcousticFeatures;
  readonly quality: {
    readonly decision: QualityResult["decision"];
    readonly captureQuality: QualityResult["captureQuality"];
    readonly captureQualityScore: number;
    readonly baselineEligible: boolean;
  };
  readonly domain: {
    readonly predicted: DomainClassification["predicted"];
    readonly confidence: number;
  };
  /** Qualitative evidence level (High/Medium/Low/Early baseline) — never a raw number. */
  readonly evidenceLevel: UserFacingConfidence["evidenceLevel"];
  readonly eligibleHumCount: number;
  readonly abstained: boolean;
}

/**
 * Build the derived sync payload from a read and run the privacy guards BEFORE
 * returning it. `assertNoRawAudioFields` is the last line of defense against a
 * raw-audio-like field reaching a sync payload; `assertNoClinicalLeak` keeps any
 * clinical-risk label out of it (ADR-0006). Either guard throws rather than
 * letting an unsafe payload through.
 */
export function buildHumSyncPayload(
  read: OrchestratedRead,
  meta: { readonly capturedAt: IsoTimestamp; readonly modelVersion: ModelVersion },
): HumSyncPayload {
  const q = read.internal.quality;
  const payload: HumSyncPayload = {
    featureMode: read.internal.features.featureMode,
    capturedAt: meta.capturedAt,
    modelVersion: meta.modelVersion,
    derivedFeatures: read.internal.features,
    quality: {
      decision: q.decision,
      captureQuality: q.captureQuality,
      captureQualityScore: q.captureQualityScore,
      baselineEligible: q.baselineEligible,
    },
    domain: { predicted: read.internal.domain.predicted, confidence: read.internal.domain.confidence },
    evidenceLevel: read.userFacing.confidence.evidenceLevel,
    eligibleHumCount: read.internal.eligibleHumCount,
    abstained: read.userFacing.abstained,
  };

  assertNoRawAudioFields(payload); // privacy guard — no raw-audio-like field may sync
  assertNoClinicalLeak(payload); // ADR-0006 — no clinical-risk label may sync
  return payload;
}
