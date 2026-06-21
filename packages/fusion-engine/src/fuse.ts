import { clamp01, mean, type ModelVersion, type UnitInterval } from "@hum-ai/shared-types";
import {
  FUSION_LABEL_AFFECT,
  FUSION_LABELS,
  neutralInference,
  zeroStateScores,
  type ConfidenceCaps,
  type ExpertOutput,
  type MultiHeadAffectInference,
} from "@hum-ai/affect-model-contracts";
import { StubWeightedMetaLearner, argmax, type MetaLearner, type FusionDistribution } from "./meta-learner";
import { ConfidenceModelV1 } from "./confidence";
import { availableModalityCount } from "./reliability";

/**
 * Everything fusion needs that does not come from the experts themselves. The
 * caps are pre-combined by the orchestrator (personalization-stage cap ∩
 * capture-quality cap — see `combineCaps`).
 */
export interface FusionContext {
  readonly modelVersion: ModelVersion;
  readonly captureQuality: UnitInterval;
  readonly domainMatch: UnitInterval;
  readonly caps: ConfidenceCaps;
  readonly calibrationMaturity: UnitInterval;
  readonly longitudinalTrendStrength: UnitInterval;
}

export interface FusionEngineOptions {
  readonly metaLearner?: MetaLearner;
}

/**
 * The late-fusion engine. Independent expert outputs in → one calibrated
 * `MultiHeadAffectInference` out. Tolerates missing modalities; abstains when
 * no modality is available or confidence falls below the floor.
 */
export class FusionEngine {
  private readonly metaLearner: MetaLearner;
  private readonly confidenceModel = new ConfidenceModelV1();

  constructor(opts: FusionEngineOptions = {}) {
    this.metaLearner = opts.metaLearner ?? new StubWeightedMetaLearner();
  }

  fuse(experts: readonly ExpertOutput[], ctx: FusionContext): MultiHeadAffectInference {
    const available = experts.filter((e) => e.available);

    // Missing-modality handling: no usable expert → safe abstaining default.
    if (available.length === 0) {
      const base = neutralInference(ctx.modelVersion);
      return { ...base, abstained: true, abstainReason: "poor_capture_quality" };
    }

    // Backbone-floor discipline: a malformed/untrained injected meta-learner degrades to
    // the deterministic stub rather than crashing the read.
    let dist: FusionDistribution;
    try {
      dist = this.metaLearner.combine(available);
    } catch {
      dist = new StubWeightedMetaLearner().combine(available);
    }
    const top = argmax(dist);
    const modalityAgreement = computeAgreement(available, dist, top.label);
    const oodScore = clamp01(mean(available.map((e) => e.oodScore)));

    const confidence = this.confidenceModel.compute(
      {
        modelProbability: top.prob,
        topClassMargin: top.margin,
        captureQuality: ctx.captureQuality,
        domainMatch: ctx.domainMatch,
        modalityAgreement,
        oodScore,
        calibrationMaturity: ctx.calibrationMaturity,
        longitudinalTrendStrength: ctx.longitudinalTrendStrength,
      },
      ctx.caps,
    );

    const dimensional = dimensionalFromDist(dist);
    const states = statesFromDist(dist);
    const uncertainty = clamp01(1 - (0.6 * top.prob + 0.4 * top.margin));

    return {
      modelVersion: ctx.modelVersion,
      dimensional,
      states,
      relapseDrift: 0, // filled by the relapse engine when a baseline comparison exists
      recoveryWorseningUnchanged: null,
      uncertainty,
      confidence,
      abstained: confidence.abstained,
      abstainReason: confidence.abstainReason,
      recommendedIntervention: null, // selected later by the intervention engine
    };
  }
}

function dimensionalFromDist(dist: FusionDistribution) {
  let valence = 0;
  let arousal = 0;
  for (const l of FUSION_LABELS) {
    const a = FUSION_LABEL_AFFECT[l];
    valence += dist[l] * a.va.valence;
    arousal += dist[l] * a.va.arousal;
  }
  return { valence: clamp01(valence * 0.5 + 0.5) * 2 - 1, arousal: clamp01(arousal * 0.5 + 0.5) * 2 - 1 };
}

function statesFromDist(dist: FusionDistribution) {
  const states = zeroStateScores();
  for (const l of FUSION_LABELS) {
    const head = FUSION_LABEL_AFFECT[l].dominantState;
    states[head] = clamp01(states[head] + dist[l]);
  }
  return states;
}

/**
 * Agreement = how strongly the available experts support the fused top label.
 * With only one modality present we cannot corroborate, so agreement is capped.
 */
function computeAgreement(available: readonly ExpertOutput[], dist: FusionDistribution, topLabel: string): UnitInterval {
  const support = mean(available.map((e) => e.probabilities[topLabel] ?? 0));
  const base = clamp01(support);
  return availableModalityCount(available) >= 2 ? base : Math.min(base, 0.7);
}
