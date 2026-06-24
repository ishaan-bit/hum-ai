import type { AcousticFeatures } from "@hum-ai/audio-features";
import { BIG_FIVE_KEYS, type BigFiveKey } from "@hum-ai/personality-signature";

/**
 * SIM-LAB REFERENCE & PARAMETER SPECS — the substrate for one-at-a-time
 * sensitivity analysis of the hybrid read path (rule-based acoustic backbone +
 * ML axis priors + ML fusion) and the OCEAN signature.
 *
 * The clean path for sensitivity analysis is NOT synth-PCM → `computeFeatures`
 * (one synth knob moves many derived fields at once), but constructing
 * `AcousticFeatures` directly and varying ONE field while the rest are held at a
 * neutral, gate-"good", domain-"hum" reference. Each function in the read path is
 * pure + deterministic, so this isolates the marginal effect of every captured
 * parameter.
 *
 * Grounding. The reference values + sweep ranges are taken from the `hum_spec`
 * feature dictionary (12 s sustained-phonation protocol; see docs/source/INDEX.md
 * `hum_spec`) and the population-absolute normalization windows the read code
 * itself uses (`axis-read.ts`, `personality-signature/index.ts`). The per-feature
 * `kind` encodes the research-grounded ROLE each parameter is allowed to play:
 *
 *  - `prosody`      mood-variable contour the person controls hum-to-hum (pitch height,
 *                   melodic movement). The acoustically-legible carrier of AROUSAL and the
 *                   weak-but-real carrier of VALENCE (Russell V-A circumplex; `ser_mental_health_review`).
 *  - `energy`       loudness / activity — the single strongest, most reliable AROUSAL cue
 *                   (`ser_mental_health_review`, `clinical_voice_biomarker_review`).
 *  - `voice_quality` steadiness / smoothness / control / micro-perturbation — person-ish
 *                   timbre. Carries the "settled/in-control" half of valence and the
 *                   conscientiousness / emotional-steadiness OCEAN cues (`voice-big-five.md`).
 *  - `fidelity`     mic + room artefacts (clarity, SNR, flatness, breathiness, noise floor).
 *                   MUST NOT drive the affect read — folding it in pinned every user to one
 *                   zone per device (valence-fidelity-decoupling). Belongs to signal strength
 *                   + confidence only.
 *  - `continuity`   phrasing / pauses — gate + signal-strength inputs, not affect.
 *  - `structural`   duration / sample rate / mode — bookkeeping, never affect.
 *
 * These `kind` tags let the harness ASSERT the research-grounded contract (e.g.
 * "no `fidelity` feature may move valence"), which is the calibration QA the read
 * path previously lacked.
 */

/** The role a captured parameter is research-permitted to play in the read. */
export type FeatureKind = "prosody" | "energy" | "voice_quality" | "fidelity" | "continuity" | "structural";

export interface FeatureSpec {
  readonly feature: keyof AcousticFeatures;
  readonly kind: FeatureKind;
  /** Group label for the report (mirrors the `hum_spec` dictionary groups). */
  readonly group: string;
  /** Realistic sweep range for the 12 s hum protocol (min, max). */
  readonly min: number;
  readonly max: number;
  /** One-line research/normalization note (where the range / role comes from). */
  readonly note: string;
}

/**
 * The canonical neutral reference hum: a clean, audible, well-voiced, moderately
 * steady 12 s sustained tone that the quality gate grades "good" and the domain
 * classifier hears as a "hum". Values sit near the middle of the read code's
 * normalization windows so a one-at-a-time sweep can move the output in BOTH
 * directions and surface saturation symmetrically.
 */
