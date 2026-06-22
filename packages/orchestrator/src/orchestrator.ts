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
import type { FusionContext, MetaLearner } from "@hum-ai/fusion-engine";
// Re-export so consumers of `OrchestratorInput.metaLearner` get the type from the orchestrator.
export type { MetaLearner } from "@hum-ai/fusion-engine";
import {
  adaptiveBlendWeight,
  applyAxisCalibration,
  applyPersonalization,
  axisCalibrationEngaged,
  baselineDivergence,
  blendSalience,
  buildDualBaseline,
  buildRelapseReferences,
  contextAdjustedBaseline,
  ingestHum,
  policyConfidence,
  selectByUCB,
  signatureAlignment,
  stagePolicy,
  timeBucket,
  zDeltasAgainstBaseline,
} from "@hum-ai/personalization-engine";
import type {
  BaselineDivergence,
  ContextualCenters,
  DualBaseline,
  HumObservation,
  InterventionPolicy,
  PersonalAxisCalibration,
  PersonalizationApplication,
  PersonalizationStage,
  PersonalizationState,
} from "@hum-ai/personalization-engine";
import { assessLongitudinalState, assessRelapse, estimateTrend, personalStableBand } from "@hum-ai/relapse-engine";
import type {
  LongitudinalDiagnosticState,
  LongitudinalTrendDirection,
  RelapseReferenceKind,
  RelapseSample,
  RelapseVerdict,
  SeriesPoint,
} from "@hum-ai/relapse-engine";
import {
  selectInterventionFromView,
  selectInterventionOfDay,
  interventionOfDayStrings,
  supportiveCandidates,
  buildSupportiveSuggestion,
  isSupportiveIntervention,
} from "@hum-ai/intervention-engine";
import type { InterventionContext, InterventionOfDay } from "@hum-ai/intervention-engine";
import {
  assertNoClinicalLeak,
  splitInference,
  toRecommendationView,
} from "@hum-ai/affect-model-contracts";
import type {
  AffectExpert,
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
  EARLY_BASELINE_HUMS,
} from "@hum-ai/safety-language";
import type { UserFacingConfidence } from "@hum-ai/safety-language";
import { clinicalRiskScore } from "./risk";
import { INTERVENTION_COPY, axisHeadline, innerStateLine, readNote } from "./copy";
import { resolveAxisRead, axisReadConfidence, type AffectAxisPriors, type AxisRead } from "./axis-read";

/**
 * END-TO-END ORCHESTRATOR (NEXT_PROMPT goal; composes ADR-0006/0007/0008/0009).
 *
 * One module that runs the full read path over DERIVED features only:
 *
 *   audio-features → quality-gate → domain-classifier → expert-ser →
 *   fusion-engine → personalization (dual baseline) → relapse-engine →
 *   intervention-engine → safety-language
 *
 * **Pretrained/model inference (optional, governed).** A trained affect-PRIOR
 * expert (e.g. signal-lab's `LearnedAffectPriorExpert`) may be injected through
 * the standard `AffectExpert` contract via `input.learnedAffectPrior`. It is a
 * DROP-IN for the off-domain `SpeechEmotionExpert` stub (same acted-speech role),
 * fused — not trusted as truth — and it contributes a far-domain confidence cap
 * (ADR-0005). When absent, the deterministic heuristic ensemble runs unchanged
 * (honest fallback — no trained model is required to run the spine). The
 * orchestrator stays decoupled from signal-lab: only the contract crosses the
 * seam, so the trained model is loaded and constructed by the caller/bridge.
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
  /** Learned recovery-signature centroid (z-deltas in stable periods) — for alignment. */
  readonly recoverySignature?: Record<string, number>;
  /** Learned high-risk-signature centroid (z-deltas in high-risk periods) — for alignment. */
  readonly highRiskSignature?: Record<string, number>;
  /** Consecutive drifting hums through the previous read (longitudinal "min consecutive" rule). */
  readonly priorConsecutiveDriftHums?: number;
  /** Learned per-feature SALIENCE (v2) — weights the personal re-reference toward the user's informative axes. */
  readonly salience?: Record<string, number>;
  /** Recently-detected baseline REGIME shift direction (v2), if any — enables regime-aware adaptation. */
  readonly regimeShift?: "none" | "up" | "down";
  /** Learned per-intervention BANDIT policy (v2) — personalizes the supportive suggestion. */
  readonly interventionPolicy?: InterventionPolicy;
  /** Per-time-of-day feature centers (v2) — re-references against "your usual at this time of day". */
  readonly contextualCenters?: ContextualCenters;
  /**
   * Learned PERSONAL AXIS CALIBRATION (HiTL) — the user's own corrections re-centre the
   * population acoustic valence/arousal read on THIS person. Applied to the axis read
   * before personalization re-reference (silent within-user refinement; never amplifies).
   */
  readonly axisCalibration?: PersonalAxisCalibration;
  /**
   * Recent within-user RISK SERIES (most-recent last; `t` = capturedAt ms, `value` =
   * composite risk score) for the robust longitudinal trend (Theil–Sen + Mann–Kendall).
   * The current hum's point is appended by the read. Omitted ⇒ no series trend (the
   * single-comparison verdict stands).
   */
  readonly recentRiskSeries?: readonly SeriesPoint[];
  /**
   * HiTL-derived PER-FEATURE IMPORTANCE (`@hum-ai/native-corpus` `combinedFeatureImportance`)
   * — which derived features actually track THIS user's reported valence/arousal. Blended
   * into the personalization salience so the read leans on the axes that are predictive for
   * them. Omitted ⇒ salience is unchanged (no-op without HiTL data).
   */
  readonly featureImportance?: Record<string, number>;
}

