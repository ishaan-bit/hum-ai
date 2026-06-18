import { percentile, median } from "./numeric";

/**
 * Robust per-feature statistics, defined exactly as in `hum_spec` §4.6
 * (Baseline Construction). Robust estimators (median/MAD/IQR) are used instead
 * of mean/SD because early baselines are small and fragile and must not be
 * dominated by a single outlier hum.
 */
export interface RobustStats {
  /** Number of samples the stats were computed from. */
  readonly n: number;
  /** 50th percentile — the robust center used for z-deltas and ratios. */
  readonly median: number;
  /** Median Absolute Deviation. */
  readonly mad: number;
  /** Inter-quartile range (p75 − p25). */
  readonly iqr: number;
  /** Robust standard deviation = MAD × 1.4826 (normal-consistent estimator). */
  readonly robustStd: number;
}

/** MAD → σ scaling constant for a normal distribution. */
export const MAD_TO_STD = 1.4826;

export function computeRobustStats(values: readonly number[]): RobustStats {
  const n = values.length;
  if (n === 0) {
    return { n: 0, median: Number.NaN, mad: Number.NaN, iqr: Number.NaN, robustStd: Number.NaN };
  }
  const med = median(values);
  const absDev = values.map((v) => Math.abs(v - med));
  const mad = median(absDev);
  const iqr = percentile(values, 0.75) - percentile(values, 0.25);
  return { n, median: med, mad, iqr, robustStd: mad * MAD_TO_STD };
}

/**
 * z-delta: how far `current` sits from the baseline center in robust-σ units.
 * `epsilon` floors the denominator so near-constant features don't explode.
 * Mirrors `zDelta(feature) = (current - mean) / max(std, epsilon)`.
 */
export function zDelta(current: number, stats: RobustStats, epsilon = 1e-6): number {
  const std = Math.max(stats.robustStd, epsilon);
  return (current - stats.median) / std;
}

/**
 * Feature ratio relative to the baseline center, defined only when the center
 * is positive (mirrors `ratio = current / baselineMean when baselineMean > 0`).
 * Returns `null` when the center is non-positive.
 */
export function featureRatio(current: number, stats: RobustStats): number | null {
  if (!(stats.median > 0)) return null;
  return current / stats.median;
}
