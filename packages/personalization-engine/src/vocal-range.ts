import { computeRangeStats, rangePosition, type RangeStats } from "@hum-ai/shared-types";

/**
 * THE LONGITUDINAL VOCAL-RANGE MODEL (Stable Build v13).
 *
 * The rest of the personalization engine answers "how UNUSUAL is this hum for you" — a
 * z-delta of the current value against the rolling MEDIAN (center + scale). That is the right
 * frame for drift/relapse. It is NOT the right frame for the design's other question: WHERE in
 * this person's own reachable RANGE does a parameter sit right now.
 *
 * A user's vocal range — how quiet↔loud, low↔high, dark↔bright, steady↔roving their voice
 * actually gets — is an ABSOLUTE property of the speaker (+ their mic), and unlike a mood it only
 * SHARPENS as more hums arrive. This is the directive's "where absolute values come into focus …
 * assessing a user's vocal range, and all the ranges of all the parameters … wired in a
 * longitudinal modelling sense, so this layer gets refined through subsequent hums."
 *
 * So the vocal-range model is the THIRD sibling of the dual baseline (rolling center / anchored
 * center / longitudinal RANGE). It is fed by ABSOLUTE per-hum feature values (the same windows
 * the baselines use) and gives a per-parameter robust span (p05…p95). `rangePosition` then maps
 * any value into the user's own [0,1] reachable span — the absolute-but-personal reference frame a
 * within-hum/per-chunk read can use to say "this stretch sat at the LOW end of your usual loudness"
 * without leaking the population-absolute offset of the speaker's voice.
 *
 * Robust by construction (p05/p95, not raw min/max) so a single clipped or near-silent hum cannot
 * blow the range open — the same discipline as `computeRobustStats`.
 */

/** Per-feature longitudinal range: feature name → robust range stats over the user's eligible hums. */
export type VocalRangeVector = Record<string, RangeStats>;

/**
 * Eligible-hum count below which the range is too thin to trust. A range needs more samples than a
 * median to stabilize (you have to have HIT both ends of your span), so this sits above
 * `baselineActive` (5). Consumers should treat a sub-threshold range as "still forming".
 */
export const VOCAL_RANGE_MIN_HUMS = 8;

/**
 * Build the per-feature longitudinal vocal-range model from the bounded per-feature windows
 * (absolute values). Computed over the FULL retained window (up to `FEATURE_HISTORY_LIMIT`), so it
 * accumulates the user's reachable span and refines each hum as more samples arrive. Pure.
 */
export function buildVocalRange(samplesByFeature: Record<string, readonly number[]>): VocalRangeVector {
  const out: VocalRangeVector = {};
  for (const [feature, values] of Object.entries(samplesByFeature)) {
    out[feature] = computeRangeStats(values);
  }
  return out;
}

/** True once at least one feature's range is supported by ≥ `minHums` eligible hums. */
export function vocalRangeActive(range: VocalRangeVector | undefined, minHums = VOCAL_RANGE_MIN_HUMS): boolean {
  if (!range) return false;
  for (const stats of Object.values(range)) if (stats.n >= minHums) return true;
  return false;
}

/**
 * Where `value` sits in the user's own reachable range for `feature`, in [0,1] (low edge → 0,
 * high edge → 1), or `null` when the range is not yet trustworthy (too few hums / degenerate span)
 * — the caller then falls back to the population-absolute read rather than a fabricated 0.5.
 */
export function featureRangePosition(
  feature: string,
  value: number,
  range: VocalRangeVector | undefined,
  minHums = VOCAL_RANGE_MIN_HUMS,
): number | null {
  const stats = range?.[feature];
  if (!stats || stats.n < minHums) return null;
  return rangePosition(value, stats);
}
