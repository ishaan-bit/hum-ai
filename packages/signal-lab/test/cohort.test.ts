import { test } from "node:test";
import assert from "node:assert/strict";
import {
  logRegSpec,
  nearestCentroidSpec,
  gaussianNbSpec,
  knnSpec,
  decisionTreeSpec,
  randomForestSpec,
  ensembleSpec,
  defaultCohort,
  type CohortModelSpec,
} from "../src/cohort";

const LABELS = ["low_arousal", "high_arousal"];
const FEATURES = ["a", "b", "c"];

/** Two linearly-separable clusters on feature `a` (+ noise columns). */
function separable(n = 60): { X: number[][]; y: string[] } {
  const X: number[][] = [];
  const y: string[] = [];
  for (let i = 0; i < n; i++) {
    X.push([2 + (i % 5) * 0.05, (i % 3) * 0.1, -1]);
    y.push("low_arousal");
    X.push([-2 - (i % 5) * 0.05, (i % 3) * 0.1, 1]);
    y.push("high_arousal");
  }
  return { X, y };
}

const SPECS: CohortModelSpec[] = [
  logRegSpec(),
  nearestCentroidSpec,
  gaussianNbSpec,
  knnSpec(5),
  decisionTreeSpec({ maxDepth: 4 }),
  randomForestSpec({ trees: 6, maxDepth: 4 }),
  ensembleSpec([logRegSpec(), gaussianNbSpec]),
];

test("every cohort model returns a valid probability distribution over the labels", () => {
  const { X, y } = separable();
  for (const spec of SPECS) {
    const model = spec.train(X, y, LABELS, FEATURES);
    const dist = model.predictProba([3, 0, -1]);
    const keys = Object.keys(dist).sort();
    assert.deepEqual(keys, [...LABELS].sort(), `${spec.name} label set`);
    const sum = Object.values(dist).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `${spec.name} sums to 1 (got ${sum})`);
    for (const v of Object.values(dist)) assert.ok(v >= 0 && Number.isFinite(v), `${spec.name} finite ≥0`);
  }
});

test("every cohort model learns an easy separable boundary", () => {
  const { X, y } = separable();
  for (const spec of SPECS) {
    const model = spec.train(X, y, LABELS, FEATURES);
    const lowDist = model.predictProba([3, 0, -1]);
    const highDist = model.predictProba([-3, 0, 1]);
    assert.ok(lowDist["low_arousal"]! > lowDist["high_arousal"]!, `${spec.name} predicts low`);
    assert.ok(highDist["high_arousal"]! > highDist["low_arousal"]!, `${spec.name} predicts high`);
  }
});

test("models are deterministic (seeded) — identical retraining gives identical output", () => {
  const { X, y } = separable();
  for (const spec of [decisionTreeSpec({ maxDepth: 4 }), randomForestSpec({ trees: 6, maxDepth: 4 }), knnSpec(5)]) {
    const a = spec.train(X, y, LABELS, FEATURES).predictProba([1, 0.2, 0]);
    const b = spec.train(X, y, LABELS, FEATURES).predictProba([1, 0.2, 0]);
    assert.deepEqual(a, b, `${spec.name} deterministic`);
  }
});

test("defaultCohort spans distinct model families", () => {
  const families = new Set(defaultCohort().map((s) => s.family));
  for (const f of ["linear", "prototype", "probabilistic", "instance", "tree", "ensemble"]) {
    assert.ok(families.has(f), `cohort missing family ${f}`);
  }
});
