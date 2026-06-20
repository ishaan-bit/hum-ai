import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion, computeRobustStats } from "@hum-ai/shared-types";
import { zeroStateScores, type MultiHeadAffectInference } from "@hum-ai/affect-model-contracts";
import { applyPersonalization, stagePolicy } from "@hum-ai/personalization-engine";

function prior(): MultiHeadAffectInference {
  const states = zeroStateScores();
  states.sadness_low_mood = 0.6;
  states.neutral_close_to_usual = 0.1;
  return {
    modelVersion: asModelVersion("v2-test"),
    dimensional: { valence: -0.6, arousal: -0.3 },
    states,
    relapseDrift: 0,
    recoveryWorseningUnchanged: null,
    uncertainty: 0.4,
    confidence: {
      rawConfidence: 0.6,
      confidence: 0.6,
      confidencePercent: 60,
      appliedCap: 0.82,
      capReason: "test",
      abstained: false,
      abstainReason: "none",
    },
    abstained: false,
    abstainReason: "none",
    recommendedIntervention: null,
  };
}

const stableBaseline = (feature: string) => ({ [feature]: computeRobustStats(Array.from({ length: 30 }, () => 1)) });

test("v2: a deviation only on a LOW-salience feature still reads as the user's usual", () => {
  const baseline = {
    informative: computeRobustStats(Array.from({ length: 30 }, () => 100)),
    noise: computeRobustStats(Array.from({ length: 30 }, () => 50)),
  };
  const { application } = applyPersonalization(prior(), { informative: 0, noise: 4 }, stagePolicy(30), {
    model: { salience: { informative: 1, noise: 0 }, baseline },
  });
  assert.equal(application.applied, true);
  assert.ok(application.selfNormality > 0.95, "the non-salient deviation is ignored → reads as usual");
  assert.ok(application.pull > 0.4, "so the read is strongly re-referenced toward the user's neutral");
});

test("v2 surfaces top contributors; v1 (no model context) omits them", () => {
  const baseline = { a: computeRobustStats(Array.from({ length: 30 }, () => 1)), b: computeRobustStats(Array.from({ length: 30 }, () => 1)) };
  const withModel = applyPersonalization(prior(), { a: 0.1, b: 3 }, stagePolicy(30), { model: { baseline } });
  assert.ok(withModel.application.topContributors?.[0]?.feature === "b");
  const noModel = applyPersonalization(prior(), { a: 0.1, b: 3 }, stagePolicy(30));
  assert.equal(noModel.application.topContributors, undefined);
});

test("v2: a recently-detected regime shift strengthens the re-reference", () => {
  const model = { baseline: stableBaseline("a") };
  const z = { a: 0 }; // on baseline
  const base = applyPersonalization(prior(), z, stagePolicy(30), { model }).application.pull;
  const shifted = applyPersonalization(prior(), z, stagePolicy(30), {
    model: { ...model, regimeShift: "up" },
  }).application.pull;
  assert.ok(shifted > base, "regime-aware adaptation increases the pull after a detected shift");
});

test("v2 stays inactive at cold start (population prior owns the read)", () => {
  const { application, inference } = applyPersonalization(prior(), { a: 0 }, stagePolicy(1), {
    model: { baseline: stableBaseline("a") },
  });
  assert.equal(application.applied, false);
  assert.equal(inference.dimensional.valence, prior().dimensional.valence);
});