export const REFERENCE_HUM: AcousticFeatures = {
  featureMode: "hum-state-v2",
  sampleRate: 48000,

  // energy / loudness (hum_spec §6 energy group)
  durationSec: 12,
  inputRms: 0.06,
  meanRms: 0.06,
  medianRms: 0.06,
  rmsEnergy: 0.06,
  peakAmplitude: 0.45,
  activeFrameRatio: 0.7,
  quietFrameRatio: 0.2,
  clippedFrameRatio: 0,
  silenceRatio: 0.12,
  noiseFloorRms: 0.006,
  signalToNoiseProxy: 8,
  zeroCrossingRate: 0.05,

  // pitch / melodic (nullable when unvoiced; reference is voiced)
  pitchMeanHz: 175,
  pitchVariance: 6,
  pitchRangeSemitones: 2.5,
  pitchStability: 0.8,
  jitter: 0.012,
  pitchDrift: 0.06,
  pitchCoverage: 0.7,
  longestStableSegmentSec: 5,

  // spectral
  spectralCentroidHz: 1000,
  spectralBandwidthHz: 1200,
  spectralRolloffHz: 2200,
  spectralFlatness: 0.2,
  spectralFlux: 0.1,

  // continuity / phrasing
  breakCount: 1,
  pauseCount: 1,
  avgPauseLengthSec: 0.2,
  microBreakRatio: 0.05,
  onsetDelaySec: 0.2,
  voicingContinuityCoverage: 0.82,

  // voice-quality / expression / stability
  clarityScore: 0.75,
  breathinessProxy: 0.2,
  shimmerProxy: 0.12,
  amplitudeStability: 0.78,
  smoothnessScore: 0.7,
  musicalityScore: 0.3,
  controlledExpressionScore: 0.65,
  residualInstabilityScore: 0.25,
  residualPitchInstability: 0.2,
  residualAmplitudeInstability: 0.2,
  vibratoRegularity: 0.6,
  attackConsistency: 0.6,

  // flags
  isSilent: false,
  isTooFaint: false,
};

/**
 * Every numeric, swept parameter with its research-grounded role + realistic range.
 * Booleans / `featureMode` / `sampleRate` are not swept (structural). Ranges come from
 * the `hum_spec` dictionary and the read code's own normalization windows; where two
 * layers disagree on a window (e.g. pitch range 0.3–4 for openness vs 0.5–8 for arousal),
 * the WIDER realistic range is used so the sweep can expose the disagreement.
 */
