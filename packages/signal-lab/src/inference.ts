import {
  asIsoTimestamp,
  asModelVersion,
  clamp01,
  defaultConsent,
  hasConsent,
  type ConsentState,
  type IsoTimestamp,
  type ModelVersion,
} from "@hum-ai/shared-types";
import { computeFeatures, metricsFromFeatures, type AcousticFeatures, type AudioInput } from "@hum-ai/audio-features";
import { evaluateQuality, type QualityResult } from "@hum-ai/quality-gate";
import { HeuristicDomainClassifier, HumDomainAdapter, type DomainClassification } from "@hum-ai/domain-classifier";
import { defaultAudioExperts } from "@hum-ai/expert-ser";
import { FusionEngine, combineCaps, type FusionContext } from "@hum-ai/fusion-engine";
import { stagePolicy } from "@hum-ai/personalization-engine";
import { selectInterventionFromView } from "@hum-ai/intervention-engine";
import {
  FUSION_LABELS,
  FUSION_LABEL_AFFECT,
  assertNoClinicalLeak,
  splitInference,
  toRecommendationView,
  type ExpertOutput,
  type FusionLabel,
  type InterventionType,
  type MultiHeadAffectInference,
} from "@hum-ai/affect-model-contracts";
import { userFacingConfidence, type UserFacingConfidence } from "@hum-ai/safety-language";
import { toFeatureVector } from "./feature-schema";
import { featureContributions, type LogRegParams } from "./model";
import { LearnedAffectPriorExpert } from "./expert";
import { predictNeuralFromFeatures, type NeuralFeatureModel } from "./neural-feature-model";
import { notEvaluatedPromotion } from "./manifest";

/**
 * Inference adapter: run a NEW hum (raw audio OR already-derived features) through
 * the learned pipeline and emit an honest evidence report.
 *
 * The pipeline reuses the existing runtime contracts — it does NOT duplicate them:
 *   computeFeatures → evaluateQuality → HeuristicDomainClassifier/HumDomainAdapter
 *   → (learned expert | heuristic fallback) → FusionEngine(+combineCaps)
 *   → toRecommendationView/assertNoClinicalLeak → selectInterventionFromView
 *   → userFacingConfidence.
 *
 * Governance wired in (ADR-0004/0005): the binding confidence cap is the strictest
 * of {personalization-stage cap, capture-quality cap, live-domain-match cap,
 * trained-prior far-domain penalty}. A single hum has no history → population_prior
 * (cap 0.72). When no trained model is supplied, the adapter falls back to the
 * deterministic heuristic experts and flags `fallbackUsed: true`.
 */

export interface InferHumInput {
  /** Raw, ephemeral audio (extracted on-device, never persisted). */
  readonly audio?: AudioInput;
  /** OR pre-derived features (e.g. a synced derived payload). */
  readonly features?: AcousticFeatures;
  /** Trained baseline; null/undefined ⇒ fallback to heuristic experts. */
  readonly model?: LogRegParams | null;
  /** Path of the artifact the model came from (for provenance in the report). */
  readonly modelArtifactPath?: string | null;
  /** Prior eligible-hum count for stage selection (default 0 = first hum). */
  readonly priorEligibleCount?: number;
  readonly consent?: ConsentState;
  readonly modelVersion?: ModelVersion;
  readonly now?: IsoTimestamp;
  /** Promotion-gate status (from a signal-lab model manifest), surfaced honestly. */
  readonly promotion?: InferencePromotion;
  /**
   * Optional promoted feature-space NEURAL model (e.g. a gate-passed arousal axis).
   * It is surfaced as an AUXILIARY coarse prior only — it does NOT replace the affect
   * head or steer interventions (ADR-0005: far-domain acted-speech prior, penalty 0.45).
   * When absent, the runtime behaves exactly as before (classical / fallback).
   */
  readonly neuralAuxModel?: NeuralFeatureModel | null;
  readonly neuralAuxArtifactPath?: string | null;
}

