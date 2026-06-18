import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * A complete, clean-hum `AcousticFeatures` fixture. Chosen so the quality gate
 * grades it "good" (baseline-eligible) and the domain classifier hears a "hum"
 * (well-voiced, narrow range, smooth, low musicality). Override any field per
 * test. NOT real audio — a hand-built derived-feature object.
 */
export function cleanHumFeatures(over: Partial<AcousticFeatures> = {}): AcousticFeatures {
  const base: AcousticFeatures = {
    featureMode: "hum-state-v2",
    sampleRate: 48000,

    // energy
    durationSec: 12,
    inputRms: 0.09,
    meanRms: 0.09,
    medianRms: 0.09,
    rmsEnergy: 0.1,
    peakAmplitude: 0.55,
    activeFrameRatio: 0.72,
    quietFrameRatio: 0.18,
    clippedFrameRatio: 0,
    silenceRatio: 0.1,
    noiseFloorRms: 0.006,
    signalToNoiseProxy: 8,
    zeroCrossingRate: 0.04,

    // pitch (voiced, narrow, stable)
    pitchMeanHz: 180,
    pitchVariance: 4,
    pitchRangeSemitones: 2.5,
    pitchStability: 0.85,
    jitter: 0.01,
    pitchDrift: 0.05,
    pitchCoverage: 0.7,
    longestStableSegmentSec: 6,

    // spectral
    spectralCentroidHz: 900,
    spectralBandwidthHz: 1200,
    spectralRolloffHz: 2200,
    spectralFlatness: 0.18,
    spectralFlux: 0.08,

    // continuity
    breakCount: 1,
    pauseCount: 1,
    avgPauseLengthSec: 0.2,
    microBreakRatio: 0.05,
    onsetDelaySec: 0.2,
    voicingContinuityCoverage: 0.85,

    // expression (clear, controlled, low instability, modest musicality)
    clarityScore: 0.78,
    breathinessProxy: 0.15,
    shimmerProxy: 0.05,
    amplitudeStability: 0.8,
    smoothnessScore: 0.75,
    musicalityScore: 0.2,
    controlledExpressionScore: 0.7,
    residualInstabilityScore: 0.15,
    residualPitchInstability: 0.1,
    residualAmplitudeInstability: 0.1,
    vibratoRegularity: 0.6,
    attackConsistency: 0.6,

    // flags
    isSilent: false,
    isTooFaint: false,
  };
  return { ...base, ...over };
}

/** A near-silent capture: the quality gate rejects it and the read abstains. */
export function silentFeatures(over: Partial<AcousticFeatures> = {}): AcousticFeatures {
  return cleanHumFeatures({
    meanRms: 0.002,
    medianRms: 0.002,
    rmsEnergy: 0.002,
    inputRms: 0.002,
    peakAmplitude: 0.01,
    activeFrameRatio: 0.05,
    silenceRatio: 0.95,
    quietFrameRatio: 0.95,
    signalToNoiseProxy: 0.5,
    pitchCoverage: 0,
    isSilent: true,
    isTooFaint: true,
    ...over,
  });
}

/**
 * Deterministic per-feature sample history. `recentShift` is added to the most
 * recent `recentCount` samples so the rolling center can be made to diverge from
 * the anchored long-term center (for the dual-baseline divergence test).
 */
export function sampleHistory(opts: {
  readonly feature: string;
  readonly total: number;
  readonly base: number;
  readonly recentCount?: number;
  readonly recentShift?: number;
}): Record<string, readonly number[]> {
  const { feature, total, base } = opts;
  const recentCount = opts.recentCount ?? 0;
  const recentShift = opts.recentShift ?? 0;
  const values: number[] = [];
  for (let i = 0; i < total; i++) {
    // small deterministic spread so robust spread (MAD) is non-degenerate
    const spread = ((i % 5) - 2) * 0.002;
    const shift = i >= total - recentCount ? recentShift : 0;
    values.push(base + spread + shift);
  }
  return { [feature]: values };
}
