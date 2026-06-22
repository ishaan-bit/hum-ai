import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import { computeFeatures, type AudioInput, type AcousticFeatures } from "@hum-ai/audio-features";
import {
  anxietySeverityBand,
  assertValidClinicalExample,
  buildGad7Response,
  buildPhq9Response,
  depressionSeverityBand,
  gadToBinaryLabel,
  InvalidClinicalExampleError,
  InvalidInstrumentResponseError,
  phqToBinaryLabel,
  type ClinicalHumExample,
} from "../src/clinical-feedback";

function humFeatures(freq = 180, amp = 0.2): AcousticFeatures {
  const sampleRate = 16000;
  const n = sampleRate * 12;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  const input: AudioInput = { sampleRate, samples };
  return computeFeatures(input);
}

const NOW = asIsoTimestamp("2026-06-22T10:00:00.000Z");

function clinicalExample(over: Partial<ClinicalHumExample> = {}): ClinicalHumExample {
  return {
    id: "c-1",
    participantPseudonym: "p-abc123",
    studyId: "study-1",
    capturedAt: NOW,
    features: humFeatures(),
    phq: buildPhq9Response([1, 1, 1, 1, 1, 1, 1, 1, 0], NOW),
    gad: buildGad7Response([1, 1, 1, 1, 1, 1, 1], NOW),
    captureQualityScore: 0.8,
    eligible: true,
    deviceClass: "ios_safari",
    featureSchemaVersion: "hum-acoustic-v2",
    ...over,
  };
}

test("buildPhq9Response computes total, band, and breaks out item 9", () => {
  const phq = buildPhq9Response([0, 1, 2, 3, 0, 1, 2, 3, 1], NOW);
  assert.equal(phq.total, 13);
  assert.equal(phq.severityBand, "moderate");
  assert.equal(phq.item9, 1);
  assert.equal(phq.instrument, "PHQ-9");
});

test("PHQ-8 has 8 items and a null item 9", () => {
  const phq = buildPhq9Response([3, 3, 3, 3, 3, 3, 3, 3], NOW, "PHQ-8");
  assert.equal(phq.total, 24);
  assert.equal(phq.item9, null);
  assert.equal(phq.instrument, "PHQ-8");
});

test("instrument builders reject out-of-range / wrong-length input", () => {
  assert.throws(() => buildPhq9Response([0, 1, 2, 3, 0, 1, 2, 3], NOW), InvalidInstrumentResponseError); // 8 items for PHQ-9
  assert.throws(() => buildPhq9Response([0, 1, 2, 4, 0, 1, 2, 3, 0], NOW), InvalidInstrumentResponseError); // 4 out of range
  assert.throws(() => buildGad7Response([0, 1, 2, 3, 0, 1], NOW), InvalidInstrumentResponseError); // 6 items for GAD-7
});

test("severity bands follow the standard PHQ-9 / GAD-7 cut-points", () => {
  assert.equal(depressionSeverityBand(4), "minimal");
  assert.equal(depressionSeverityBand(9), "mild");
  assert.equal(depressionSeverityBand(10), "moderate");
  assert.equal(depressionSeverityBand(15), "moderately_severe");
  assert.equal(depressionSeverityBand(20), "severe");
  assert.equal(anxietySeverityBand(4), "minimal");
  assert.equal(anxietySeverityBand(10), "moderate");
  assert.equal(anxietySeverityBand(15), "severe");
});

test("binary screening labels map at the ≥10 cut", () => {
  assert.equal(phqToBinaryLabel(buildPhq9Response([1, 1, 1, 1, 1, 1, 1, 1, 1], NOW)), "screen_negative"); // 9
  assert.equal(phqToBinaryLabel(buildPhq9Response([2, 1, 1, 1, 1, 1, 1, 1, 1], NOW)), "screen_positive"); // 10
  assert.equal(gadToBinaryLabel(buildGad7Response([1, 1, 1, 1, 1, 1, 3], NOW)), "screen_negative"); // total 9
  assert.equal(gadToBinaryLabel(buildGad7Response([2, 1, 1, 1, 1, 1, 3], NOW)), "screen_positive"); // total 10
});

test("assertValidClinicalExample accepts a valid row", () => {
  assert.doesNotThrow(() => assertValidClinicalExample(clinicalExample()));
});

test("assertValidClinicalExample rejects a raw-audio-bearing row", () => {
  const bad = { ...clinicalExample(), audioBuffer: [0.1, 0.2] } as unknown as ClinicalHumExample;
  assert.throws(() => assertValidClinicalExample(bad));
});

test("assertValidClinicalExample requires a pseudonym and ≥1 instrument", () => {
  assert.throws(() => assertValidClinicalExample(clinicalExample({ participantPseudonym: "user@example.com" })), InvalidClinicalExampleError);
  assert.throws(() => assertValidClinicalExample(clinicalExample({ phq: null, gad: null })), InvalidClinicalExampleError);
  assert.throws(() => assertValidClinicalExample(clinicalExample({ captureQualityScore: 1.5 })), InvalidClinicalExampleError);
});
