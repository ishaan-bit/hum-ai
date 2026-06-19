import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trainLogReg,
  predictTop,
  predictProba,
  featureContributions,
  serializeModel,
  deserializeModel,
} from "../src/model";

const FEATURES = ["a", "b", "c"];

/** Two linearly-separable clusters on feature `a`. */
function makeSeparable(): { X: number[][]; y: string[] } {
  const X: number[][] = [];
  const y: string[] = [];
  for (let i = 0; i < 30; i++) {
    X.push([2 + (i % 3) * 0.1, 0, 0]);
    y.push("calm_regulated");
    X.push([-2 - (i % 3) * 0.1, 0, 0]);
    y.push("high_arousal_negative");
  }
  return { X, y };
}

test("logreg learns a separable boundary", () => {
  const { X, y } = makeSeparable();
  const model = trainLogReg(X, y, { labels: ["calm_regulated", "high_arousal_negative"], featureNames: FEATURES });
  assert.equal(predictTop(model, [3, 0, 0]).label, "calm_regulated");
  assert.equal(predictTop(model, [-3, 0, 0]).label, "high_arousal_negative");
  const dist = predictProba(model, [3, 0, 0]);
  const sum = Object.values(dist).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, "distribution sums to 1");
});

test("serialize/deserialize preserves predictions", () => {
  const { X, y } = makeSeparable();
  const model = trainLogReg(X, y, { labels: ["calm_regulated", "high_arousal_negative"], featureNames: FEATURES });
  const back = deserializeModel(serializeModel(model));
  assert.deepEqual(predictProba(back, [1.5, 0, 0]), predictProba(model, [1.5, 0, 0]));
});

test("class weighting keeps a rare class learnable", () => {
  const X: number[][] = [];
  const y: string[] = [];
  for (let i = 0; i < 100; i++) {
    X.push([1, 0, 0]);
    y.push("calm_regulated");
  }
  for (let i = 0; i < 8; i++) {
    X.push([-1, 0, 0]);
    y.push("low_mood");
  }
  const model = trainLogReg(X, y, {
    labels: ["calm_regulated", "low_mood"],
    featureNames: FEATURES,
    classWeighted: true,
  });
  assert.equal(predictTop(model, [-1, 0, 0]).label, "low_mood");
});

test("featureContributions are sorted by magnitude and reference real feature names", () => {
  const { X, y } = makeSeparable();
  const model = trainLogReg(X, y, { labels: ["calm_regulated", "high_arousal_negative"], featureNames: FEATURES });
  const contribs = featureContributions(model, [3, 0, 0], "calm_regulated");
  assert.equal(contribs.length, FEATURES.length);
  for (let i = 1; i < contribs.length; i++) {
    assert.ok(Math.abs(contribs[i - 1]!.contribution) >= Math.abs(contribs[i]!.contribution));
  }
  for (const c of contribs) assert.ok(FEATURES.includes(c.feature));
});

test("deserializeModel rejects malformed JSON", () => {
  assert.throws(() => deserializeModel(JSON.stringify({ nope: true })));
});
