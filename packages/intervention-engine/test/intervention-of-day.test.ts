import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecommendationView } from "@hum-ai/affect-model-contracts";
import type { EvidenceLevel } from "@hum-ai/safety-language";
import {
  selectInterventionOfDay,
  selectTemplateForState,
  regulationStateFor,
  assertInterventionOfDaySafe,
  deriveRegulationState,
  HUM_REGULATION_STATES,
  INTERVENTION_CATEGORIES,
  type HumRegulationState,
  type InterventionOfDayInput,
} from "@hum-ai/intervention-engine";

const ALL_EVIDENCE = ["early_baseline", "low", "medium", "high"] as const;
const DOWNSHIFT = ["breath_regulation", "grounding", "music_regulation", "movement_reset", "reduce_load", "rest_recovery"];

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

const input = (over: Partial<InterventionOfDayInput> = {}): InterventionOfDayInput => ({
  view: view(),
  captureUsable: true,
  evidence: "medium",
  baselineMature: true,
  ...over,
});

/** A representative input that deterministically derives each canonical state. */
const STATE_INPUTS: Readonly<Record<HumRegulationState, InterventionOfDayInput>> = {
  calm_regulated: input({ view: view({ dimensional: { valence: 0.4, arousal: -0.3 } }) }),
  positive_activation: input({ view: view({ dimensional: { valence: 0.6, arousal: 0.5 } }) }),
  high_activation_negative: input({ view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) }),
  low_recovery: input({ view: view({ dimensional: { valence: -0.3, arousal: -0.4 }, lowEnergyPattern: true }) }),
  low_mood: input({ view: view({ dimensional: { valence: -0.4, arousal: -0.3 }, lowMoodPattern: true }) }),
  mixed_unsettled: input({ view: view({ mixedOrUncertain: true }) }),
  neutral_usual: input({ view: view({ dimensional: { valence: 0, arousal: 0 } }) }),
  needs_support: input({ longitudinal: { drifting: true, persistent: true } }),
  poor_capture: input({ captureUsable: false }),
  low_confidence: input({ view: view({ abstained: true }) }),
  not_enough_history: input({ view: view({ abstained: true }), baselineMature: false }),
};

// --- 1. state-to-intervention mapping for EVERY canonical state -------------

test("every canonical state maps to a valid, safe, 1-5 minute intervention", () => {
  for (const state of HUM_REGULATION_STATES) {
    const inp = STATE_INPUTS[state];
    assert.equal(regulationStateFor(inp), state, `input did not derive '${state}'`);

    const iod = selectInterventionOfDay(inp);
    assert.ok(INTERVENTION_CATEGORIES.includes(iod.category), `bad category for ${state}: ${iod.category}`);
    assert.ok(iod.title.length > 0 && iod.instruction.length > 0 && iod.whySuggested.length > 0);
    assert.ok(iod.durationMinutes >= 1 && iod.durationMinutes <= 5, `duration out of range for ${state}`);
    assert.doesNotThrow(() => assertInterventionOfDaySafe(iod), `unsafe copy for ${state}`);
    // whySuggested is a single sentence (one terminal period).
    assert.equal((iod.whySuggested.match(/\./g) ?? []).length, 1, `whySuggested not one sentence for ${state}`);
  }
});

// --- 2-8. design principles per affect region ------------------------------

const inSet = (cat: string, allowed: readonly string[]) => assert.ok(allowed.includes(cat), `unexpected category ${cat}`);

test("high arousal + negative valence → downshift (breath/grounding/settle/reduce)", () => {
  const inp = input({ view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) });
  assert.equal(regulationStateFor(inp), "high_activation_negative");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["breath_regulation", "grounding", "music_regulation", "movement_reset", "reduce_load", "rest_recovery"]);
  assert.match(iod.whySuggested, /activation|steadi/i);
});

test("low recovery / fatigue → rest/recovery, never an energising push", () => {
  const inp = input({ view: view({ dimensional: { valence: -0.3, arousal: -0.4 }, lowEnergyPattern: true }) });
  assert.equal(regulationStateFor(inp), "low_recovery");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["rest_recovery", "movement_reset", "reduce_load"]);
  assert.doesNotMatch(iod.instruction, /brisk|energ(y|ising|ize)|push harder|work out/i);
});

