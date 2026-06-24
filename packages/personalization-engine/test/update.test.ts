import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId } from "@hum-ai/shared-types";
import type { RelapseSample } from "@hum-ai/relapse-engine";
import {
  buildRelapseReferences,
  ingestHum,
  newPersonalizationState,
  syncableProfile,
  FEATURE_HISTORY_LIMIT,
  type HumObservation,
  type PersonalizationState,
} from "@hum-ai/personalization-engine";

const ts = (d: string) => asIsoTimestamp(`${d}T00:00:00.000Z`);
const freshState = (): PersonalizationState =>
  newPersonalizationState(asUserId("u1"), ts("2026-06-19"), asModelVersion("v1"));

const obs = (over: Partial<HumObservation> = {}): HumObservation => ({
  capturedAt: ts("2026-06-19"),
  features: { meanRms: 0.09, pitchMeanHz: 180 },
  eligible: true,
  ...over,
});

test("an ineligible hum does not shape the model, but a read-bearing one still enters the diary", () => {
  const s = freshState();
  // (a) ineligible with no read payload → nothing changes (model + diary untouched).
  const bare = ingestHum(s, obs({ eligible: false }));
  assert.equal(bare.eligibleHumCount, 0);
  assert.deepEqual(bare.profile, s.profile);
  assert.deepEqual(bare.featureWindows, s.featureWindows);
  assert.equal(bare.relapseHistory.length, 0);

  // (b) ineligible WITH a dimensional read + risk → the diary's relapse history records it (so the
  // diary + count badge always reflect the most-recent check-in), but the model baseline, ladder,
  // and eligibleHumCount NEVER advance for a non-quality-gated hum.
  const withRead = ingestHum(
    s,
    obs({ eligible: false, dimensional: { valence: -0.2, arousal: 0.1 }, riskScore: 0.3 }),
  );
  assert.equal(withRead.relapseHistory.length, 1, "ineligible read-bearing hum records to the diary history");
  assert.equal(withRead.eligibleHumCount, 0, "but does not advance the eligible-hum ladder");
  assert.deepEqual(withRead.profile, s.profile, "and does not move the model baseline");
  assert.deepEqual(withRead.featureWindows, s.featureWindows);
});

test("each eligible hum advances the count, baseline, stage cap, and timestamp", () => {
  let s = freshState();
  for (let i = 0; i < 5; i++) s = ingestHum(s, obs({ capturedAt: ts("2026-06-20") }));
  assert.equal(s.eligibleHumCount, 5);
  assert.ok((s.profile.baseline_vector.meanRms?.n ?? 0) > 0);
  assert.equal(s.profile.baseline_vector.meanRms?.median, 0.09);
  assert.equal(s.profile.confidence_cap, 0.82); // personal_baseline stage (5–9)
  assert.equal(s.profile.last_updated_at, ts("2026-06-20"));
  assert.equal(s.profile.feature_distribution_summary.meanRms, 5);
});

test("feature windows are bounded to the anchored long window", () => {
  let s = freshState();
  for (let i = 0; i < FEATURE_HISTORY_LIMIT + 25; i++) s = ingestHum(s, obs());
  assert.equal(s.featureWindows.meanRms!.length, FEATURE_HISTORY_LIMIT);
});

test("per-modality reliability is learned by EMA toward what fusion trusted", () => {
  let s = freshState();
  s = ingestHum(s, obs({ observedModalityReliability: { audio: 0.8, face: 0, text: 0 } }));
  assert.ok(s.profile.modality_reliability_vector.audio > 0.1 && s.profile.modality_reliability_vector.audio < 0.2);
  // absent channels are not decayed below zero
  assert.equal(s.profile.modality_reliability_vector.face, 0);
  for (let i = 0; i < 40; i++) s = ingestHum(s, obs({ observedModalityReliability: { audio: 0.8, face: 0, text: 0 } }));
  assert.ok(s.profile.modality_reliability_vector.audio > 0.7, "converges toward the observed reliability");
});

test("high-risk signatures are learned only once the baseline is active, and routed by risk band", () => {
  // A high-risk hum before the baseline is active must NOT seed a signature.
  let s = freshState();
  s = ingestHum(s, obs({ riskScore: 0.9, dimensional: { valence: -0.5, arousal: 0.3 } }));
  assert.deepEqual(s.profile.high_risk_signature_vector, {});

  // Build a stable baseline (≥5), then a high-risk hum that DEVIATES from it.
  s = freshState();
  for (let i = 0; i < 6; i++) s = ingestHum(s, obs({ riskScore: 0.2 }));
  assert.ok("meanRms" in s.profile.recovery_signature_vector, "stable hums seed the recovery signature");
  const withHighRisk = ingestHum(s, obs({ features: { meanRms: 0.2, pitchMeanHz: 180 }, riskScore: 0.85 }));
  assert.ok(Math.abs(withHighRisk.profile.high_risk_signature_vector.meanRms ?? 0) > 1, "deviating high-risk hum seeds the high-risk signature");
});

test("relapse history is retained (bounded) only when a dimensional read + risk score exist", () => {
  let s = freshState();
  s = ingestHum(s, obs()); // no dimensional/risk → not retained
  assert.equal(s.relapseHistory.length, 0);
  s = ingestHum(s, obs({ dimensional: { valence: 0.1, arousal: 0 }, riskScore: 0.3 }));
  assert.equal(s.relapseHistory.length, 1);
});

test("syncableProfile returns the derived profile and passes the raw-audio guard", () => {
  let s = freshState();
  s = ingestHum(s, obs({ dimensional: { valence: 0.1, arousal: 0 }, riskScore: 0.3 }));
  assert.doesNotThrow(() => syncableProfile(s));
  assert.equal(syncableProfile(s), s.profile);
});

test("buildRelapseReferences picks recent stable/high-risk and aggregates the time windows", () => {
  const history: RelapseSample[] = [
    { capturedAt: ts("2026-06-01"), dimensional: { valence: 0.2, arousal: 0 }, riskScore: 0.7 }, // older, high-risk
    { capturedAt: ts("2026-06-10"), dimensional: { valence: 0.3, arousal: 0 }, riskScore: 0.2 }, // newer, stable
  ];
  const refs = buildRelapseReferences(history, ts("2026-06-15"));
  assert.equal(refs.previous_stable?.riskScore, 0.2);
  assert.equal(refs.previous_high_risk?.riskScore, 0.7);
  // 30-day window covers both → mean risk 0.45; 7-day window covers only the 06-10 sample.
  assert.ok(Math.abs((refs.baseline_30d?.riskScore ?? 0) - 0.45) < 1e-9);
  assert.equal(refs.baseline_7d?.riskScore, 0.2);
});
