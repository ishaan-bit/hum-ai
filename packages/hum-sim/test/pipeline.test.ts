import { test } from "node:test";
import assert from "node:assert/strict";
import { runHum, makeLatent, zoneOf, type LatentHumProfile } from "@hum-ai/hum-sim";

/**
 * FULL-PIPELINE INTEGRATION — every simulated hum must traverse the exact production
 * path (orchestrateHumAudio → computeFeatures → orchestrateHumRead) and yield a valid,
 * finite, safe-to-render result.
 */
const fast = (over: Partial<LatentHumProfile>): LatentHumProfile =>
  makeLatent({ durationSec: 8, sampleRate: 16000, ...over });

test("runHum produces a finite, well-formed read on a nominal hum", async () => {
  const r = await runHum("t/neutral", fast({}));
  assert.ok(Number.isFinite(r.displayAxis.valence) && Number.isFinite(r.displayAxis.arousal));
  assert.ok(r.displayAxis.valence >= -1 && r.displayAxis.valence <= 1);
  assert.ok(r.displayAxis.arousal >= -1 && r.displayAxis.arousal <= 1);
  assert.equal(typeof r.zone, "string");
  assert.equal(r.zone, zoneOf(r.displayAxis.valence, r.displayAxis.arousal));
  assert.ok(r.riskScore >= 0 && r.riskScore <= 1);
  assert.ok(["clean", "borderline", "rejected"].includes(r.quality.decision));
  assert.ok(typeof r.userFacing.headline === "string" && r.userFacing.headline.length > 0);
});

test("a clean nominal hum is not rejected and carries no non-finite warnings", async () => {
  const r = await runHum("t/clean", fast({ energy: 0.6 }));
  assert.notEqual(r.quality.decision, "rejected");
  assert.equal(r.warnings.filter((w) => w.includes("non-finite")).length, 0);
  assert.equal(r.features.isSilent, false);
});

test("at cold start (no history) the displayed read equals the acoustic backbone", async () => {
  const r = await runHum("t/coldstart", fast({ energy: 0.7, pitchHeight: 0.8 }));
  assert.ok(Math.abs(r.displayAxis.valence - r.axisAcoustic.valence) < 1e-9, "no re-reference at cold start");
  assert.ok(Math.abs(r.displayAxis.arousal - r.axisAcoustic.arousal) < 1e-9);
});

test("every stage's V-A stays within [-1,1]", async () => {
  const r = await runHum("t/bounds", fast({ energy: 0.95, pitchHeight: 0.95, melodicMovement: 0.9, brightness: 0.9 }));
  for (const va of [r.axisAcoustic, r.axisRead, r.displayAxis, r.internalDimensional]) {
    assert.ok(va.valence >= -1 && va.valence <= 1, `valence ${va.valence}`);
    assert.ok(va.arousal >= -1 && va.arousal <= 1, `arousal ${va.arousal}`);
  }
});
