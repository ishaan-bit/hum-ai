import { clamp01, DOMAIN_CLASSES, type DomainClass, type UnitInterval } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * Runtime domain classification of a single capture. Because "a hum is not
 * speech, not a full music track, and not necessarily singing" (project brief),
 * Hum must know what it is actually listening to before trusting any affect
 * head. See ADR-0002.
 */
export interface DomainClassification {
  readonly predicted: DomainClass;
  readonly probabilities: Readonly<Record<DomainClass, number>>;
  readonly confidence: UnitInterval;
}

export interface DomainClassifier {
  classify(features: AcousticFeatures): DomainClassification;
}

function softmaxNormalize(scores: Record<DomainClass, number>): Record<DomainClass, number> {
  let total = 0;
  for (const c of DOMAIN_CLASSES) total += Math.max(scores[c], 0);
  const out = {} as Record<DomainClass, number>;
  if (total <= 0) {
    for (const c of DOMAIN_CLASSES) out[c] = c === "noisy_unknown" ? 1 : 0;
    return out;
  }
  for (const c of DOMAIN_CLASSES) out[c] = Math.max(scores[c], 0) / total;
  return out;
}

/**
 * A transparent, rule-based domain classifier (v1 stub). It is intentionally
 * interpretable, not a trained model — the trained classifier slots in behind
 * the same `DomainClassifier` interface later. Heuristics are derived from
 * `hum_spec` feature meanings: a hum is a sustained, well-voiced, narrow-range,
 * smooth, low-melodic-movement vocalization.
 */
export class HeuristicDomainClassifier implements DomainClassifier {
  classify(f: AcousticFeatures): DomainClassification {
    const scores = {} as Record<DomainClass, number>;
    for (const c of DOMAIN_CLASSES) scores[c] = 0;

    // Silence / invalid short-circuits.
    if (f.isSilent || f.meanRms <= 0.006) {
      return { predicted: "silence", probabilities: softmaxNormalize({ ...scores, silence: 1 }), confidence: 0.9 };
    }
    if (f.durationSec < 1 || Number.isNaN(f.rmsEnergy)) {
      return { predicted: "invalid", probabilities: softmaxNormalize({ ...scores, invalid: 1 }), confidence: 0.8 };
    }

    const pc = f.pitchCoverage ?? 0;
    const voiced = pc > 0.35;
    const narrowRange = (f.pitchRangeSemitones ?? 99) < 5;
    const smooth = (f.smoothnessScore ?? 0) > 0.5;
    const lowNoise = f.signalToNoiseProxy > 3;

    // hum: well-voiced, narrow pitch range, smooth, low melodic movement, modest musicality.
    scores.hum =
      (voiced ? 1 : 0) * 1.0 +
      (narrowRange ? 1 : 0) * 1.0 +
      (smooth ? 1 : 0) * 0.8 +
      (1 - clamp01(f.musicalityScore)) * 0.6 +
      f.voicingContinuityCoverage * 0.8;

    // singing: well-voiced but wider pitch range + high musicality.
    scores.singing =
      (voiced ? 1 : 0) * 0.8 + clamp01(f.musicalityScore) * 1.4 + (!narrowRange ? 1 : 0) * 0.8;

    // speech: moderate voicing, higher zero-crossing/flux, more interruptions.
    scores.speech =
      clamp01(f.zeroCrossingRate * 4) * 0.9 + clamp01(f.spectralFlux) * 0.6 + clamp01(f.pauseCount / 4) * 0.6 +
      (voiced ? 0.3 : 0.6);

    // music: broadband, bright, high flux, low voicing.
    scores.music =
      clamp01(f.spectralFlux) * 1.0 + clamp01(f.spectralBandwidthHz / 4000) * 0.8 + (voiced ? 0 : 0.6);

    // vocal_burst: short, energetic, low sustained voicing/continuity.
    scores.vocal_burst =
      (f.durationSec < 3 ? 1 : 0) * 1.2 + (1 - f.voicingContinuityCoverage) * 0.6 + clamp01(f.peakAmplitude) * 0.4;

    // noisy_unknown: poor SNR catch-all.
    scores.noisy_unknown = (lowNoise ? 0.2 : 1.2) + clamp01(f.breathinessProxy) * 0.5;

    const probabilities = softmaxNormalize(scores);
    let predicted: DomainClass = "noisy_unknown";
    let best = -1;
    for (const c of DOMAIN_CLASSES) {
      if (probabilities[c] > best) {
        best = probabilities[c];
        predicted = c;
      }
    }
    // Confidence = top probability tempered by SNR.
    const confidence = clamp01(best * (lowNoise ? 1 : 0.7));
    return { predicted, probabilities, confidence };
  }
}