/**
 * An optional pretrained affect-PRIOR expert injected into the read. Consumed
 * through the standard `AffectExpert` contract, so the orchestrator never needs
 * to know about signal-lab or model artifacts — the caller (or signal-lab's
 * runtime bridge) loads the model and constructs the expert.
 *
 * Governance (ADR-0005): a public-data prior is NEVER hum truth. It is fused as a
 * drop-in for the off-domain speech-emotion stub and contributes a far-domain
 * confidence cap (`confidenceCap`, e.g. 0.45) that the strictest-cap rule honours.
 */
export interface LearnedAffectPrior {
  /** The trained prior, behind the same contract as the heuristic experts. */
  readonly expert: AffectExpert;
  /** Far-domain confidence cap this prior contributes (ADR-0005); strictest wins. */
  readonly confidenceCap: UnitInterval;
  /** Reason surfaced in the binding-cap provenance (defaulted when omitted). */
  readonly capReason?: string;
  /** Artifact path the prior was loaded from (provenance only; never synced). */
  readonly artifact?: string;
  /**
   * Whether this prior's affect target passed the promotion gate, sourced from the
   * loader's model manifest (ADR-0005 / signal-lab `model_manifest.json`). `undefined`
   * when no manifest accompanied the artifact. Recorded in provenance so a consumer can
   * never mistake a kept-but-unpromoted population prior for a gate-validated model — the
   * fused read is identical either way (the prior is always penalized + capped).
   */
  readonly gatePassed?: boolean;
  /** Honest one-line gate/promotion note for provenance (never rendered/synced). */
  readonly gateNote?: string;
}

/** A learned prior recorded for audit but HELD out of the steering path (v3). */
export interface HeldPriorAudit {
  readonly expertId: string;
  readonly artifact: string | null;
  readonly gatePassed: boolean | null;
  readonly gateNote: string | null;
}

/** Which model produced this read (internal transparency — never rendered/synced). */
export interface ModelProvenance {
  readonly kind: "learned_affect_prior" | "heuristic_ensemble";
  /**
   * How a supplied learned affect prior contributed to the SECONDARY affect-state read
   * (v3 gate enforcement):
   *  - `fused` — gate-passed/unknown prior fused into the ensemble (within its far-domain cap);
   *  - `held_failed_gate` — prior supplied but HELD out of fusion because it failed its
   *    promotion gate (the heuristic ensemble steered instead; recorded in `heldPrior`);
   *  - `none` — no learned prior supplied (heuristic ensemble).
   */
  readonly priorContribution: "fused" | "held_failed_gate" | "none";
  /** Expert id that supplied the learned prior, or null for the heuristic ensemble. */
  readonly expertId: string | null;
  /** Artifact path the learned prior came from, or null. */
  readonly artifact: string | null;
  /** Number of experts fused this read. */
  readonly expertCount: number;
  /**
   * Whether the STEERING prior's affect target passed its promotion gate (manifest-sourced),
   * or `null` when unknown / heuristic fallback / held. A fused prior is always
   * far-domain-penalized and capped; a gate-FAILED prior is held out entirely (v3).
   */
  readonly gatePassed: boolean | null;
  /** Honest gate/promotion note for the steering prior (manifest-sourced), or `null`. */
  readonly gateNote: string | null;
  /**
   * Audit record of a supplied prior that was HELD out of fusion (failed gate). Present
   * only when `priorContribution === "held_failed_gate"`; the read did NOT use it. Never
   * rendered raw / synced; carries no clinical-risk or raw-audio-like field.
   */
  readonly heldPrior: HeldPriorAudit | null;
  readonly note: string;
}

