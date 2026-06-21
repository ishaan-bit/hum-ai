import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRobustStats, zDelta, zDeltaCI, ciShrunkMagnitude } from "@hum-ai/shared-types";

// A baseline with a known robust scale; vary n to vary the CI width.
function baseline(n: number, spread = 1) {
  const vals: number[] = [];
  for (let i = 0; i < n; i++) vals.push((i % 2 === 0 ? -spread : spread) * 0.5);
  return computeRobustStats(vals);
}

test("zDeltaCI centers on the z-delta and widens as n shrinks", () => {
  const small = baseline(5);
  const large = baseline(50);
  const ciSmall = zDeltaCI(small.median + 0.5, small);
  const ciLarge = zDeltaCI(large.median + 0.5, large);
  assert.ok(Math.abs(ciSmall.center - zDelta(small.median + 0.5, small)) < 1e-9);
  // Fewer samples ⇒ a wider interval (more finite-sample uncertainty).
  assert.ok(ciSmall.halfWidth > ciLarge.halfWidth, `${ciSmall.halfWidth} > ${ciLarge.halfWidth}`);
  assert.ok(ciSmall.lo < ciSmall.center && ciSmall.center < ciSmall.hi);
});

test("ciShrunkMagnitude zeroes a small deviation whose CI overlaps the band, keeps a clear one", () => {
  const band = 0.12;
  // A z=0.5 deviation against a THIN baseline (n=4) → wide CI overlaps the band → not significant.
  const thin = baseline(4);
  const small = zDeltaCI(thin.median + 0.5 * thin.robustStd, thin);
  assert.ok(small.halfWidth > 0.5);
  assert.equal(ciShrunkMagnitude(small, band), Math.max(0, Math.abs(small.center) - small.halfWidth));
  assert.ok(ciShrunkMagnitude(small, band) < Math.abs(small.center), "thin-baseline deviation is shrunk");

  // A LARGE z=3 deviation against a rich baseline (n=64) → tight CI clears the band → full magnitude.
  const rich = baseline(64);
  const big = zDeltaCI(rich.median + 3 * rich.robustStd, rich);
  assert.ok(big.lo > band, "the whole interval clears the band");
  assert.equal(ciShrunkMagnitude(big, band), Math.abs(big.center));
});
