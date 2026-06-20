import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, defaultConsent } from "@hum-ai/shared-types";
import { assertValidNativeHumExample, type HumSelfReport } from "@hum-ai/affect-model-contracts";
import { newAxisCalibration, updateAxisCalibration } from "@hum-ai/personalization-engine";
import {
  orchestrateHumRead,
  buildFeedbackRequest,
  applyFeedback,
  type OrchestratedRead,
} from "@hum-ai/orchestrator";
import { cleanHumFeatures, silentFeatures } from "./fixtures";

const now = asIsoTimestamp("2026-06-20T10:00:00.000Z");
const mv = asModelVersion("hum-web@0.1.0");

async function read(over = {}, history = undefined as Parameters<typeof orchestrateHumRead>[0]["history"]): Promise<OrchestratedRead> {
  return orchestrateHumRead({
    features: cleanHumFeatures(over),
    consent: defaultConsent(now),
    modelVersion: mv,
    now,
    history,
  });
}

test("buildFeedbackRequest asks on a low/no-trained-agreement read and exposes a usable priority", async () => {
  const r = await read();
  const req = buildFeedbackRequest(r);
  assert.equal(r.userFacing.abstained, false);
  assert.ok(req.priority > 0 && req.priority <= 1);
  // With no trained axis priors supplied, neither axis is in-domain → it is worth asking.
  assert.equal(req.shouldAsk, true);
  assert.ok(["low_confidence", "no_trained_agreement", "boundary"].includes(req.reason));
  assert.equal(req.predicted.valence, r.internal.axis.dimensional.valence);
});

test("buildFeedbackRequest never asks on an abstained read", async () => {
  const r = await orchestrateHumRead({ features: silentFeatures(), consent: defaultConsent(now), modelVersion: mv, now });
  const req = buildFeedbackRequest(r);
  assert.equal(r.userFacing.abstained, true);
  assert.equal(req.shouldAsk, false);
  assert.equal(req.reason, "abstained");
  assert.equal(req.priority, 0);
});

test("applyFeedback mints a guard-valid native example + a personal correction", async () => {
  const r = await read();
  const report: HumSelfReport = {
    label: { valence: 0.6, arousal: -0.2 },
    source: "self_report_adjust",
    agreedWithRead: false,
  };
  const { example, correction } = applyFeedback(r, report, { id: "hum-1", capturedAt: now, modelVersion: mv });

  assert.doesNotThrow(() => assertValidNativeHumExample(example));
  assert.equal(example.features, r.internal.features);
  assert.equal(example.label.valence, 0.6);
  assert.equal(example.provenance, "in_app_hitl_self_report");
  assert.equal(example.featureSchemaVersion, r.internal.features.featureMode);
  // The correction's predicted is what the user saw; residual drives calibration.
  assert.deepEqual(correction.predicted, r.internal.axis.dimensional);
  assert.equal(correction.reported.valence, 0.6);
  assert.equal(correction.weight, 1);
});

test("a CONFIRM is down-weighted vs an ADJUST", async () => {
  const r = await read();
  const confirm = applyFeedback(
    r,
    { label: r.internal.axis.dimensional, source: "self_report_confirm", agreedWithRead: true },
    { id: "h", capturedAt: now, modelVersion: mv },
  );
  assert.ok((confirm.correction.weight ?? 1) < 1);
});

test("personal axis calibration shifts the surfaced read but preserves acoustic provenance", async () => {
  const base = await read();
  // Build a calibration that says: the user consistently feels more positive than read.
  let cal = newAxisCalibration();
  for (let i = 0; i < 6; i++) {
    cal = updateAxisCalibration(cal, { predicted: base.internal.axis.dimensional, reported: { valence: 0.9, arousal: base.internal.axis.dimensional.arousal } });
  }
  const calibrated = await read({}, {
    eligibleSamplesByFeature: {},
    priorEligibleCount: 0,
    axisCalibration: cal,
  });

  assert.ok(
    calibrated.internal.axis.dimensional.valence > base.internal.axis.dimensional.valence,
    "the surfaced valence shifted toward the user's self-report",
  );
  // The transparent acoustic provenance is unchanged — calibration only moves the surfaced value.
  assert.equal(calibrated.internal.axis.valence.acousticValue, base.internal.axis.valence.acousticValue);
  // The surfaced value equals the calibrated dimensional value.
  assert.equal(calibrated.internal.axis.valence.value, calibrated.internal.axis.dimensional.valence);
});
