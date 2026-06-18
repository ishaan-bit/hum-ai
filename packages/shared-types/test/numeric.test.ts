import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, clamp01, median, percentile, normalize } from "@hum-ai/shared-types";

test("clamp bounds values and handles NaN", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp(Number.NaN, 0, 10), 0);
});

test("median and percentile interpolate", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.75), 3.25);
});

test("normalize clamps to unit interval", () => {
  assert.equal(normalize(5, 0, 10), 0.5);
  assert.equal(normalize(-5, 0, 10), 0);
  assert.equal(normalize(50, 0, 10), 1);
});