export interface OrchestratorInput {
  /** Derived features for the current hum. Raw audio never enters the orchestrator. */
  readonly features: AcousticFeatures;
  /** User consent state — gates clinical-risk surfacing (defaults to local-only). */
  readonly consent: ConsentState;
  readonly modelVersion: ModelVersion;
  readonly now: IsoTimestamp;
  readonly history?: HumHistory;
  /**
   * Optional pretrained affect-PRIOR expert (drop-in for the speech-emotion stub).
   * Omit to run the deterministic heuristic ensemble (honest fallback).
   */
  readonly learnedAffectPrior?: LearnedAffectPrior;
  /**
   * Optional trained coarse VALENCE / AROUSAL axis priors. When supplied they REFINE
   * the transparent on-domain acoustic axis read when in-domain, and abstain when the
   * hum is outside their (far-domain acted-speech) training distribution (ADR-0005).
   * The axis read leads the dimensional read from the first hum either way.
   */
  readonly axisPriors?: AffectAxisPriors;
  /**
   * Optional PROMOTED hum-native fusion meta-learner (trained on the user's own hums,
   * `@hum-ai/native-corpus` `trainFusionMetaLearner`). Replaces the hand-weighted stub for
   * the secondary affect-state read only when it beats the stub on held-out hums. Omit ⇒
   * the deterministic stub (the dimensional V-A read is unaffected either way).
   */
  readonly metaLearner?: MetaLearner;
}

/** The off-domain stub slot a trained acted-speech prior is a drop-in for. */
const SPEECH_EMOTION_EXPERT_ID = "expert-ser:speech-emotion";

/**
 * v3 GATE ENFORCEMENT. A supplied learned affect prior is HELD (transparency-only — never
 * steers the read or boosts confidence) when it EXPLICITLY failed its promotion gate
 * (`gatePassed === false`). An unknown-gate prior (`undefined`) is still fused but is
 * bounded by its far-domain confidence cap (the conservative ceiling) — only a KNOWN
 * failure is held out of fusion entirely. The dimensional V-A read leads from the acoustic
 * backbone regardless; this governs the SECONDARY affect-state read only.
 */
function learnedPriorHeld(prior?: LearnedAffectPrior): boolean {
  return prior !== undefined && prior.gatePassed === false;
}

/**
 * The four prior-derived audit fields with their `?? null` defaults — the single source
 * shared by the fused-prior provenance record and the held-prior record, so the audit
 * shape can never drift between the two branches.
 */
function priorAuditFields(prior: LearnedAffectPrior): HeldPriorAudit {
  return {
    expertId: prior.expert.expertId,
    artifact: prior.artifact ?? null,
    gatePassed: prior.gatePassed ?? null,
    gateNote: prior.gateNote ?? null,
  };
}

/**
 * Minimum axis signal strength for a read to be shown. Below this the hum carried
 * too little clear, voiced audio to read (near-silent / unclear), so we abstain
 * honestly rather than surface a confident-looking zero.
 */
const MIN_READ_SIGNAL = 0.1;

/**
 * Assemble the audio-stream expert ensemble. With a learned affect prior supplied
 * it REPLACES the off-domain `SpeechEmotionExpert` stub (same acted-speech role),
 * so the far-domain view is upgraded, not double-counted; if that slot is somehow
 * absent the prior is appended. With no prior, the heuristic ensemble is returned
 * unchanged — the spine runs identically with or without a trained model.
 */
