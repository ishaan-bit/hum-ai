import { isTimbreFeature, type AcousticFeatures } from "@hum-ai/audio-features";
import { clamp, zDelta, type RobustStats } from "@hum-ai/shared-types";

/** Winsor cap on a within-person z-delta so a near-constant (degenerate) feature can't explode. */
export const TIMBRE_STANDARDIZE_WINSOR_Z = 6;

/**
 * The pretraining feature schema is the EXACT `AcousticFeatures` contract from
 * `@hum-ai/audio-features` (`features.ts`). We never invent feature names; we
 * enumerate the real ones so (a) feature tables match the extractor output and
 * (b) a schema drift (a renamed/added/removed extractor field) is caught by the
 * `feature-schema.test.ts` reconciliation against a live `computeFeatures` result.
 *
 * Nullable fields mean "not computable for this capture" (e.g. no voiced frames),
 * NOT zero (synthesis §2). The vectorizer therefore emits an explicit MASK
 * channel per nullable feature (1 = present, 0 = missing) instead of coercing the
 * value to 0 — so a model can learn "missing-ness" rather than be told a false 0.
 */

/** Real-valued, always-present feature fields (Energy + Spectral + non-null Continuity/Expression). */
export const NUMERIC_FEATURE_KEYS = [
  // Energy / loudness
  "durationSec",
  "inputRms",
  "meanRms",
  "medianRms",
  "rmsEnergy",
  "peakAmplitude",
  "activeFrameRatio",
  "quietFrameRatio",
  "clippedFrameRatio",
  "silenceRatio",
  "noiseFloorRms",
  "signalToNoiseProxy",
  "zeroCrossingRate",
  // Spectral
  "spectralCentroidHz",
  "spectralBandwidthHz",
  "spectralRolloffHz",
  "spectralFlatness",
  "spectralFlux",
  // Continuity (non-null)
  "breakCount",
  "pauseCount",
  "avgPauseLengthSec",
  "microBreakRatio",
  "voicingContinuityCoverage",
  // Expression (non-null)
  "clarityScore",
  "breathinessProxy",
  "shimmerProxy",
  "amplitudeStability",
  "musicalityScore",
  "controlledExpressionScore",
  "residualInstabilityScore",
  "residualPitchInstability",
  "residualAmplitudeInstability",
] as const satisfies readonly (keyof AcousticFeatures)[];

/** Nullable feature fields — emit value + mask channel (null ⇒ mask 0). */
export const NULLABLE_FEATURE_KEYS = [
  // Pitch (all nullable)
  "pitchMeanHz",
  "pitchVariance",
  "pitchRangeSemitones",
  "pitchStability",
  "jitter",
  "pitchDrift",
  "pitchCoverage",
  "longestStableSegmentSec",
  // Continuity / Expression nullable
  "onsetDelaySec",
  "smoothnessScore",
  "vibratoRegularity",
  "attackConsistency",
] as const satisfies readonly (keyof AcousticFeatures)[];

/** Boolean capture flags, encoded as 0/1 features. */
export const BOOLEAN_FEATURE_KEYS = ["isSilent", "isTooFaint"] as const satisfies readonly (keyof AcousticFeatures)[];

export type NumericFeatureKey = (typeof NUMERIC_FEATURE_KEYS)[number];
export type NullableFeatureKey = (typeof NULLABLE_FEATURE_KEYS)[number];
export type BooleanFeatureKey = (typeof BOOLEAN_FEATURE_KEYS)[number];

/**
 * Ordered names of every column the vectorizer emits: numeric, then boolean,
 * then for each nullable feature a value column AND a `<name>__present` mask
 * column. This order is the model's feature contract and is serialized with the
 * model so inference uses the identical layout.
 */
export function featureVectorNames(): string[] {
  const names: string[] = [];
  for (const k of NUMERIC_FEATURE_KEYS) names.push(k);
  for (const k of BOOLEAN_FEATURE_KEYS) names.push(k);
  for (const k of NULLABLE_FEATURE_KEYS) {
    names.push(k);
    names.push(`${k}__present`);
  }
  return names;
}

