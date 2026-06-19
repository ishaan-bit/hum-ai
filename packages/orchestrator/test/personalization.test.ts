import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId, defaultConsent } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { assertNoClinicalLeak } from "@hum-ai/affect-model-contracts";
import { newPersonalizationState, syncableProfile } from "@hum-ai/personalization-engine";
import {
  orchestrateHumRead,
  humFeatureSamples,
  humHistoryFromState,
  observationFromRead,
  ingestHum,
  type HumHistory,
} from "@hum-ai/orchestrator";
import { cleanHumFeatures, sampleHistory } from "./fixtures";

const now = asIsoTimestamp("2026-06-19T12:00:00.000Z");
const modelVersion = asModelVersion("personalization-test-v1");
const consent = defaultConsent(now);

/** A rich, multi-feature history whose center IS the given hum (the user's usual). */
function onBaselineHistory(features: AcousticFeatures, count: number): HumHistory {
  const samples = humFeatureSamples(features);
  const eligibleSamplesByFeature: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(samples)) {
    // tiny deterministic spread so the robust spread (MAD) is non-degenerate
    eligibleSamplesByFeature[k] = Array.from({ length: count }, (_, i) => v * (1 + ((i % 5) - 2) * 0.001));
  }
  return { eligibleSamplesByFeature, priorEligibleCount: count };
}

test("personalization is off at cold start and on once a personal baseline exists", async () => {
  const features = cleanHumFeatures();
  const cold = await orchestrateHumRead({ features, consent, modelVersion, now });
  assert.equal(cold.internal.personalization.applied, false);
  assert.equal(cold.internal.stage, "population_prior");

  const matured = await orchestrateHumRead({
    features,
    consent,
    modelVersion,
    now,
    history: onBaselineHistory(features, 30),
  });
  assert.equal(matured.internal.personalization.applied, true);
  assert.ok(matured.internal.personalization.pull > 0, "a hum on the user's baseline is re-referenced");
});

test("a hum matching the user's usual reads more like their usual than the same hum cold", async () => {
  const features = cleanHumFeatures();
  const cold = await orchestrateHumRead({ features, consent, modelVersion, now });
  const personal = await orchestrateHumRead({
    features,
    consent,
    modelVersion,
    now,
    history: onBaselineHistory(features, 30),
  });

  const c = cold.internal.inference;
  const p = personal.internal.inference;
  // Same acoustics, but read against the user's own baseline: closer to "your usual".
  assert.ok(p.states.neutral_close_to_usual >= c.states.neutral_close_to_usual);
  assert.ok(p.states.depressive_affect_markers <= c.states.depressive_affect_markers + 1e-9);
  // Dimensional point pulled toward the user's neutral (origin).
  const cMag = Math.hypot(c.dimensional.valence, c.dimensional.arousal);
  const pMag = Math.hypot(p.dimensional.valence, p.dimensional.arousal);
  assert.ok(pMag <= cMag + 1e-9, "personalized read sits no further from neutral than the population read");
  // Individualization never weakens the privacy/clinical guards.
  assert.doesNotThrow(() => assertNoClinicalLeak(personal.userFacing));
  assert.doesNotThrow(() => assertNoClinicalLeak(personal.recommendationView));
});

test("a hum that departs from the user's baseline is recognized as less usual, prior preserved", async () => {
  // The user's usual `meanRms` sits ~0.04; the current hum is at ~0.09 — far from
  // their own baseline on the covered feature. selfNormality must drop and the
  // re-reference toward neutral must be negligible (the population prior survives).
  const departingFromBaseline: HumHistory = {
    eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 30, base: 0.04 }),
    priorEligibleCount: 30,
  };
  const read = await orchestrateHumRead({
    features: cleanHumFeatures(), // meanRms ~0.09 — well above this user's usual
    consent,
    modelVersion,
    now,
    history: departingFromBaseline,
  });
  assert.ok(read.internal.personalization.selfNormality < 0.2, "recognized as far from the user's usual");
  assert.ok(read.internal.personalization.pull < 0.05, "so the population prior is essentially preserved");
});

test("the personalization loop accumulates a per-user model and stays sync-safe", async () => {
  let state = newPersonalizationState(asUserId("loop-user"), now, modelVersion);
  const features = cleanHumFeatures();

  let firstApplied: boolean | null = null;
  for (let i = 0; i < 12; i++) {
    const history = humHistoryFromState(state, now);
    const read = await orchestrateHumRead({ features, consent, modelVersion, now, history });
    if (i === 0) firstApplied = read.internal.personalization.applied;
    state = ingestHum(state, observationFromRead(read, now));
  }

  assert.equal(firstApplied, false); // nothing to personalize against on the very first hum
  assert.equal(state.eligibleHumCount, 12);
  assert.ok((state.profile.baseline_vector.meanRms?.n ?? 0) > 0, "baseline learned from real features");
  assert.equal(state.profile.confidence_cap, 0.88); // personalized_fusion (10–19)
  assert.ok(state.profile.modality_reliability_vector.audio > 0, "audio trust learned");
  assert.doesNotThrow(() => syncableProfile(state)); // derived-only; raw-audio guard passes

  // A subsequent read is now personalized against the accumulated model.
  const finalRead = await orchestrateHumRead({
    features,
    consent,
    modelVersion,
    now,
    history: humHistoryFromState(state, now),
  });
  assert.equal(finalRead.internal.personalization.applied, true);
});
