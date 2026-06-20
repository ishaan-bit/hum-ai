import { strict as assert } from "node:assert";
import { test } from "node:test";
import { asModelVersion } from "@hum-ai/shared-types";
import {
  neutralInference,
  zeroStateScores,
  type MultiHeadAffectInference,
  type AffectStateHead,
} from "@hum-ai/affect-model-contracts";
import { clinicalRiskScore } from "../src/risk";

const MV = asModelVersion("risk-test@0.0.0");

// These mirror the downstream bands the score is compared against:
//  - relapse-engine longitudinal HIGH_RISK_BAND = 0.6 (risk_marker_present)
//  - personalization signature routing: high-risk >= 0.6, recovery <= 0.4
const HIGH_RISK_BAND = 0.6;
const RECOVERY_MAX = 0.4;

function inferWith(over: Partial<Record<AffectStateHead, number>>): MultiHeadAffectInference {
  return { ...neutralInference(MV), states: { ...zeroStateScores(), ...over } };
}

test("REGRESSION: the clinical high-risk band (0.6) is reachable — was structurally capped ~0.16", () => {
  // Before the fix, RISK_WEIGHTS weighted 5 heads v1 fusion never emits (incl. the
  // largest, depressive_affect_markers 0.22) and normalized by the full weight sum,
  // capping the score under 0.16 — so risk_marker_present / high-risk-signature
  // learning could never engage. A sadness- or anxiety-dominated hum must now cross 0.6.
  const sad = clinicalRiskScore(inferWith({ sadness_low_mood: 1 }));
  const anx = clinicalRiskScore(inferWith({ anxiety_like_tension: 1 }));
  assert.ok(sad >= HIGH_RISK_BAND, `sadness-dominated hum should cross the high-risk band, got ${sad}`);
  assert.ok(anx >= HIGH_RISK_BAND, `anxiety-dominated hum should cross the high-risk band, got ${anx}`);
});

test("calm / neutral / positive hums sit in the recovery zone (<= 0.4)", () => {
  assert.ok(clinicalRiskScore(inferWith({ neutral_close_to_usual: 1 })) <= RECOVERY_MAX);
  assert.ok(clinicalRiskScore(inferWith({ calm_regulated: 1 })) <= RECOVERY_MAX);
  assert.ok(clinicalRiskScore(inferWith({ joy_positive_activation: 1 })) <= RECOVERY_MAX);
});

test("score is bounded in [0,1] and monotonic in risk mass", () => {
  const low = clinicalRiskScore(inferWith({ sadness_low_mood: 0.2, neutral_close_to_usual: 0.8 }));
  const high = clinicalRiskScore(inferWith({ sadness_low_mood: 0.8, neutral_close_to_usual: 0.2 }));
  assert.ok(high > low, `more risk mass must raise the score (${low} -> ${high})`);
  assert.ok(low >= 0 && high <= 1, "score must stay in [0,1]");
});

test("only the heads v1 fusion can emit are scored — no dead weight, no NaN", () => {
  // Heads fusion never produces (depressive_affect_markers, stress_overload, …) must
  // not contribute and must not break the score (also guards the undefined -> NaN path).
  const ghost = clinicalRiskScore(inferWith({ sadness_low_mood: 1, depressive_affect_markers: 1, stress_overload: 1 }));
  assert.ok(Number.isFinite(ghost), "non-emitted heads must not produce NaN");
  assert.ok(ghost >= HIGH_RISK_BAND, "the reachable sadness mass still drives the score");
  // A hum whose mass is ONLY on a non-emitted head reads as no risk.
  assert.equal(clinicalRiskScore(inferWith({ stress_overload: 1 })), 0);
});
