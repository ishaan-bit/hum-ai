import { clamp01, normalizeDistribution, type Modality } from "@hum-ai/shared-types";
import {
  missingExpertOutput,
  FUSION_LABELS,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
  type FusionLabel,
} from "@hum-ai/affect-model-contracts";

/**
 * Text Emotion Recognition expert (DistilRoBERTa-style), per the TriSense
 * spine. For Hum, text is an OPTIONAL companion: a short reflective note a user
 * may type alongside a hum (silent-environment fallback in TriSense terms).
 * When no text is present this returns a missing-modality output. The real
 * DistilRoBERTa model slots in behind `AffectExpert`.
 *
 * The text input shape is `{ text: string }`. The v1 stub does a tiny lexical
 * tilt so it is demonstrably input-driven, but stays low-confidence.
 */
export interface TextInput {
  readonly text: string;
}

const POSITIVE = ["calm", "good", "great", "happy", "relaxed", "fine", "ok", "better"];
const NEGATIVE_LOW = ["tired", "exhausted", "sad", "down", "low", "drained", "flat"];
const NEGATIVE_HIGH = ["anxious", "stressed", "worried", "tense", "angry", "panic", "overwhelmed"];

export class TextEmotionExpert implements AffectExpert {
  readonly expertId = "expert-ter:distilroberta-stub";
  readonly modality: Modality = "text";
  readonly labelSpace = FUSION_LABELS;

  async predict(features: unknown, meta: ExpertInputMeta): Promise<ExpertOutput> {
    const input = features as TextInput | null;
    const text = input?.text?.trim().toLowerCase() ?? "";
    if (text.length === 0) return missingExpertOutput(this.expertId, this.modality);

    const tilt: Partial<Record<FusionLabel, number>> = { neutral_close_to_usual: 0.4 };
    const words = text.split(/\W+/).filter(Boolean);
    for (const w of words) {
      if (POSITIVE.includes(w)) tilt.calm_regulated = (tilt.calm_regulated ?? 0) + 1;
      if (NEGATIVE_LOW.includes(w)) tilt.low_mood = (tilt.low_mood ?? 0) + 1;
      if (NEGATIVE_HIGH.includes(w)) tilt.tense_anxious = (tilt.tense_anxious ?? 0) + 1;
    }

    const probabilities = normalizeDistribution(tilt, FUSION_LABELS);

    return {
      expertId: this.expertId,
      modality: this.modality,
      available: true,
      probabilities,
      selfConfidence: clamp01(Math.min(0.5, 0.2 + words.length * 0.02)),
      domainMatch: 1, // text is not subject to the hum audio-domain gap
      oodScore: 0.3,
      notes: "v1-stub (lexical tilt over a short reflective note)",
    };
  }
}
