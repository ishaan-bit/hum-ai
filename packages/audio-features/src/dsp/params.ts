/**
 * DSP parameters for the hum feature extractor.
 *
 * The energy/loudness constants here are transcribed from the SAME legacy spec
 * (`hum_spec` §7) that `@hum-ai/quality-gate` `HUM_THRESHOLDS` is built from.
 * They are duplicated here ON PURPOSE: `audio-features` must not depend on
 * `quality-gate` (that package depends on this one for the `CaptureMetrics`
 * type — importing back would create a cycle). A cross-package test
 * (`quality-gate/test/threshold-sync.test.ts`) asserts the overlapping values
 * stay identical, so they cannot silently drift.
 *
 * Everything else (frame sizes, voicing/pitch search range, clip detection) is a
 * DSP implementation choice, documented inline. None of these are accuracy
 * claims — they are deterministic signal-processing constants.
 */
export const DSP_PARAMS = {
  /** Schema/version tag stamped onto every feature object. */
  featureMode: "hum-state-v2",

  // --- framing (energy / voicing analysis) ---
  /** RMS analysis window, ms (legacy `rmsWindowMs`). 80 ms ≈ 5–6 cycles at 70 Hz. */
  rmsWindowMs: 80,
  /** Hop between RMS frames, ms. Non-overlapping (= window) keeps frame counts honest. */
  rmsHopMs: 80,
  /** Window used to estimate the background/noise floor, ms (legacy `noiseFloorWindowMs`). */
  noiseFloorWindowMs: 500,

  // --- per-sample / per-frame energy thresholds (legacy values) ---
  /** |x| below this counts as a silent sample (legacy `silenceThreshold`). */
  silenceThreshold: 0.02,
  /** Overall RMS below this ⇒ basically silent (legacy `basicallySilentRms`). */
  basicallySilentRms: 0.0035,
  /** Peak below this ⇒ basically silent (legacy `basicallySilentPeak`). */
  basicallySilentPeak: 0.012,
  /** Mean RMS at/below this is "near silence" (legacy `nearSilenceMeanRms`). */
  nearSilenceMeanRms: 0.006,
  /** Decision RMS below this is faint / soft (legacy `softRms`). */
  softRms: 0.014,
  /** Decision RMS at/above this is a strong capture (legacy `strongRms`). */
  strongRms: 0.05,

  /**
   * Per-frame activity floor. A frame with RMS below this is "quiet"; at/above
   * it is "active". Set just below `softRms` so a soft-but-clean hum still reads
   * as mostly-active (so it reaches the gate's soft_usable path instead of being
   * rejected for "too little active audio"). Quiet and active share this floor.
   */
  quietFrameRms: 0.012,
  activeFrameRms: 0.012,

  // --- clipping ---
  /** |x| at/above this is treated as a clipped sample. */
  clipSampleLevel: 0.98,
  /** A frame is "clipped" when this fraction of its samples are clipped... */
  clipFrameSampleFraction: 0.01,
  /** ...or at least this many samples are clipped (whichever is larger). */
  clipFrameMinSamples: 2,

  // --- pitch (autocorrelation) ---
  /** Lowest F0 searched, Hz. A closed-mouth hum/voice fundamental floor. */
  minPitchHz: 70,
  /** Highest F0 searched, Hz. */
  maxPitchHz: 500,
  /** Normalized-autocorrelation peak at/above this marks a frame as voiced. */
  voicingThreshold: 0.5,
  /**
   * Strength required for a peak pinned at the HIGHEST-frequency lag (minLag).
   * A tone whose true F0 is below `minPitchHz` cannot reach its real period in
   * the search band, so the global max lands on the descending shoulder at
   * minLag and would otherwise be reported as a confident, wrong ~`maxPitchHz`
   * F0. A genuine tone exactly at `maxPitchHz` yields a near-unity peak there, so
   * requiring high strength at the edge rejects the out-of-band alias without
   * losing real high-F0 detections.
   */
  edgePitchMinStrength: 0.9,
  /** Minimum run of voiced frames counted as continuous voicing. */
  minVoicedRunFrames: 3,
  /** Relative frame-to-frame F0 change below this is "stable" (for stable segments). */
  stableF0RelStep: 0.03,

  // --- continuity / pauses ---
  /** An internal unvoiced gap at/above this length counts as a pause (s). */
  pauseMinSec: 0.16, // 2 frames at 80 ms

  // --- spectral analysis ---
  /** Target spectral analysis window, ms (zero-padded up to a power of two). */
  spectralWindowMs: 40,
  /** Spectral hop, ms (≈ 50% overlap). */
  spectralHopMs: 20,
  /** Rolloff energy fraction (legacy/standard 85%). */
  rolloffFraction: 0.85,

  // --- SNR proxy ---
  /** Cap on the SNR proxy so a near-zero noise floor can't make it explode. */
  maxSnrProxy: 100,
} as const;

/** Small epsilon to keep divisions and logs finite. */
export const EPS = 1e-9;
