import { clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import type { FusionLabel as Label } from "@hum-ai/affect-model-contracts";
import { StubAudioExpert } from "./base";

/**
 * HumAcousticExpert — the hum-native interpretable expert (most on-domain).
 * Tilts the label space directly from spec acoustic dimensions: energy →
 * arousal, clarity/brightness → valence, low energy + low brightness → low mood
 * / fatigue.
 */
export class HumAcousticExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:hum-acoustic";
  readonly labelSpace: readonly Label[] = [
    "calm_regulated",
    "positive_activation",
    "high_arousal_negative",
    "low_mood",
    "tense_anxious",
    "fatigued",
    "neutral_close_to_usual",
  ];
  protected readonly defaultDomainMatch = 0.9;

  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const energy = clamp01((f.rmsEnergy * 0.5 + f.activeFrameRatio * 0.5) / 0.6);
    const brightness = clamp01(f.spectralCentroidHz / 2000);
    const positiveValence = clamp01(f.clarityScore * 0.6 + (1 - f.residualInstabilityScore) * 0.4);
    const instability = clamp01(f.residualInstabilityScore);
    return {
      neutral_close_to_usual: 0.4,
      calm_regulated: (1 - energy) * 0.6 + positiveValence * 0.4,
      positive_activation: energy * positiveValence,
      high_arousal_negative: energy * (1 - positiveValence) * 0.8 + instability * 0.4,
      tense_anxious: instability * 0.6 + energy * (1 - positiveValence) * 0.4,
      low_mood: (1 - energy) * (1 - positiveValence) * 0.8,
      fatigued: (1 - energy) * (1 - brightness) * 0.7,
    };
  }
}

/**
 * HumEmbeddingExpert — placeholder for a self-supervised hum embedding model
 * (Wav2Vec2/WavLM-style). v1 returns the neutral-leaning tilt; a real model
 * would also populate `embedding`. Hum-native, so high domain match.
 */
export class HumEmbeddingExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:hum-embedding";
  readonly labelSpace: readonly Label[] = [
    "calm_regulated",
    "positive_activation",
    "low_mood",
    "tense_anxious",
    "neutral_close_to_usual",
  ];
  protected readonly defaultDomainMatch = 0.85;
  protected tilt(): Partial<Record<Label, number>> {
    return { neutral_close_to_usual: 1 };
  }
}

/**
 * SingingPhonationExpert — bridges sung/sustained-phonation priors
 * (`vocal_biomarker_and_singing_protocol_support`). Near-domain to a hum.
 */
export class SingingPhonationExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:singing-phonation";
  readonly labelSpace: readonly Label[] = ["calm_regulated", "positive_activation", "tense_anxious", "neutral_close_to_usual"];
  protected readonly defaultDomainMatch = 0.7;
  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const stable = clamp01((f.vibratoRegularity ?? 0.5) * 0.5 + (f.smoothnessScore ?? 0.5) * 0.5);
    return { calm_regulated: stable, tense_anxious: 1 - stable, neutral_close_to_usual: 0.5 };
  }
}

/**
 * VocalBurstExpressionExpert — affective-expression bridge (vocal bursts /
 * nonverbal). Moderate domain match; an expression bridge, NOT diagnosis.
 */
export class VocalBurstExpressionExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:vocal-burst";
  readonly labelSpace: readonly Label[] = ["positive_activation", "high_arousal_negative", "calm_regulated", "neutral_close_to_usual"];
  protected readonly defaultDomainMatch = 0.55;
  protected tilt(): Partial<Record<Label, number>> {
    return { neutral_close_to_usual: 1 };
  }
}

/**
 * SpeechEmotionExpert — Wav2Vec2-style SER prior (acted/conversational speech).
 * OFF-DOMAIN for a hum → low default domain match, so fusion down-weights it.
 */
export class SpeechEmotionExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:speech-emotion";
  readonly labelSpace: readonly Label[] = [
    "positive_activation",
    "high_arousal_negative",
    "low_mood",
    "neutral_close_to_usual",
  ];
  protected readonly defaultDomainMatch = 0.4;
  protected tilt(): Partial<Record<Label, number>> {
    return { neutral_close_to_usual: 1 };
  }
}

/**
 * SpeechClinicalExpert — clinical voice-biomarker PRIOR
 * (`clinical_voice_biomarker_review`). Emits risk-leaning labels but is the most
 * off-domain for a hum and the most safety-sensitive → lowest domain match and
 * gated downstream (never diagnosis).
 */
export class SpeechClinicalExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:speech-clinical";
  readonly labelSpace: readonly Label[] = ["low_mood", "fatigued", "tense_anxious", "neutral_close_to_usual"];
  protected readonly defaultDomainMatch = 0.35;
  protected tilt(): Partial<Record<Label, number>> {
    return { neutral_close_to_usual: 1 };
  }
}

/** The full audio-stream expert ensemble, ordered by hum-domain proximity. */
export function defaultAudioExperts(): StubAudioExpert[] {
  return [
    new HumAcousticExpert(),
    new HumEmbeddingExpert(),
    new SingingPhonationExpert(),
    new VocalBurstExpressionExpert(),
    new SpeechEmotionExpert(),
    new SpeechClinicalExpert(),
  ];
}
