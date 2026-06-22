import { test } from "node:test";
import assert from "node:assert/strict";
import { softmax, makeRng, finiteOr, normalizeDistribution } from "@hum-ai/shared-types";

test("softmax sums to 1, is shift-stable, and handles empty/degenerate input", () => {
  const p = softmax([1, 2, 3]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  // shift-invariant: adding a constant to every logit leaves the distribution unchanged
  const shifted = softmax([1001, 1002, 1003]);
  for (let i = 0; i < p.length; i++) assert.ok(Math.abs(p[i]! - shifted[i]!) < 1e-9);
  assert.deepEqual(softmax([0, 0]), [0.5, 0.5]);
  assert.deepEqual(softmax([]), []);
});

test("makeRng is deterministic per seed and yields values in [0, 1)", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  // a different seed diverges
  assert.notEqual(makeRng(1)(), makeRng(2)());
});

test("finiteOr returns finite values, falls back on NaN/Infinity/null/undefined", () => {
  assert.equal(finiteOr(3.5, 0), 3.5);
  assert.equal(finiteOr(0, 9), 0);
  assert.equal(finiteOr(Number.NaN, 9), 9);
  assert.equal(finiteOr(Infinity, 9), 9);
  assert.equal(finiteOr(-Infinity, 9), 9);
  assert.equal(finiteOr(null, 9), 9);
  assert.equal(finiteOr(undefined, 9), 9);
});

test("normalizeDistribution L1-normalizes with uniform and custom fallback", () => {
  assert.deepEqual(normalizeDistribution({ a: 2, b: 2 }, ["a", "b"]), { a: 0.5, b: 0.5 });
  // negatives are floored at 0 before normalizing
  assert.deepEqual(normalizeDistribution({ a: 3, b: -1 }, ["a", "b"]), { a: 1, b: 0 });
  // all non-positive → uniform fallback
  assert.deepEqual(normalizeDistribution({ a: 0, b: 0 }, ["a", "b"]), { a: 0.5, b: 0.5 });
  // all non-positive → custom fallback
  assert.deepEqual(
    normalizeDistribution({ a: 0, b: 0 }, ["a", "b"], (k) => (k === "a" ? 1 : 0)),
    { a: 1, b: 0 },
  );
});