export const FEATURE_SPECS: readonly FeatureSpec[] = [
  // --- energy ---
  { feature: "meanRms", kind: "energy", group: "energy", min: 0.006, max: 0.14, note: "arousal energy cue (window 0.006–0.06); strongest reliable arousal correlate" },
  { feature: "rmsEnergy", kind: "energy", group: "energy", min: 0.006, max: 0.14, note: "signal-strength loudness (window 0.006–0.05)" },
  { feature: "peakAmplitude", kind: "energy", group: "energy", min: 0.05, max: 0.95, note: "extraversion loudness cue (window 0.1–0.7)" },
  { feature: "activeFrameRatio", kind: "energy", group: "energy", min: 0.2, max: 0.98, note: "arousal voiced-activity cue; extraversion (window 0.4–0.95)" },
  { feature: "silenceRatio", kind: "continuity", group: "energy", min: 0, max: 0.7, note: "gate + signal strength; high → near-silent" },
  { feature: "zeroCrossingRate", kind: "voice_quality", group: "energy", min: 0.01, max: 0.2, note: "voicing/noisiness proxy (gate speech discrimination)" },
  // --- fidelity (mic + room — MUST NOT touch the affect read) ---
  { feature: "signalToNoiseProxy", kind: "fidelity", group: "fidelity", min: 0.5, max: 16, note: "SNR — confidence only (valence-fidelity-decoupling)" },
  { feature: "noiseFloorRms", kind: "fidelity", group: "fidelity", min: 0.001, max: 0.05, note: "room noise floor — confidence only" },
  { feature: "clarityScore", kind: "fidelity", group: "fidelity", min: 0.2, max: 0.95, note: "capture clarity — signal strength + confidence ONLY (removed from valence)" },
  { feature: "spectralFlatness", kind: "fidelity", group: "fidelity", min: 0.05, max: 0.6, note: "noisiness — confidence only" },
  { feature: "breathinessProxy", kind: "fidelity", group: "fidelity", min: 0.05, max: 0.8, note: "breathiness — agreeableness cue only (voice-big-five.md), not valence" },
  // --- pitch / melodic (prosody = mood-variable) ---
  { feature: "pitchMeanHz", kind: "prosody", group: "pitch", min: 90, max: 285, note: "pitch height (window 95–260): arousal + (mood-variable) valence; V-A circumplex" },
  { feature: "pitchRangeSemitones", kind: "prosody", group: "pitch", min: 0.3, max: 6, note: "melodic movement: arousal (window 0.5–8), valence, openness (window 0.5–6 after 2026-06-24 calibration); 6 st is already a wide hum" },
  { feature: "pitchVariance", kind: "prosody", group: "pitch", min: 0.5, max: 30, note: "pitch spread (correlates with range/jitter)" },
  { feature: "pitchStability", kind: "voice_quality", group: "pitch", min: 0.4, max: 0.99, note: "held-tone stability: valence settledness; conscientiousness + steadiness (window 0.6–0.99)" },
  { feature: "jitter", kind: "voice_quality", group: "pitch", min: 0.003, max: 0.06, note: "cycle-to-cycle pitch perturbation → emotional steadiness (inverse, window 0.005–0.05)" },
  { feature: "pitchDrift", kind: "voice_quality", group: "pitch", min: 0, max: 0.4, note: "slow pitch drift" },
  { feature: "pitchCoverage", kind: "continuity", group: "pitch", min: 0.2, max: 0.95, note: "voiced coverage → signal strength" },
  { feature: "longestStableSegmentSec", kind: "continuity", group: "pitch", min: 0.5, max: 10, note: "held-segment length (gate hum evidence)" },
  // --- spectral ---
  { feature: "spectralCentroidHz", kind: "prosody", group: "spectral", min: 250, max: 3000, note: "brightness: arousal (window 250–2600); extraversion + agreeableness" },
  { feature: "spectralFlux", kind: "prosody", group: "spectral", min: 0.01, max: 0.4, note: "timbre change → arousal animation (window 0.01–0.3)" },
  { feature: "spectralBandwidthHz", kind: "prosody", group: "spectral", min: 400, max: 2500, note: "spectral spread (brightness correlate)" },
  { feature: "spectralRolloffHz", kind: "prosody", group: "spectral", min: 800, max: 4000, note: "high-frequency rolloff (brightness correlate)" },
  // --- voice-quality / expression ---
  { feature: "amplitudeStability", kind: "voice_quality", group: "expression", min: 0.4, max: 0.99, note: "intensity steadiness: valence; conscientiousness + steadiness (window 0.5–0.99)" },
  { feature: "smoothnessScore", kind: "voice_quality", group: "expression", min: 0.2, max: 0.95, note: "contour smoothness: valence; agreeableness warmth" },
  { feature: "musicalityScore", kind: "prosody", group: "expression", min: 0.05, max: 0.8, note: "melodic richness → openness (voice-big-five.md)" },
  { feature: "controlledExpressionScore", kind: "voice_quality", group: "expression", min: 0.2, max: 0.95, note: "vocal control → conscientiousness primary cue (Schuller 2012; Mohammadi 2012)" },
  { feature: "residualInstabilityScore", kind: "voice_quality", group: "expression", min: 0.05, max: 0.7, note: "composite micro-instability: valence agitation (inverse); conscientiousness (inverse)" },
  { feature: "residualPitchInstability", kind: "voice_quality", group: "expression", min: 0.03, max: 0.7, note: "pitch micro-instability → steadiness (inverse, window 0.05–0.6)" },
  { feature: "residualAmplitudeInstability", kind: "voice_quality", group: "expression", min: 0.03, max: 0.7, note: "amplitude micro-instability" },
  { feature: "shimmerProxy", kind: "voice_quality", group: "expression", min: 0.03, max: 0.6, note: "amplitude perturbation → conscientiousness + steadiness (inverse, Saeedi 2023)" },
  { feature: "vibratoRegularity", kind: "voice_quality", group: "expression", min: 0.2, max: 0.95, note: "vibrato evenness: valence; openness (low weight)" },
  { feature: "attackConsistency", kind: "voice_quality", group: "expression", min: 0.2, max: 0.95, note: "onset evenness" },
];

/** The OCEAN trait keys, re-exported so the harness can iterate them without a second import. */
export const OCEAN_KEYS: readonly BigFiveKey[] = BIG_FIVE_KEYS;

/**
 * Project a single feature vector into the longitudinal feature WINDOWS shape that
 * `assessPersonalitySignature` consumes (it reads per-feature arrays, not one hum).
 * Every numeric field becomes a constant window of length `humCount` — so the OCEAN
 * read reflects exactly this hum's steady habits. Non-finite / non-numeric fields drop out.
 */
export function featuresToWindows(
  features: AcousticFeatures,
  humCount: number,
): Record<string, readonly number[]> {
  const windows: Record<string, readonly number[]> = {};
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      windows[key] = Array.from({ length: humCount }, () => value);
    }
  }
  return windows;
}

/** Build a reference variant by overriding any fields (keeps the rest neutral). */
export function refHum(over: Partial<AcousticFeatures> = {}): AcousticFeatures {
  return { ...REFERENCE_HUM, ...over };
}
