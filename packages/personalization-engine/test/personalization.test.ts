import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId } from "@hum-ai/shared-types";
import {
  stagePolicy,
  buildBaselineVector,
  zDeltasAgainstBaseline,
  newUserProfile,
  PERSONALIZATION_STAGES,
} from "@hum-ai/personalization-engine";

test("the ladder progresses through all five stages with rising caps", () => {
  const counts = [1, 3, 7, 15, 40];
  const policies = counts.map(stagePolicy);
  assert.deepEqual(
    policies.map((p) => p.stage),
    [...PERSONALIZATION_STAGES],
  );
  const caps = policies.map((p) => p.confidenceCap);
  for (let i = 1; i < caps.length; i++) assert.ok(caps[i]! > caps[i - 1]!, "caps must be monotonic");
});

test("first hum is population-prior with the 0.72 cap and no baseline (first-hum cap)", () => {
  const p = stagePolicy(1);
  assert.equal(p.stage, "population_prior");
  assert.equal(p.confidenceCap, 0.72);
  assert.equal(p.baselineActive, false);
  assert.ok(p.capReason.toLowerCase().includes("first"));
});

test("baseline activates at 5 eligible hums; relapse model at 20+", () => {
  assert.equal(stagePolicy(4).baselineActive, false);
  assert.equal(stagePolicy(5).baselineActive, true);
  assert.equal(stagePolicy(19).relapseModelActive, false);
  assert.equal(stagePolicy(20).relapseModelActive, true);
});

test("robust baseline ignores outliers (median/MAD) and z-delta is signed", () => {
  // 24 stable values around 100 with one wild outlier.
  const stable = Array.from({ length: 24 }, () => 100);
  stable[0] = 100000; // outlier
  const baseline = buildBaselineVector({ pitchCenterHz: stable });
  assert.equal(baseline.pitchCenterHz!.median, 100); // robust to the outlier
  const z = zDeltasAgainstBaseline({ pitchCenterHz: 100 }, baseline);
  // with ~zero spread, a value at the median is ~0 sigma
  assert.ok(Math.abs(z.pitchCenterHz!) < 1e-3);
});

test("z-deltas EXCLUDE fidelity features (capture quality is not a within-person deviation)", () => {
  // A baseline + current capture where a fidelity feature (SNR) and a state feature (pitch) both
  // deviate. The fidelity deviation must NOT appear as a z-delta — it can't re-reference affect,
  // seed a risk signature, or read as drift.
  const baseline = buildBaselineVector({
    signalToNoiseProxy: Array.from({ length: 24 }, () => 8),
    clarityScore: Array.from({ length: 24 }, () => 0.9),
    pitchMeanHz: Array.from({ length: 24 }, () => 180),
  });
  const z = zDeltasAgainstBaseline({ signalToNoiseProxy: 2, clarityScore: 0.3, pitchMeanHz: 200 }, baseline);
  assert.equal(z.signalToNoiseProxy, undefined, "SNR (fidelity) yields no z-delta");
  assert.equal(z.clarityScore, undefined, "clarity (fidelity) yields no z-delta");
  assert.ok(z.pitchMeanHz !== undefined, "pitch (state) still yields a z-delta");
});

test("a new user profile starts at the population-prior cap", () => {
  const p = newUserProfile(asUserId("u1"), asIsoTimestamp("2026-06-18T00:00:00.000Z"), asModelVersion("v1"));
  assert.equal(p.confidence_cap, 0.72);
  assert.deepEqual(p.baseline_vector, {});
});
