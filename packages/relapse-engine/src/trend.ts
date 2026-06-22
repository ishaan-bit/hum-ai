import { clamp01, median } from "@hum-ai/shared-types";

/**
 * ROBUST WITHIN-USER TREND ESTIMATION.
 *
 * The longitudinal read previously inferred a trend direction from a single relapse
 * verdict (one paired comparison). That is fragile to a noisy hum. This module adds
 * distribution-free estimators over the user's RECENT SERIES that are robust to
 * outliers and small n — the right tools for sparse, noisy daily-hum data:
 *
 *  - Theil–Sen slope: the median of all pairwise slopes. Tolerates up to ~29% outliers,
 *    needs no Gaussian assumption — far more honest on a handful of noisy hums than OLS.
 *  - Mann–Kendall: a non-parametric monotonic-trend test (S statistic + Kendall's τ),
 *    so we can say a trend is *significant* rather than reading noise as a direction.
 *  - CUSUM: cumulative-sum drift detection for the ONSET of a sustained shift (early
 *    warning), with the approximate changepoint index.
 *
 * Pure, deterministic, dependency-light. Non-clinical: these describe the user's own
 * recent series; they never diagnose. Confidence is bounded and earned from |τ| and n.
 */

export interface SeriesPoint {
  /** Monotonic time key (ms epoch or an index). Only the ORDER + spacing matter. */
  readonly t: number;
  readonly value: number;
}

export type TrendDirection = "rising" | "falling" | "flat";

export interface TrendEstimate {
  readonly n: number;
  /** Theil–Sen slope in value-units per t-unit (0 when < 2 points). */
  readonly slope: number;
  /** Robust intercept (median of value − slope·t), for extrapolation. */
  readonly intercept: number;
  readonly direction: TrendDirection;
  /** Kendall's τ in [-1, 1] — rank correlation of value vs time. */
  readonly tau: number;
  /** Mann–Kendall S statistic (sum of concordant − discordant sign pairs). */
  readonly s: number;
  /** True when the monotonic trend clears the small-sample significance bar. */
  readonly significant: boolean;
  /** Earned confidence [0,1] from |τ| and sample size — never overstated. */
  readonly confidence: number;
}

/** Theil–Sen slope: median of pairwise slopes (skips equal-time pairs). */
export function theilSenSlope(points: readonly SeriesPoint[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j]!.t - points[i]!.t;
      if (dt === 0) continue;
      slopes.push((points[j]!.value - points[i]!.value) / dt);
    }
  }
  return slopes.length ? median(slopes) : 0;
}

/**
 * Mann–Kendall trend test on the value series (assumes points are in time order).
 * Returns the S statistic, Kendall's τ, a direction, and a small-sample significance
 * flag. We use a conservative |S| threshold scaled by √(variance) rather than a full
 * normal-approximation p-value — honest and dependency-free for the small n we have.
 */
export function mannKendall(values: readonly number[]): {
  s: number;
  tau: number;
  direction: TrendDirection;
  significant: boolean;
} {
  const n = values.length;
  if (n < 3) return { s: 0, tau: 0, direction: "flat", significant: false };
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(values[j]! - values[i]!);
    }
  }
  const denom = (n * (n - 1)) / 2;
  const tau = denom > 0 ? s / denom : 0;
  // Variance of S under the null (no ties correction — ties are rare on continuous reads).
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = varS > 0 ? (s - Math.sign(s)) / Math.sqrt(varS) : 0; // continuity-corrected
  const significant = Math.abs(z) >= 1.645; // ~one-sided 95%
  const direction: TrendDirection = s > 0 ? "rising" : s < 0 ? "falling" : "flat";
  return { s, tau, direction, significant };
}

/**
 * Robust trend over a recent series: Theil–Sen slope + Mann–Kendall significance.
 * `flatSlopeEps` collapses a near-zero slope to "flat" so micro-drift isn't read as
 * a direction. Confidence is |τ| tempered by sample size (more hums → more trust),
 * and zeroed when the trend is not significant.
 */
export function estimateTrend(
  points: readonly SeriesPoint[],
  opts: { flatSlopeEps?: number } = {},
): TrendEstimate {
  const n = points.length;
  if (n < 3) {
    return { n, slope: 0, intercept: n ? points[0]!.value : 0, direction: "flat", tau: 0, s: 0, significant: false, confidence: 0 };
  }
  const slope = theilSenSlope(points);
  const intercept = median(points.map((p) => p.value - slope * p.t));
  const mk = mannKendall(points.map((p) => p.value));
  const eps = opts.flatSlopeEps ?? 0;
  const direction: TrendDirection = Math.abs(slope) <= eps ? "flat" : mk.direction;
  // Earned confidence: |τ| × a sample-size factor, only when significant.
  const sizeFactor = clamp01((n - 2) / 8); // ramps in from n=3, full by ~n=10
  const confidence = mk.significant && direction !== "flat" ? clamp01(Math.abs(mk.tau) * sizeFactor) : 0;
  return { n, slope, intercept, direction, tau: mk.tau, s: mk.s, significant: mk.significant, confidence };
}

export interface CusumResult {
  readonly drift: "up" | "down" | "none";
  /** Peak normalized cumulative deviation [0,∞); compare against `threshold`. */
  readonly magnitude: number;
  /** Index where the detected drift began (the run's start), or null when none. */
  readonly changeIndex: number | null;
}

/**
 * Tabular CUSUM drift detector for the ONSET of a sustained shift (early warning).
 *
 * The target is the EARLY in-control baseline (mean of the first `warmup` points), NOT
 * the global mean — so a step change actually accumulates against where the series
 * STARTED, which is the question that matters for drift ("has it moved away from the
 * user's recent steady level?"). The scale is a robust full-series MAD estimate. The
 * cumulative sums grow only while the series sits above/below the baseline by more than
 * the `slack`, and a drift is flagged when one crosses the `threshold` decision interval;
 * the onset index is where that run began. Pure.
 */
export function cusumDrift(
  values: readonly number[],
  opts: { threshold?: number; slack?: number; warmup?: number } = {},
): CusumResult {
  const n = values.length;
  if (n < 4) return { drift: "none", magnitude: 0, changeIndex: null };
  const warmup = Math.max(2, Math.min(opts.warmup ?? 3, Math.floor(n / 2)));
  const mu0 = values.slice(0, warmup).reduce((a, b) => a + b, 0) / warmup; // in-control baseline
  const m = values.reduce((a, b) => a + b, 0) / n;
  const mad = median(values.map((v) => Math.abs(v - m))) || 1e-9;
  const scale = 1.4826 * mad; // MAD → robust σ estimate
  const k = opts.slack ?? 0.5; // slack in σ units (reference value)
  const threshold = opts.threshold ?? 4; // decision interval in σ units

  let sHi = 0;
  let sLo = 0;
  let hiStart = 0;
  let loStart = 0;
  let best: CusumResult = { drift: "none", magnitude: 0, changeIndex: null };
  for (let i = 0; i < n; i++) {
    const z = (values[i]! - mu0) / scale;
    if (sHi === 0) hiStart = i;
    if (sLo === 0) loStart = i;
    sHi = Math.max(0, sHi + z - k);
    sLo = Math.max(0, sLo - z - k);
    if (sHi > best.magnitude) best = { drift: "up", magnitude: sHi, changeIndex: hiStart };
    if (sLo > best.magnitude) best = { drift: "down", magnitude: sLo, changeIndex: loStart };
  }
  return best.magnitude >= threshold ? best : { drift: "none", magnitude: best.magnitude, changeIndex: null };
}
