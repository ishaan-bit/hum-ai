import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AFFECT_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  assertNoClinicalLeak,
  type RecommendationView,
} from "@hum-ai/affect-model-contracts";
import { validateUserFacingText, isConfidenceCopySafe, type EvidenceLevel } from "@hum-ai/safety-language";
import {
  selectInterventionOfDay,
  interventionOfDayStrings,
  INTERVENTION_TEMPLATES,
  INTERVENTION_CATEGORIES,
  HUM_REGULATION_STATES,
  NOT_BASED_ON,
  type InterventionOfDayInput,
  type HumRegulationState,
} from "@hum-ai/intervention-engine";

// --- helpers ---------------------------------------------------------------

const view = (over: Partial<RecommendationView> = {}): RecommendationView => ({
  abstained: false,
  dimensional: { valence: 0, arousal: 0 },
  uncertainty: 0.2,
  elevatedRegulationNeed: false,
  lowEnergyPattern: false,
  lowMoodPattern: false,
  mixedOrUncertain: false,
  ...over,
});

const STATE_VIEW: Readonly<Record<HumRegulationState, Partial<InterventionOfDayInput>>> = {
  calm_regulated: { view: view({ dimensional: { valence: 0.4, arousal: -0.3 } }) },
  positive_activation: { view: view({ dimensional: { valence: 0.6, arousal: 0.5 } }) },
  high_activation_negative: { view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) },
  low_recovery: { view: view({ dimensional: { valence: -0.3, arousal: -0.4 }, lowEnergyPattern: true }) },
  low_mood: { view: view({ dimensional: { valence: -0.4, arousal: -0.3 }, lowMoodPattern: true }) },
  mixed_unsettled: { view: view({ mixedOrUncertain: true }) },
  neutral_usual: { view: view({ dimensional: { valence: 0, arousal: 0 } }) },
  needs_support: { longitudinal: { drifting: true, persistent: true } },
  poor_capture: { captureUsable: false },
  low_confidence: { view: view({ abstained: true }) },
  not_enough_history: { view: view({ abstained: true }), baselineMature: false },
};

const EVIDENCE: readonly EvidenceLevel[] = ["early_baseline", "low", "medium", "high"];

/** Every produced InterventionOfDay across states × evidence × escalation flag. */
function* sweep(): Generator<ReturnType<typeof selectInterventionOfDay>> {
  for (const state of HUM_REGULATION_STATES) {
    for (const evidence of EVIDENCE) {
      for (const safetyAllowsEscalation of [false, true]) {
        for (const rotationSeed of [0, 1, 2, 5]) {
          const base: InterventionOfDayInput = {
            view: view(),
            captureUsable: true,
            evidence,
            baselineMature: state !== "not_enough_history",
            safetyAllowsEscalation,
            rotationSeed,
            ...STATE_VIEW[state],
          };
          yield selectInterventionOfDay(base);
        }
      }
    }
  }
}

/** Tokens that must never appear in user-facing intervention text. */
const FORBIDDEN_CLINICAL_TOKENS: readonly string[] = [
  ...CLINICAL_RISK_MARKER_HEAD_IDS,
  ...CLINICAL_RISK_MARKER_HEAD_IDS.map((id) => AFFECT_HEADS[id].internalLabel),
];

// --- 15. all user-facing intervention text passes safety-language ----------

test("every produced intervention string passes safety-language and carries no raw % ", () => {
  let count = 0;
  for (const iod of sweep()) {
    for (const s of interventionOfDayStrings(iod)) {
      count++;
      const r = validateUserFacingText(s);
      assert.equal(r.ok, true, `forbidden phrase in: "${s}" (${r.violations.map((v) => v.phrase).join(", ")})`);
      assert.equal(isConfidenceCopySafe(s), true, `raw confidence number in: "${s}"`);
    }
  }
  assert.ok(count > 0);
});

// --- 14. no treatment / diagnosis / prevention claims ----------------------

test("no intervention string makes a treatment / diagnosis / prevention claim", () => {
  const forbidden = /\b(diagnos\w*|treats?|cures?|therap(y|eutic) for)\b|prevents? relapse|clinically (validated|certain)/i;
  for (const iod of sweep()) {
    for (const s of interventionOfDayStrings(iod)) {
      assert.doesNotMatch(s, forbidden, `clinical/treatment claim in: "${s}"`);
    }
  }
});

// --- 13. no clinical label leak in user-facing output ----------------------

