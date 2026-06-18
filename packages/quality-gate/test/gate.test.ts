import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaptureMetrics } from "@hum-ai/audio-features";
import { evaluateQuality, CAPTURE_QUALITY_CONFIDENCE_CAP } from "@hum-ai/quality-gate";

// A clean, "good" baseline capture; tests override one field at a time.
const good = (over: Partial<CaptureMetrics> = {}): CaptureMetrics => ({
  durationSec: 12,
  isSilent: false,
  meanRms: 0.08,
  decisionRms: 0.09,
  clippedFrameRatio: 0.0,
  silenceRatio: 0.2,
  quietFrameRatio: 0.3,
  activeFrameRatio: 0.6,
  pitchCoverage: 0.7,
  signalToNoiseProxy: 8,
  peakAmplitude: 0.7,
  baselineRmsRatio: 1.0,
  ...over,
});

test("a clean strong capture is good/clean and baseline-eligible", () => {
  const r = evaluateQuality(good());
  assert.equal(r.decision, "clean");
  assert.equal(r.captureQuality, "good");
  assert.equal(r.baselineEligible, true);
  assert.ok(r.captureQualityScore > 0.7);
});

test("too short is rejected", () => {
  const r = evaluateQuality(good({ durationSec: 6 }));
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.some((x) => x.startsWith("too_short")));
});

test("near silent is rejected", () => {
  const r = evaluateQuality(good({ isSilent: true, meanRms: 0.001 }));
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("near_silent"));
});

test("clipping is rejected", () => {
  const r = evaluateQuality(good({ clippedFrameRatio: 0.2 }));
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("clipped"));
});

test("poor voicing (low pitch coverage) is rejected", () => {
  const r = evaluateQuality(good({ pitchCoverage: 0.1 }));
  assert.equal(r.decision, "rejected");
  assert.ok(r.reasons.includes("poor_voicing"));
});

test("poor capture caps confidence low (poor-capture cap)", () => {
  const r = evaluateQuality(good({ durationSec: 4 }));
  assert.equal(r.confidenceCap, CAPTURE_QUALITY_CONFIDENCE_CAP.rejected);
  assert.ok(r.confidenceCap <= 0.5);
});

test("faint capture is soft_usable / borderline and not baseline-eligible", () => {
  const r = evaluateQuality(good({ decisionRms: 0.01, meanRms: 0.012 }));
  assert.equal(r.captureQuality, "soft_usable");
  assert.equal(r.decision, "borderline");
  assert.equal(r.baselineEligible, false);
  assert.equal(r.confidenceCap, CAPTURE_QUALITY_CONFIDENCE_CAP.soft_usable);
});

test("below 70% of baseline RMS is soft_usable", () => {
  const r = evaluateQuality(good({ baselineRmsRatio: 0.5 }));
  assert.equal(r.captureQuality, "soft_usable");
});

test("usable-but-not-good still passes as clean", () => {
  // strong enough to pass gates, but SNR too low to be 'good'
  const r = evaluateQuality(good({ signalToNoiseProxy: 3.5, decisionRms: 0.06 }));
  assert.equal(r.decision, "clean");
  assert.equal(r.captureQuality, "usable");
});
