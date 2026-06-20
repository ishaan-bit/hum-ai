import { test } from "node:test";
import assert from "node:assert/strict";
import { theilSenSlope, mannKendall, estimateTrend, cusumDrift, type SeriesPoint } from "../src/trend";

function series(values: number[]): SeriesPoint[] {
  return values.map((v, i) => ({ t: i, value: v }));
}

test("Theil–Sen recovers a clean slope and resists an outlier", () => {
  const clean = series([0, 1, 2, 3, 4, 5]);
  assert.ok(Math.abs(theilSenSlope(clean) - 1) < 1e-9);
  // One wild outlier should not swing the median-of-slopes much (vs OLS, which would).
  const withOutlier = series([0, 1, 2, 50, 4, 5]);
  assert.ok(Math.abs(theilSenSlope(withOutlier) - 1) < 0.6, `robust slope: ${theilSenSlope(withOutlier)}`);
});

test("Mann–Kendall flags a monotonic rise as significant, flat as not", () => {
  const rising = mannKendall([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(rising.direction, "rising");
  assert.ok(rising.tau > 0.9);
  assert.equal(rising.significant, true);

  const flat = mannKendall([3, 3.1, 2.9, 3.0, 3.05, 2.95]);
  assert.equal(flat.significant, false);
});

test("estimateTrend earns confidence only from a significant trend with enough points", () => {
  const rising = estimateTrend(series([0.1, 0.2, 0.3, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9]));
  assert.equal(rising.direction, "rising");
  assert.equal(rising.significant, true);
  assert.ok(rising.confidence > 0);

  const tooShort = estimateTrend(series([0.2, 0.6]));
  assert.equal(tooShort.significant, false);
  assert.equal(tooShort.confidence, 0);

  const noisy = estimateTrend(series([0.5, 0.49, 0.51, 0.5, 0.52, 0.48]));
  assert.equal(noisy.confidence, 0); // not significant → no earned confidence
});

test("estimateTrend collapses a tiny slope to flat under flatSlopeEps", () => {
  const t = estimateTrend(series([0.50, 0.501, 0.502, 0.503, 0.504, 0.505]), { flatSlopeEps: 0.01 });
  assert.equal(t.direction, "flat");
});

test("CUSUM detects a sustained upward shift and its onset, ignores noise", () => {
  const shift = cusumDrift([0.2, 0.21, 0.19, 0.2, 0.7, 0.72, 0.71, 0.73, 0.74]);
  assert.equal(shift.drift, "up");
  assert.ok(shift.changeIndex !== null && shift.changeIndex >= 3, `onset ~mid: ${shift.changeIndex}`);

  const noise = cusumDrift([0.5, 0.48, 0.52, 0.49, 0.51, 0.5, 0.49]);
  assert.equal(noise.drift, "none");
});

test("a falling series reads as falling (maps to 'improving' risk for the caller)", () => {
  const falling = estimateTrend(series([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]));
  assert.equal(falling.direction, "falling");
  assert.equal(falling.significant, true);
});
