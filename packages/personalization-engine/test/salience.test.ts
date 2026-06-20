import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRobustStats } from "@hum-ai/shared-types";
import { coverageWeight, seriesCorrelation, redundancyDiscount, featureSalience } from "@hum-ai/personalization-engine";

test("coverageWeight grows with sample count: n/(n+K)", () => {
  assert.equal(coverageWeight(0), 0);
  assert.ok(coverageWeight(6) > 0.49 && coverageWeight(6) < 0.51); // K=6 ⇒ half-weight at n=6
  assert.ok(coverageWeight(60) > coverageWeight(6));
});

test("seriesCorrelation: identical→+1, opposite→−1, constant→0", () => {
  const a = [1, 2, 3, 4, 5];
  assert.ok(seriesCorrelation(a, a) > 0.999);
  assert.ok(seriesCorrelation(a, [5, 4, 3, 2, 1]) < -0.999);
  assert.equal(seriesCorrelation(a, [2, 2, 2, 2, 2]), 0); // no variance ⇒ undefined ⇒ 0
});

test("redundancyDiscount down-weights correlated features, keeps independent ones at 1", () => {
  const windows = {
    loudA: [1, 2, 3, 4, 5, 6],
    loudB: [2, 4, 6, 8, 10, 12], // perfectly correlated with loudA
    indep: [3, 1, 4, 1, 5, 9],
  };
  const disc = redundancyDiscount(windows);
  assert.ok(disc.loudA! < 1 && disc.loudB! < 1, "redundant features are discounted");
  assert.ok(disc.indep! >= disc.loudA!, "an independent feature retains more weight");
});

test("featureSalience rewards well-evidenced features", () => {
  const baseline = {
    a: computeRobustStats(Array.from({ length: 30 }, (_, i) => i)), // high n
    b: computeRobustStats([1, 2]), // thin
  };
  const sal = featureSalience(baseline);
  assert.ok(sal.a! > sal.b!, "more-evidenced feature is more salient");
});