/** Number of columns in a feature vector. */
export function featureVectorLength(): number {
  return NUMERIC_FEATURE_KEYS.length + BOOLEAN_FEATURE_KEYS.length + NULLABLE_FEATURE_KEYS.length * 2;
}

/**
 * A per-feature robust baseline for WITHIN-PERSON (or within-contributor) standardization.
 * Maps a feature name → its robust center/scale over that person's prior eligible hums.
 */
export type FeatureBaseline = Record<string, RobustStats>;

/**
 * v11 TRAIT-DECOUPLED feature vector. When a `baseline` is supplied, every IDENTITY-bearing
 * `timbre` feature (pitch + brightness + loudness register, per `@hum-ai/audio-features`
 * `FEATURE_KIND`) is emitted as its WITHIN-PERSON STANDARDIZED DEVIATION (`zDelta` vs the
 * person's own usual) instead of its absolute value — so a model learns from "louder/higher/
 * brighter than THEIR usual" (mood), not from "louder/higher/brighter than the average voice"
 * (identity). `state` and `fidelity` features are already relative / capture-quality and are
 * emitted as-is. With NO baseline, this is byte-identical to the absolute vector (so far-domain
 * priors and existing callers are unchanged). Dimensionality is identical either way.
 *
 * Why this is the user's directive made concrete: "the variations relative to the individual …
 * are the parameters which should be used to retrain the models going ahead, not absolute values
 * … as we get more hums new variables are introduced which are these variations standardized."
 */
export function standardizeTimbre(key: string, value: number, baseline: FeatureBaseline | undefined): number {
  if (!baseline || !isTimbreFeature(key)) return value;
  const stats = baseline[key];
  if (!stats || stats.n <= 0) return value;
  return clamp(zDelta(value, stats), -TIMBRE_STANDARDIZE_WINSOR_Z, TIMBRE_STANDARDIZE_WINSOR_Z);
}

/**
 * Project one `AcousticFeatures` object into a numeric vector with explicit null
 * masking. A missing (null) value contributes `0` in its value column AND `0` in
 * its `__present` mask column; a present value contributes the raw number AND `1`.
 * Non-finite values are treated as missing (defensive).
 *
 * With a `baseline` (the person's or contributor's robust per-feature stats), timbre features
 * are emitted as within-person standardized deviations (see `standardizeTimbre`); without one,
 * the vector is the absolute representation (unchanged behaviour).
 */
export function toFeatureVector(f: AcousticFeatures, baseline?: FeatureBaseline): number[] {
  const v: number[] = [];
  for (const k of NUMERIC_FEATURE_KEYS) {
    const x = f[k] as number;
    v.push(Number.isFinite(x) ? standardizeTimbre(k, x, baseline) : 0);
  }
  for (const k of BOOLEAN_FEATURE_KEYS) {
    v.push(f[k] ? 1 : 0);
  }
  for (const k of NULLABLE_FEATURE_KEYS) {
    const x = f[k] as number | null;
    if (x === null || x === undefined || !Number.isFinite(x)) {
      v.push(0);
      v.push(0);
    } else {
      v.push(standardizeTimbre(k, x, baseline));
      v.push(1);
    }
  }
  return v;
}

/** A compact, serializable snapshot of the schema (for the artifact + drift test). */
export interface FeatureSchemaSnapshot {
  readonly source: string;
  readonly numeric: readonly string[];
  readonly nullable: readonly string[];
  readonly boolean: readonly string[];
  readonly vectorLength: number;
  readonly vectorNames: readonly string[];
  readonly note: string;
}

export function featureSchemaSnapshot(): FeatureSchemaSnapshot {
  return {
    source: "@hum-ai/audio-features AcousticFeatures (features.ts)",
    numeric: [...NUMERIC_FEATURE_KEYS],
    nullable: [...NULLABLE_FEATURE_KEYS],
    boolean: [...BOOLEAN_FEATURE_KEYS],
    vectorLength: featureVectorLength(),
    vectorNames: featureVectorNames(),
    note: "Nullable features carry a `<name>__present` mask channel; null means not-computable, never 0. featureMode + sampleRate are metadata, not model inputs.",
  };
}
