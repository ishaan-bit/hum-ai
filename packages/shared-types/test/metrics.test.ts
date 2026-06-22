import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accuracyOf,
  balancedAccuracy,
  perClassMetrics,
  confusionMatrix,
  expectedCalibrationError,
  groupFolds,
} from "@hum-ai/shared-types";

test("accuracyOf is top-1 accuracy, 0 on empty", () => {
  assert.equal(accuracyOf(["a", "b", "c"], ["a", "b", "x"]), 2 / 3);
  assert.equal(accuracyOf([], []), 0);
});

test("balancedAccuracy is mean per-class recall over classes with support", () => {
  // class a: 2/2 recalled; class b: 1/2 recalled → (1 + 0.5) / 2
  const ba = balancedAccuracy(["a", "a", "b", "b"], ["a", "a", "b", "a"], ["a", "b"]);
  assert.equal(ba, 0.75);
  // a class with no support is skipped (not counted as 0)
  assert.equal(balancedAccuracy(["a", "a"], ["a", "a"], ["a", "b"]), 1);
});

test("perClassMetrics computes precision/recall/f1/support", () => {
  const m = perClassMetrics(["a", "a", "b"], ["a", "b", "b"], ["a", "b"]);
  const a = m.find((x) => x.label === "a")!;
  assert.equal(a.support, 2);
  assert.equal(a.precision, 1); // 1 predicted a, all correct
  assert.equal(a.recall, 0.5); // 1 of 2 true a recalled
});

test("confusionMatrix is row-true × col-pred", () => {
  const { labels, matrix } = confusionMatrix(["a", "b"], ["a", "a"], ["a", "b"]);
  assert.deepEqual(labels, ["a", "b"]);
  assert.deepEqual(matrix, [
    [1, 0], // true a → pred a
    [1, 0], // true b → pred a
  ]);
});

test("expectedCalibrationError is 0 when confident+correct, and guards bin index", () => {
  assert.equal(expectedCalibrationError(["a"], ["a"], [1]), 0);
  // top prob 0 must not index bin -1 (the Math.max(0,…) guard); just assert it returns finite
  const ece = expectedCalibrationError(["a", "b"], ["a", "a"], [0, 0.95]);
  assert.ok(Number.isFinite(ece) && ece >= 0 && ece <= 1);
});

test("groupFolds keeps a group within one fold (round-robin over sorted groups)", () => {
  const samples = [
    { group: "g1" },
    { group: "g2" },
    { group: "g1" },
    { group: "g3" },
  ];
  const folds = groupFolds(samples, 2);
  // both g1 rows (indices 0 and 2) land in the same fold
  assert.equal(folds[0], folds[2]);
  for (const f of folds) assert.ok(f >= 0 && f < 2);
});
