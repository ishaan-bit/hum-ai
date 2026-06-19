import { test } from "node:test";
import assert from "node:assert/strict";
import { signatureAlignment, updateSignatureCentroid } from "@hum-ai/personalization-engine";

test("a signature centroid seeds new features and EMA-nudges existing ones slowly", () => {
  const seeded = updateSignatureCentroid({}, { pitchMeanHz: 2, meanRms: -1 });
  assert.equal(seeded.pitchMeanHz, 2); // first observation seeds directly
  assert.equal(seeded.meanRms, -1);

  const nudged = updateSignatureCentroid(seeded, { pitchMeanHz: 4 }, 0.15);
  // moves toward 4 but only by alpha — slow, drift-resistant.
  assert.ok(nudged.pitchMeanHz! > 2 && nudged.pitchMeanHz! < 2.5);
  assert.equal(nudged.meanRms, -1); // untouched feature unchanged
});

test("non-finite observations are ignored", () => {
  const out = updateSignatureCentroid({ a: 1 }, { a: Number.NaN, b: Number.POSITIVE_INFINITY });
  assert.equal(out.a, 1);
  assert.equal(out.b, undefined);
});

test("alignment is +1 for the same direction, −1 for the opposite, 0 with no shared support", () => {
  const sig = { a: 1, b: 2, c: -1 };
  assert.ok(signatureAlignment({ a: 2, b: 4, c: -2 }, sig) > 0.999); // same direction, scaled
  assert.ok(signatureAlignment({ a: -1, b: -2, c: 1 }, sig) < -0.999); // opposite
  assert.equal(signatureAlignment({ x: 5, y: 9 }, sig), 0); // no shared features
  assert.equal(signatureAlignment({}, sig), 0);
});
