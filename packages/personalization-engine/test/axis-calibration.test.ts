import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId } from "@hum-ai/shared-types";
import {
  newAxisCalibration,
  updateAxisCalibration,
  applyAxisCalibration,
  axisCalibrationConfidence,
  axisCalibrationEngaged,
  MAX_AXIS_OFFSET,
  AXIS_CALIBRATION_MIN_CONFIDENT,
  type PersonalAxisCorrection,
} from "../src/axis-calibration";
import { ingestFeedback } from "../src/update";
import { newPersonalizationState } from "../src/state";

const now = asIsoTimestamp("2026-06-20T10:00:00.000Z");
const mv = asModelVersion("hum-web@0.1.0");

test("a fresh calibration is empty and leaves a read unchanged", () => {
  const cal = newAxisCalibration();
  assert.equal(axisCalibrationEngaged(cal), false);
  assert.deepEqual(applyAxisCalibration(cal, { valence: 0.3, arousal: -0.2 }), { valence: 0.3, arousal: -0.2 });
  assert.deepEqual(applyAxisCalibration(undefined, { valence: 0.3, arousal: -0.2 }), { valence: 0.3, arousal: -0.2 });
});

test("a consistent positive residual moves the read toward the user's self-report", () => {
  // The model keeps reading valence ~0 but the user keeps reporting ~+0.6.
  let cal = newAxisCalibration();
  const corr: PersonalAxisCorrection = { predicted: { valence: 0, arousal: 0 }, reported: { valence: 0.6, arousal: 0 } };
  for (let i = 0; i < AXIS_CALIBRATION_MIN_CONFIDENT; i++) cal = updateAxisCalibration(cal, corr);
  assert.ok(cal.valence.offset > 0.2, `offset learned: ${cal.valence.offset}`);
  assert.equal(axisCalibrationConfidence(cal.valence.count), 1);
  const adjusted = applyAxisCalibration(cal, { valence: 0, arousal: 0 });
  assert.ok(adjusted.valence > 0.2 && adjusted.valence <= 0.6, `read re-centred: ${adjusted.valence}`);
  // The arousal axis had zero residual → untouched.
  assert.equal(adjusted.arousal, 0);
});

test("the offset is bounded and cannot relocate the read arbitrarily", () => {
  let cal = newAxisCalibration();
  const extreme: PersonalAxisCorrection = { predicted: { valence: -1, arousal: 0 }, reported: { valence: 1, arousal: 0 } };
  for (let i = 0; i < 30; i++) cal = updateAxisCalibration(cal, extreme);
  assert.ok(cal.valence.offset <= MAX_AXIS_OFFSET + 1e-9, `bounded: ${cal.valence.offset}`);
});

test("a single correction is shrunk (under-confident) so two taps can't redraw the axis", () => {
  const cal = updateAxisCalibration(newAxisCalibration(), {
    predicted: { valence: 0, arousal: 0 },
    reported: { valence: 0.8, arousal: 0 },
  });
  assert.equal(cal.valence.count, 1);
  assert.ok(axisCalibrationConfidence(1) < 1);
  const adjusted = applyAxisCalibration(cal, { valence: 0, arousal: 0 });
  // offset 0.8 (clamped to 0.6) × confidence(1)=0.25 → ~0.15, not the full 0.6.
  assert.ok(adjusted.valence < cal.valence.offset, `shrunk: ${adjusted.valence} < ${cal.valence.offset}`);
});

test("agreement (residual 0) relaxes a learned offset back toward neutral over time", () => {
  let cal = newAxisCalibration();
  for (let i = 0; i < 6; i++) cal = updateAxisCalibration(cal, { predicted: { valence: 0, arousal: 0 }, reported: { valence: 0.6, arousal: 0 } });
  const learned = cal.valence.offset;
  for (let i = 0; i < 10; i++) cal = updateAxisCalibration(cal, { predicted: { valence: 0.5, arousal: 0 }, reported: { valence: 0.5, arousal: 0 } });
  assert.ok(cal.valence.offset < learned, `relaxed: ${cal.valence.offset} < ${learned}`);
});

test("ingestFeedback updates only the calibration, not the baseline or hum count", () => {
  const state = newPersonalizationState(asUserId("u1"), now, mv);
  const next = ingestFeedback(state, { predicted: { valence: 0, arousal: 0 }, reported: { valence: 0.5, arousal: -0.4 } });
  assert.equal(next.eligibleHumCount, state.eligibleHumCount);
  assert.deepEqual(next.featureWindows, state.featureWindows);
  assert.ok(axisCalibrationEngaged(next.profile.axis_calibration));
  assert.equal(next.profile.axis_calibration!.valence.count, 1);
  // The original state is untouched (purity).
  assert.equal(axisCalibrationEngaged(state.profile.axis_calibration), false);
});
