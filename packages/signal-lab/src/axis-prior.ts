import { clamp, clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import type { AffectAxisPrior, AxisPrediction } from "@hum-ai/orchestrator";
import { applyStandardizer, predictProba, type LogRegParams } from "./model";
import { toFeatureVector } from "./feature-schema";

/**
 * Wrap a trained coarse-axis LogReg (signal-lab `model.valence_binary.json` /
 * `model.arousal_binary.json`) as an OOD-aware `AffectAxisPrior` for the orchestrator.
 *
 * Browser-safe (pure): no `node:fs`. The web loads the params + manifest and calls this;
 * the runtime bridge does the same for Node. The model owns its standardizer, so the OOD
 * distance is computed here from how far the hum's standardized features sit from the
 * (far-domain, acted-speech) training distribution. A hum is typically OUTSIDE that
 * domain, so `predict` abstains (`inDomain=false`) — honest, by design (ADR-0005).
 */
export interface AxisPriorMeta {
  readonly axis: "valence" | "arousal";
  /** Honest balanced accuracy on the far-domain validation set (from the manifest). */
  readonly balancedAccuracy: number;
  readonly passedGate: boolean;
  /** meanAbsZ at/above which the input is treated as out-of-domain. Default 1.8. */
  readonly oodThreshold?: number;
}

/** The label that means "high pole" for each axis (value → +1). */
const POSITIVE_POLE: Record<"valence" | "arousal", string> = {
  valence: "positive_valence",
  arousal: "high_arousal",
};

/** Mean |standardized value| across the feature vector — the OOD distance proxy. */
function meanAbsZ(params: LogRegParams, raw: readonly number[]): number {
  const z = applyStandardizer(raw, params.standardizer);
  if (z.length === 0) return 0;
  let s = 0;
  for (const v of z) s += Math.abs(v);
  return s / z.length;
}

export function buildAffectAxisPrior(params: LogRegParams, meta: AxisPriorMeta): AffectAxisPrior {
  const oodThreshold = meta.oodThreshold ?? 1.8;
  const posLabel = POSITIVE_POLE[meta.axis];
  return {
    axis: meta.axis,
    balancedAccuracy: meta.balancedAccuracy,
    passedGate: meta.passedGate,
    predict(features: AcousticFeatures): AxisPrediction {
      const raw = toFeatureVector(features);
      const dist = predictProba(params, raw);
      const pPos = dist[posLabel] ?? dist[params.labels[params.labels.length - 1]!] ?? 0;
      const value = clamp(2 * pPos - 1, -1, 1); // P(high pole) → signed [-1,1]
      const mz = meanAbsZ(params, raw);
      // ~0 at in-domain (mz≈0.74 on real RAVDESS), saturating to 1 far out (mz≳3).
      const ood = clamp01((mz - 1.0) / 2.2);
      const inDomain = mz < oodThreshold;
      const margin = Math.abs(value); // distance from the decision boundary
      const confidence = inDomain ? clamp01(margin * (1 - ood)) : 0;
      return { value, ood, inDomain, confidence };
    },
  };
}
