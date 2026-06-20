import type { RobustStats } from "@hum-ai/shared-types";

/**
 * CIRCADIAN / TIME-OF-DAY CONTEXT (v2).
 *
 * A person's "usual" hum is not constant through the day — a 7am hum and an 11pm
 * hum differ in energy, pitch and clarity for the same mood. A generic baseline
 * averages those away; a personal one shouldn't. This keeps a light per-time-bucket
 * center (EMA) so the read can be re-referenced against "your usual *at this time of
 * day*" once a bucket is well-sampled, falling back to the global baseline otherwise.
 *
 * Lightweight by design: only per-bucket feature CENTERS are kept (the spread is
 * borrowed from the global baseline), so the synced footprint stays small and derived.
 * Buckets are computed from the capture timestamp (UTC); a future pass can use the
 * capture-local hour when a timezone offset is available.
 */

export const TIME_BUCKETS = ["night", "morning", "afternoon", "evening"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

/** Min hums in a bucket before its center is trusted over the global baseline. */
export const CONTEXT_MIN_N = 4;
/** EMA smoothing for per-bucket centers. */
export const CONTEXT_EMA_ALPHA = 0.2;

export interface ContextBucketStats {
  readonly centers: Record<string, number>;
  readonly n: number;
}
export type ContextualCenters = Partial<Record<TimeBucket, ContextBucketStats>>;

/** Map an ISO timestamp to its time-of-day bucket (UTC hour). */
export function timeBucket(iso: string): TimeBucket {
  const ms = Date.parse(iso);
  const hour = Number.isFinite(ms) ? new Date(ms).getUTCHours() : 12;
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function newContextualCenters(): ContextualCenters {
  return {};
}

/** EMA-update the per-feature centers for one time bucket; pure. */
export function updateContextualCenters(
  prev: ContextualCenters,
  bucket: TimeBucket,
  features: Record<string, number>,
  alpha = CONTEXT_EMA_ALPHA,
): ContextualCenters {
  const out: ContextualCenters = { ...prev };
  const cur = out[bucket] ?? { centers: {}, n: 0 };
  const centers: Record<string, number> = { ...cur.centers };
  for (const [f, v] of Object.entries(features)) {
    if (!Number.isFinite(v)) continue;
    const prevC = centers[f];
    centers[f] = prevC === undefined ? v : prevC + alpha * (v - prevC);
  }
  out[bucket] = { centers, n: cur.n + 1 };
  return out;
}

/**
 * Replace each baseline feature's CENTER with the time-of-day bucket center when
 * that bucket is well-sampled (n ≥ minN) and has the feature — so z-deltas are taken
 * against "your usual at this time of day". Spread (MAD/IQR/σ) and n are kept from the
 * global baseline. Falls back to the global baseline when context is thin/absent.
 */
export function contextAdjustedBaseline(
  baseline: Record<string, RobustStats>,
  contextual: ContextualCenters | undefined,
  bucket: TimeBucket,
  minN = CONTEXT_MIN_N,
): Record<string, RobustStats> {
  const ctx = contextual?.[bucket];
  if (!ctx || ctx.n < minN) return baseline;
  const out: Record<string, RobustStats> = {};
  for (const [f, stats] of Object.entries(baseline)) {
    const center = ctx.centers[f];
    out[f] = center === undefined ? stats : { ...stats, median: center };
  }
  return out;
}
