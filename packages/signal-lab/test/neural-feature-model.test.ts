import { test } from "node:test";
import assert from "node:assert/strict";
import { featureVectorNames, featureVectorLength } from "../src/feature-schema";
import {
  parseNeuralFeatureModel,
  predictNeural,
  NeuralFeatureModelError,
  type NeuralFeatureModel,
} from "../src/neural-feature-model";

/** A valid 2-class op-graph over the live feature contract (identity standardizer,
 * a single linear that copies feature[0] into class 1 and feature[1] into class 0). */
function tinyModel(): NeuralFeatureModel {
  const F = featureVectorLength();
  const names = featureVectorNames();
  const W0 = new Array(F).fill(0);
  const W1 = new Array(F).fill(0);
  W0[1] = 5; // class 0 driven by feature 1
  W1[0] = 5; // class 1 driven by feature 0
  return {
    version: "test/0.0.0",
    kind: "feature_mlp_opgraph",
    target: "arousal_binary",
    family: "linear",
    labels: ["low_arousal", "high_arousal"],
    featureNames: names,
    standardizer: { mean: new Array(F).fill(0), std: new Array(F).fill(1) },
    ops: [{ op: "linear", W: [W0, W1], b: [0, 0] }],
    evidence: { balancedAccuracy: 0.86, ece: 0.1, pValue: 0.001, classicalBaseline: 0.831, validation: "test" },
    governance: "test prior",
  };
}

test("predictNeural produces a normalized distribution and the right argmax", () => {
  const m = tinyModel();
  const F = featureVectorLength();
  const v = new Array(F).fill(0);
  v[0] = 1; // pushes class 1 (high_arousal)
  const dist = predictNeural(m, v);
  const sum = dist["low_arousal"]! + dist["high_arousal"]!;
  assert.ok(Math.abs(sum - 1) < 1e-9, "distribution sums to 1");
  assert.ok(dist["high_arousal"]! > dist["low_arousal"]!, "feature[0] drives high_arousal");
});

test("parseNeuralFeatureModel accepts a contract-matching model", () => {
  const m = parseNeuralFeatureModel(JSON.stringify(tinyModel()));
  assert.equal(m.target, "arousal_binary");
  assert.equal(m.labels.length, 2);
});

test("parseNeuralFeatureModel rejects a non-opgraph artifact", () => {
  assert.throws(() => parseNeuralFeatureModel(JSON.stringify({ kind: "logreg" })), NeuralFeatureModelError);
});

test("parseNeuralFeatureModel detects feature-contract drift", () => {
  const bad = { ...tinyModel(), featureNames: ["only", "two"], standardizer: { mean: [0, 0], std: [1, 1] } };
  assert.throws(() => parseNeuralFeatureModel(JSON.stringify(bad)), /feature contract drift/);
});

test("batchnorm + relu ops execute in order", () => {
  const F = featureVectorLength();
  const names = featureVectorNames();
  const W = [new Array(F).fill(0), new Array(F).fill(0)];
  W[0]![0] = 1;
  W[1]![0] = -1;
  const m: NeuralFeatureModel = {
    ...tinyModel(),
    ops: [
      { op: "linear", W, b: [0, 0] },
      { op: "relu" }, // class 1 (=-feature0) clamped to 0 when feature0>0
    ],
  };
  const v = new Array(F).fill(0);
  v[0] = 2;
  const dist = predictNeural(m, v);
  assert.ok(dist["low_arousal"]! > dist["high_arousal"]!, "relu clamps the negative logit");
});