function buildExpertEnsemble(prior?: LearnedAffectPrior): AffectExpert[] {
  const base: AffectExpert[] = defaultAudioExperts();
  // v3: a gate-FAILED prior is held out of the ensemble entirely — the deterministic
  // heuristic experts steer the secondary read (the prior can't sharpen or boost it).
  if (!prior || learnedPriorHeld(prior)) return base;
  let replaced = false;
  const ensemble = base.map((e) => {
    if (e.expertId === SPEECH_EMOTION_EXPERT_ID) {
      replaced = true;
      return prior.expert;
    }
    return e;
  });
  if (!replaced) ensemble.push(prior.expert);
  return ensemble;
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
  /**
   * The reflective inner-state line the read leads with — valence + arousal fused with
   * the benign affect lean into one plain "right now you read as …" sentence. Null when
   * the read abstained. Non-diagnostic; screened with the rest of the user-facing copy.
   */
  readonly innerState: string | null;
  readonly note: string;
  readonly suggestion: { readonly type: InterventionType; readonly copy: string } | null;
  /**
   * Today's regulation-support step (Intervention of the Day). Always present — even
   * an abstaining/poor-capture read yields a useful "try another hum" step. Built
   * from the sanitized view + qualitative confidence + abstracted trend only, and
   * screened with the rest of the user-facing copy. Carries no clinical label and
   * no raw confidence number.
   */
  readonly interventionOfDay: InterventionOfDay;
}

/** Internal, NEVER-rendered detail (logging, eval, consent-gated risk surfacing). */
export interface InternalRead {
  /** The DERIVED features this read was computed from (never raw audio). */
  readonly features: AcousticFeatures;
  readonly inference: MultiHeadAffectInference;
  /** Two heads; the clinical head is consent-gated (withheld by default). */
  readonly twoHead: TwoHeadAffectOutput;
  readonly relapse: RelapseVerdict | null;
  /**
   * The integrated, INTERNAL longitudinal diagnostic state: trend direction, a
   * consent-gated non-diagnostic risk hypothesis, sustained relapse-drift / recovery
   * signals (confidence hard-capped at 88%), a monitoring flag + routing action, and
   * source provenance. Never rendered or synced as-is; surfacing is consent-gated and
   * must pass `@hum-ai/safety-language` (it contains internal risk labels by design).
   */
  readonly longitudinal: LongitudinalDiagnosticState;
  readonly dualBaseline: DualBaseline;
  readonly divergence: BaselineDivergence;
  readonly quality: QualityResult;
  readonly domain: DomainClassification;
  /** How the read was re-referenced against the user's own baseline (transparency). */
  readonly personalization: PersonalizationApplication;
  /**
   * Which model produced the affective read — a learned prior (drop-in for the
   * speech-emotion stub) or the heuristic fallback ensemble. Transparency/eval
   * only; carries no raw-audio-like or clinical-risk key, and is never synced.
   */
  readonly modelProvenance: ModelProvenance;
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
  /**
   * The dimensional axis read this hum led with: the transparent on-domain acoustic
   * valence/arousal, each optionally refined by an in-domain trained prior (or noting
   * the prior abstained OOD). Carries per-axis confidence + provenance for the UI.
   */
  readonly axis: AxisRead;
  /** Secondary 6-way affect-label hint (most-likely benign broad state), or null. */
  readonly affectHint: AffectStateHead | null;
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

/**
 * Apply the user's learned PERSONAL AXIS CALIBRATION (HiTL) to a freshly-resolved axis
 * read: shift the surfaced valence/arousal values + dimensional point toward the user's
 * own self-reports, while PRESERVING each axis's transparent `acousticValue` provenance
 * and its confidence. Returns the read unchanged until a calibration has been earned.
 */
function applyAxisCalibrationToRead(read: AxisRead, calibration?: PersonalAxisCalibration): AxisRead {
  if (!axisCalibrationEngaged(calibration)) return read;
  const dim = applyAxisCalibration(calibration, read.dimensional);
  return {
    ...read,
    dimensional: dim,
    valence: { ...read.valence, value: dim.valence },
    arousal: { ...read.arousal, value: dim.arousal },
  };
}

/** The `n` features with the largest |z-delta| (explainability: what drove the read). */
function topFeaturesByAbsZ(zDeltas: Record<string, number>, n: number): string[] {
  return Object.entries(zDeltas)
    .filter(([, z]) => Number.isFinite(z))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([k]) => k);
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
  if (read.innerState) strings.push(read.innerState);
  if (read.suggestion) strings.push(read.suggestion.copy);
  strings.push(...interventionOfDayStrings(read.interventionOfDay));
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

