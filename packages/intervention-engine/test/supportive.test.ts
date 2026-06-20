import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecommendationView } from "@hum-ai/affect-model-contracts";
import { supportiveCandidates, buildSupportiveSuggestion, isSupportiveIntervention } from "@hum-ai/intervention-engine";

const view = (over: Partial<RecommendationView> = {}): RecommendationView => ({
  abstained: false,
  dimensional: { valence: 0, arousal: 0 },
  uncertainty: 0.3,
  elevatedRegulationNeed: false,
  lowEnergyPattern: false,
  lowMoodPattern: false,
  mixedOrUncertain: false,
  ...over,
});

test("isSupportiveIntervention excludes none and escalation", () => {
  assert.equal(isSupportiveIntervention("music_recommendation"), true);
  assert.equal(isSupportiveIntervention("breath_regulation"), true);
  assert.equal(isSupportiveIntervention("none"), false);
  assert.equal(isSupportiveIntervention("escalation_suggestion"), false);
});

test("supportiveCandidates returns the safe option set per V-A region", () => {
  const tense = supportiveCandidates(view({ dimensional: { valence: -0.4, arousal: 0.5 } }));
  assert.ok(tense.includes("breath_regulation") && tense.length > 1);

  const low = supportiveCandidates(view({ dimensional: { valence: -0.3, arousal: -0.3 } }));
  assert.ok(low.includes("rest_recovery") && low.includes("social_check_in"));

  assert.deepEqual(supportiveCandidates(view({ dimensional: { valence: 0.05, arousal: 0.05 } })), []);
  assert.deepEqual(supportiveCandidates(view({ abstained: true })), []);
});

test("buildSupportiveSuggestion produces a valid suggestion for the chosen type", () => {
  const s = buildSupportiveSuggestion("breath_regulation", view({ dimensional: { valence: -0.4, arousal: 0.5 } }));
  assert.equal(s.type, "breath_regulation");
  assert.ok(s.vaTarget && s.vaTarget.arousal < 0.5, "nudges arousal downward");
  assert.ok(s.intensity > 0);
});
