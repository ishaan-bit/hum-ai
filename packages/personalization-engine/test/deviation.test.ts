import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRobustStats } from "@hum-ai/shared-types";
import { personalDeviationV2 } from "@hum-ai/personalization-engine";

test("on-baseline → selfNormality≈1; uniformly far → low selfNormality", () => {
  assert.ok(personalDeviationV2({ a: 0, b: 0, c: 0 }).selfNormality > 0.99);
  assert.ok(personalDeviationV2({ a: 3, b: 3, c: 3 }).selfNormality < 0.2);
});

test("winsorization stops a single degenerate feature from exploding the read", () => {
  const d = personalDeviationV2({ a: 0, b: 0, c: 1000 }, { winsorZ: 4 });
  assert.ok(d.magnitude < 2, `degenerate spike capped (got ${d.magnitude})`);
});

test("salience focuses the read on informative axes — a deviation on a 0-salience feature is ignored", () => {
  const d = personalDeviationV2(
    { informative: 0, noise: 4 },
    { salience: { informative: 1, noise: 0 } },
  );
  assert.ok(d.selfNormality > 0.99, "deviation only on a non-salient feature reads as usual");
  assert.equal(d.support, 1); // the zero-salience feature is not counted
});

test("top contributors surface what drove the deviation", () => {
  const d = personalDeviationV2({ a: 0.2, big: 3, c: 0.1 });
  assert.equal(d.topContributors[0]!.feature, "big");
});

test("effectiveEvidence reflects per-feature sample counts", () => {
  const lowN = personalDeviationV2({ a: 1 }, { baseline: { a: computeRobustStats([1, 2]) } });
  const highN = personalDeviationV2(
    { a: 1 },
    { baseline: { a: computeRobustStats(Array.from({ length: 50 }, (_, i) => i)) } },
  );
  assert.ok(highN.effectiveEvidence > lowN.effectiveEvidence);
});