test("sadness / low-mood markers → gentle activation, no claim of treating depression", () => {
  const inp = input({ view: view({ dimensional: { valence: -0.4, arousal: -0.3 }, lowMoodPattern: true }) });
  assert.equal(regulationStateFor(inp), "low_mood");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["movement_reset", "rest_recovery", "grounding", "social_check_in", "music_regulation", "journaling"]);
  assert.doesNotMatch(`${iod.title} ${iod.instruction} ${iod.whySuggested}`, /depress|treat|cure/i);
});

test("anger/frustration shares the downshift region AND has a reachable discharge step", () => {
  // The safe view collapses anger/anxiety/fear into one V-A region by design (ADR-0006);
  // a physical-discharge movement step (step away, unclench, short walk) is reachable.
  const inp = input({ view: view({ dimensional: { valence: -0.5, arousal: 0.6 } }) });
  assert.equal(regulationStateFor(inp), "high_activation_negative");
  let foundDischarge = false;
  for (let seed = 0; seed < 12; seed++) {
    const iod = selectInterventionOfDay({ ...inp, rotationSeed: seed });
    inSet(iod.category, DOWNSHIFT);
    if (iod.id === "unclench_walk" || iod.category === "movement_reset") foundDischarge = true;
  }
  assert.ok(foundDischarge, "expected a movement/discharge step to be reachable for anger/frustration");
});

test("calm / regulated → maintain, do not over-intervene", () => {
  const inp = input({ view: view({ dimensional: { valence: 0.4, arousal: -0.3 } }) });
  assert.equal(regulationStateFor(inp), "calm_regulated");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["no_action_needed", "music_regulation", "journaling"]);
});

test("excitement / positive activation → channel into one focused thing", () => {
  const inp = input({ view: view({ dimensional: { valence: 0.6, arousal: 0.5 } }) });
  assert.equal(regulationStateFor(inp), "positive_activation");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["journaling", "music_regulation"]);
});

test("mixed / unstable → simplify, one grounding action", () => {
  const inp = input({ view: view({ mixedOrUncertain: true }) });
  assert.equal(regulationStateFor(inp), "mixed_unsettled");
  const iod = selectInterventionOfDay(inp);
  inSet(iod.category, ["reduce_load", "grounding", "journaling", "music_regulation", "breath_regulation", "rest_recovery"]);
});

// --- 9-11. capture / confidence / history ----------------------------------

test("poor capture → repeat capture, NO emotional interpretation", () => {
  const inp = input({ captureUsable: false, view: view({ dimensional: { valence: -0.5, arousal: 0.7 } }) });
  assert.equal(regulationStateFor(inp), "poor_capture");
  const iod = selectInterventionOfDay(inp);
  assert.equal(iod.category, "repeat_capture");
  // basedOnSignals must NOT claim any emotional read.
  for (const s of iod.basedOnSignals) assert.doesNotMatch(s, /activ|pleasant|mood|settled/i);
  assert.match(iod.whySuggested, /clear|read/i);
});

test("low confidence / abstain (mature baseline) → cautious general grounding", () => {
  const inp = input({ view: view({ abstained: true }), baselineMature: true });
  assert.equal(regulationStateFor(inp), "low_confidence");
  const iod = selectInterventionOfDay(inp);
  assert.equal(iod.category, "grounding");
  assert.match(iod.whySuggested, /confiden|read/i);
});

