import { clamp, clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import type { AffectAxisPrior, AxisPrediction } from "@hum-ai/orchestrator";
import { applyStandardizer, predictProba, type LogRegParams } from "@hum-ai/signal-lab/model";
import { toFeatureVector } from "@hum-ai/signal-lab/feature-schema";
import { AXIS_POLE_LABELS } from "./train";
import type { Axis } from "./calibration";

/**
 * Wrap a promoted HUM-NATIVE axis model as the orchestrator's `AffectAxisPrior`.
 *
 * The crucial difference from signal-lab's far-domain `buildAffectAxisPrior`: this
 * model's standardizer is fit on HUMS, so a real hum sits squarely INSIDE its
 * training distribution (`meanAbsZ` small) and `predict` returns `inDomain: true` —
 * it CONTRIBUTES to the read instead of abstaining OOD. It carries NO far-domain
 * penalty because it is not far-domain. It still only REFINES (the orchestrator caps
 * any axis prior's nudge at 0.5 weight — ADR-0010), and it only exists once it has
 * cleared the native promotion gate, so `passedGate` is honestly true.
 */

export interface HumNativeAxisMeta {
  readonly axis: Axis;
  /** Held-out balanced accuracy that earned promotion (provenance for the read). */
  readonly balancedAccuracy: number;
  /** meanAbsZ at/above which even a native model treats the hum as atypical. */
  readonly oodThreshold?: number;
}

function meanAbsZ(params: LogRegParams, raw: readonly number[]): number {
  const z = applyStandardizer(raw, params.standardizer);
  if (z.length === 0) return 0;
  let s = 0;
  for (const v of z) s += Math.abs(v);
  return s / z.length;
}

export function buildHumNativeAxisPrior(params: LogRegParams, meta: HumNativeAxisMeta): AffectAxisPrior {
  const oodThreshold = meta.oodThreshold ?? 3.0; // hums fit their own standardizer (mz ~0.7–1.5); only a wildly atypical capture is OOD
  const poles = AXIS_POLE_LABELS[meta.axis];
  return {
    axis: meta.axis,
    balancedAccuracy: meta.balancedAccuracy,
    passedGate: true, // a native prior only exists once it cleared the native gate
    nativeDomain: true, // on-domain hum truth — earns the larger nudge cap (ADR-0011)
    predict(features: AcousticFeatures): AxisPrediction {
      const raw = toFeatureVector(features);
      const dist = predictProba(params, raw);
      const pHigh = dist[poles.high] ?? 0;
      const value = clamp(2 * pHigh - 1, -1, 1); // P(high pole) → signed [-1,1]
      const mz = meanAbsZ(params, raw);
      // Native domain: in-domain is the COMMON case. ood rises only well beyond the training spread.
      const ood = clamp01((mz - 1.5) / 2.5);
      const inDomain = mz < oodThreshold;
      const margin = Math.abs(value);
      const confidence = inDomain ? clamp01(margin * (1 - ood)) : 0;
      return { value, ood, inDomain, confidence };
    },
  };
}
