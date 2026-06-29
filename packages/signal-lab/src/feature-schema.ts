import { isTimbreFeature, type AcousticFeatures } from "@hum-ai/audio-features";
import { clamp, rangePosition, zDelta, type RangeStats, type RobustStats } from "@hum-ai/shared-types";

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

// ────────────────────────────────────────────────────────────────────────────────────
// v13 — WITHIN-HUM + LONGITUDINAL-RANGE representations (the "model adjustment").
//
// The directive: chunking / inner-state prediction should reason over WITHIN-HUM relative
// values, while ABSOLUTE values feed a longitudinal per-user VOCAL-RANGE model; "the variations
// relative to the individual … are the parameters which should be used … not absolute values."
//
// These functions are the representation that realizes it. They are ADDITIVE and SEPARATE from
// `toFeatureVector` — the absolute / within-person-z-delta vector trained models already depend on
// is left byte-identical (its standardizer is serialized with every artifact; changing it would
// silently corrupt promoted priors). The new vectorizers carry NO persisted artifact: the within-hum
// trajectory model is unsupervised + deterministic, so it can adopt a richer representation freely.
// ────────────────────────────────────────────────────────────────────────────────────

/** A per-feature LONGITUDINAL vocal-range model (feature → the user's robust reachable span). */
export type FeatureRange = Record<string, RangeStats>;

/**
 * LONGITUDINAL-RANGE standardization (v13). Map an IDENTITY-bearing `timbre` feature to where it
 * sits in the user's OWN reachable range, centered to [-1,1] (low edge → −1, mid → 0, high edge →
 * +1). This is the absolute-but-personal frame: a value high in THIS person's loudness range reads
 * "+", regardless of how loud their voice is vs the population. Returns the raw value unchanged when
 * the feature is not identity-bearing or the range is not yet trustworthy (a caller then falls back
 * to the population-absolute read). The range complement of `standardizeTimbre` (which uses z-delta
 * vs the median); use whichever frame a model was fit on.
 */
export function rangeStandardize(key: string, value: number, range: FeatureRange | undefined): number {
  if (!range || !isTimbreFeature(key)) return value;
  const stats = range[key];
  if (!stats) return value;
  const pos = rangePosition(value, stats); // [0,1] or null
  return pos === null ? value : pos * 2 - 1; // center to [-1,1]
}

/**
 * The mood-variable features whose WITHIN-HUM trajectory the inner-state read reasons over. A
 * curated subset (the carriers of arousal/valence + steadiness), so the trajectory vector is fixed
 * length and dense. Nullable members contribute zeros when a chunk could not compute them.
 */
export const TRAJECTORY_FEATURE_KEYS = [
  "meanRms",
  "pitchMeanHz",
  "pitchRangeSemitones",
  "spectralCentroidHz",
  "spectralFlux",
  "jitter",
  "shimmerProxy",
  "amplitudeStability",
  "residualInstabilityScore",
  "musicalityScore",
] as const satisfies readonly (keyof AcousticFeatures)[];

/** Number of columns in a trajectory vector: 1 (chunk count) + 3 summaries per feature. */
export function trajectoryVectorLength(): number {
  return 1 + TRAJECTORY_FEATURE_KEYS.length * 3;
}

/** Ordered names of the trajectory vector columns (chunk count, then arc/range/volatility per feature). */
export function trajectoryVectorNames(): string[] {
  const names: string[] = ["chunkCountNorm"];
  for (const k of TRAJECTORY_FEATURE_KEYS) {
    names.push(`${k}__arc`, `${k}__range`, `${k}__volatility`);
  }
  return names;
}

/** Mean / population-std of a finite series (std 0 ⇒ a flat series). */
function meanStd(xs: readonly number[]): { mean: number; std: number } {
  const n = xs.length;
  if (n === 0) return { mean: 0, std: 0 };
  let m = 0;
  for (const x of xs) m += x;
  m /= n;
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return { mean: m, std: Math.sqrt(v / n) };
}

/**
 * VECTORIZE the WITHIN-HUM trajectory (v13). Given the ordered per-chunk features of one hum,
 * emit a fixed-length vector of WITHIN-HUM relative variation: for each trajectory feature, the
 * chunk values are z-scored ACROSS THIS HUM'S CHUNKS (so a husky vs bright voice cannot manufacture
 * a trajectory — every column is within-hum by construction) and summarized as:
 *   - arc        — last-chunk minus first-chunk z (the net direction across the hum);
 *   - range      — max minus min z (how far the parameter swung within the hum);
 *   - volatility — mean |chunk-to-chunk z step| (how restlessly it moved).
 * A leading `chunkCountNorm` encodes fragmentation (the chunk count is itself a signal). A single
 * chunk, or identical chunks, yields the zero vector — no manufactured trajectory. Pure; emits no
 * absolute level, so it is inherently trait-decoupled.
 */
export function toTrajectoryVector(chunkFeatures: readonly AcousticFeatures[]): number[] {
  const k = chunkFeatures.length;
  const chunkCountNorm = clamp((k - 1) / 4, 0, 1); // 1 chunk → 0, ≥5 chunks → 1
  const out: number[] = [chunkCountNorm];
  if (k < 2) {
    for (let i = 0; i < TRAJECTORY_FEATURE_KEYS.length; i++) out.push(0, 0, 0);
    return out;
  }
  for (const key of TRAJECTORY_FEATURE_KEYS) {
    // Collect the chunk values that are present + finite (nullable features may be absent).
    const present: { idx: number; v: number }[] = [];
    chunkFeatures.forEach((f, idx) => {
      const raw = (f as unknown as Record<string, number | null | undefined>)[key];
      if (typeof raw === "number" && Number.isFinite(raw)) present.push({ idx, v: raw });
    });
    if (present.length < 2) {
      out.push(0, 0, 0);
      continue;
    }
    const { mean: m, std: s } = meanStd(present.map((p) => p.v));
    if (s < 1e-9) {
      out.push(0, 0, 0); // flat across chunks → no trajectory
      continue;
    }
    const z = present.map((p) => (p.v - m) / s);
    const first = z[0] as number;
    const last = z[z.length - 1] as number;
    let lo = Infinity;
    let hi = -Infinity;
    let stepAcc = 0;
    for (let i = 0; i < z.length; i++) {
      const zi = z[i] as number;
      if (zi < lo) lo = zi;
      if (zi > hi) hi = zi;
      if (i > 0) stepAcc += Math.abs(zi - (z[i - 1] as number));
    }
    const arc = last - first;
    const range = hi - lo;
    const volatility = stepAcc / (z.length - 1);
    out.push(arc, range, volatility);
  }
  return out;
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
