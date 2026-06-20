import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceWeight, evidenceWeightVarianceAware, shrinkTowardPrior } from "@hum-ai/personalization-engine";

test("evidenceWeight n/(n+K): 0 at n=0, rises monotonically toward 1", () => {
  assert.equal(evidenceWeight(0), 0);
  assert.ok(evidenceWeight(5) > 0.49 && evidenceWeight(5) < 0.51); // K=5 ⇒ half at n=5
  assert.ok(evidenceWeight(20) > evidenceWeight(5));
  assert.ok(evidenceWeight(500) > 0.95);
});

test("variance-aware weighting shrinks noisier features harder", () => {
  assert.ok(evidenceWeightVarianceAware(10, 0) > evidenceWeightVarianceAware(10, 3));
});

test("shrinkTowardPrior blends personal vs prior by the personal weight", () => {
  assert.equal(shrinkTowardPrior(10, 0, 0), 0); // no evidence ⇒ all prior
  assert.equal(shrinkTowardPrior(10, 0, 1), 10); // full evidence ⇒ all personal
  assert.equal(shrinkTowardPrior(10, 0, 0.5), 5);
});
