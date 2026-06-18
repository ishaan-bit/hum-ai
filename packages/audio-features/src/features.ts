/**
 * Acoustic feature schema, distilled from `hum_spec` §6 (Feature Parameter
 * Dictionary). This is the DERIVED representation — it is the only thing that
 * may be stored/synced. Raw audio is never represented here (no buffers, no
 * blobs); see `@hum-ai/shared-types` privacy guard.
 *
 * The full legacy dictionary has ~80 fields; this captures the load-bearing
 * subset the quality gate, domain classifier, baseline, and experts consume.
 * `null` indicates "not computable for this capture" (e.g. no voiced frames),
 * exactly as the spec marks pitch/melodic fields nullable.
 */

/** Energy / loudness group. */
export interface EnergyFeatures {
  readonly durationSec: number;
  readonly inputRms: number;
  readonly meanRms: number;
  readonly medianRms: number;
  readonly rmsEnergy: number;
  readonly peakAmplitude: number;
  readonly activeFrameRatio: number;
  readonly quietFrameRatio: number;
  readonly clippedFrameRatio: number;
  readonly silenceRatio: number;
  readonly noiseFloorRms: number;
  readonly signalToNoiseProxy: number;
  readonly zeroCrossingRate: number;
}

/** Pitch / melodic group (nullable when unvoiced). */
export interface PitchFeatures {
  readonly pitchMeanHz: number | null;
  readonly pitchVariance: number | null;
  readonly pitchRangeSemitones: number | null;
  readonly pitchStability: number | null;
  readonly jitter: number | null;
  readonly pitchDrift: number | null;
  readonly pitchCoverage: number | null;
  readonly longestStableSegmentSec: number | null;
}

/** Spectral group. */
export interface SpectralFeatures {
  readonly spectralCentroidHz: number;
  readonly spectralBandwidthHz: number;
  readonly spectralRolloffHz: number;
  readonly spectralFlatness: number;
  readonly spectralFlux: number;
}

/** Continuity / phrasing group. */
export interface ContinuityFeatures {
  readonly breakCount: number;
  readonly pauseCount: number;
  readonly avgPauseLengthSec: number;
  readonly microBreakRatio: number;
  readonly onsetDelaySec: number | null;
  readonly voicingContinuityCoverage: number;
}

/** Voice-quality / expression / stability group. */
export interface ExpressionFeatures {
  readonly clarityScore: number;
  readonly breathinessProxy: number;
  readonly shimmerProxy: number;
  readonly amplitudeStability: number;
  readonly smoothnessScore: number | null;
  readonly musicalityScore: number;
  readonly controlledExpressionScore: number;
  readonly residualInstabilityScore: number;
  readonly residualPitchInstability: number;
  readonly residualAmplitudeInstability: number;
  readonly vibratoRegularity: number | null;
  readonly attackConsistency: number | null;
}

/** Boolean capture flags. */
export interface CaptureFlags {
  readonly isSilent: boolean;
  readonly isTooFaint: boolean;
}

/** The complete derived feature object for one hum capture. */
export interface AcousticFeatures
  extends EnergyFeatures,
    PitchFeatures,
    SpectralFeatures,
    ContinuityFeatures,
    ExpressionFeatures,
    CaptureFlags {
  /** Mode tag for schema/versioning, e.g. "hum-state-v2" from the spec. */
  readonly featureMode: string;
  readonly sampleRate: number;
}

/**
 * The minimal metric subset the quality gate reads. Kept as its own type so the
 * gate does not depend on the full feature object.
 */
export interface CaptureMetrics {
  readonly durationSec: number;
  readonly isSilent: boolean;
  readonly meanRms: number;
  readonly decisionRms: number;
  readonly clippedFrameRatio: number;
  readonly silenceRatio: number;
  readonly quietFrameRatio: number;
  readonly activeFrameRatio: number;
  readonly pitchCoverage: number | null;
  readonly signalToNoiseProxy: number;
  readonly peakAmplitude: number;
  /** current RMS / rolling-baseline RMS, or null pre-baseline. */
  readonly baselineRmsRatio: number | null;
}

export function metricsFromFeatures(f: AcousticFeatures, baselineRmsRatio: number | null = null): CaptureMetrics {
  return {
    durationSec: f.durationSec,
    isSilent: f.isSilent,
    meanRms: f.meanRms,
    decisionRms: f.rmsEnergy,
    clippedFrameRatio: f.clippedFrameRatio,
    silenceRatio: f.silenceRatio,
    quietFrameRatio: f.quietFrameRatio,
    activeFrameRatio: f.activeFrameRatio,
    pitchCoverage: f.pitchCoverage,
    signalToNoiseProxy: f.signalToNoiseProxy,
    peakAmplitude: f.peakAmplitude,
    baselineRmsRatio,
  };
}