test("no clinical head id / internal label leaks into the intervention output", () => {
  for (const iod of sweep()) {
    // structural: no clinical key anywhere in the object (ADR-0006 guard)
    assert.doesNotThrow(() => assertNoClinicalLeak(iod));
    // textual: no raw clinical token appears in any user-facing string
    for (const s of interventionOfDayStrings(iod)) {
      const lower = s.toLowerCase();
      for (const token of FORBIDDEN_CLINICAL_TOKENS) {
        assert.equal(lower.includes(token.toLowerCase()), false, `clinical token "${token}" in: "${s}"`);
      }
    }
  }
});

test("notBasedOn explicitly disclaims clinical/medical scope and itself passes safety", () => {
  assert.ok(NOT_BASED_ON.length > 0);
  for (const s of NOT_BASED_ON) {
    assert.equal(validateUserFacingText(s).ok, true, `notBasedOn line unsafe: "${s}"`);
  }
  assert.ok(NOT_BASED_ON.some((s) => /clinical|medical/i.test(s)));
  assert.ok(NOT_BASED_ON.some((s) => /camera|photo|video/i.test(s)));
});

// --- 16. music intervention scope is regulation only -----------------------

test("music templates are regulation support only — cited, scoped, never treatment/diagnosis", () => {
  const REG_TARGETS = ["settle", "steady", "gentle_lift", "maintain", "focused_momentum"];
  const music = INTERVENTION_TEMPLATES.filter((t) => t.category === "music_regulation");
  assert.ok(music.length >= 3, "expected several music templates");
  for (const t of music) {
    assert.ok(t.sourceRefs.includes("intervention_support_source"), `${t.id} missing music evidence ref`);
    assert.ok(t.musicTarget && REG_TARGETS.includes(t.musicTarget), `${t.id} bad music target`);
    const blob = `${t.title} ${t.instruction} ${t.whyAction}`;
    assert.equal(validateUserFacingText(blob).ok, true, `${t.id} music copy unsafe`);
    assert.doesNotMatch(blob, /depress|diagnos|treat|cure|anxiet/i, `${t.id} music copy over-claims`);
  }
});

// --- template library integrity --------------------------------------------

test("template library: 25-40 templates, unique ids, 1-5 min, every category used", () => {
  assert.ok(INTERVENTION_TEMPLATES.length >= 25 && INTERVENTION_TEMPLATES.length <= 40, `count=${INTERVENTION_TEMPLATES.length}`);

  const ids = INTERVENTION_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate template ids");

  for (const t of INTERVENTION_TEMPLATES) {
    assert.ok(t.durationMinutes >= 1 && t.durationMinutes <= 5, `${t.id} duration out of range`);
    assert.ok(t.intensity === "low" || t.intensity === "moderate", `${t.id} bad intensity`);
    assert.ok(t.title.length > 0 && t.instruction.length > 0 && t.whyAction.length > 0);
  }

  const usedCategories = new Set(INTERVENTION_TEMPLATES.map((t) => t.category));
  for (const cat of INTERVENTION_CATEGORIES) {
    assert.ok(usedCategories.has(cat), `category '${cat}' has no template`);
  }
});

test("every canonical state is covered by at least one template", () => {
  for (const state of HUM_REGULATION_STATES) {
    const covering = INTERVENTION_TEMPLATES.filter(
      (t) => t.targetStates.includes(state) && !t.contraindicatedStates.includes(state),
    );
    assert.ok(covering.length > 0, `state '${state}' has no covering template`);
  }
});

test("each template's contraindicated states never overlap its target states", () => {
  for (const t of INTERVENTION_TEMPLATES) {
    for (const c of t.contraindicatedStates) {
      assert.equal(t.targetStates.includes(c), false, `${t.id} targets and contraindicates '${c}'`);
    }
  }
});

test("every canonical state has a baseline-free, early_baseline-eligible fallback (selection is total)", () => {
  // Guarantees selectTemplateForState never comes up empty at the lowest evidence /
  // pre-baseline — so the safety-net branch is provably unreachable, not incidental.
  for (const state of HUM_REGULATION_STATES) {
    const fallback = INTERVENTION_TEMPLATES.filter(
      (t) =>
        t.targetStates.includes(state) &&
        !t.contraindicatedStates.includes(state) &&
        !t.requiresBaselineMature &&
        t.minEvidence === "early_baseline",
    );
    assert.ok(fallback.length > 0, `state '${state}' has no early_baseline, baseline-free fallback template`);
  }
});
