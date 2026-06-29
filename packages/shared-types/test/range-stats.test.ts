import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRangeStats, rangePosition } from "../src/index";

test("computeRangeStats captures a robust span (p05…p95), not raw min/max", () => {
  const vals = Array.from({ length: 100 }, (_, i) => i / 99); // 0…1 uniform
  const r = computeRangeStats(vals);
  assert.equal(r.n, 100);
  assert.equal(r.min, 0);
  assert.equal(r.max, 1);
  assert.ok(r.p05 > 0 && r.p05 < 0.1, `p05 ≈ 0.05 (got ${r.p05.toFixed(3)})`);
  assert.ok(r.p95 > 0.9 && r.p95 < 1, `p95 ≈ 0.95 (got ${r.p95.toFixed(3)})`);
  assert.ok(Math.abs(r.span - (r.p95 - r.p05)) < 1e-9);
  assert.ok(Math.abs(r.median - 0.5) < 0.02);
});

test("a single clipped outlier cannot blow the robust span open", () => {
  const clean = Array.from({ length: 50 }, () => 0.5);
  const withSpike = [...clean, 100];
  const r = computeRangeStats(withSpike);
  assert.equal(r.max, 100, "raw max still records the spike");
  assert.ok(r.span < 1, `robust span ignores the single spike (got ${r.span.toFixed(3)})`);
});

test("rangePosition maps a value into the user's own [0,1] span, clamped", () => {
  const r = computeRangeStats(Array.from({ length: 100 }, (_, i) => i / 99));
  const mid = rangePosition(0.5, r);
  assert.ok(mid !== null && Math.abs(mid - 0.5) < 0.06, `mid-range ≈ 0.5 (got ${mid})`);
  assert.equal(rangePosition(-5, r), 0, "below the low edge clamps to 0");
  assert.equal(rangePosition(5, r), 1, "above the high edge clamps to 1");
});

test("rangePosition returns null on a degenerate / empty span (caller falls back)", () => {
  assert.equal(rangePosition(0.5, computeRangeStats([])), null);
  assert.equal(rangePosition(0.5, computeRangeStats([0.5, 0.5, 0.5])), null, "flat span ⇒ null, not a fabricated 0.5");
});
