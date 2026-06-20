import { test } from "node:test";
import assert from "node:assert/strict";
import { FUSION_LABELS, type ExpertOutput, type FusionLabel } from "@hum-ai/affect-model-contracts";
import {
  LogisticRegressionMetaLearner,
  StubWeightedMetaLearner,
  fitMetaLearner,
  metaFeatureVector,
  argmax,
  type MetaLearnerSample,
} from "../src/meta-learner";

function expert(id: string, top: FusionLabel, peak = 0.8): ExpertOutput {
  const probabilities: Record<string, number> = {};
  const rest = (1 - peak) / (FUSION_LABELS.length - 1);
  for (const l of FUSION_LABELS) probabilities[l] = l === top ? peak : rest;
  return { expertId: id, modality: "audio", available: true, probabilities, selfConfidence: 0.3, domainMatch: 0.6, oodScore: 0.4 };
}

const ORDER = ["a", "b"];

test("metaFeatureVector concatenates expert blocks in order, zero-block for missing", () => {
  const v = metaFeatureVector([expert("a", "calm_regulated")], ORDER);
  assert.equal(v.length, ORDER.length * FUSION_LABELS.length);
  // The second expert ("b") is absent → its block is all zeros.
  const block = FUSION_LABELS.length;
  for (let j = block; j < 2 * block; j++) assert.equal(v[j], 0);
});

test("an untrained meta-learner throws; the stub fallback always works", () => {
  assert.throws(() => new LogisticRegressionMetaLearner().combine([expert("a", "calm_regulated")]), /untrained/i);
  const stub = new StubWeightedMetaLearner().combine([expert("a", "calm_regulated")]);
  const total = FUSION_LABELS.reduce((s, l) => s + stub[l], 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("the forward pass produces a valid distribution and respects the trained weights", () => {
  // Hand-built params: bias favors class 0; one weight ties feature 0 (expert a, label 0) to class 0.
  const K = FUSION_LABELS.length;
  const D = ORDER.length * K;
  const weights = Array.from({ length: K }, () => new Array(D).fill(0));
  weights[0]![0] = 5; // class 0 fires when expert "a" assigns mass to FUSION_LABELS[0]
  const bias = new Array(K).fill(0);
  const ml = new LogisticRegressionMetaLearner({ expertOrder: ORDER, weights, bias });
  const dist = ml.combine([expert("a", FUSION_LABELS[0]!, 0.9)]);
  const total = FUSION_LABELS.reduce((s, l) => s + dist[l], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "softmax output sums to 1");
  assert.equal(argmax(dist).label, FUSION_LABELS[0], "the trained weight drives the argmax");
});

test("fitMetaLearner learns a separable expert→label mapping", () => {
  // Label is "positive_activation" when expert a leans positive, else "low_mood".
  const samples: MetaLearnerSample[] = [];
  for (let i = 0; i < 24; i++) {
    const positive = i % 2 === 0;
    samples.push({
      experts: [expert("a", positive ? "positive_activation" : "low_mood", 0.85), expert("b", "neutral_close_to_usual", 0.5)],
      label: positive ? "positive_activation" : "low_mood",
    });
  }
  const params = fitMetaLearner(samples, { expertOrder: ORDER, iterations: 300 });
  assert.equal(params.trainCount, 24);
  assert.equal(params.expertOrder.length, 2);

  const ml = new LogisticRegressionMetaLearner(params);
  assert.equal(argmax(ml.combine([expert("a", "positive_activation", 0.85)])).label, "positive_activation");
  assert.equal(argmax(ml.combine([expert("a", "low_mood", 0.85)])).label, "low_mood");
});

test("fit defaults the expert order to the first sample's experts", () => {
  const samples: MetaLearnerSample[] = [
    { experts: [expert("a", "calm_regulated"), expert("b", "tense_anxious")], label: "calm_regulated" },
    { experts: [expert("a", "tense_anxious"), expert("b", "calm_regulated")], label: "tense_anxious" },
  ];
  const params = fitMetaLearner(samples, { iterations: 50 });
  assert.deepEqual(params.expertOrder, ["a", "b"]);
});
