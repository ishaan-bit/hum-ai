import type { ValenceArousal } from "@hum-ai/shared-types";
import type { AffectStateHead } from "./heads";

/**
 * The shared fusion label space. Experts emit probabilities over THIS compact
 * space (or are mapped into it), and the late-fusion meta-learner combines them
 * here. Keeping the space in the contract (not in the fusion package) lets every
 * expert and the fusion engine agree without a dependency cycle.
 *
 * Each label carries its Valence–Arousal anchor (Russell circumplex, the
 * TriSense recommendation interlingua) and the dominant affect-state head it
 * feeds. This is how a categorical fusion result becomes a multi-head inference.
 */
export const FUSION_LABELS = [
  "calm_regulated",
  "positive_activation",
  "high_arousal_negative",
  "low_mood",
  "tense_anxious",
  "fatigued",
  "neutral_close_to_usual",
] as const;
export type FusionLabel = (typeof FUSION_LABELS)[number];

export interface FusionLabelAffect {
  readonly va: ValenceArousal;
  readonly dominantState: AffectStateHead;
}

export const FUSION_LABEL_AFFECT: Readonly<Record<FusionLabel, FusionLabelAffect>> = {
  calm_regulated: { va: { valence: 0.4, arousal: -0.3 }, dominantState: "calm_regulated" },
  positive_activation: { va: { valence: 0.6, arousal: 0.5 }, dominantState: "joy_positive_activation" },
  high_arousal_negative: { va: { valence: -0.5, arousal: 0.6 }, dominantState: "anger_frustration" },
  low_mood: { va: { valence: -0.5, arousal: -0.4 }, dominantState: "sadness_low_mood" },
  tense_anxious: { va: { valence: -0.3, arousal: 0.5 }, dominantState: "anxiety_like_tension" },
  fatigued: { va: { valence: -0.2, arousal: -0.6 }, dominantState: "fatigue_low_recovery" },
  neutral_close_to_usual: { va: { valence: 0, arousal: 0 }, dominantState: "neutral_close_to_usual" },
};

export function uniformFusionDistribution(): Record<FusionLabel, number> {
  const p = 1 / FUSION_LABELS.length;
  const out = {} as Record<FusionLabel, number>;
  for (const l of FUSION_LABELS) out[l] = p;
  return out;
}
