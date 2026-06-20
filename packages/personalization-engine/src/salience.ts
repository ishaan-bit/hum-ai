import type { RobustStats } from "@hum-ai/shared-types";
import type { BaselineVector } from "./profile";

/**
 * PERSONAL FEATURE SALIENCE (v2).
 *
 * A generic personalization treats every DSP feature as equally meaningful. A
 * good one learns *which* axes carry this person's signal. Salience answers, per
 * feature: "how much independent, well-evidenced information does a deviation on
 * this feature carry for THIS user?"
 *
 *  - **Coverage** — features the user has actually produced many times have a
 *    trustworthy baseline; thin features are discounted (empirical evidence).
 *  - **Redundancy decorrelation** — features that move together within the user
 *    (e.g. the cluster of loudness-correlated energy features) share information;
 *    counting them all fully would let one physical effect dominate the read, so
 *    each is down-weighted by how much it correlates with the rest. This is a
 *    cheap stand-in for a full inverse-covariance (Mahalanobis) weighting that
 *    stays stable on the small, ragged sample counts a real user produces.
 *
 * Salience is *learned* (computed in `ingestHum`, cached on the profile) and then
 * read cheaply at inference time — the personal deviation weights z-deltas by it.
 */

/** n at which a feature reaches half of its coverage weight (n/(n+K)). */
export const SALIENCE_COVERAGE_K = 6;
/** |correlation| at/above which two features are treated as mutually redundant. */
export const REDUNDANCY_CORR_THRESHOLD = 0.6;

/** Evidence/coverage weight for a baseline estimate: n/(n+K) ∈ [0,1). */
export function coverageWeight(n: number, k = SALIENCE_COVERAGE_K): number {
  if (!(n > 0)) return 0;
  return n / (n + k);
}

/** Pearson correlation over the trailing overlap of two series (0 when undefined). */
export function seriesCorrelation(a: readonly number[], b: readonly number[]): number {
  const m = Math.min(a.length, b.length);
  if (m < 3) return 0;
  const aa = a.slice(a.length - m);
  const bb = b.slice(b.length - m);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < m; i++) {
    ma += aa[i]!;
    mb += bb[i]!;
  }
  ma /= m;
  mb /= m;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < m; i++) {
    const da = aa[i]! - ma;
    const db = bb[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * Redundancy discount per feature: a feature strongly correlated with many others
 * carries less *independent* information, so it is scaled by 1/(1 + Σ|corr|≥thr).
 * Returns 1 for every feature when no windows are supplied (nothing to decorrelate).
 */
export function redundancyDiscount(
  windows: Record<string, readonly number[]>,
  threshold = REDUNDANCY_CORR_THRESHOLD,
): Record<string, number> {
  const feats = Object.keys(windows);
  const acc: Record<string, number> = {};
  for (const f of feats) acc[f] = 1; // 1 = itself; correlations add on top
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      const fi = feats[i]!;
      const fj = feats[j]!;
      const r = Math.abs(seriesCorrelation(windows[fi]!, windows[fj]!));
      if (r >= threshold) {
        acc[fi]! += r;
        acc[fj]! += r;
      }
    }
  }
  const out: Record<string, number> = {};
  for (const f of feats) out[f] = 1 / acc[f]!;
  return out;
}

export interface SalienceOptions {
  /** Per-feature eligible-hum windows (for redundancy decorrelation). */
  readonly windows?: Record<string, readonly number[]>;
  readonly coverageK?: number;
  readonly corrThreshold?: number;
}

/**
 * Per-feature personal salience = coverage(n) × redundancy-discount. Returns a
 * RELATIVE weight per feature (callers normalize); honest — it uses only the
 * user's own derived data, never a population feature prior we don't have.
 */
export function featureSalience(baseline: BaselineVector, opts: SalienceOptions = {}): Record<string, number> {
  const redund = opts.windows ? redundancyDiscount(opts.windows, opts.corrThreshold) : null;
  const out: Record<string, number> = {};
  for (const [feature, stats] of Object.entries(baseline)) {
    const s: RobustStats = stats;
    const cov = coverageWeight(s.n, opts.coverageK);
    const red = redund ? redund[feature] ?? 1 : 1;
    out[feature] = cov * red;
  }
  return out;
}
