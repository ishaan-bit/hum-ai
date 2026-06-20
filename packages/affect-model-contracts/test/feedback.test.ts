import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion } from "@hum-ai/shared-types";
import { computeFeatures, type AudioInput, type AcousticFeatures } from "@hum-ai/audio-features";
import {
  assertValidNativeHumExample,
  InvalidNativeHumExampleError,
  normalizeLabel,
  type NativeHumExample,
} from "../src/feedback";
import { ClinicalLeakError } from "../src/two-head";

/** A 12 s sustained sine "hum" → real derived features (no hand-maintained fixture). */
function humFeatures(freq = 180, amp = 0.2): AcousticFeatures {
  const sampleRate = 16000;
  const n = sampleRate * 12;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  const input: AudioInput = { sampleRate, samples };
  return computeFeatures(input);
}

function example(over: Partial<NativeHumExample> = {}): NativeHumExample {
  return {
    id: "ex-1",
    capturedAt: asIsoTimestamp("2026-06-20T10:00:00.000Z"),
    modelVersion: asModelVersion("hum-web@0.1.0"),
    features: humFeatures(),
    predicted: { valence: 0.2, arousal: -0.1 },
    predictedConfidence: 0.4,
    label: { valence: 0.5, arousal: -0.3 },
    source: "self_report_adjust",
    agreedWithRead: false,
    captureQualityScore: 0.8,
    eligible: true,
    provenance: "in_app_hitl_self_report",
    featureSchemaVersion: "hum-acoustic-v2",
    ...over,
  };
}

test("a benign valence/arousal example passes both privacy guards", () => {
  assert.doesNotThrow(() => assertValidNativeHumExample(example()));
});

test("normalizeLabel clamps overshoot and coerces non-finite to 0", () => {
  assert.deepEqual(normalizeLabel({ valence: 1.8, arousal: -2 }), { valence: 1, arousal: -1 });
  assert.deepEqual(normalizeLabel({ valence: NaN, arousal: Infinity }), { valence: 0, arousal: 0 });
});

test("an out-of-range label axis is rejected", () => {
  assert.throws(() => assertValidNativeHumExample(example({ label: { valence: 1.5, arousal: 0 } })), InvalidNativeHumExampleError);
});

test("a clinical-risk-marker label leaking as a field VALUE trips the clinical guard", () => {
  // Defense in depth: a refactor that ever stuffed a risk-marker id into the row
  // (here as an extra string field value) must be caught.
  const leaky = { ...example(), provenance: "depressive_affect_markers" } as unknown as NativeHumExample;
  assert.throws(() => assertValidNativeHumExample(leaky), ClinicalLeakError);
});

test("a raw-audio-like field anywhere in the row trips the raw-audio guard", () => {
  const leaky = { ...example(), rawAudioPcm: [0.1, 0.2] } as unknown as NativeHumExample;
  assert.throws(() => assertValidNativeHumExample(leaky));
});

test("the derived features carry no raw-audio field names (corpus parity with sync payload)", () => {
  // The features object is the same shape HumSyncPayload syncs; it must itself be clean.
  assert.doesNotThrow(() => assertValidNativeHumExample(example({ features: humFeatures(220, 0.15) })));
});
