import { clamp } from "@hum-ai/shared-types";

/**
 * WITHIN-USER SIGNATURE LEARNING (ADR-0003).
 *
 * The `UserModelProfile` carries a `recovery_signature_vector` and a
 * `high_risk_signature_vector` — "what does a recovered/stable hum look like for
 * THIS person" vs "what does a high-risk hum look like for them", expressed as a
 * centroid of per-feature z-deltas (deviation from their own baseline). They are
 * the personal counterpart to the population priors: the relapse engine compares
 * risk scores, but these say *which direction* the user's features move when they
 * are doing well vs badly.
 *
 * Both are learned online from eligible hums, routed by the hum's risk band, with
 * a slow EMA so a single session cannot redraw the signature. They start empty
 * and are only meaningful once the personal baseline is active (≥ 5 eligible hums),
 * so z-deltas exist to learn from.
 */

/** A learned per-feature centroid of z-deltas (recovery or high-risk signature). */
export type SignatureVector = Record<string, number>;

/** EMA learning rate for signature centroids — slow, so no single hum dominates. */
export const SIGNATURE_EMA_ALPHA = 0.15;

/**
 * EMA-update a signature centroid toward a freshly observed z-delta vector.
 * Features new to the centroid are seeded with the observed value; existing
 * features are nudged by `alpha`. Non-finite observations are skipped. Pure.
 */
export function updateSignatureCentroid(
  prev: SignatureVector,
  zDeltas: Record<string, number>,
  alpha = SIGNATURE_EMA_ALPHA,
): SignatureVector {
  const out: SignatureVector = { ...prev };
  for (const [feature, z] of Object.entries(zDeltas)) {
    if (!Number.isFinite(z)) continue;
    const prior = out[feature];
    out[feature] = prior === undefined ? z : prior + alpha * (z - prior);
  }
  return out;
}

/**
 * Cosine alignment ∈ [−1, 1] of a current z-delta vector with a learned signature,
 * over the features they share. +1 = the hum looks just like that signature (e.g.
 * the user's own high-risk pattern), 0 = orthogonal / no shared support, −1 =
 * opposite. Returns 0 when there is no shared support — we never invent an
 * alignment against a signature we have not earned.
 */
export function signatureAlignment(
  zDeltas: Record<string, number>,
  signature: SignatureVector,
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  let shared = 0;
  for (const [feature, a] of Object.entries(zDeltas)) {
    const b = signature[feature];
    if (b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    dot += a * b;
    normA += a * a;
    normB += b * b;
    shared++;
  }
  if (shared === 0 || normA === 0 || normB === 0) return 0;
  return clamp(dot / (Math.sqrt(normA) * Math.sqrt(normB)), -1, 1);
}
