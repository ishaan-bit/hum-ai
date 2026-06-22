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

/** Return `value` if it is a finite number, else `fallback`. Rejects NaN/±Infinity/non-number. */
export function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Numerically stable softmax over a vector of logits: shift by the max, exponentiate,
 * then L1-normalize. The `sum || 1` guard makes an all-equal or empty input safe
 * (empty → `[]`). Pure; the single source shared by every model that scores classes.
 */
export function softmax(z: readonly number[]): number[] {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  let sum = 0;
  const out = new Array<number>(z.length);
  for (let k = 0; k < z.length; k++) {
    const e = Math.exp(z[k]! - max);
    out[k] = e;
    sum += e;
  }
  const denom = sum || 1;
  for (let k = 0; k < z.length; k++) out[k] = out[k]! / denom;
  return out;
}

/**
 * mulberry32 — a tiny deterministic PRNG. `makeRng(seed)` returns a closure yielding
 * values in [0, 1). The `seed >>> 0` coercion keeps seeding reproducible, so CV folds,
 * permutation nulls, and synth fixtures stay byte-for-byte stable across runs.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * L1-normalize the non-negative part of a score Record over a fixed key set so the result
 * sums to 1. When every score is ≤ 0 (no signal), each key falls back to `fallback(key)`
 * if supplied, else a uniform `1 / keys.length`. The single source for the expert /
 * fusion / domain probability-normalization that recurred verbatim across packages.
 */
export function normalizeDistribution<K extends string>(
  scores: Readonly<Partial<Record<K, number>>>,
  keys: readonly K[],
  fallback?: (key: K) => number,
): Record<K, number> {
  let total = 0;
  for (const k of keys) total += Math.max(scores[k] ?? 0, 0);
  const out = {} as Record<K, number>;
  if (total <= 0) {
    for (const k of keys) out[k] = fallback ? fallback(k) : 1 / keys.length;
    return out;
  }
  for (const k of keys) out[k] = Math.max(scores[k] ?? 0, 0) / total;
  return out;
}

