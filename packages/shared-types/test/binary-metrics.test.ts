import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryMetricsAtThreshold, reliabilityDiagram, rocAuc } from "../src/metrics";

test("rocAuc = 1 for perfect separation, 0 for perfectly reversed", () => {
  const pos = [false, false, true, true];
  assert.equal(rocAuc(pos, [0.1, 0.2, 0.8, 0.9]), 1);
  assert.equal(rocAuc(pos, [0.9, 0.8, 0.2, 0.1]), 0);
});

test("rocAuc handles ties with average ranks (0.5 when indistinguishable)", () => {
  assert.equal(rocAuc([true, false], [0.5, 0.5]), 0.5);
});

test("rocAuc is NaN when a class is empty (undefined, surfaced honestly)", () => {
  assert.ok(Number.isNaN(rocAuc([true, true], [0.3, 0.7])));
  assert.ok(Number.isNaN(rocAuc([], [])));
});

test("binaryMetricsAtThreshold computes the confusion-derived operating point", () => {
  // pos = [T,T,F,F], score = [.9,.4,.6,.1], threshold .5 → pred = [T,F,T,F]
  const m = binaryMetricsAtThreshold([true, true, false, false], [0.9, 0.4, 0.6, 0.1], 0.5);
  assert.equal(m.tp, 1);
  assert.equal(m.fn, 1);
  assert.equal(m.fp, 1);
  assert.equal(m.tn, 1);
  assert.equal(m.sensitivity, 0.5);
  assert.equal(m.specificity, 0.5);
  assert.equal(m.ppv, 0.5);
  assert.equal(m.npv, 0.5);
  assert.equal(m.youdenJ, 0);
});

test("a perfectly-calibrated split has ECE ~0; a confidently-wrong one is large", () => {
  // 10 rows all scored 0.5 with exactly half positive → the bin's observed rate equals its score.
  const pos = [true, false, true, false, true, false, true, false, true, false];
  const calibrated = reliabilityDiagram(pos, pos.map(() => 0.5), 10);
  assert.ok(calibrated.ece < 1e-9);
  // High-confidence (0.95) but all negative → confidently wrong, large ECE.
  const wrong = reliabilityDiagram([false, false, false, false], [0.95, 0.95, 0.95, 0.95], 10);
  assert.ok(wrong.ece > 0.5);
});
