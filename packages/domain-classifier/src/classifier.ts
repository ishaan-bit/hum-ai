import { clamp01, normalizeDistribution, DOMAIN_CLASSES, type DomainClass, type UnitInterval } from "@hum-ai/shared-types";
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

// L1-normalize the domain scores; with no positive signal, fall back to "noisy_unknown".
function softmaxNormalize(scores: Record<DomainClass, number>): Record<DomainClass, number> {
  return normalizeDistribution(scores, DOMAIN_CLASSES, (c) => (c === "noisy_unknown" ? 1 : 0));
}

/**
 * A transparent, rule-based domain classifier. It is intentionally interpretable,
 * NOT a trained model — its job is a hum-vs-not-hum domain GUARD, not fine-grained
 * audio-event recognition. The trained classifier slots in behind the same
 * `DomainClassifier` interface later (research/model-cards/domain-classifier-v1).
 *
 * v2 (this pass) feeds on REAL extractor output. The hard-threshold booleans of
 * v1 are replaced with GRADED evidence terms (smoother, less brittle on continuous
 * features), and confidence now folds in the top-two margin so an ambiguous capture
 * honestly reports lower confidence. Heuristics still derive from `hum_spec` feature
 * meanings: a hum is a sustained, well-voiced, narrow-range, smooth, low-melodic
 * vocalization.
 *
 * NOTE on a known limitation: distinguishing speech from singing heuristically is
 * genuinely hard (both are voiced, both can be wide-range). The classifier reliably
 * separates hum from not-hum; within not-hum, speech and singing may be confused.
 * That is acceptable — both are off-domain and down-weighted by `HumDomainAdapter`.
 */
export class HeuristicDomainClassifier implements DomainClassifier {
  classify(f: AcousticFeatures): DomainClassification {
    const scores = {} as Record<DomainClass, number>;
    for (const c of DOMAIN_CLASSES) scores[c] = 0;

    // Silence / invalid short-circuits (same constants as the quality gate).
    if (f.isSilent || f.meanRms <= 0.006) {
      return { predicted: "silence", probabilities: softmaxNormalize({ ...scores, silence: 1 }), confidence: 0.9 };
    }
    if (f.durationSec < 1 || !Number.isFinite(f.rmsEnergy)) {
      return { predicted: "invalid", probabilities: softmaxNormalize({ ...scores, invalid: 1 }), confidence: 0.8 };
    }

    // --- graded evidence terms in [0,1] ---
    const pc = f.pitchCoverage ?? 0;
    const voicedness = clamp01((pc - 0.35) / (0.85 - 0.35)); // 0 at .35, 1 at .85
    const range = f.pitchRangeSemitones;
    const narrowness = range === null ? 0 : clamp01((6 - range) / 6); // 1 at 0 st, 0 at >=6 st
    const smoothness = clamp01(f.smoothnessScore ?? 0);
    const musicality = clamp01(f.musicalityScore);
    const continuity = clamp01(f.voicingContinuityCoverage);
    const sustainment = voicedness * clamp01((f.longestStableSegmentSec ?? 0) / 3); // gated by voicing
    const flux = clamp01(f.spectralFlux);
    const brightness = clamp01(f.spectralBandwidthHz / 4000);
    const breakiness = clamp01(f.breakCount / 8) * 0.6 + clamp01(f.microBreakRatio * 3) * 0.4;
    const lowNoise = f.signalToNoiseProxy > 3;

    // hum: well-voiced, narrow, smooth, sustained, low melodic movement, continuous.
    scores.hum =
      voicedness * 1.0 +
      narrowness * 1.0 +
      smoothness * 0.8 +
      sustainment * 0.6 +
      (1 - musicality) * 0.5 +
      continuity * 0.7;

    // singing: well-voiced but more melodic (wider range, higher musicality).
    scores.singing = voicedness * 0.8 + musicality * 1.4 + (1 - narrowness) * 0.8;

    // speech: brighter, higher zero-crossing/flux, more breaks/pauses.
    scores.speech =
      clamp01(f.zeroCrossingRate * 4) * 0.9 + flux * 0.6 + breakiness * 0.7 + (1 - voicedness) * 0.3;

    // music: broadband, bright, high flux, weak voicing.
    scores.music = flux * 1.0 + brightness * 0.8 + (1 - voicedness) * 0.6;

    // vocal_burst: short, energetic, low sustained voicing.
    scores.vocal_burst =
      (f.durationSec < 3 ? 1 : 0) * 1.2 + (1 - continuity) * 0.6 + clamp01(f.peakAmplitude) * 0.4;

    // noisy_unknown: poor-SNR catch-all.
    scores.noisy_unknown = (lowNoise ? 0.2 : 1.2) + clamp01(f.breathinessProxy) * 0.5;

    const probabilities = softmaxNormalize(scores);

    let predicted: DomainClass = "noisy_unknown";
    let p1 = -1;
    let p2 = 0;
    for (const c of DOMAIN_CLASSES) {
      const p = probabilities[c];
      if (p > p1) {
        p2 = p1;
        p1 = p;
        predicted = c;
      } else if (p > p2) {
        p2 = p;
      }
    }

    // Confidence = top probability, sharpened by the top-two margin and tempered
    // by SNR. A dominant, well-separated class is trusted; a near-tie is not.
    const margin = p1 > 0 ? clamp01((p1 - p2) / p1) : 0;
    const confidence = clamp01(p1 * (0.55 + 0.45 * margin) * (lowNoise ? 1 : 0.7));
    return { predicted, probabilities, confidence };
  }
}
