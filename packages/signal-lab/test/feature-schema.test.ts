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
