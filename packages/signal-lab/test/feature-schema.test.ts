import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures, type AcousticFeatures } from "@hum-ai/audio-features";
import { synthHum, synthSilence } from "@hum-ai/audio-features";
import {
  NUMERIC_FEATURE_KEYS,
  NULLABLE_FEATURE_KEYS,
  BOOLEAN_FEATURE_KEYS,
  featureVectorNames,
  featureVectorLength,
  toFeatureVector,
  featureSchemaSnapshot,
} from "../src/feature-schema";

test("every declared feature key exists on a real computeFeatures output (drift guard)", () => {
  const f = computeFeatures(synthHum({ seed: 1 })) as unknown as Record<string, unknown>;
  for (const k of [...NUMERIC_FEATURE_KEYS, ...NULLABLE_FEATURE_KEYS, ...BOOLEAN_FEATURE_KEYS]) {
    assert.ok(k in f, `schema key '${k}' missing from AcousticFeatures output`);
  }
});

test("schema does not reference unsupported parameters not produced by the extractor", () => {
  const f = computeFeatures(synthHum({ seed: 2 })) as unknown as Record<string, unknown>;
  const realKeys = new Set(Object.keys(f));
  for (const k of [...NUMERIC_FEATURE_KEYS, ...NULLABLE_FEATURE_KEYS, ...BOOLEAN_FEATURE_KEYS]) {
    assert.ok(realKeys.has(k), `schema lists '${k}' which the extractor does not produce`);
  }
});

test("vector length and names are consistent", () => {
  const f = computeFeatures(synthHum({ seed: 3 }));
  const v = toFeatureVector(f);
  assert.equal(v.length, featureVectorLength());
  assert.equal(featureVectorNames().length, featureVectorLength());
});

test("nullable features emit a 0 value AND a 0 mask channel when null (no false zeros)", () => {
  // Near silence ⇒ no voiced frames ⇒ pitch fields null.
  const f: AcousticFeatures = computeFeatures(synthSilence({ seed: 4 }));
  assert.equal(f.pitchMeanHz, null);
  const names = featureVectorNames();
  const v = toFeatureVector(f);
  const valueIdx = names.indexOf("pitchMeanHz");
  const maskIdx = names.indexOf("pitchMeanHz__present");
  assert.ok(valueIdx >= 0 && maskIdx >= 0);
  assert.equal(v[maskIdx], 0, "missing nullable feature must have mask 0");
  assert.equal(v[valueIdx], 0, "missing nullable feature value column is 0 (but distinguished by the mask)");

  // A voiced hum ⇒ present pitch ⇒ mask 1.
  const hum = computeFeatures(synthHum({ seed: 5 }));
  if (hum.pitchMeanHz !== null) {
    const vh = toFeatureVector(hum);
    assert.equal(vh[maskIdx], 1, "present nullable feature must have mask 1");
  }
});

test("schema snapshot is serializable and self-describing", () => {
  const snap = featureSchemaSnapshot();
  assert.ok(snap.source.includes("AcousticFeatures"));
  assert.equal(snap.vectorLength, featureVectorLength());
  assert.ok(snap.vectorNames.includes("pitchMeanHz__present"));
});

// ---------------------------------------------------------------------------
// SCHEMA LOCK (drift guard, strict). The 58-column layout IS the contract the
// shipped RAVDESS prior JSONs serialize against, by POSITION — `axis-prior.ts` /
// `runtime-bridge.ts` / `native-corpus` all vectorize through `featureVectorNames`
// / `toFeatureVector`. The reconciliation tests above catch a RENAME/REMOVAL, but
// an ADDITION or REORDER keeps `v.length === featureVectorLength()` self-consistent
// and would slip through silently — exactly the schema-v2 hazard the REVAMP_PLAN
// flags as "BREAKS PRIORS". This pins the exact count AND the exact serialized order
// so any drift fails LOUDLY and forces the deliberate, versioned v2 migration path.
const FROZEN_VECTOR_NAMES: readonly string[] = [
  "durationSec", "inputRms", "meanRms", "medianRms", "rmsEnergy", "peakAmplitude",
  "activeFrameRatio", "quietFrameRatio", "clippedFrameRatio", "silenceRatio",
  "noiseFloorRms", "signalToNoiseProxy", "zeroCrossingRate", "spectralCentroidHz",
  "spectralBandwidthHz", "spectralRolloffHz", "spectralFlatness", "spectralFlux",
  "breakCount", "pauseCount", "avgPauseLengthSec", "microBreakRatio",
  "voicingContinuityCoverage", "clarityScore", "breathinessProxy", "shimmerProxy",
  "amplitudeStability", "musicalityScore", "controlledExpressionScore",
  "residualInstabilityScore", "residualPitchInstability", "residualAmplitudeInstability",
  "isSilent", "isTooFaint",
  "pitchMeanHz", "pitchMeanHz__present",
  "pitchVariance", "pitchVariance__present",
  "pitchRangeSemitones", "pitchRangeSemitones__present",
  "pitchStability", "pitchStability__present",
  "jitter", "jitter__present",
  "pitchDrift", "pitchDrift__present",
  "pitchCoverage", "pitchCoverage__present",
  "longestStableSegmentSec", "longestStableSegmentSec__present",
  "onsetDelaySec", "onsetDelaySec__present",
  "smoothnessScore", "smoothnessScore__present",
  "vibratoRegularity", "vibratoRegularity__present",
  "attackConsistency", "attackConsistency__present",
];

test("SCHEMA LOCK: the vector is exactly 58 columns (32 numeric + 2 boolean + 12 nullable×2)", () => {
  // The exact bucket sizes the shipped-prior contract depends on. Changing any of
  // these is a schema-v2 migration (§3 REVAMP_PLAN), never an accidental edit.
  assert.equal(NUMERIC_FEATURE_KEYS.length, 32, "numeric feature count drifted");
  assert.equal(BOOLEAN_FEATURE_KEYS.length, 2, "boolean feature count drifted");
  assert.equal(NULLABLE_FEATURE_KEYS.length, 12, "nullable feature count drifted");
  assert.equal(featureVectorLength(), 58, "feature vector length drifted from the 58-col prior contract");
});

test("SCHEMA LOCK: featureVectorNames() matches the frozen golden order exactly", () => {
  // A positional diff: any add / remove / reorder of a feature breaks this and the
  // shipped priors at once — forcing the deliberate, retrain-gated v2 path instead.
  assert.deepEqual(featureVectorNames(), FROZEN_VECTOR_NAMES);
});
