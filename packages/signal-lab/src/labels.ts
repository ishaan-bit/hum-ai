import { FUSION_LABELS, FUSION_LABEL_AFFECT, type FusionLabel } from "@hum-ai/affect-model-contracts";
import type { RavdessEmotion } from "@hum-ai/dataset-harness";

/**
 * Label / target harmonization (ADR-0005: public labels are PRIORS, never hum
 * truth). The only locally-available dataset that carries affect labels AND audio
 * is RAVDESS (acted_speech_emotion, `far` domain). We map its own categorical
 * emotion annotation onto the repo's compact fusion-label target space
 * (`FUSION_LABELS`, `fusion-labels.ts`), which already carries Russell V-A anchors
 * and a dominant affect-state head per label.
 *
 * Every mapping is traceable to:
 *  - the dataset's own annotation (`@hum-ai/dataset-harness` `ravdess.ts`),
 *  - the fusion-label V-A anchors (`FUSION_LABEL_AFFECT`), and
 *  - the Russell circumplex placement adopted by `trisense_architecture`.
 *
 * Ambiguous RAVDESS emotions with NO clean fusion-label home are EXCLUDED rather
 * than force-fit (ADR-0005: do not force datasets into categories the repo does
 * not justify). The exclusions are recorded so the gap is honest, not hidden.
 */

export type MappingStrength = "direct" | "moderate";

export interface EmotionMapping {
  readonly emotion: RavdessEmotion;
  /** Target fusion label, or null when the emotion is intentionally excluded. */
  readonly fusionLabel: FusionLabel | null;
  readonly strength: MappingStrength | "excluded";
  readonly rationale: string;
}

/**
 * RAVDESS 8-class emotion → fusion label. `neutral/calm/happy/sad/angry` are
 * direct circumplex matches; `fearful` is a moderate match to `tense_anxious`
 * (both occupy the high-arousal-negative "tense" quadrant). `disgust` and
 * `surprised` are excluded: disgust has no distinct fusion label and surprise has
 * ambiguous valence — forcing either would manufacture a target the repo's label
 * space does not justify.
 */
export const RAVDESS_EMOTION_MAPPING: Readonly<Record<RavdessEmotion, EmotionMapping>> = {
  neutral: {
    emotion: "neutral",
    fusionLabel: "neutral_close_to_usual",
    strength: "direct",
    rationale: "RAVDESS neutral ↔ neutral_close_to_usual (V0/A0).",
  },
  calm: {
    emotion: "calm",
    fusionLabel: "calm_regulated",
    strength: "direct",
    rationale: "RAVDESS calm ↔ calm_regulated (positive valence, low arousal).",
  },
  happy: {
    emotion: "happy",
    fusionLabel: "positive_activation",
    strength: "direct",
    rationale: "RAVDESS happy ↔ positive_activation (positive valence, raised arousal).",
  },
  sad: {
    emotion: "sad",
    fusionLabel: "low_mood",
    strength: "direct",
    rationale: "RAVDESS sad ↔ low_mood (negative valence, low arousal).",
  },
  angry: {
    emotion: "angry",
    fusionLabel: "high_arousal_negative",
    strength: "direct",
    rationale: "RAVDESS angry ↔ high_arousal_negative (negative valence, high arousal).",
  },
  fearful: {
    emotion: "fearful",
    fusionLabel: "tense_anxious",
    strength: "moderate",
    rationale:
      "RAVDESS fearful → tense_anxious (closest fusion label; both sit in the high-arousal negative 'tense' quadrant). Fear ≠ anxiety, so strength is moderate.",
  },
  disgust: {
    emotion: "disgust",
    fusionLabel: null,
    strength: "excluded",
    rationale:
      "No distinct fusion label for disgust; collapsing it into high_arousal_negative (anger) would conflate two states the label space separates. Excluded.",
  },
  surprised: {
    emotion: "surprised",
    fusionLabel: null,
    strength: "excluded",
    rationale:
      "Surprise has ambiguous valence (can be positive or negative); no single fusion label is justified. Excluded.",
  },
};

/** Map a RAVDESS emotion to its fusion label, or null if excluded. */
export function fusionLabelForEmotion(emotion: RavdessEmotion): FusionLabel | null {
  return RAVDESS_EMOTION_MAPPING[emotion].fusionLabel;
}

/** The fusion labels that actually receive RAVDESS training support (deduped, in FUSION_LABELS order). */
export function supportedFusionLabels(): FusionLabel[] {
  const supported = new Set<FusionLabel>();
  for (const m of Object.values(RAVDESS_EMOTION_MAPPING)) {
    if (m.fusionLabel) supported.add(m.fusionLabel);
  }
  return FUSION_LABELS.filter((l) => supported.has(l));
}

/** Fusion labels with NO RAVDESS training support (a documented gap, e.g. `fatigued`). */
export function unsupportedFusionLabels(): FusionLabel[] {
  const supported = new Set(supportedFusionLabels());
  return FUSION_LABELS.filter((l) => !supported.has(l));
}

/** Canonical V-A anchor + dominant affect-state head for a fusion label (from the contract). */
export function fusionLabelAffect(label: FusionLabel) {
  return FUSION_LABEL_AFFECT[label];
}

/** A serializable, fully-traceable snapshot of the mapping for the artifact + tests. */
export interface LabelMappingSnapshot {
  readonly target_space: "FUSION_LABELS";
  readonly target_space_source: string;
  readonly governance: string;
  readonly mappings: readonly EmotionMapping[];
  readonly supported_labels: readonly FusionLabel[];
  readonly unsupported_labels: readonly FusionLabel[];
  readonly excluded_emotions: readonly RavdessEmotion[];
}

export function labelMappingSnapshot(): LabelMappingSnapshot {
  const mappings = Object.values(RAVDESS_EMOTION_MAPPING);
  return {
    target_space: "FUSION_LABELS",
    target_space_source: "@hum-ai/affect-model-contracts fusion-labels.ts (FUSION_LABELS + FUSION_LABEL_AFFECT)",
    governance:
      "RAVDESS = acted_speech_emotion, domain_gap_to_hum=far (penalty 0.45). allowed_model_use: pretraining, evaluation, affect_prior. Prohibited: clinical_prior, hum_finetune, personalization, relapse_tracking (ADR-0005).",
    mappings,
    supported_labels: supportedFusionLabels(),
    unsupported_labels: unsupportedFusionLabels(),
    excluded_emotions: mappings.filter((m) => m.fusionLabel === null).map((m) => m.emotion),
  };
}
