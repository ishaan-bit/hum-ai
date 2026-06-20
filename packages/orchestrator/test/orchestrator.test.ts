import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asModelVersion,
  asIsoTimestamp,
  defaultConsent,
  type ConsentState,
} from "@hum-ai/shared-types";
import {
  AFFECT_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  CLINICAL_RISK_STATE_HEADS,
  assertNoClinicalLeak,
} from "@hum-ai/affect-model-contracts";
import { validateUserFacingText, isConfidenceCopySafe, EVIDENCE_LEVELS } from "@hum-ai/safety-language";
import { orchestrateHumRead, type HumHistory, type OrchestratedRead } from "@hum-ai/orchestrator";
import { cleanHumFeatures, silentFeatures, sampleHistory } from "./fixtures";

const now = asIsoTimestamp("2026-06-18T12:00:00.000Z");
const modelVersion = asModelVersion("orchestrator-test-v1");

const withConsent = (...scopes: ConsentState["grantedScopes"]): ConsentState => ({
  grantedScopes: scopes,
  updatedAt: now,
});

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

/** Every clinical-risk marker id AND its internal research label. */
const FORBIDDEN_USER_FACING = new Set<string>([
  ...CLINICAL_RISK_MARKER_HEAD_IDS,
  ...CLINICAL_RISK_MARKER_HEAD_IDS.map((id) => AFFECT_HEADS[id].internalLabel),
]);

const firstHumInput = () => ({ features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now });

const earlyBaselineHistory: HumHistory = {
  eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 3, base: 0.09 }),
  priorEligibleCount: 3,
};

const postBaselineHistory: HumHistory = {
  eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 30, base: 0.09 }),
  priorEligibleCount: 30,
  relapseReferences: {
    baseline_30d: { capturedAt: now, dimensional: { valence: 0.1, arousal: 0 }, riskScore: 0.2 },
    previous_stable: { capturedAt: now, dimensional: { valence: 0.2, arousal: 0 }, riskScore: 0.15 },
  },
};

// ---------------------------------------------------------------------------
// Shape stability across the three maturity cases.
// ---------------------------------------------------------------------------

const TOP_KEYS = ["userFacing", "recommendationView", "internal"].sort();
const USER_FACING_KEYS = ["abstained", "isEarlyBaseline", "confidence", "headline", "note", "suggestion", "interventionOfDay"].sort();

test("orchestrator produces a stable output shape for first / early / post baseline", async () => {
  const reads = await Promise.all([
    orchestrateHumRead(firstHumInput()),
    orchestrateHumRead({ ...firstHumInput(), history: earlyBaselineHistory }),
    orchestrateHumRead({ ...firstHumInput(), history: postBaselineHistory }),
  ]);

  for (const read of reads) {
    assert.deepEqual(Object.keys(read).sort(), TOP_KEYS);
    assert.deepEqual(Object.keys(read.userFacing).sort(), USER_FACING_KEYS);
    assert.equal(typeof read.userFacing.abstained, "boolean");
    assert.equal(typeof read.userFacing.isEarlyBaseline, "boolean");
    assert.equal(typeof read.userFacing.headline, "string");
    assert.equal(typeof read.userFacing.note, "string");
    assert.ok(EVIDENCE_LEVELS.includes(read.userFacing.confidence.evidenceLevel));
    // suggestion is either null or {type, copy}
    if (read.userFacing.suggestion !== null) {
      assert.equal(typeof read.userFacing.suggestion.type, "string");
      assert.equal(typeof read.userFacing.suggestion.copy, "string");
    }
  }
});