test("pre-baseline: weak read stays general; a confident read leads from hum #1 (ADR-0010)", () => {
  // An abstained read pre-baseline never infers affect.
  const abstainedYoung = input({ view: view({ abstained: true }), baselineMature: false });
  assert.equal(regulationStateFor(abstainedYoung), "not_enough_history");

  // A committed read that is too weak to lean on (below `low`) still falls back to general.
  const weakYoung = input({
    view: view({ dimensional: { valence: -0.5, arousal: 0.7 } }),
    baselineMature: false,
    evidence: "early_baseline",
  });
  assert.equal(regulationStateFor(weakYoung), "not_enough_history");
  assert.match(selectInterventionOfDay(weakYoung).whySuggested, /baseline|forming|general/i);

  // A CONFIDENT committed read leads from the first hum: it derives its affect region even
  // before a personal baseline, and the copy makes NO comparison to a "usual" that doesn't
  // exist yet.
  const confidentYoung = input({
    view: view({ dimensional: { valence: -0.5, arousal: 0.7 } }),
    baselineMature: false,
    evidence: "medium",
  });
  assert.equal(regulationStateFor(confidentYoung), "high_activation_negative");
  const iod = selectInterventionOfDay(confidentYoung);
  assert.doesNotMatch(iod.whySuggested, /your usual|your recent baseline|baseline is still forming/i);
  assert.doesNotMatch(iod.basedOnSignals.join(" "), /recent baseline/i);
  assert.doesNotThrow(() => assertInterventionOfDaySafe(iod));
});

// --- 12. relapse_drift / worsening with safe copy + escalation gating -------

test("sustained worsening / relapse-drift → needs_support with SAFE copy", () => {
  const inp = input({
    view: view({ dimensional: { valence: -0.3, arousal: 0.1 }, elevatedRegulationNeed: true }),
    longitudinal: { drifting: true, persistent: true },
  });
  assert.equal(regulationStateFor(inp), "needs_support");
  const iod = selectInterventionOfDay(inp);
  assert.doesNotThrow(() => assertInterventionOfDaySafe(iod));
  assert.doesNotMatch(`${iod.whySuggested} ${iod.safetyNote ?? ""}`, /diagnos|prevent|relapse|treat|cure/i);
});

test("escalation copy is gated by the safety flag AND persistence", () => {
  const base = input({
    view: view({ dimensional: { valence: -0.3, arousal: 0.1 } }),
    longitudinal: { drifting: true, persistent: true },
  });

  // No consent → escalation present but not shown, and carries no copy.
  const withheld = selectInterventionOfDay({ ...base, safetyAllowsEscalation: false });
  assert.equal(withheld.escalation?.show, false);
  assert.equal(withheld.escalation?.copy, undefined);

  // Consent + persistent → escalation shown with safe copy.
  const shown = selectInterventionOfDay({ ...base, safetyAllowsEscalation: true });
  assert.equal(shown.escalation?.show, true);
  assert.ok((shown.escalation?.copy ?? "").length > 0);
  assert.doesNotThrow(() => assertInterventionOfDaySafe(shown));

  // Consent but NOT persistent → not shown.
  const notPersistent = selectInterventionOfDay({
    ...base,
    longitudinal: { drifting: true, persistent: false },
    safetyAllowsEscalation: true,
  });
  // not persistent → state is not needs_support, so no escalation block at all.
  assert.notEqual(regulationStateFor({ ...base, longitudinal: { drifting: true, persistent: false } }), "needs_support");
  assert.equal(notPersistent.escalation, undefined);
});

// --- confidence language + uncertainty surfacing ---------------------------

test("evidence band maps to confidence language; low evidence surfaces uncertainty", () => {
  const cases: ReadonlyArray<[EvidenceLevel, string]> = [
    ["early_baseline", "early_signal"],
    ["low", "low_evidence"],
    ["medium", "moderate_evidence"],
    ["high", "stronger_evidence"],
  ];
  for (const [evidence, expected] of cases) {
    const iod = selectInterventionOfDay(input({ evidence, view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) }));
    assert.equal(iod.confidenceLanguage, expected);
  }
  // An interpreted read at low evidence explicitly flags the uncertainty in copy.
  const lowConf = selectInterventionOfDay(input({ evidence: "low", view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) }));
  assert.match(lowConf.whySuggested, /early.*low-confidence|low-confidence/i);
});

// --- determinism -----------------------------------------------------------