/**
 * Honest promotion-gate status for the affect read, sourced from the multi-dataset
 * experiment's `model_manifest.json`. The runtime affect head uses the 6-class
 * prior whether or not it passed; this block reports that truthfully so a consumer
 * never mistakes a population prior for a gate-validated model.
 */
export interface InferencePromotion {
  readonly evaluated: boolean;
  readonly gateMetric: string;
  readonly gateThreshold: number;
  readonly affectTargetId: string;
  readonly affectBalancedAccuracy: number | null;
  readonly affectPassedGate: boolean;
  readonly affectModelRole: string;
  /** A coarse axis (e.g. arousal) that DID pass the gate as a far-domain prior, if any. */
  readonly promotedAuxTarget: string | null;
  readonly promotedAuxBalancedAccuracy: number | null;
  readonly datasetsUsed: readonly string[];
  readonly note: string;
}

export interface StateCandidate {
  readonly fusionLabel: FusionLabel;
  readonly probability: number;
  readonly valence: number;
  readonly arousal: number;
}

export interface FeatureContribution {
  readonly feature: string;
  readonly contribution: number;
}

export interface InferenceReport {
  readonly modelUsed: {
    readonly id: string;
    readonly version: string;
    readonly kind: "learned_logreg" | "heuristic_stub_fallback";
    readonly source: string;
    readonly labelSpace: readonly string[];
  };
  readonly artifactUsed: string | null;
  readonly fallbackUsed: boolean;
  readonly features: {
    readonly featureMode: string;
    readonly sampleRate: number;
    readonly durationSec: number;
    readonly meanRms: number;
    readonly pitchMeanHz: number | null;
    readonly pitchCoverage: number | null;
    readonly spectralCentroidHz: number;
    readonly nullFeatureCount: number;
  };
  readonly quality: {
    readonly decision: QualityResult["decision"];
    readonly captureQuality: QualityResult["captureQuality"];
    readonly captureQualityScore: number;
    readonly baselineEligible: boolean;
    readonly reasons: readonly string[];
  };
  readonly domain: {
    readonly predicted: DomainClassification["predicted"];
    readonly classifierConfidence: number;
    readonly domainMatch: number;
    readonly domainPenalty: number;
    readonly rationale: string;
  };
  readonly inferredState: {
    readonly abstained: boolean;
    readonly dominantBroadState: string | null;
    readonly valence: number;
    readonly arousal: number;
    readonly stateCandidates: readonly StateCandidate[];
  };
  readonly confidence: {
    readonly qualitative: UserFacingConfidence;
    readonly internal: {
      readonly rawConfidence: number;
      readonly confidence: number;
      readonly confidencePercent: number;
      readonly appliedCap: number;
      readonly capReason: string;
    };
    readonly uncertainty: number;
    readonly abstained: boolean;
    readonly abstainReason: string;
    readonly eligibleHumCount: number;
    readonly stage: string;
  };
  readonly support: {
    readonly topFeatureContributions: readonly FeatureContribution[];
    readonly note: string;
  };
  readonly promotion: InferencePromotion;
  /**
   * A promoted coarse NEURAL prior (e.g. arousal axis), if one was supplied. This is
   * auxiliary evidence surfaced honestly; it does NOT change `inferredState`,
   * `confidence`, or `intervention` — those remain driven by the calibrated affect
   * pipeline so an unvalidated coarse axis can never steer a recommendation.
   */
  readonly neuralAuxiliaryPrior: {
    readonly target: string;
    readonly family: string;
    readonly topLabel: string;
    readonly probability: number;
    readonly distribution: Readonly<Record<string, number>>;
    readonly balancedAccuracy: number;
    readonly artifact: string | null;
    readonly note: string;
  } | null;
  readonly intervention: {
    readonly type: InterventionType;
    readonly rationale: string;
    readonly sourceRefs: readonly string[];
    readonly surfaced: boolean;
  };
  readonly warnings: readonly string[];
  /** Full internal inference (gitignored-artifact use only; carries risk-marker heads). */
  readonly internalInference: MultiHeadAffectInference;
}