  // 4. Audio-stream experts. A trained affect prior, when supplied, drops into the
  //    speech-emotion slot (pretrained/model inference); otherwise the heuristic
  //    ensemble runs unchanged (honest fallback — no trained model required).
  const ensemble = buildExpertEnsemble(input.learnedAffectPrior);
  const meta = { modality: "audio" as const, captureQuality: quality.captureQualityScore };
  const experts = await Promise.all(ensemble.map((e) => e.predict(features, meta)));
  const observedModalityReliability = modalityReliability(experts);
  // A PROMOTED hum-native fusion meta-learner (trained on the user's own confirmed hums)
  // replaces the hand-weighted stub for the SECONDARY affect-state read; absent ⇒ stub
  // (honest fallback). The dimensional V-A read still leads from the acoustic backbone.
  const fusionEngine = new FusionEngine({ metaLearner: input.metaLearner });

  // 5. Strictest of the personalization-stage, capture-quality, domain, and (when a
  //    trained prior is fused) the prior's far-domain caps (ADR-0005). Strictest wins.
  const capParts = [
    { cap: stage.confidenceCap, reason: stage.capReason },
    { cap: quality.confidenceCap, reason: `capture quality (${quality.captureQuality})` },
    { cap: domainAdaptation.confidencePenalty, reason: `domain match (heard ${domain.predicted})` },
  ];
  // v3: only a FUSED prior contributes its far-domain cap; a HELD (gate-failed) prior is
  // not in the read, so it neither boosts confidence nor imposes its penalty.
  if (input.learnedAffectPrior && !learnedPriorHeld(input.learnedAffectPrior)) {
    capParts.push({
      cap: input.learnedAffectPrior.confidenceCap,
      reason: input.learnedAffectPrior.capReason ?? "learned affect prior far-domain penalty (ADR-0005)",
    });
  }
  const caps = combineCaps(capParts);

  // 6. Late fusion → calibrated multi-head inference.
  const fusionCtx: FusionContext = {
    modelVersion,
    captureQuality: quality.captureQualityScore,
    domainMatch: domainAdaptation.domainMatch,
    caps,
    calibrationMaturity: stage.calibrationMaturity,
    longitudinalTrendStrength,
  };
  const baseInf = fusionEngine.fuse(experts, fusionCtx);

  // 6a. AXIS READ — lead with VALENCE + AROUSAL from the first hum. A transparent,
  //     on-domain acoustic mapping produces the dimensional read (always meaningful on
  //     real audio); the trained far-domain axis priors REFINE it only when in-domain
  //     and abstain otherwise (ADR-0005). This replaces the neutral-washed fused
  //     dimensional point as the read the rest of the spine reasons over.
  const acousticAxisRead = resolveAxisRead(features, input.axisPriors);
  // PERSONAL AXIS CALIBRATION (HiTL): re-centre the population acoustic read on THIS
  // person from their accumulated corrections. The transparent `acousticValue` provenance
  // on each axis is preserved; only the surfaced `value`/`dimensional` shift. No-op until
  // the user has corrected a read (engaged === false ⇒ identical read).
  const axisRead = applyAxisCalibrationToRead(acousticAxisRead, history.axisCalibration);
  const readAbstained = quality.decision === "rejected" || axisRead.signalStrength < MIN_READ_SIGNAL;
  const axisConfidence = axisReadConfidence(axisRead);
  const axisLedInf: MultiHeadAffectInference = {
    ...baseInf,
    dimensional: axisRead.dimensional,
    abstained: readAbstained,
    abstainReason: readAbstained
      ? quality.decision === "rejected"
        ? "poor_capture_quality"
        : baseInf.abstained
          ? baseInf.abstainReason
          : "low_margin"
      : "none",
  };