test("selection is deterministic per input and rotates safely by seed", () => {
  const inp = input({ view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) });
  assert.equal(selectInterventionOfDay({ ...inp, rotationSeed: 7 }).id, selectInterventionOfDay({ ...inp, rotationSeed: 7 }).id);
  // Every seed in a sweep yields a valid, safe step in the right region.
  for (let seed = 0; seed < 12; seed++) {
    const iod = selectInterventionOfDay({ ...inp, rotationSeed: seed });
    assert.doesNotThrow(() => assertInterventionOfDaySafe(iod));
    assert.ok(INTERVENTION_CATEGORIES.includes(iod.category));
  }
  // Negative seeds don't crash.
  assert.doesNotThrow(() => selectInterventionOfDay({ ...inp, rotationSeed: -3 }));
});

// --- deriver direct (sanitized view only) ----------------------------------

test("deriveRegulationState reads only the sanitized view + safe meta", () => {
  assert.equal(
    deriveRegulationState(view({ dimensional: { valence: -0.4, arousal: 0.6 } }), {
      captureUsable: true,
      baselineMature: true,
    }),
    "high_activation_negative",
  );
});

// --- review-driven regressions ---------------------------------------------

test("a clearly unpleasant read with mild arousal is never called 'usual' or 'steady'", () => {
  for (const arousal of [0, 0.1, 0.2, 0.24]) {
    const st = regulationStateFor(input({ view: view({ dimensional: { valence: -0.6, arousal } }) }));
    assert.notEqual(st, "neutral_usual", `valence -0.6, arousal ${arousal} wrongly mapped to neutral_usual`);
    assert.notEqual(st, "calm_regulated", `valence -0.6, arousal ${arousal} wrongly mapped to calm_regulated`);
  }
});

test("a clear strong-affect read keeps its downshift even when mixedOrUncertain is set", () => {
  // bare meta-uncertainty must not override a confident high-activation-negative read.
  const v = view({ dimensional: { valence: -0.6, arousal: 0.7 }, mixedOrUncertain: true });
  assert.equal(regulationStateFor({ ...input(), view: v }), "high_activation_negative");
});

test("non-finite rotationSeed (NaN/±Infinity) does not crash and yields a valid, safe step", () => {
  const inp = input({ view: view({ dimensional: { valence: -0.4, arousal: 0.6 } }) });
  for (const seed of [NaN, Infinity, -Infinity]) {
    const iod = selectInterventionOfDay({ ...inp, rotationSeed: seed });
    assert.ok(iod.id.length > 0);
    assert.doesNotThrow(() => assertInterventionOfDaySafe(iod));
  }
  assert.doesNotThrow(() => selectTemplateForState("high_activation_negative", "high", true, NaN));
});

test("needs_support surfaces tentative, non-diagnostic framing at EVERY evidence band", () => {
  const base = input({ longitudinal: { drifting: true, persistent: true } });
  assert.equal(regulationStateFor(base), "needs_support");
  for (const evidence of ALL_EVIDENCE) {
    const iod = selectInterventionOfDay({ ...base, evidence });
    assert.match(iod.whySuggested, /tentative|gently note|not a conclusion/i, `no hedge at ${evidence}`);
    // a sustained trend must NOT be tagged as a single-read "low-confidence read".
    assert.doesNotMatch(iod.whySuggested, /low-confidence read/i, `contradictory tag at ${evidence}`);
    assert.doesNotThrow(() => assertInterventionOfDaySafe(iod));
  }
});

test("needs_support basedOnSignals reflects the trend, not a per-hum affective read", () => {
  const iod = selectInterventionOfDay(input({ longitudinal: { drifting: true, persistent: true } }));
  for (const s of iod.basedOnSignals) assert.doesNotMatch(s, /how activated|pleasant or settled/i);
  assert.ok(iod.basedOnSignals.some((s) => /trend/i.test(s)), "needs_support should cite the trend");
});

test("mixed_unsettled has a steady low-complexity music option (brief: mixed → steady track)", () => {
  let foundSteady = false;
  for (let seed = 0; seed < 16; seed++) {
    const iod = selectInterventionOfDay(input({ view: view({ mixedOrUncertain: true }), evidence: "high", rotationSeed: seed }));
    if (iod.id === "music_steady") foundSteady = true;
  }
  assert.ok(foundSteady, "expected a steady music step to be reachable for mixed_unsettled");
});
