import { test } from "node:test";
import assert from "node:assert/strict";
import { rms, peakAmplitude, silenceRatio, zeroCrossingRate, NotImplementedExtractor } from "@hum-ai/audio-features";

test("rms of silence is 0, rms of constant amplitude equals amplitude", () => {
  assert.equal(rms([0, 0, 0, 0]), 0);
  assert.equal(rms([0.5, -0.5, 0.5, -0.5]), 0.5);
});

test("peakAmplitude finds the max magnitude", () => {
  assert.equal(peakAmplitude([0.1, -0.9, 0.3]), 0.9);
});

test("silenceRatio counts sub-threshold samples", () => {
  assert.equal(silenceRatio([0, 0, 0.5, 0.5]), 0.5);
  assert.equal(silenceRatio([]), 1);
});

test("zeroCrossingRate of an alternating signal is ~1", () => {
  assert.equal(zeroCrossingRate([1, -1, 1, -1]), 1);
  assert.equal(zeroCrossingRate([1, 1, 1, 1]), 0);
});

test("the v1 extractor stub rejects rather than returning fake features", async () => {
  await assert.rejects(() => new NotImplementedExtractor().extract({ sampleRate: 16000, samples: [0] }));
});
