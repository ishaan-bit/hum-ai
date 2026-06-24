import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, asUserId, defaultConsent, CLINICAL_RISK_CONFIDENCE_CAP } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { assertNoClinicalLeak } from "@hum-ai/affect-model-contracts";
import { newPersonalizationState } from "@hum-ai/personalization-engine";
import {
  orchestrateHumRead,
  humFeatureSamples,
  humHistoryFromState,
  observationFromRead,
  ingestHum,
  type HumHistory,
} from "@hum-ai/orchestrator";
import { cleanHumFeatures, silentFeatures } from "./fixtures";

const now = asIsoTimestamp("2026-06-19T12:00:00.000Z");
const modelVersion = asModelVersion("longitudinal-test-v1");
const consent = defaultConsent(now);

/** A rich, multi-feature history whose center IS the given hum (the user's usual). */
function onBaselineHistory(features: AcousticFeatures, count: number): HumHistory {
  const samples = humFeatureSamples(features);
  const eligibleSamplesByFeature: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(samples)) {
    eligibleSamplesByFeature[k] = Array.from({ length: count }, (_, i) => v * (1 + ((i % 5) - 2) * 0.001));
  }
  return { eligibleSamplesByFeature, priorEligibleCount: count };
}

test("first hum does not produce longitudinal certainty (insufficient_data, prior-derived)", async () => {
  const read = await orchestrateHumRead({ features: cleanHumFeatures(), consent, modelVersion, now });
  const lon = read.internal.longitudinal;
  assert.equal(lon.riskHypothesis.status, "insufficient_data");
  assert.equal(lon.relapseDrift, null);
  assert.equal(lon.recovery, null);
  assert.equal(lon.monitoringFlag, false);
  assert.equal(lon.trendDirection, "uncertain");
  // provenance: a first hum leans on the population prior, not a personal baseline.
  assert.equal(lon.evidenceSources.populationPrior, true);
  assert.equal(lon.evidenceSources.personalBaseline, false);
  assert.equal(lon.evidenceSources.relapseModel, false);
});

test("a baseline-active read is personalized and carries a within-user longitudinal state", async () => {
  const features = cleanHumFeatures();
  const read = await orchestrateHumRead({
    features,
    consent,
    modelVersion,
    now,
    history: onBaselineHistory(features, 30),
  });
  const lon = read.internal.longitudinal;
  assert.equal(lon.evidenceSources.personalBaseline, true);
  assert.notEqual(lon.riskHypothesis.status, "insufficient_data", "with a baseline a within-user judgement is made");
  assert.equal(lon.isDiagnostic, false);
});

test("the longitudinal risk confidence never exceeds the 88% clinical hard cap", async () => {
  // Even at a mature, relapse-model account (general cap 0.92), the diagnostic
  // confidence is clamped to 88%.
  for (const count of [0, 6, 12, 30]) {
    const features = cleanHumFeatures();
    const read = await orchestrateHumRead({
      features,
      consent,
      modelVersion,
      now,
      history: count === 0 ? undefined : onBaselineHistory(features, count),
    });
    const lon = read.internal.longitudinal;
    assert.ok(
      lon.riskHypothesis.confidence <= CLINICAL_RISK_CONFIDENCE_CAP + 1e-9,
      `risk confidence ${lon.riskHypothesis.confidence} exceeded the 88% cap at ${count} hums`,
    );
    if (lon.relapseDrift) {
      assert.ok(lon.relapseDrift.confidence <= CLINICAL_RISK_CONFIDENCE_CAP + 1e-9);
    }
  }
});

test("a rejected/low-quality hum abstains — the longitudinal state declines, not guesses", async () => {
  const read = await orchestrateHumRead({
    features: silentFeatures(),
    consent,
    modelVersion,
    now,
    history: onBaselineHistory(cleanHumFeatures(), 30),
  });
  assert.equal(read.userFacing.abstained, true);
  assert.equal(read.internal.longitudinal.abstained, true);
  assert.equal(read.internal.longitudinal.riskHypothesis.status, "insufficient_data");
  assert.equal(read.internal.longitudinal.relapseDrift, null);
});

test("the longitudinal state never leaks clinical labels into rendered/recommendation output", async () => {
  const features = cleanHumFeatures();
  const read = await orchestrateHumRead({
    features,
    consent,
    modelVersion,
    now,
    history: onBaselineHistory(features, 30),
  });
  // The internal longitudinal state DOES contain internal risk labels by design;
  // the user-facing and recommendation projections must remain leak-free.
  assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
  assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
});

test("output shape is stable for orchestrator/runtime consumers", async () => {
  const read = await orchestrateHumRead({ features: cleanHumFeatures(), consent, modelVersion, now });
  const lon = read.internal.longitudinal;
  assert.ok("trendDirection" in lon);
  assert.ok("riskHypothesis" in lon);
  assert.ok("relapseDrift" in lon);
  assert.ok("recovery" in lon);
  assert.ok("monitoringFlag" in lon);
  assert.ok("consecutiveDriftHums" in lon);
  assert.ok("evidenceSources" in lon);
  assert.equal(lon.isDiagnostic, false);
});

test("an ineligible (rejected) hum does not corrupt the consecutive-drift streak", () => {
  let state = newPersonalizationState(asUserId("drift-user"), now, modelVersion);
  // Seed a streak via an eligible observation carrying a drift count.
  state = ingestHum(state, {
    capturedAt: now,
    features: humFeatureSamples(cleanHumFeatures()),
    eligible: true,
    consecutiveDriftHums: 2,
  });
  assert.equal(state.consecutiveDriftHums, 2);
  // A rejected hum is returned unchanged — the streak is preserved, not reset.
  const after = ingestHum(state, {
    capturedAt: now,
    features: humFeatureSamples(silentFeatures()),
    eligible: false,
    consecutiveDriftHums: 0,
  });
  assert.equal(after.consecutiveDriftHums, 2);
  // An ineligible hum with no read payload leaves the state materially unchanged (the model, ladder,
  // streak, and diary history are all untouched). It is no longer the SAME object reference — a
  // read-bearing ineligible hum now records to the diary's relapse history — so assert deep equality.
  assert.deepEqual(after, state, "ineligible hums leave the state materially unchanged");
});

test("the personalization loop carries the longitudinal state and drift streak across hums", async () => {
  let state = newPersonalizationState(asUserId("loop-user"), now, modelVersion);
  const features = cleanHumFeatures();
  for (let i = 0; i < 12; i++) {
    const read = await orchestrateHumRead({
      features,
      consent,
      modelVersion,
      now,
      history: humHistoryFromState(state, now),
    });
    // Clean, on-baseline hums never accrue drift.
    assert.equal(read.internal.longitudinal.consecutiveDriftHums, 0);
    state = ingestHum(state, observationFromRead(read, now));
  }
  assert.equal(state.consecutiveDriftHums, 0);
  assert.equal(state.eligibleHumCount, 12);
});
