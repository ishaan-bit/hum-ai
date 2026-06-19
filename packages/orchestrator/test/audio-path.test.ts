import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asIsoTimestamp,
  asModelVersion,
  defaultConsent,
  findRawAudioFields,
  isRawAudioFieldName,
  type ConsentState,
} from "@hum-ai/shared-types";
import { synthHum, synthSilence } from "@hum-ai/audio-features";
import { CLINICAL_RISK_MARKER_HEAD_IDS, AFFECT_HEADS } from "@hum-ai/affect-model-contracts";
import {
  orchestrateHumAudio,
  buildHumSyncPayload,
  type HumHistory,
  type OrchestratedRead,
} from "@hum-ai/orchestrator";
import { sampleHistory } from "./fixtures";

const now = asIsoTimestamp("2026-06-19T08:00:00.000Z");
const modelVersion = asModelVersion("orchestrator-audio-test-v1");
const withConsent = (...scopes: ConsentState["grantedScopes"]): ConsentState => ({ grantedScopes: scopes, updatedAt: now });

const matureHistory: HumHistory = {
  eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 30, base: 0.27 }),
  priorEligibleCount: 30,
  relapseReferences: {
    baseline_30d: { capturedAt: now, dimensional: { valence: 0.1, arousal: 0 }, riskScore: 0.2 },
    previous_stable: { capturedAt: now, dimensional: { valence: 0.2, arousal: 0 }, riskScore: 0.15 },
  },
};

/** Recursively collect every object KEY in a value. */
function allKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== "object") return acc;
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    acc.add(k);
    allKeys(v, acc);
  }
  return acc;
}

test("audio entry: a clean synthetic hum runs end-to-end and commits to a read", async () => {
  const read = await orchestrateHumAudio({
    audio: synthHum(),
    consent: defaultConsent(now),
    modelVersion,
    now,
    history: matureHistory,
  });
  assert.equal(read.userFacing.abstained, false);
  assert.notEqual(read.userFacing.suggestion, null);
  assert.equal(read.internal.quality.decision, "clean");
  assert.equal(read.internal.domain.predicted, "hum");
  // The derived features rode through to internal (and are real, not the stub).
  assert.equal(read.internal.features.featureMode, "hum-state-v2");
  assert.ok(read.internal.features.pitchMeanHz !== null);
});

test("audio entry: a silent capture abstains safely (rejected path)", async () => {
  const read = await orchestrateHumAudio({
    audio: synthSilence(),
    consent: defaultConsent(now),
    modelVersion,
    now,
  });
  assert.equal(read.userFacing.abstained, true);
  assert.equal(read.userFacing.suggestion, null);
  assert.equal(read.internal.quality.decision, "rejected");
});

test("no raw-audio field name appears anywhere in the orchestrated read", async () => {
  const read = await orchestrateHumAudio({ audio: synthHum(), consent: defaultConsent(now), modelVersion, now, history: matureHistory });
  assert.deepEqual(findRawAudioFields(read), [], "the read must carry no raw-audio-like field");
  for (const key of allKeys(read)) {
    assert.equal(isRawAudioFieldName(key), false, `raw-audio-like key leaked: '${key}'`);
  }
});

test("buildHumSyncPayload: derived-only, passes privacy + clinical guards", async () => {
  const read = await orchestrateHumAudio({ audio: synthHum(), consent: withConsent("local_processing", "clinical_risk_surfacing"), modelVersion, now, history: matureHistory });
  const payload = buildHumSyncPayload(read, { capturedAt: now, modelVersion });

  // No raw-audio-like field, and no clinical-risk head id / internal label.
  assert.deepEqual(findRawAudioFields(payload), []);
  const keys = allKeys(payload);
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    assert.equal(keys.has(id), false, `clinical head id '${id}' present in sync payload`);
    assert.equal(keys.has(AFFECT_HEADS[id].internalLabel), false);
  }
  // It carries the derived features and qualitative evidence only — no raw number.
  assert.equal(payload.derivedFeatures.featureMode, "hum-state-v2");
  assert.equal(typeof payload.evidenceLevel, "string");
  assert.equal(Object.hasOwn(payload, "confidence"), false);
});

test("buildHumSyncPayload throws if a raw-audio field is smuggled in", async () => {
  const read = await orchestrateHumAudio({ audio: synthHum(), consent: defaultConsent(now), modelVersion, now, history: matureHistory });
  // Tamper: graft a raw-audio carrier onto the features object the builder reads.
  const tampered: OrchestratedRead = {
    ...read,
    internal: { ...read.internal, features: { ...read.internal.features, audioBlob: [1, 2, 3] } as never },
  };
  assert.throws(() => buildHumSyncPayload(tampered, { capturedAt: now, modelVersion }), /raw-audio/i);
});

test("relapse stays gated below 20 eligible hums, even via the audio path", async () => {
  // 18 prior + 1 eligible clean hum = 19 eligible → personalized_fusion, relapse OFF.
  const young: HumHistory = {
    eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 18, base: 0.27 }),
    priorEligibleCount: 18,
    relapseReferences: matureHistory.relapseReferences,
  };
  const youngRead = await orchestrateHumAudio({ audio: synthHum(), consent: defaultConsent(now), modelVersion, now, history: young });
  assert.equal(youngRead.internal.eligibleHumCount, 19);
  assert.notEqual(youngRead.internal.stage, "relapse_model");
  assert.equal(youngRead.internal.relapse, null, "relapse must be gated before 20 eligible hums");

  // 30 prior → relapse_model active, relapse verdict present.
  const matureRead = await orchestrateHumAudio({ audio: synthHum(), consent: defaultConsent(now), modelVersion, now, history: matureHistory });
  assert.equal(matureRead.internal.stage, "relapse_model");
  assert.notEqual(matureRead.internal.relapse, null);
});
