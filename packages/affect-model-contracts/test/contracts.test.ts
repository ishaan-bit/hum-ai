import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_AFFECT_HEADS,
  AFFECT_HEADS,
  AFFECT_STATE_HEADS,
  RISK_MARKER_HEADS,
  neutralInference,
  missingExpertOutput,
} from "@hum-ai/affect-model-contracts";
import { asModelVersion } from "@hum-ai/shared-types";

test("every project-brief head exists in the registry", () => {
  // The 22 heads from the brief.
  const expected = [
    "valence",
    "arousal",
    "calm_regulated",
    "joy_positive_activation",
    "excitement",
    "stress_overload",
    "anger_frustration",
    "anxiety_like_tension",
    "fear_like_activation",
    "sadness_low_mood",
    "depressive_affect_markers",
    "fatigue_low_recovery",
    "emotional_instability",
    "flattened_affect",
    "cognitive_attention_strain_later",
    "relapse_drift",
    "recovery_worsening_unchanged",
    "mixed_state",
    "neutral_close_to_usual",
    "uncertainty",
    "abstain_reason",
    "recommended_intervention",
  ];
  for (const h of expected) {
    assert.ok(ALL_AFFECT_HEADS.includes(h as (typeof ALL_AFFECT_HEADS)[number]), `missing head: ${h}`);
    assert.ok(AFFECT_HEADS[h as keyof typeof AFFECT_HEADS], `missing spec: ${h}`);
  }
  assert.equal(ALL_AFFECT_HEADS.length, expected.length);
});

test("clinical-risk markers are flagged and the obvious benign heads are not", () => {
  for (const h of ["depressive_affect_markers", "anxiety_like_tension", "relapse_drift"]) {
    assert.ok(RISK_MARKER_HEADS.includes(h as (typeof RISK_MARKER_HEADS)[number]), `${h} must be a risk marker`);
  }
  assert.equal(AFFECT_HEADS.valence.riskMarker, false);
  assert.equal(AFFECT_HEADS.calm_regulated.riskMarker, false);
});

test("future-reserved head is not user-visible", () => {
  assert.equal(AFFECT_HEADS.cognitive_attention_strain_later.userVisible, false);
});

test("neutral inference abstains and is centered", () => {
  const inf = neutralInference(asModelVersion("test-v0"));
  assert.equal(inf.abstained, true);
  assert.equal(inf.dimensional.valence, 0);
  assert.equal(inf.states.neutral_close_to_usual, 1);
  assert.equal(inf.recoveryWorseningUnchanged, null);
  // all state heads exist
  for (const h of AFFECT_STATE_HEADS) assert.equal(typeof inf.states[h], "number");
});

test("missing expert output is marked unavailable", () => {
  const out = missingExpertOutput("expert-ser:hum-acoustic", "audio");
  assert.equal(out.available, false);
  assert.equal(out.selfConfidence, 0);
  assert.equal(out.oodScore, 1);
});