function dominantBroadState(states: Readonly<Partial<Record<string, number>>>): string | null {
  let best: string | null = null;
  let bestVal = 0;
  for (const [head, value] of Object.entries(states)) {
    if (value !== undefined && value > bestVal) {
      bestVal = value;
      best = head;
    }
  }
  return best;
}

/** Run the learned (or fallback) pipeline on one hum and produce the evidence report. */
export async function inferFromHum(input: InferHumInput): Promise<InferenceReport> {
  const modelVersion = input.modelVersion ?? asModelVersion("signal-lab-infer@0.1.0");
  const now = input.now ?? asIsoTimestamp("1970-01-01T00:00:00.000Z");
  const consent = input.consent ?? defaultConsent(now);

  if (!input.audio && !input.features) {
    throw new Error("inferFromHum: provide either `audio` or `features`");
  }
  const features: AcousticFeatures = input.features ?? computeFeatures(input.audio!);
  const vector = toFeatureVector(features);

  // 1. Quality gate.
  const quality = evaluateQuality(metricsFromFeatures(features, null));

  // 2. Domain classification + hum-compatibility penalty.
  const domain = new HeuristicDomainClassifier().classify(features);
  const domainAdaptation = new HumDomainAdapter().scoreCapture(domain);

  // 3. Stage (single hum / supplied history).
  const eligibleHumCount = (input.priorEligibleCount ?? 0) + (quality.baselineEligible ? 1 : 0);
  const stage = stagePolicy(eligibleHumCount);

  // 4. Expert(s): learned prior if a model is supplied, else heuristic fallback.
  const fallbackUsed = !input.model;
  const meta = { modality: "audio" as const, captureQuality: quality.captureQualityScore };
  let expertOutputs: ExpertOutput[];
  let learnedExpert: LearnedAffectPriorExpert | null = null;
  if (input.model) {
    learnedExpert = new LearnedAffectPriorExpert(input.model);
    expertOutputs = [await learnedExpert.predict(features, meta, domainAdaptation.domainMatch)];
  } else {
    expertOutputs = await Promise.all(defaultAudioExperts().map((e) => e.predict(features, meta)));
  }

  // 5. Caps: strictest of stage ∩ capture-quality ∩ live-domain-match ∩ trained-prior
  //    far-domain penalty (wires the dataset DOMAIN_GAP_PENALTY into the confidence path).
  const capParts = [
    { cap: stage.confidenceCap, reason: stage.capReason },
    { cap: quality.confidenceCap, reason: `capture quality (${quality.captureQuality})` },
    { cap: domainAdaptation.confidencePenalty, reason: `domain match (heard ${domain.predicted})` },
  ];
  if (input.model) {
    capParts.push({ cap: 0.45, reason: "affect-prior far-domain penalty 0.45 (acted speech; ADR-0005)" });
  }
  const caps = combineCaps(capParts);

  // 6. Late fusion → calibrated multi-head inference.
  const fusionCtx: FusionContext = {
    modelVersion,
    captureQuality: quality.captureQualityScore,
    domainMatch: domainAdaptation.domainMatch,
    caps,
    calibrationMaturity: stage.calibrationMaturity,
    longitudinalTrendStrength: 0,
  };
  const baseInf = new FusionEngine().fuse(expertOutputs, fusionCtx);

  // 7. Recommendation path — engine sees only the sanitized view.
  const recommendationView = toRecommendationView(baseInf);
  assertNoClinicalLeak(recommendationView);
  const suggestion = selectInterventionFromView(recommendationView, {
    persistentRiskPattern: false, // single hum, no longitudinal history
    safetyAllowsEscalation: hasConsent(consent, "clinical_risk_surfacing"),
  });
  const inference: MultiHeadAffectInference = {
    ...baseInf,
    recommendedIntervention: suggestion.type === "none" ? null : suggestion.type,
  };

  // 8. State candidates from the (learned) expert distribution, else fused states.
  const exDist = expertOutputs.length === 1 ? expertOutputs[0]!.probabilities : null;
  const stateCandidates: StateCandidate[] = (exDist
    ? [...FUSION_LABELS]
        .map((l) => ({ l, p: exDist[l] ?? 0 }))
        .filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p)
        .slice(0, 5)
        .map((x) => ({
          fusionLabel: x.l,
          probability: x.p,
          valence: FUSION_LABEL_AFFECT[x.l].va.valence,
          arousal: FUSION_LABEL_AFFECT[x.l].va.arousal,
        }))
    : []);

  const twoHead = splitInference(inference, consent);
  const dominant = inference.abstained ? null : dominantBroadState(twoHead.broad.states);

  const qualitative = userFacingConfidence(inference.confidence, eligibleHumCount);

  // 9. Support metadata (what evidence supported it) — learned model only.
  const topContribs: FeatureContribution[] =
    learnedExpert && !inference.abstained && stateCandidates.length > 0
      ? featureContributions(input.model!, vector, stateCandidates[0]!.fusionLabel).slice(0, 8)
      : [];

  // Auxiliary neural prior (coarse axis) — computed for transparency ONLY; it is
  // deliberately NOT fed into fusion/intervention above.
  const neuralAuxiliaryPrior = input.neuralAuxModel
    ? (() => {
        const pred = predictNeuralFromFeatures(input.neuralAuxModel!, features);
        return {
          target: input.neuralAuxModel!.target,
          family: input.neuralAuxModel!.family,
          topLabel: pred.topLabel,
          probability: pred.probability,
          distribution: pred.distribution,
          balancedAccuracy: input.neuralAuxModel!.evidence.balancedAccuracy,
          artifact: input.neuralAuxArtifactPath ?? null,
          note:
            "Auxiliary gate-passed NEURAL prior (coarse axis, far-domain acted speech, penalty 0.45). " +
            "Surfaced for transparency; does NOT drive the affect head, confidence, or interventions (ADR-0005).",
        };
      })()
    : null;

  const nullFeatureCount = countNullFeatures(features);
  const promotion: InferencePromotion = input.promotion ?? notEvaluatedPromotion({ hasModel: !!input.model });
  const warnings = buildWarnings(inference, quality, domain, fallbackUsed, eligibleHumCount);
  if (promotion.evaluated && !promotion.affectPassedGate) {
    const ba = promotion.affectBalancedAccuracy;
    warnings.push(
      `Affect target did NOT pass the ${(promotion.gateThreshold * 100).toFixed(0)}% promotion gate` +
        `${ba !== null ? ` (balanced acc ${(ba * 100).toFixed(1)}%)` : ""} — used as a population prior only.`,
    );
    if (promotion.promotedAuxTarget) {
      const aux = promotion.promotedAuxBalancedAccuracy;
      warnings.push(
        `A coarse '${promotion.promotedAuxTarget}' axis DID clear the gate as a far-domain PRIOR` +
          `${aux !== null ? ` (${(aux * 100).toFixed(1)}%)` : ""}, but it is NOT used to drive this read (still acted-speech, penalty 0.45).`,
      );
    }
  }
  if (neuralAuxiliaryPrior) {
    warnings.push(
      `Auxiliary NEURAL prior '${neuralAuxiliaryPrior.target}' (${neuralAuxiliaryPrior.family}, balAcc ` +
        `${(neuralAuxiliaryPrior.balancedAccuracy * 100).toFixed(1)}%) read '${neuralAuxiliaryPrior.topLabel}' ` +
        `(${(neuralAuxiliaryPrior.probability * 100).toFixed(0)}%) — transparency only; not steering this read.`,
    );
  }

  return {
    modelUsed: {
      id: learnedExpert ? learnedExpert.expertId : "expert-ser:heuristic-ensemble",
      version: input.model?.version ?? "stub",
      kind: input.model ? "learned_logreg" : "heuristic_stub_fallback",
      source: input.model
        ? "signal-lab LogReg affect prior (trained on RAVDESS acted speech)"
        : "@hum-ai/expert-ser defaultAudioExperts() deterministic stubs",
      labelSpace: input.model ? input.model.labels : [...FUSION_LABELS],
    },
    artifactUsed: input.modelArtifactPath ?? null,
    fallbackUsed,
    features: {
      featureMode: features.featureMode,
      sampleRate: features.sampleRate,
      durationSec: features.durationSec,
      meanRms: features.meanRms,
      pitchMeanHz: features.pitchMeanHz,
      pitchCoverage: features.pitchCoverage,
      spectralCentroidHz: features.spectralCentroidHz,
      nullFeatureCount,
    },
    quality: {
      decision: quality.decision,
      captureQuality: quality.captureQuality,
      captureQualityScore: quality.captureQualityScore,
      baselineEligible: quality.baselineEligible,
      reasons: quality.reasons,
    },
    domain: {
      predicted: domain.predicted,
      classifierConfidence: domain.confidence,
      domainMatch: domainAdaptation.domainMatch,
      domainPenalty: domainAdaptation.confidencePenalty,
      rationale: domainAdaptation.rationale,
    },
    inferredState: {
      abstained: inference.abstained,
      dominantBroadState: dominant,
      valence: inference.dimensional.valence,
      arousal: inference.dimensional.arousal,
      stateCandidates,
    },
    confidence: {
      qualitative,
      internal: {
        rawConfidence: inference.confidence.rawConfidence,
        confidence: inference.confidence.confidence,
        confidencePercent: inference.confidence.confidencePercent,
        appliedCap: inference.confidence.appliedCap,
        capReason: inference.confidence.capReason,
      },
      uncertainty: inference.uncertainty,
      abstained: inference.abstained,
      abstainReason: inference.abstainReason,
      eligibleHumCount,
      stage: stage.stage,
    },
    support: {
      topFeatureContributions: topContribs,
      note: input.model
        ? "Per-feature weight × standardized value for the top predicted fusion label (LogReg). Positive = pushed toward this label."
        : "Fallback heuristic experts produce no learned feature weights; no contribution attribution available.",
    },
    promotion,
    neuralAuxiliaryPrior,
    intervention: {
      type: suggestion.type,
      rationale: suggestion.rationale,
      sourceRefs: suggestion.sourceRefs,
      surfaced: !inference.abstained && suggestion.type !== "none",
    },
    warnings,
    internalInference: inference,
  };
}