  // 6b. PERSONALIZATION — re-reference the axis read against the user's OWN rolling
  //     baseline so the read is INDIVIDUAL, not population-derived. The more this hum
  //     matches the user's usual, the more it reads as their usual; the more it
  //     departs, the more the read is preserved. SILENT progressive refinement — it
  //     never gates or hides the read, and has nothing to act on until a baseline
  //     forms (`applyPersonalization`).
  const currentSamples = humFeatureSamples(features);
  // Circadian: re-reference against "your usual at this time of day" when the
  // matching bucket is well-sampled; otherwise this is the global rolling baseline.
  const personalBaseline = contextAdjustedBaseline(
    dualBaseline.rolling.vector,
    history.contextualCenters,
    timeBucket(now),
  );
  const personalZDeltas = stage.baselineActive
    ? zDeltasAgainstBaseline(currentSamples, personalBaseline)
    : {};
  const { inference: personalizedInf, application: personalization } = applyPersonalization(
    axisLedInf,
    personalZDeltas,
    stage,
    {
      // v2 personal model: circadian-, salience-weighted, evidence-gated, regime-aware re-reference.
      // The salience is BLENDED with the HiTL per-feature importance (which features track
      // THIS user's reported affect) so the read leans on what's predictive for them (ADR-0011).
      // The blend weight is EVIDENCE-AWARE: a thin baseline discounts the hint (the salience
      // it would amplify is itself unreliable), growing to full weight as the baseline matures.
      model: {
        salience: blendSalience(history.salience, history.featureImportance, adaptiveBlendWeight(eligibleHumCount)),
        baseline: personalBaseline,
        regimeShift: history.regimeShift,
      },
    },
  );

  // 7. Relapse (within-user) + dual-baseline-informed drift, on the PERSONALIZED
  //    read. The relapse engine receives only an opaque riskScore from the clinical
  //    head — now an individual one, scored against the user's own baseline.
  const currentRiskScore = clinicalRiskScore(personalizedInf);
  const references = history.relapseReferences ?? {};
  const relapseActive = stage.relapseModelActive && Object.keys(references).length > 0;

  // Learned-signature alignments for THIS hum (computed once; reused by the relapse drift
  // scaling AND the longitudinal state). Null until the matching signature is learned.
  const highRiskSignature = history.highRiskSignature ?? {};
  const recoverySignature = history.recoverySignature ?? {};
  const hasPersonalZ = Object.keys(personalZDeltas).length > 0;
  const highRiskAlignment =
    hasPersonalZ && Object.keys(highRiskSignature).length > 0
      ? signatureAlignment(personalZDeltas, highRiskSignature)
      : null;
  const recoveryAlignment =
    hasPersonalZ && Object.keys(recoverySignature).length > 0
      ? signatureAlignment(personalZDeltas, recoverySignature)
      : null;

  // PER-USER stable band (from the user's own risk-score noise) + SIGNATURE-WEIGHTED drift:
  // a high-variance user gets a wider "stable" tolerance (fewer false alarms), and drift that
  // matches their learned high-risk pattern is a stronger early-warning.
  const relapseOptions = {
    stableBand: personalStableBand((history.recentRiskSeries ?? []).map((p) => p.value)),
    signatureAlignment: { highRisk: highRiskAlignment ?? 0, recovery: recoveryAlignment ?? 0 },
  };
  const relapse: RelapseVerdict | null = relapseActive
    ? assessRelapse(
        { capturedAt: now, dimensional: personalizedInf.dimensional, riskScore: currentRiskScore },
        references,
        relapseOptions,
      )
    : null;

  const divergenceDrift = longitudinalTrend(divergence);
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
  let suggestion = selectInterventionFromView(recommendationView, interventionCtx);

  // PERSONALIZED INTERVENTION POLICY (v2): once the user is established and has real
  // intervention history, let the bandit choose among the SAFE supportive options for
  // this V-A region (what has helped them / is worth trying). The safety-gated
  // none / escalation / abstain decisions above are never overridden.
  if (isSupportiveIntervention(suggestion.type) && stage.personalizedFusionActive) {
    const policy: InterventionPolicy = history.interventionPolicy ?? {};
    const candidates = supportiveCandidates(recommendationView);
    if (candidates.length > 1 && policyConfidence(policy, candidates) > 0) {
      const pick = selectByUCB(policy, candidates);
      if (pick && pick.best.type !== suggestion.type) {
        suggestion = buildSupportiveSuggestion(pick.best.type, recommendationView);
      }
    }
  }

