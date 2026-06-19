import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion } from "@hum-ai/shared-types";
import { zeroStateScores, type MultiHeadAffectInference } from "@hum-ai/affect-model-contracts";
import {
  applyPersonalization,
  personalDeviation,
  personalizationWeight,
  stagePolicy,
} from "@hum-ai/personalization-engine";

const onBaseline = (n: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, 0]));

const farFromBaseline = (n: number, z = 3): Record<string, number> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, z]));

function priorInference(over: Partial<MultiHeadAffectInference> = {}): MultiHeadAffectInference {
  const states = zeroStateScores();
  states.sadness_low_mood = 0.6;
  states.depressive_affect_markers = 0.5;
  states.joy_positive_activation = 0.6; // non-risk peer for the "damped equally" check
  states.neutral_close_to_usual = 0.1;
  return {
    modelVersion: asModelVersion("personalize-test"),
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
    ...over,
  };
}

test("personalization weight is 0 until the baseline is active, then rises up the ladder", () => {
  assert.equal(personalizationWeight(stagePolicy(1)), 0); // population_prior
  assert.equal(personalizationWeight(stagePolicy(3)), 0); // early_calibration
  const baseline = personalizationWeight(stagePolicy(7)); // personal_baseline
  const fusion = personalizationWeight(stagePolicy(15)); // personalized_fusion
  const relapse = personalizationWeight(stagePolicy(30)); // relapse_model
  assert.ok(baseline > 0 && fusion > baseline && relapse > fusion, "weight rises monotonically once active");
});

test("personalDeviation: on-baseline → selfNormality≈1, far → selfNormality→0, empty → support 0", () => {
  const near = personalDeviation(onBaseline(10));
  assert.ok(near.selfNormality > 0.99 && near.support === 10);
  const far = personalDeviation(farFromBaseline(10, 3));
  assert.ok(far.selfNormality < 0.2 && far.support === 10);
  const empty = personalDeviation({});
  assert.equal(empty.support, 0);
  assert.equal(empty.selfNormality, 1); // nothing to compare ⇒ no pull (caller checks support)
});

test("cold start passes the population prior through untouched", () => {
  const prior = priorInference();
  const { inference, application } = applyPersonalization(prior, onBaseline(10), stagePolicy(1));
  assert.equal(application.applied, false);
  assert.equal(inference, prior); // same reference — no re-referencing at all
});

test("an abstained read is never personalized", () => {
  const prior = priorInference({ abstained: true, abstainReason: "poor_capture_quality" });
  const { application, inference } = applyPersonalization(prior, onBaseline(10), stagePolicy(30));
  assert.equal(application.applied, false);
  assert.equal(inference, prior);
});

test("a hum that matches the user's usual is re-referenced toward their neutral", () => {
  const prior = priorInference();
  const { inference, application } = applyPersonalization(prior, onBaseline(10), stagePolicy(30));
  assert.equal(application.applied, true);
  assert.ok(application.pull > 0.5, "mature stage + on-baseline ⇒ strong pull");

  // Dimensional pulled toward the user's neutral (origin).
  assert.ok(Math.abs(inference.dimensional.valence) < Math.abs(prior.dimensional.valence));
  assert.ok(Math.abs(inference.dimensional.arousal) < Math.abs(prior.dimensional.arousal));
  // "Close to your usual" rises; population activations damp.
  assert.ok(inference.states.neutral_close_to_usual > prior.states.neutral_close_to_usual);
  assert.ok(inference.states.sadness_low_mood < prior.states.sadness_low_mood);
  assert.ok(inference.states.depressive_affect_markers < prior.states.depressive_affect_markers);
});

test("a hum that departs from the user's baseline preserves the population prior", () => {
  const prior = priorInference();
  const { inference, application } = applyPersonalization(prior, farFromBaseline(10, 3), stagePolicy(30));
  assert.equal(application.applied, true);
  assert.ok(application.pull < 0.15, "far-from-baseline ⇒ weak pull");
  // The negative read survives — a genuine personal change is not smoothed away.
  assert.ok(Math.abs(inference.dimensional.valence) > 0.5);
  assert.ok(inference.states.depressive_affect_markers > 0.4);
});

test("risk markers are damped by the SAME factor as non-risk peers — never selectively hidden", () => {
  const prior = priorInference();
  const { inference } = applyPersonalization(prior, onBaseline(10), stagePolicy(30));
  // sadness_low_mood (risk marker) and joy_positive_activation (benign) started equal (0.6).
  assert.ok(
    Math.abs(inference.states.sadness_low_mood - inference.states.joy_positive_activation) < 1e-9,
    "equal priors damp to equal posteriors",
  );
});

test("thin per-feature coverage scales personalization down", () => {
  const prior = priorInference();
  const thin = applyPersonalization(prior, onBaseline(1), stagePolicy(30)).application;
  const full = applyPersonalization(prior, onBaseline(10), stagePolicy(30)).application;
  assert.ok(thin.pull < full.pull, "1-feature coverage pulls far less than full coverage");
});