test("the read works from hum #1: a real evidence band from the first hum; early-baseline is informational only", async () => {
  const first = await orchestrateHumRead(firstHumInput());
  // The model speaks from hum #1: a real earned band, NOT forced to "early_baseline".
  assert.notEqual(first.userFacing.confidence.evidenceLevel, "early_baseline");
  assert.ok(["high", "medium", "low"].includes(first.userFacing.confidence.evidenceLevel));
  // …but the personal baseline is still forming — surfaced as an informational flag only.
  assert.equal(first.userFacing.isEarlyBaseline, true);
  assert.equal(first.internal.stage, "population_prior");
  assert.equal(first.internal.eligibleHumCount, 1);
  // A clean hum reads with a real dimensional axis read (not a neutral wash).
  assert.equal(typeof first.internal.axis.dimensional.valence, "number");
  assert.equal(typeof first.internal.axis.dimensional.arousal, "number");

  const early = await orchestrateHumRead({ ...firstHumInput(), history: earlyBaselineHistory });
  assert.equal(early.userFacing.isEarlyBaseline, true); // 4 eligible hums < 5

  const post = await orchestrateHumRead({ ...firstHumInput(), history: postBaselineHistory });
  assert.equal(post.userFacing.isEarlyBaseline, false);
  assert.ok(["high", "medium", "low"].includes(post.userFacing.confidence.evidenceLevel));
  assert.equal(post.internal.stage, "relapse_model");
});

// ---------------------------------------------------------------------------
// Clinical-risk separation (ADR-0006).
// ---------------------------------------------------------------------------

test("clinical-risk labels can never leak into the user-facing output", async () => {
  // Run a risk-leaning capture WITH consent — the strongest leak pressure.
  const read = await orchestrateHumRead({
    features: cleanHumFeatures({
      clarityScore: 0.2,
      residualInstabilityScore: 0.7,
      residualPitchInstability: 0.6,
      spectralCentroidHz: 650,
      rmsEnergy: 0.06,
      activeFrameRatio: 0.45,
    }),
    consent: withConsent("local_processing", "clinical_risk_surfacing"),
    modelVersion,
    now,
    history: postBaselineHistory,
  });

  assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
  const keys = allKeys(read.userFacing);
  for (const forbidden of FORBIDDEN_USER_FACING) {
    assert.equal(keys.has(forbidden), false, `'${forbidden}' must not appear in user-facing output`);
  }
});

test("the recommendation engine receives only the sanitized view — no clinical labels", async () => {
  const read = await orchestrateHumRead({ ...firstHumInput(), history: postBaselineHistory });

  // The exact object the intervention engine consumed.
  assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
  const keys = allKeys(read.recommendationView);
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    assert.equal(keys.has(id), false, `'${id}' present in recommendation view`);
    assert.equal(keys.has(AFFECT_HEADS[id].internalLabel), false);
  }
  // …but it still carries the abstracted bands the engine reasons over.
  const view = read.recommendationView as unknown as Record<string, unknown>;
  for (const band of ["elevatedRegulationNeed", "lowEnergyPattern", "lowMoodPattern", "mixedOrUncertain"]) {
    assert.equal(typeof view[band], "boolean");
  }
});

test("clinical-risk markers live ONLY in the consent-gated head, never in copy/view", async () => {
  const features = cleanHumFeatures({ clarityScore: 0.25, residualInstabilityScore: 0.65 });

  // Without consent: clinical head withheld, recommendations still work.
  const withheld = await orchestrateHumRead({
    features,
    consent: defaultConsent(now),
    modelVersion,
    now,
    history: postBaselineHistory,
  });
  assert.equal(withheld.internal.twoHead.clinical.available, false);
  if (!withheld.internal.twoHead.clinical.available) {
    assert.match(withheld.internal.twoHead.clinical.withheldReason, /clinical_risk_surfacing/);
  }
  // Recommendations do NOT depend on consent (engine works on sanitized bands).
  if (!withheld.userFacing.abstained) assert.notEqual(withheld.userFacing.suggestion, null);

  // With consent: the head surfaces, carries the markers, and is never diagnostic.
  const granted = await orchestrateHumRead({
    features,
    consent: withConsent("local_processing", "clinical_risk_surfacing"),
    modelVersion,
    now,
    history: postBaselineHistory,
  });
  assert.equal(granted.internal.twoHead.clinical.available, true);
  if (granted.internal.twoHead.clinical.available) {
    assert.equal(granted.internal.twoHead.clinical.head.isDiagnostic, false);
    for (const head of CLINICAL_RISK_STATE_HEADS) {
      assert.ok(head in granted.internal.twoHead.clinical.head.markers, `${head} missing from clinical head`);
    }
  }
});