  const inference: MultiHeadAffectInference = {
    ...inferenceWithLongitudinal,
    recommendedIntervention: suggestion.type === "none" ? null : suggestion.type,
  };

  // 8b. LONGITUDINAL DIAGNOSTIC STATE — synthesize the within-user signals into one
  //     internal, non-diagnostic state: trend direction, a consent-gated risk
  //     hypothesis, sustained relapse-drift / recovery signals (confidence hard-capped
  //     at 88%), a monitoring flag, and source provenance. The learned recovery /
  //     high-risk SIGNATURES (centroids of the user's z-deltas in stable / high-risk
  //     periods) finally feed a read here: alignment of THIS hum with them sharpens
  //     the drift/recovery direction. The signature alignments (`highRiskAlignment` /
  //     `recoveryAlignment`) were computed once above (reused by the relapse drift scaling).
  // ROBUST LONGITUDINAL TREND — Theil–Sen slope + Mann–Kendall over the recent risk
  // series (prior eligible hums + this hum). A significant RISING risk trend reads as
  // worsening; FALLING as improving. Refines a weak single-comparison verdict; never
  // overrides a worsening verdict (handled in assessLongitudinalState). Non-diagnostic.
  const riskSeries: SeriesPoint[] = [
    ...(history.recentRiskSeries ?? []),
    { t: Date.parse(now), value: currentRiskScore },
  ].filter((p) => Number.isFinite(p.t));
  const trend = estimateTrend(riskSeries);
  const trendDirection: LongitudinalTrendDirection =
    trend.significant && trend.direction === "rising"
      ? "worsening"
      : trend.significant && trend.direction === "falling"
        ? "improving"
        : "uncertain";
  const seriesTrend = { direction: trendDirection, confidence: trend.confidence, significant: trend.significant };

  const longitudinal = assessLongitudinalState({
    relapseModelActive: stage.relapseModelActive,
    baselineActive: stage.baselineActive,
    anchoredActive: divergence.anchored,
    relapse,
    divergenceMagnitude: divergence.magnitude,
    riskScore: currentRiskScore,
    baseConfidence: inference.confidence.confidence,
    abstained: inference.abstained,
    abstainReason: inference.abstainReason,
    highRiskAlignment,
    recoveryAlignment,
    driftEvidenceFeatures: topFeaturesByAbsZ(personalZDeltas, 3),
    priorConsecutiveDriftHums: history.priorConsecutiveDriftHums ?? 0,
    seriesTrend,
  });

  // 9. Two-head split with the consent gate (clinical head withheld by default).
  const twoHead = splitInference(inference, consent);

  // 10. Qualitative confidence + plain copy, then SCREEN everything. The user-facing
  //     confidence is EARNED FROM THIS HUM'S axis read (signal clarity + in-domain
  //     trained agreement) — NOT gated behind a multi-hum calibration count. The
  //     internal fusion confidence still drives the longitudinal / risk path.
  const confidence = userFacingConfidence(
    { confidence: axisConfidence, abstained: inference.abstained },
    eligibleHumCount,
  );
  const affectHint = inference.abstained ? null : dominantBroadState(twoHead.broad.states);

