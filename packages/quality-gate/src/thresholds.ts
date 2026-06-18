/**
 * Quality thresholds & constants, transcribed from `hum_spec` §7 (Thresholds
 * and Constants) and §8 (Quality Gate). Keeping them in one named object makes
 * them auditable and testable rather than scattered magic numbers.
 */
export const HUM_THRESHOLDS = {
  featureMode: "hum-state-v2",
  targetDurationSec: 12,
  minDurationSec: 8,
  rmsWindowMs: 80,
  noiseFloorWindowMs: 500,

  silenceThreshold: 0.02,
  basicallySilentRms: 0.0035,
  basicallySilentPeak: 0.012,
  nearSilenceMeanRms: 0.006,

  softRms: 0.014,
  strongRms: 0.05,

  minActiveFrameRatio: 0.22,
  borderlineActiveFrameRatio: 0.34,
  maxQuietFrameRatio: 0.78,
  maxClippedFrameRatio: 0.08,
  maxNoiseFloorRms: 0.035,
  minPitchCoverage: 0.35,
  goodPitchCoverage: 0.5,
  maxSilenceRatio: 0.72,

  softBaselineRatio: 0.7,
  strongBaselineRatio: 1.5,

  minSnrProxy: 2.5,
  goodSnrProxy: 5,

  baselineActivationCount: 5,
  rollingBaselineSize: 24,
} as const;

/**
 * Capture-quality → suggested confidence cap [0,1]. Poor capture MUST cap
 * confidence (project brief). The fusion confidence model takes the minimum of
 * this and the personalization-stage cap.
 */
export const CAPTURE_QUALITY_CONFIDENCE_CAP = {
  good: 0.95,
  usable: 0.9,
  soft_usable: 0.7,
  poor: 0.5,
  rejected: 0.3,
} as const;
