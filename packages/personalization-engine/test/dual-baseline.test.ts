import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDualBaseline,
  buildRollingBaseline,
  buildAnchoredBaseline,
  baselineDivergence,
  updateAnchoredCenter,
  ANCHOR_MIN_HUMS,
  ROLLING_WINDOW,
} from "@hum-ai/personalization-engine";

/** Helper: an array of length n filled by a generator. */
const series = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

test("anchored baseline stays inactive below the maturity threshold", () => {
  const samples = { pitchCenterHz: series(ANCHOR_MIN_HUMS - 1, () => 180) };
  const anchored = buildAnchoredBaseline(samples);
  assert.equal(anchored.active, false);
  assert.deepEqual(anchored.vector, {});
});

test("anchored baseline activates at the maturity threshold", () => {
  const samples = { pitchCenterHz: series(ANCHOR_MIN_HUMS, () => 180) };
  const anchored = buildAnchoredBaseline(samples);
  assert.equal(anchored.active, true);
  assert.equal(anchored.vector.pitchCenterHz!.median, 180);
});

test("rolling baseline only summarizes the most recent window", () => {
  // 200 old low values, then 24 recent high values.
  const samples = { pitchCenterHz: [...series(200, () => 100), ...series(ROLLING_WINDOW, () => 200)] };
  const rolling = buildRollingBaseline(samples);
  assert.equal(rolling.vector.pitchCenterHz!.median, 200); // recent window dominates
});

test("divergence is undefined until the anchor is active", () => {
  const dual = buildDualBaseline({ pitchCenterHz: series(5, () => 180) });
  const div = baselineDivergence(dual);
  assert.equal(div.anchored, false);
  assert.equal(div.magnitude, 0);
});

test("rolling drift away from a stable anchor produces a non-zero divergence", () => {
  // Long history jittered around 180 Hz (the anchor, with finite spread),
  // then a recent window drifted up to 210 Hz. The anchor window spans both so
  // the anchor center stays near 180 while the rolling center tracks 210.
  const history = series(180, (i) => 180 + (i % 2 === 0 ? 2 : -2));
  const recent = series(ROLLING_WINDOW, () => 210);
  const dual = buildDualBaseline({ pitchCenterHz: [...history, ...recent] }, { anchorWindow: 300 });
  const div = baselineDivergence(dual);
  assert.equal(div.anchored, true);
  assert.ok(div.magnitude > 0, "rolling center drifted from the anchor");
  assert.ok((div.perFeature.pitchCenterHz ?? 0) > 0, "drift is upward (positive)");
});

test("baseline divergence IGNORES a fidelity-only shift (a mic/room change is not within-user drift)", () => {
  // A long stable history then a recent window where ONLY a fidelity feature (SNR) drifts hard while
  // a state feature (pitch) holds. The fidelity drift must not appear in perFeature or move magnitude.
  const histSnr = series(180, (i) => 8 + (i % 2 === 0 ? 0.2 : -0.2));
  const recentSnr = series(ROLLING_WINDOW, () => 2); // capture got much noisier recently
  const pitch = series(180 + ROLLING_WINDOW, () => 180); // mood/voice unchanged
  const dual = buildDualBaseline(
    { signalToNoiseProxy: [...histSnr, ...recentSnr], pitchMeanHz: pitch },
    { anchorWindow: 300 },
  );
  const div = baselineDivergence(dual);
  assert.equal(div.anchored, true);
  assert.equal(div.perFeature.signalToNoiseProxy, undefined, "fidelity drift is excluded from divergence");
  assert.equal(div.magnitude, 0, "a fidelity-only shift produces no within-user drift");
});

test("anchored EMA update nudges the center slowly, not all the way", () => {
  const samples = { pitchCenterHz: series(ANCHOR_MIN_HUMS, () => 100) };
  const anchored = buildAnchoredBaseline(samples);
  const updated = updateAnchoredCenter(anchored, { pitchCenterHz: 200 }, 0.05);
  const med = updated.vector.pitchCenterHz!.median;
  assert.ok(med > 100 && med < 110, `EMA should move slowly, got ${med}`);
  assert.equal(updated.sampleCount, anchored.sampleCount + 1);
});

test("inactive anchor ignores EMA updates", () => {
  const anchored = buildAnchoredBaseline({ pitchCenterHz: series(3, () => 100) });
  const updated = updateAnchoredCenter(anchored, { pitchCenterHz: 200 });
  assert.equal(updated.active, false);
  assert.deepEqual(updated.vector, {});
});
