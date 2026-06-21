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

/** A closed-form confidence interval on a z-delta, accounting for finite-sample uncertainty. */
export interface ZDeltaCI {
  /** Lower CI bound on the z-delta. */
  readonly lo: number;
  /** Point estimate (the z-delta itself). */
  readonly center: number;
  /** Upper CI bound. */
  readonly hi: number;
  /** Half-width of the interval (the finite-sample uncertainty in σ units). */
  readonly halfWidth: number;
}

/**
 * One-sided 95% confidence interval on a z-delta from the baseline's own robust
 * stats ALONE — no Monte Carlo. The baseline center/scale are estimated from `n`
 * samples, so the standardized deviation carries sampling error `SE ≈ √(1.5/n)`
 * (the robust-scale finite-sample factor); the CI half-width is `z × SE`. A thin
 * baseline (small n) yields a WIDE interval, so a small deviation cannot be claimed
 * as a confident drift. Deterministic + pure.
 */
export function zDeltaCI(current: number, stats: RobustStats, z = 1.645): ZDeltaCI {
  const center = zDelta(current, stats);
  const n = Math.max(1, stats.n);
  const halfWidth = z * Math.sqrt(1.5 / n);
  return { lo: center - halfWidth, center, hi: center + halfWidth, halfWidth };
}

/**
 * The EFFECTIVE drift magnitude of a deviation after accounting for its CI overlap
 * with a stable band: if the interval overlaps `[-band, band]` the deviation is not
 * significant, so the magnitude is shrunk to `max(0, |center| − halfWidth)`; once the
 * whole interval clears the band the full `|center|` stands. Never negative. Pure.
 */
export function ciShrunkMagnitude(ci: ZDeltaCI, band: number): number {
  const overlapsBand = ci.lo <= band && ci.hi >= -band;
  if (!overlapsBand) return Math.abs(ci.center);
  return Math.max(0, Math.abs(ci.center) - ci.halfWidth);
}
