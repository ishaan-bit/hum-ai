import { clamp01, emptyModalityReliability, type ModalityReliability } from "@hum-ai/shared-types";
import type { ExpertOutput } from "@hum-ai/affect-model-contracts";

/**
 * Per-expert reliability weight for late fusion. Combines the expert's own
 * self-confidence, how on-domain it is for a hum (`domainMatch`), and how
 * in-distribution the sample looked (`1 − oodScore`). Missing experts weigh 0.
 *
 * This is the mechanism that solves the TriSense "modality dominance" problem:
 * a confident-but-off-domain speech expert is automatically down-weighted
 * relative to a hum-native expert.
 */
export function expertWeight(e: ExpertOutput): number {
  if (!e.available) return 0;
  return clamp01(e.selfConfidence * e.domainMatch * (1 - e.oodScore));
}

/**
 * PERSONALIZED expert weight (the "personalized fusion uses modality-reliability
 * weights" hook). Blends the per-sample `expertWeight` with the user's LEARNED
 * per-modality reliability (`UserModelProfile.modality_reliability_vector`) by
 * `personalWeight` (λ from the personalization ladder). A modality the user has
 * historically produced reliable signal on counts for more; a chronically noisy
 * one counts for less. `personalWeight = 0` (cold start) ⇒ identical to
 * `expertWeight`, so this is a safe drop-in for a meta-learner once a user
 * reaches `personalizedFusionActive`.
 */
export function personalizedExpertWeight(
  e: ExpertOutput,
  learned: ModalityReliability,
  personalWeight: number,
): number {
  const base = expertWeight(e);
  const w = clamp01(personalWeight);
  if (w <= 0 || !e.available) return base;
  const personal = clamp01(learned[e.modality] ?? 0);
  // Personal factor in [0.5, 1.5]: trusted modality amplifies, distrusted damps.
  const personalAdjusted = clamp01(base * (0.5 + personal));
  return clamp01((1 - w) * base + w * personalAdjusted);
}

/** Aggregate expert weights into a per-modality reliability vector (max per modality). */
export function modalityReliability(experts: readonly ExpertOutput[]): ModalityReliability {
  const out = emptyModalityReliability();
  for (const e of experts) {
    const w = expertWeight(e);
    if (w > out[e.modality]) out[e.modality] = w;
  }
  return out;
}

/** Number of distinct modalities that produced an available expert. */
export function availableModalityCount(experts: readonly ExpertOutput[]): number {
  const set = new Set(experts.filter((e) => e.available).map((e) => e.modality));
  return set.size;
}
