import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId } from "@hum-ai/shared-types";
import {
  newPersonalizationState,
  ingestHum,
  type HumObservation,
  type PersonalizationState,
} from "@hum-ai/personalization-engine";

const ts = (d: string) => asIsoTimestamp(`${d}T00:00:00.000Z`);
const fresh = (): PersonalizationState => newPersonalizationState(asUserId("u"), ts("2026-06-19"), asModelVersion("v"));
const obs = (over: Partial<HumObservation> = {}): HumObservation => ({
  capturedAt: ts("2026-06-19"),
  features: { meanRms: 0.09, pitchMeanHz: 180, spectralCentroidHz: 900 },
  eligible: true,
  ...over,
});

test("ingestHum learns a salience vector and maintains a regime state once the baseline is active", () => {
  let s = fresh();
  for (let i = 0; i < 8; i++) s = ingestHum(s, obs());
  assert.ok(s.profile.salience_vector && Object.keys(s.profile.salience_vector).length > 0);
  assert.ok(s.profile.regime !== undefined);
});

test("ingestHum updates the bandit intervention policy from observed responses", () => {
  let s = fresh();
  s = ingestHum(s, obs({ interventionResponse: { type: "breath_regulation", riskDelta: -0.3 } }));
  const arm = s.profile.intervention_policy?.breath_regulation;
  assert.ok(arm && arm.count === 1);
  assert.ok(arm!.mean > 0, "reward = −riskDelta = +0.3 (the intervention helped)");
});

test("a sustained personal drift eventually flips the regime to a detected shift", () => {
  let s = fresh();
  for (let i = 0; i < 12; i++) {
    s = ingestHum(s, obs({ features: { pitchMeanHz: 150, meanRms: 0.09, spectralCentroidHz: 800 } }));
  }
  let shifted = false;
  for (let i = 0; i < 40 && !shifted; i++) {
    s = ingestHum(s, obs({ features: { pitchMeanHz: 230, meanRms: 0.09, spectralCentroidHz: 800 } }));
    if (s.profile.regime && s.profile.regime.lastShift !== "none") shifted = true;
  }
  assert.equal(shifted, true);
  assert.ok((s.profile.adaptation_rate ?? 0) > 0, "adaptation rate lifts after the shift");
});