  // Intervention of the Day — built from the SAME sanitized view + qualitative
  // confidence + abstracted trend the rest of the safe layer uses. No clinical
  // label, no raw confidence number; self-screened, then screened again below.
  const daySeed = Number(now.slice(5, 7)) * 31 + Number(now.slice(8, 10));
  const interventionOfDay: InterventionOfDay = selectInterventionOfDay({
    view: recommendationView,
    captureUsable: quality.decision !== "rejected",
    evidence: confidence.evidenceLevel,
    baselineMature: eligibleHumCount >= EARLY_BASELINE_HUMS,
    longitudinal: relapse
      ? {
          drifting: relapseDrift >= 0.5 || interventionCtx.persistentRiskPattern === true,
          persistent: interventionCtx.persistentRiskPattern === true,
        }
      : undefined,
    safetyAllowsEscalation: interventionCtx.safetyAllowsEscalation,
    rotationSeed: Number.isFinite(daySeed) ? daySeed : 0,
  });
  const userFacing: UserFacingRead = {
    abstained: inference.abstained,
    isEarlyBaseline: confidence.isEarlyBaseline,
    confidence,
    headline: axisHeadline(inference.dimensional.valence, inference.dimensional.arousal, inference.abstained),
    innerState: innerStateLine(
      axisRead.dimensional.valence,
      axisRead.dimensional.arousal,
      affectHint,
      inference.abstained,
    ),
    note: readNote({
      abstained: inference.abstained,
      isEarlyBaseline: confidence.isEarlyBaseline,
      divergenceActive: divergence.anchored,
      divergenceMagnitude: divergence.magnitude,
    }),
    suggestion: inference.abstained
      ? null
      : { type: suggestion.type, copy: INTERVENTION_COPY[suggestion.type] },
    interventionOfDay,
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

  const suppliedPrior = input.learnedAffectPrior;
  const priorHeld = learnedPriorHeld(suppliedPrior);
  const modelProvenance: ModelProvenance =
    suppliedPrior && !priorHeld
      ? {
          kind: "learned_affect_prior",
          priorContribution: "fused",
          ...priorAuditFields(suppliedPrior),
          expertCount: experts.length,
          heldPrior: null,
          note:
            "Trained affect PRIOR fused as a drop-in for the off-domain speech-emotion stub; " +
            "far-domain (acted speech), penalized, never hum truth (ADR-0005).",
        }
      : {
          // No prior, OR a gate-FAILED prior held out of fusion (v3). The deterministic
          // heuristic ensemble steered the secondary read either way.
          kind: "heuristic_ensemble",
          priorContribution: suppliedPrior ? "held_failed_gate" : "none",
          expertId: null,
          artifact: null,
          expertCount: experts.length,
          gatePassed: null,
          gateNote: null,
          heldPrior: suppliedPrior ? priorAuditFields(suppliedPrior) : null,
          note: suppliedPrior
            ? "Trained affect prior supplied but HELD out of fusion (failed its promotion gate); " +
              "the deterministic heuristic ensemble steered the secondary read. Transparency-only (ADR-0005, v3 gate enforcement)."
            : "Deterministic heuristic SER-family experts (no trained model supplied; honest fallback).",
        };

  return {
    userFacing,
    recommendationView,
    internal: {
      features,
      inference,
      twoHead,
      relapse,
      longitudinal,
      dualBaseline,
      divergence,
      quality,
      domain,
      personalization,
      modelProvenance,
      observedModalityReliabilityByOrder: MODALITIES.map((m) => observedModalityReliability[m]),
      domainMatch: domainAdaptation.domainMatch,
      stage: stage.stage,
      eligibleHumCount,
      axis: axisRead,
      affectHint,
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
  /** Optional pretrained affect-PRIOR expert (drop-in); omit for heuristic fallback. */
  readonly learnedAffectPrior?: LearnedAffectPrior;
  /** Optional trained coarse valence / arousal axis priors (refine the axis read). */
  readonly axisPriors?: AffectAxisPriors;
  /** Optional promoted hum-native fusion meta-learner (secondary read only). */
  readonly metaLearner?: MetaLearner;
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
    learnedAffectPrior: input.learnedAffectPrior,
    axisPriors: input.axisPriors,
    metaLearner: input.metaLearner,
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
    recoverySignature: state.profile.recovery_signature_vector,
    highRiskSignature: state.profile.high_risk_signature_vector,
    priorConsecutiveDriftHums: state.consecutiveDriftHums,
    salience: state.profile.salience_vector,
    regimeShift: recentRegimeShift(state),
    interventionPolicy: state.profile.intervention_policy,
    contextualCenters: state.profile.contextual_centers,
    axisCalibration: state.profile.axis_calibration,
    recentRiskSeries: state.relapseHistory
      .map((s) => ({ t: Date.parse(s.capturedAt), value: s.riskScore }))
      .filter((p) => Number.isFinite(p.t)),
  };
}

/** A regime shift is "recent" (and so should bias adaptation) for a few hums after it fires. */
function recentRegimeShift(state: PersonalizationState): "none" | "up" | "down" {
  const r = state.profile.regime;
  if (!r || r.lastShift === "none" || r.sinceShift > 3) return "none";
  return r.lastShift;
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
    // Persist the consecutive-drift streak so the next read can honour the relapse
    // engine's "min consecutive hums" rule (ineligible hums never reach here, so a
    // rejected hum cannot corrupt the streak).
    consecutiveDriftHums: internal.longitudinal.consecutiveDriftHums,
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
