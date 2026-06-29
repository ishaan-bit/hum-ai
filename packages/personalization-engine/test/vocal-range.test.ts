import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVocalRange, vocalRangeActive, featureRangePosition, VOCAL_RANGE_MIN_HUMS } from "../src/vocal-range";

function windows(n: number): Record<string, number[]> {
  // meanRms spans 0.02…0.14 over n eligible hums; pitchMeanHz spans 120…200.
  return {
    meanRms: Array.from({ length: n }, (_, i) => 0.02 + (0.12 * i) / Math.max(1, n - 1)),
    pitchMeanHz: Array.from({ length: n }, (_, i) => 120 + (80 * i) / Math.max(1, n - 1)),
  };
}

test("buildVocalRange produces a per-feature robust range from the windows", () => {
  const r = buildVocalRange(windows(20));
  assert.ok(r.meanRms && r.meanRms.n === 20);
  assert.ok(r.meanRms!.span > 0.05, "loudness span is captured");
  assert.ok(r.pitchMeanHz!.span > 40, "pitch span is captured");
});

test("the range is not trusted until enough hums have arrived", () => {
  assert.equal(vocalRangeActive(buildVocalRange(windows(VOCAL_RANGE_MIN_HUMS - 1))), false);
  assert.equal(vocalRangeActive(buildVocalRange(windows(VOCAL_RANGE_MIN_HUMS))), true);
});

test("featureRangePosition places a value in the user's own range, gated on maturity", () => {
  const thin = buildVocalRange(windows(VOCAL_RANGE_MIN_HUMS - 1));
  assert.equal(featureRangePosition("meanRms", 0.08, thin), null, "sub-threshold range ⇒ null (fall back)");

  const mature = buildVocalRange(windows(30));
  const low = featureRangePosition("meanRms", 0.02, mature);
  const high = featureRangePosition("meanRms", 0.14, mature);
  assert.ok(low !== null && low < 0.2, `bottom of range → near 0 (got ${low})`);
  assert.ok(high !== null && high > 0.8, `top of range → near 1 (got ${high})`);
  assert.equal(featureRangePosition("unseenFeature", 1, mature), null, "unknown feature ⇒ null");
});