function countNullFeatures(f: AcousticFeatures): number {
  let n = 0;
  for (const v of Object.values(f)) if (v === null) n++;
  return n;
}

function buildWarnings(
  inference: MultiHeadAffectInference,
  quality: QualityResult,
  domain: DomainClassification,
  fallbackUsed: boolean,
  eligibleHumCount: number,
): string[] {
  const w: string[] = [];
  w.push("Single-hum inference: no personal baseline / longitudinal history → population-prior stage, confidence capped (ADR-0004).");
  if (fallbackUsed) {
    w.push("FALLBACK MODE: no trained model supplied — heuristic stub experts used; outputs are deterministic placeholders, not a learned read.");
  } else {
    w.push("Learned model is an AFFECT PRIOR trained on acted speech (far domain, penalty 0.45) — never hum truth, never clinical (ADR-0005).");
  }
  if (inference.abstained) w.push(`Read ABSTAINED (reason: ${inference.abstainReason}) — no confident state committed.`);
  if (quality.decision === "rejected") w.push(`Capture quality rejected: ${quality.reasons.join(", ")}.`);
  if (domain.predicted !== "hum") w.push(`Domain classifier heard '${domain.predicted}', not 'hum' — affect read down-weighted.`);
  if (eligibleHumCount < 5) w.push("Early baseline (<5 eligible hums): evidence framed qualitatively, not as a number.");
  w.push("Not a medical device; not clinically validated; produces non-diagnostic signals only.");
  return w;
}
