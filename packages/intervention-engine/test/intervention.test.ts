import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion } from "@hum-ai/shared-types";
import { neutralInference, zeroStateScores, type MultiHeadAffectInference } from "@hum-ai/affect-model-contracts";
import { selectIntervention } from "@hum-ai/intervention-engine";

const base = (over: Partial<MultiHeadAffectInference> = {}): MultiHeadAffectInference => {
  const n = neutralInference(asModelVersion("v1"));
  return {
    ...n,
    abstained: false,
    abstainReason: "none",
    confidence: { ...n.confidence, abstained: false, abstainReason: "none", confidence: 0.7, confidencePercent: 70 },
    states: zeroStateScores(),
    uncertainty: 0.2,
    ...over,
  };
};

test("an abstaining read yields no intervention", () => {
  const out = selectIntervention(base({ abstained: true, abstainReason: "poor_capture_quality" }));
  assert.equal(out.type, "none");
});

test("high-arousal negative state → breath regulation", () => {
  const out = selectIntervention(base({ dimensional: { valence: -0.4, arousal: 0.6 } }));
  assert.equal(out.type, "breath_regulation");
  assert.ok(out.vaTarget!.arousal < 0.6); // steers arousal down
});

test("low-mood subdued state → social check-in", () => {
  const states = zeroStateScores();
  states.sadness_low_mood = 0.6;
  const out = selectIntervention(base({ dimensional: { valence: -0.4, arousal: -0.3 }, states }));
  assert.equal(out.type, "social_check_in");
});

test("escalation requires BOTH persistent pattern AND safety allowance", () => {
  const states = zeroStateScores();
  states.depressive_affect_markers = 0.8;
  const inf = base({ relapseDrift: 0.7, states, dimensional: { valence: -0.5, arousal: -0.2 } });

  // missing one gate → not escalation
  assert.notEqual(selectIntervention(inf, { persistentRiskPattern: true }).type, "escalation_suggestion");
  assert.notEqual(selectIntervention(inf, { safetyAllowsEscalation: true }).type, "escalation_suggestion");
  // both gates → escalation
  assert.equal(
    selectIntervention(inf, { persistentRiskPattern: true, safetyAllowsEscalation: true }).type,
    "escalation_suggestion",
  );
});

test("music recommendation cites intervention support, not diagnosis", () => {
  const out = selectIntervention(base({ dimensional: { valence: 0.4, arousal: 0.1 } }));
  assert.equal(out.type, "music_recommendation");
  assert.ok(out.sourceRefs.includes("intervention_support_source"));
});
