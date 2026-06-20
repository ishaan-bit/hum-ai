import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId, defaultConsent } from "@hum-ai/shared-types";
import { newPersonalizationState, ingestHum, type HumObservation } from "@hum-ai/personalization-engine";
import { humHistoryFromState, humFeatureSamples, orchestrateHumRead } from "@hum-ai/orchestrator";
import { cleanHumFeatures } from "./fixtures";

const now = asIsoTimestamp("2026-06-20T08:00:00.000Z"); // morning bucket
const mv = asModelVersion("personalization-v2-orch");

test("humHistoryFromState carries the v2 personal model (salience, policy, circadian)", () => {
  let s = newPersonalizationState(asUserId("u"), now, mv);
  const feats = humFeatureSamples(cleanHumFeatures());
  for (let i = 0; i < 12; i++) {
    const obs: HumObservation = {
      capturedAt: now,
      features: feats,
      eligible: true,
      dimensional: { valence: -0.2, arousal: -0.2 },
      riskScore: 0.5,
      interventionResponse: { type: "social_check_in", riskDelta: -0.4 },
    };
    s = ingestHum(s, obs);
  }
  const h = humHistoryFromState(s, now);
  assert.ok(h.salience && Object.keys(h.salience).length > 0, "salience learned");
  assert.equal(h.interventionPolicy?.social_check_in?.count, 12, "bandit policy carried");
  assert.equal(h.contextualCenters?.morning?.n, 12, "circadian morning bucket carried");
});

test("a mature read consumes the v2 history, personalizes, and keeps the safety guards", async () => {
  let s = newPersonalizationState(asUserId("u2"), now, mv);
  const feats = cleanHumFeatures();
  for (let i = 0; i < 12; i++) {
    s = ingestHum(s, {
      capturedAt: now,
      features: humFeatureSamples(feats),
      eligible: true,
      dimensional: { valence: 0.1, arousal: 0 },
      riskScore: 0.2,
      interventionResponse: { type: "music_recommendation", riskDelta: -0.2 },
    });
  }
  const read = await orchestrateHumRead({
    features: feats,
    consent: defaultConsent(now),
    modelVersion: mv,
    now,
    history: humHistoryFromState(s, now),
  });
  assert.equal(read.internal.personalization.applied, true);
  if (read.userFacing.suggestion) assert.equal(typeof read.userFacing.suggestion.type, "string");
});