// ---------------------------------------------------------------------------
// Qualitative confidence (ADR-0008).
// ---------------------------------------------------------------------------

test("user-facing confidence is qualitative only — no raw number anywhere in copy", async () => {
  const read = await orchestrateHumRead({ ...firstHumInput(), history: postBaselineHistory });
  const c = read.userFacing.confidence;

  // No raw numeric confidence field is exposed.
  assert.equal(Object.hasOwn(c, "confidence"), false);
  assert.equal(Object.hasOwn(c, "confidencePercent"), false);
  assert.equal(Object.hasOwn(c, "rawConfidence"), false);

  // Every user-facing string is percentage-free and forbidden-phrase-free.
  const strings = [read.userFacing.headline, read.userFacing.note, c.signalClarity, c.basedOn, c.summary];
  if (read.userFacing.suggestion) strings.push(read.userFacing.suggestion.copy);
  for (const s of strings) {
    assert.equal(isConfidenceCopySafe(s), true, `raw confidence number in: "${s}"`);
    assert.equal(validateUserFacingText(s).ok, true, `forbidden phrase in: "${s}"`);
  }
});

// ---------------------------------------------------------------------------
// Dual baseline + divergence (ADR-0007).
// ---------------------------------------------------------------------------

test("rolling/anchored divergence is handled: informs drift when anchored, undefined when immature", async () => {
  // Mature, diverging history: recent 24 hums shifted well above the long anchor.
  const diverging: HumHistory = {
    eligibleSamplesByFeature: sampleHistory({
      feature: "meanRms",
      total: 200,
      base: 0.09,
      recentCount: 24,
      recentShift: 0.06,
    }),
    priorEligibleCount: 200,
  };
  const read = await orchestrateHumRead({ ...firstHumInput(), history: diverging });
  assert.equal(read.internal.divergence.anchored, true);
  assert.ok(read.internal.divergence.magnitude > 0, "expected non-zero divergence magnitude");
  // Divergence feeds the relapse-drift head (internal-only, behind the gate).
  assert.ok(read.internal.inference.relapseDrift > 0, "divergence should inform relapseDrift");
  // …and still never leaks to copy.
  assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));

  // Immature history: the anchor is inactive, so divergence is UNDEFINED (not zero-faked).
  const immature: HumHistory = {
    eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 8, base: 0.09 }),
    priorEligibleCount: 8,
  };
  const young = await orchestrateHumRead({ ...firstHumInput(), history: immature });
  assert.equal(young.internal.divergence.anchored, false);
  assert.equal(young.internal.divergence.magnitude, 0);
});

// ---------------------------------------------------------------------------
// Abstention + happy path.
// ---------------------------------------------------------------------------

test("a rejected (near-silent) capture abstains safely with no leak and no suggestion", async () => {
  const read = await orchestrateHumRead({
    features: silentFeatures(),
    consent: defaultConsent(now),
    modelVersion,
    now,
  });
  assert.equal(read.userFacing.abstained, true);
  assert.equal(read.userFacing.suggestion, null);
  assert.equal(read.recommendationView.abstained, true);
  assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
  assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
  // Abstaining copy is still safe.
  assert.equal(validateUserFacingText(read.userFacing.headline).ok, true);
  assert.equal(validateUserFacingText(read.userFacing.note).ok, true);
});

test("a clean, mature hum commits to a read and surfaces a suggestion (recommendations work)", async () => {
  const read = await orchestrateHumRead({ ...firstHumInput(), history: postBaselineHistory });
  assert.equal(read.userFacing.abstained, false);
  assert.notEqual(read.userFacing.suggestion, null);
  assert.ok(read.userFacing.headline.length > 0);
});
