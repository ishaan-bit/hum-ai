import { clamp01 } from "@hum-ai/shared-types";

/**
 * EMPIRICAL-BAYES SHRINKAGE (v2).
 *
 * v1 shifts weight from the population prior to the personal model with a single
 * global λ keyed to the ladder. That is coarse: at 10 eligible hums a feature the
 * user has produced cleanly 10 times deserves more personal trust than one seen
 * twice. Shrinkage makes the prior→personal blend PER-FEATURE and evidence-driven:
 *
 *   personalWeight(n) = n / (n + K)        // James–Stein / Beta-Binomial flavor
 *
 * K is the prior strength in pseudo-observations — with K samples the personal
 * estimate and the population prior count equally. The variance-aware variant
 * shrinks noisy features harder (a wide personal spread = weaker per-sample
 * evidence). This is the standard, principled way to personalize a cold start.
 */

/** Prior strength K (pseudo-observations) at which personal == prior. */
export const SHRINKAGE_PRIOR_STRENGTH = 5;

/** Per-feature personal weight from sample count: n/(n+K) ∈ [0,1). */
export function evidenceWeight(n: number, priorStrength = SHRINKAGE_PRIOR_STRENGTH): number {
  if (!(n > 0)) return 0;
  return clamp01(n / (n + Math.max(priorStrength, 1e-9)));
}

/**
 * Variance-aware personal weight: a noisier personal estimate is weaker evidence,
 * so its effective sample count is reduced. `relSpread` is a unitless noise proxy
 * (≥ 0); 0 ⇒ identical to `evidenceWeight`.
 */
export function evidenceWeightVarianceAware(
  n: number,
  relSpread: number,
  priorStrength = SHRINKAGE_PRIOR_STRENGTH,
): number {
  const noisePenalty = 1 / (1 + Math.max(0, relSpread));
  return evidenceWeight(n * noisePenalty, priorStrength);
}

/** Blend a personal estimate toward a prior by the personal weight ∈ [0,1]. */
export function shrinkTowardPrior(personal: number, prior: number, personalWeight: number): number {
  const w = clamp01(personalWeight);
  return w * personal + (1 - w) * prior;
}
