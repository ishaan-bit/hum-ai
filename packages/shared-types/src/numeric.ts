/**
 * Small, dependency-free numeric helpers shared across packages.
 *
 * These are intentionally pure functions so they can be unit-tested in
 * isolation and reused by the quality gate, personalization baseline, and
 * confidence model without pulling in any math library.
 */

/** A probability in the closed interval [0, 1]. */
export type Probability = number;

/** A unit interval value in [0, 1] (quality, agreement, match scores, etc.). */
export type UnitInterval = number;

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamp into [0, 1]. */
export function clamp01(value: number): UnitInterval {
  return clamp(value, 0, 1);
}

/** Arithmetic mean of a non-empty array; returns `fallback` for empty input. */
export function mean(values: readonly number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Linear interpolation factor of `x` within [low, high], clamped to [0, 1].
 * Mirrors the `normalize(x, low, high)` helper described in the Hum spec
 * (Section 9, Moment Read Dimensions).
 */
export function normalize(x: number, low: number, high: number): UnitInterval {
  if (high === low) return 0;
  return clamp01((x - low) / (high - low));
}

/** `1 - normalize(x, low, high)`. */
export function inverseNormalize(x: number, low: number, high: number): UnitInterval {
  return 1 - normalize(x, low, high);
}

/**
 * Percentile via linear interpolation between closest ranks.
 * `p` is in [0, 1]. Returns `NaN` for empty input.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const rank = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const lower = sorted[lo] as number;
  const upper = sorted[hi] as number;
  if (lo === hi) return lower;
  return lower + (upper - lower) * (rank - lo);
}

/** Median (50th percentile). */
export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** Round to `decimals` places (default 0) with sane handling of negatives. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
