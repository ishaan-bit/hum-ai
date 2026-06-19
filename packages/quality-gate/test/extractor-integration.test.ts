import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFeatures,
  metricsFromFeatures,
  synthHum,
  synthSilence,
  synthClippedHum,
  synthInterruptedHum,
  synthNoisyHum,
  synthSoftHum,
  synthMusicLike,
} from "@hum-ai/audio-features";
import { evaluateQuality, CAPTURE_QUALITY_CONFIDENCE_CAP } from "@hum-ai/quality-gate";

/** Run the REAL extractor → metrics → gate, end to end on synthetic signals. */
const gradeOf = (audio: ReturnType<typeof synthHum>, baselineRmsRatio: number | null = null) =>
  evaluateQuality(metricsFromFeatures(computeFeatures(audio), baselineRmsRatio));

test("a clean synthetic hum grades good / clean and is baseline-eligible", () => {
  const r = gradeOf(synthHum());
  assert.equal(r.decision, "clean");
  assert.equal(r.captureQuality, "good");
  assert.equal(r.baselineEligible, true);
  assert.ok(r.captureQualityScore > 0.7);
  assert.equal(r.confidenceCap, CAPTURE_QUALITY_CONFIDENCE_CAP.good);
});

test("near silence is rejected (near_silent), capping confidence low", () => {
  const r = gradeOf(synthSilence());
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("near_silent"));
  assert.equal(r.baselineEligible, false);
  assert.equal(r.confidenceCap, CAPTURE_QUALITY_CONFIDENCE_CAP.rejected);
});

test("a clipped capture is rejected (clipped)", () => {
  const r = gradeOf(synthClippedHum());
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("clipped"));
});

test("an interrupted capture is rejected (too_interrupted)", () => {
  const r = gradeOf(synthInterruptedHum());
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("too_interrupted"));
});

test("a music-like capture is rejected for poor voicing (not a hum)", () => {
  const r = gradeOf(synthMusicLike());
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("poor_voicing"));
});

test("a noisy hum still passes as clean but only 'usable' (lower quality)", () => {
  const r = gradeOf(synthNoisyHum());
  assert.equal(r.decision, "clean");
  assert.equal(r.captureQuality, "usable");
  assert.ok(r.captureQualityScore < 0.95);
});

test("a soft-but-clean hum passes as clean (usable), not rejected", () => {
  const r = gradeOf(synthSoftHum());
  assert.equal(r.decision, "clean");
  assert.notEqual(r.captureQuality, "rejected");
});

test("the soft-usable path: a clean hum quieter than the rolling baseline → soft_usable", () => {
  // Real features, but the current capture is < 70% of the user's recent RMS.
  const r = gradeOf(synthHum(), 0.5);
  assert.equal(r.captureQuality, "soft_usable");
  assert.equal(r.decision, "borderline");
  assert.equal(r.baselineEligible, false);
  assert.equal(r.confidenceCap, CAPTURE_QUALITY_CONFIDENCE_CAP.soft_usable);
});
