import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion, defaultConsent, asIsoTimestamp } from "@hum-ai/shared-types";
import type { ConsentState } from "@hum-ai/shared-types";
import {
  neutralInference,
  zeroStateScores,
  splitInference,
  toRecommendationView,
  assertNoClinicalLeak,
  ClinicalLeakError,
  BROAD_AFFECT_STATE_HEADS,
  CLINICAL_RISK_STATE_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  AFFECT_HEADS,
  type MultiHeadAffectInference,
} from "@hum-ai/affect-model-contracts";

const now = asIsoTimestamp("2026-06-18T00:00:00.000Z");

const withConsent = (...scopes: ConsentState["grantedScopes"]): ConsentState => ({
  grantedScopes: scopes,
  updatedAt: now,
});

const inferenceWith = (over: Partial<MultiHeadAffectInference> = {}): MultiHeadAffectInference => {
  const n = neutralInference(asModelVersion("v1"));
  const states = zeroStateScores();
  states.depressive_affect_markers = 0.8;
  states.anxiety_like_tension = 0.7;
  states.calm_regulated = 0.3;
  return { ...n, abstained: false, abstainReason: "none", states, relapseDrift: 0.6, ...over };
};

test("broad and clinical head id sets are disjoint and cover the state heads", () => {
  const broad = new Set(BROAD_AFFECT_STATE_HEADS);
  for (const h of CLINICAL_RISK_STATE_HEADS) {
    assert.equal(broad.has(h), false, `${h} must not be in the broad head`);
  }
  assert.equal(BROAD_AFFECT_STATE_HEADS.length + CLINICAL_RISK_STATE_HEADS.length, 15);
});

test("clinical-risk head is withheld without consent", () => {
  const split = splitInference(inferenceWith(), defaultConsent(now));
  assert.equal(split.clinical.available, false);
  if (!split.clinical.available) {
    assert.match(split.clinical.withheldReason, /clinical_risk_surfacing/);
  }
  // broad head carries benign states only — no risk markers present
  for (const id of CLINICAL_RISK_STATE_HEADS) {
    assert.equal(id in split.broad.states, false, `${id} leaked into broad head`);
  }
});

test("clinical-risk head surfaces only with explicit consent, never diagnostic", () => {
  const split = splitInference(inferenceWith(), withConsent("local_processing", "clinical_risk_surfacing"));
  assert.equal(split.clinical.available, true);
  if (split.clinical.available) {
    assert.equal(split.clinical.head.isDiagnostic, false);
    assert.equal(split.clinical.head.markers.depressive_affect_markers, 0.8);
    assert.equal(split.clinical.head.relapseDrift, 0.6);
  }
});

test("recommendation view contains no clinical-risk marker fields", () => {
  const view = toRecommendationView(inferenceWith());
  const keys = new Set(Object.keys(view));
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    assert.equal(keys.has(id), false, `${id} present in recommendation view`);
    assert.equal(keys.has(AFFECT_HEADS[id].internalLabel), false);
  }
  // but the abstracted bands still encode the risk signal
  assert.equal(view.elevatedRegulationNeed, true); // depressive 0.8 / relapseDrift 0.6
  assert.doesNotThrow(() => assertNoClinicalLeak(view));
});

test("assertNoClinicalLeak throws when a raw clinical label is present", () => {
  const leaky = { dimensional: { valence: 0, arousal: 0 }, depressive_affect_markers: 0.9 };
  assert.throws(() => assertNoClinicalLeak(leaky), ClinicalLeakError);
});

test("abstaining inference still yields an abstained view with no clinical leak", () => {
  const view = toRecommendationView(neutralInference(asModelVersion("v1")));
  assert.equal(view.abstained, true);
  assert.doesNotThrow(() => assertNoClinicalLeak(view));
});

test("assertNoClinicalLeak throws when a forbidden id leaks as a string VALUE, not just a key", () => {
  // relapse_drift is a forbidden head id AND a live RelapseClass value — the exact
  // way a refactor could surface a clinical label without using a forbidden key.
  assert.throws(() => assertNoClinicalLeak({ headline: "relapse_drift" }), ClinicalLeakError);
  assert.throws(() => assertNoClinicalLeak({ tags: ["worsening", "depressive_affect_markers"] }), ClinicalLeakError);
  // benign string values are fine
  assert.doesNotThrow(() => assertNoClinicalLeak({ headline: "a pattern in your hum", tags: ["calm"] }));
});
