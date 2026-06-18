import { FUSION_LABELS, type FusionLabel, type ExpertOutput } from "@hum-ai/affect-model-contracts";
import { expertWeight } from "./reliability";

export type FusionDistribution = Record<FusionLabel, number>;

/**
 * Late-fusion meta-learner contract. Mirrors the TriSense design: independent
 * expert probability vectors in, one fused distribution out. A trained model
 * (Logistic Regression v1, attention/gated-MoE v2) drops in behind this.
 */
export interface MetaLearner {
  readonly kind: "stub_weighted" | "logistic_regression" | "attention_moe";
  combine(experts: readonly ExpertOutput[]): FusionDistribution;
}

function zeroDist(): FusionDistribution {
  const d = {} as FusionDistribution;
  for (const l of FUSION_LABELS) d[l] = 0;
  return d;
}

function normalize(d: FusionDistribution): FusionDistribution {
  let total = 0;
  for (const l of FUSION_LABELS) total += Math.max(d[l], 0);
  const out = zeroDist();
  if (total <= 0) {
    for (const l of FUSION_LABELS) out[l] = 1 / FUSION_LABELS.length;
    return out;
  }
  for (const l of FUSION_LABELS) out[l] = Math.max(d[l], 0) / total;
  return out;
}

/**
 * v1 default: reliability-weighted late fusion. This is the deterministic
 * stand-in for the LogReg meta-learner — same interface, no training required.
 * Only available experts contribute; each is weighted by `expertWeight`.
 */
export class StubWeightedMetaLearner implements MetaLearner {
  readonly kind = "stub_weighted" as const;
  combine(experts: readonly ExpertOutput[]): FusionDistribution {
    const acc = zeroDist();
    for (const e of experts) {
      if (!e.available) continue;
      const w = expertWeight(e);
      if (w <= 0) continue;
      for (const l of FUSION_LABELS) acc[l] += w * (e.probabilities[l] ?? 0);
    }
    return normalize(acc);
  }
}

/**
 * Typed shape of a trained Logistic-Regression meta-learner (v1 target). The
 * feature vector is the concatenation of each expert's probability vector over
 * `FUSION_LABELS`, in `expertOrder`. Not implemented in this pass — `combine`
 * throws until weights are fit (see research/training scaffolds). Provided so
 * the trained model is a drop-in, not a redesign.
 */
export interface LogisticRegressionParams {
  readonly expertOrder: readonly string[];
  /** weights[class][feature]; bias[class]. */
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
}

export class LogisticRegressionMetaLearner implements MetaLearner {
  readonly kind = "logistic_regression" as const;
  constructor(private readonly params?: LogisticRegressionParams) {}
  combine(_experts: readonly ExpertOutput[]): FusionDistribution {
    if (!this.params) {
      throw new Error(
        "LogisticRegressionMetaLearner is untrained. Fit params in research/training, " +
          "or use StubWeightedMetaLearner for the v1 deterministic fusion.",
      );
    }
    // Trained inference is implemented when params are provided (future pass).
    throw new Error("LogisticRegressionMetaLearner.combine not implemented in this pass.");
  }
}

export function argmax(d: FusionDistribution): { label: FusionLabel; prob: number; margin: number } {
  const sorted = [...FUSION_LABELS].sort((a, b) => d[b] - d[a]);
  const label = sorted[0] as FusionLabel;
  const top = d[label];
  const second = sorted.length > 1 ? d[sorted[1] as FusionLabel] : 0;
  return { label, prob: top, margin: top - second };
}
