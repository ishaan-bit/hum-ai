import { clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import type { FusionLabel as Label } from "@hum-ai/affect-model-contracts";
import { StubAudioExpert } from "./base";

/** Finite-guarded read of a (possibly null/undefined) feature → `fallback` when not computable. */
const num = (v: number | null | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

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
 * HumEmbeddingExpert — the deterministic stand-in for a self-supervised hum
 * embedding model (Wav2Vec2/WavLM-style). Hum-native (high domain match), it reads
 * the hum holistically: overall regulation (steadiness × clarity) vs activation
 * (energy), splitting low-energy/low-clarity toward low mood and instability toward
 * tension. A real embedding model drops in behind the same contract; until then this
 * is an honest heuristic (capped low-confidence + untrained), NOT neutral noise.
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
  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const energy = clamp01((num(f.rmsEnergy, 0.02) * 0.5 + num(f.activeFrameRatio, 0.5) * 0.5) / 0.6);
    const positiveValence = clamp01(num(f.clarityScore, 0.5) * 0.6 + (1 - num(f.residualInstabilityScore, 0.3)) * 0.4);
    const stability = clamp01(num(f.amplitudeStability, 0.5) * 0.5 + num(f.pitchStability, 0.5) * 0.5);
    const instability = clamp01(num(f.residualInstabilityScore, 0.3));
    return {
      neutral_close_to_usual: 0.35,
      calm_regulated: (1 - energy) * 0.4 + positiveValence * 0.4 + stability * 0.2,
      positive_activation: energy * positiveValence,
      low_mood: (1 - energy) * (1 - positiveValence) * 0.8,
      tense_anxious: instability * 0.6 + energy * (1 - positiveValence) * 0.4,
    };
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
 * nonverbal). An expression bridge, NOT diagnosis (moderate domain match). It reads
 * the EXPRESSIVE arousal of the hum (energy + spectral flux) and splits it by valence
 * sign: an energetic, clear hum reads as positive activation; an energetic, rough one
 * as high-arousal-negative; a quiet one as calm. Deterministic heuristic, untrained.
 */
export class VocalBurstExpressionExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:vocal-burst";
  readonly labelSpace: readonly Label[] = ["positive_activation", "high_arousal_negative", "calm_regulated", "neutral_close_to_usual"];
  protected readonly defaultDomainMatch = 0.55;
  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const energy = clamp01((num(f.rmsEnergy, 0.02) * 0.5 + num(f.activeFrameRatio, 0.5) * 0.5) / 0.6);
    const flux = clamp01(num(f.spectralFlux, 0.08) / 0.3);
    const arousal = clamp01(energy * 0.6 + flux * 0.4);
    const positiveValence = clamp01(num(f.clarityScore, 0.5) * 0.6 + (1 - num(f.residualInstabilityScore, 0.3)) * 0.4);
    return {
      neutral_close_to_usual: 0.4,
      calm_regulated: (1 - arousal) * 0.7 + positiveValence * 0.3,
      positive_activation: arousal * positiveValence,
      high_arousal_negative: arousal * (1 - positiveValence),
    };
  }
}

/**
 * SpeechEmotionExpert — Wav2Vec2-style SER prior (acted/conversational speech).
 * OFF-DOMAIN for a hum → low default domain match, so fusion down-weights it. Reads
 * prosody proxies (pitch movement + energy → arousal; clarity → valence): animated +
 * clear ⇒ positive activation; animated + rough ⇒ high-arousal-negative; flat + quiet
 * ⇒ low mood. A drop-in slot for a trained acted-speech prior; until then a heuristic.
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
  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const energy = clamp01((num(f.rmsEnergy, 0.02) * 0.5 + num(f.activeFrameRatio, 0.5) * 0.5) / 0.6);
    const pitchMove = clamp01(num(f.pitchRangeSemitones, 1.5) / 8);
    const arousal = clamp01(energy * 0.5 + pitchMove * 0.5);
    const positiveValence = clamp01(num(f.clarityScore, 0.5) * 0.6 + (1 - num(f.residualInstabilityScore, 0.3)) * 0.4);
    return {
      neutral_close_to_usual: 0.4,
      positive_activation: arousal * positiveValence,
      high_arousal_negative: arousal * (1 - positiveValence),
      low_mood: (1 - arousal) * (1 - positiveValence) * 0.8,
    };
  }
}

/**
 * SpeechClinicalExpert — clinical voice-biomarker PRIOR
 * (`clinical_voice_biomarker_review`). Emits risk-leaning labels but is the most
 * off-domain for a hum and the most safety-sensitive → lowest domain match, capped
 * low-confidence, and consent-gated downstream (NEVER a diagnosis). Reads the
 * literature's depression/fatigue proxies (low energy + monotone pitch + low clarity ⇒
 * low mood; low energy + breathiness ⇒ fatigue; jitter/instability ⇒ tension), heavily
 * penalized by its domain gap. A heuristic prior, not a trained clinical model.
 */
export class SpeechClinicalExpert extends StubAudioExpert {
  readonly expertId = "expert-ser:speech-clinical";
  readonly labelSpace: readonly Label[] = ["low_mood", "fatigued", "tense_anxious", "neutral_close_to_usual"];
  protected readonly defaultDomainMatch = 0.35;
  protected tilt(f: AcousticFeatures): Partial<Record<Label, number>> {
    const energy = clamp01((num(f.rmsEnergy, 0.02) * 0.5 + num(f.activeFrameRatio, 0.5) * 0.5) / 0.6);
    const monotone = 1 - clamp01(num(f.pitchRangeSemitones, 2) / 6);
    const breathy = clamp01(num(f.breathinessProxy, 0.2));
    const lowClarity = 1 - clamp01(num(f.clarityScore, 0.5));
    const instability = clamp01(num(f.residualInstabilityScore, 0.3));
    const jitterN = clamp01(num(f.jitter, 0.01) / 0.04);
    return {
      neutral_close_to_usual: 0.45,
      low_mood: (1 - energy) * 0.4 + monotone * 0.3 + lowClarity * 0.3,
      fatigued: (1 - energy) * 0.5 + breathy * 0.3 + monotone * 0.2,
      tense_anxious: instability * 0.5 + jitterN * 0.5,
    };
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
