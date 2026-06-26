import type { AcousticFeatures } from "./features";

/**
 * FEATURE TAXONOMY — trait/timbre vs state, the v11 "do not read a voice's identity
 * as its mood" contract, made a first-class, SHARED fact.
 *
 * Every person has a natural vocal range: a heavier/huskier voice sits low and dark, a
 * brighter voice sits high and bright. Those are stable properties of the SPEAKER + MIC,
 * not of how they feel right now. The read and the trained models must therefore treat the
 * ABSOLUTE level of those features as IDENTITY, and recover mood from how a hum departs
 * from that person's OWN usual — the within-person standardized deviation (z-delta vs the
 * personal baseline). This table is the single source of truth for which feature is which,
 * imported by the read (axis-read), the personal salience, the model feature vector
 * (signal-lab), and the personality signature, so the subsystems can never drift apart.
 *
 *  - `timbre`     IDENTITY-bearing: the absolute level is dominated by the speaker's voice
 *                 + mic (register, loudness, brightness). It carries mood ONLY through its
 *                 deviation from the person's usual, so models standardize it within-person
 *                 (z-delta) and the personal salience down-weights its raw level. Loudness is
 *                 the borderline case — it is identity (projection level / mic gain) PLUS the
 *                 strongest single arousal cue — so the READ still uses it (its identity offset
 *                 is removed downstream by the within-user display re-reference), while the
 *                 MODEL standardizes it (the z-delta is the clean mood part).
 *  - `state`      WITHIN-HUM, already-relative dynamics (steadiness, smoothness, vibrato,
 *                 melodic movement in semitones, micro-instability, spectral change, voiced
 *                 activity). These barely carry a cross-person offset, so they are honest mood
 *                 cues from the FIRST hum and are used directly (never standardized away).
 *  - `fidelity`   mic + room artefacts (SNR, noise floor, clarity, flatness, breathiness).
 *                 MUST NOT drive the affect read at all (valence ⊥ fidelity); kept out of the
 *                 mood read and out of within-person standardization (they are capture quality,
 *                 not the person).
 *  - `structural` bookkeeping (duration, sample rate, mode, capture flags) — never affect.
 */
export type FeatureKind = "timbre" | "state" | "fidelity" | "structural";

/**
 * The kind of every `AcousticFeatures` field. Exhaustive over the schema (a missing key is a
 * compile error via the `satisfies` check below), so a new extractor field must be classified
 * here before it can silently leak into the read or the model as an absolute value.
 */
export const FEATURE_KIND = {
  // ── structural / bookkeeping ──
  featureMode: "structural",
  sampleRate: "structural",
  durationSec: "structural",
  isSilent: "structural",
  isTooFaint: "structural",

  // ── timbre / IDENTITY (absolute level = speaker + mic, standardized within-person) ──
  inputRms: "timbre",
  meanRms: "timbre",
  medianRms: "timbre",
  rmsEnergy: "timbre",
  peakAmplitude: "timbre",
  pitchMeanHz: "timbre",
  pitchVariance: "timbre",
  spectralCentroidHz: "timbre",
  spectralBandwidthHz: "timbre",
  spectralRolloffHz: "timbre",
  zeroCrossingRate: "timbre",

  // ── fidelity / mic + room (never affect, never standardized) ──
  noiseFloorRms: "fidelity",
  signalToNoiseProxy: "fidelity",
  clarityScore: "fidelity",
  spectralFlatness: "fidelity",
  breathinessProxy: "fidelity",

  // ── state / within-hum dynamics (already relative — honest mood from hum #1) ──
  activeFrameRatio: "state",
  quietFrameRatio: "state",
  clippedFrameRatio: "state",
  silenceRatio: "state",
  spectralFlux: "state",
  pitchRangeSemitones: "state",
  pitchStability: "state",
  jitter: "state",
  pitchDrift: "state",
  pitchCoverage: "state",
  longestStableSegmentSec: "state",
  breakCount: "state",
  pauseCount: "state",
  avgPauseLengthSec: "state",
  microBreakRatio: "state",
  onsetDelaySec: "state",
  voicingContinuityCoverage: "state",
  shimmerProxy: "state",
  amplitudeStability: "state",
  smoothnessScore: "state",
  musicalityScore: "state",
  controlledExpressionScore: "state",
  residualInstabilityScore: "state",
  residualPitchInstability: "state",
  residualAmplitudeInstability: "state",
  vibratoRegularity: "state",
  attackConsistency: "state",
} as const satisfies Record<keyof AcousticFeatures, FeatureKind>;

export type FeatureKey = keyof typeof FEATURE_KIND;

/** Every feature classified `timbre` — identity-bearing, standardized within-person in the model. */
export const TIMBRE_FEATURE_KEYS: readonly string[] = Object.keys(FEATURE_KIND).filter(
  (k) => FEATURE_KIND[k as FeatureKey] === "timbre",
);

/** Every feature classified `state` — already-relative within-hum mood cues. */
export const STATE_FEATURE_KEYS: readonly string[] = Object.keys(FEATURE_KIND).filter(
  (k) => FEATURE_KIND[k as FeatureKey] === "state",
);

/** Every feature classified `fidelity` — mic + room artefacts, never affect. */
export const FIDELITY_FEATURE_KEYS: readonly string[] = Object.keys(FEATURE_KIND).filter(
  (k) => FEATURE_KIND[k as FeatureKey] === "fidelity",
);

/** The kind of a feature by name (unknown / non-schema names default to `state` — used as-is, never standardized). */
export function featureKind(feature: string): FeatureKind {
  return (FEATURE_KIND as Record<string, FeatureKind>)[feature] ?? "state";
}

/**
 * True when a feature is IDENTITY-bearing (`timbre`) and therefore carries a speaker+mic
 * offset that should be removed by within-person standardization before a model or a
 * cross-person comparison may use it. The single predicate the whole codebase shares.
 */
export function isTimbreFeature(feature: string): boolean {
  return featureKind(feature) === "timbre";
}
