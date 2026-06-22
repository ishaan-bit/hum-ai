import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asIsoTimestamp,
  asModelVersion,
  defaultConsent,
  findRawAudioFields,
  isRawAudioFieldName,
  type ConsentState,
} from "@hum-ai/shared-types";
import {
  AFFECT_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  assertNoClinicalLeak,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
} from "@hum-ai/affect-model-contracts";
import { isConfidenceCopySafe, validateUserFacingText } from "@hum-ai/safety-language";
import {
  orchestrateHumRead,
  type HumHistory,
  type LearnedAffectPrior,
  type OrchestratedRead,
  type AffectAxisPrior,
  type AxisPrediction,
} from "@hum-ai/orchestrator";
import { cleanHumFeatures, sampleHistory } from "./fixtures";

const now = asIsoTimestamp("2026-06-19T12:00:00.000Z");
const modelVersion = asModelVersion("learned-prior-test-v1");
const withConsent = (...scopes: ConsentState["grantedScopes"]): ConsentState => ({ grantedScopes: scopes, updatedAt: now });

const matureHistory: HumHistory = {
  eligibleSamplesByFeature: sampleHistory({ feature: "meanRms", total: 30, base: 0.09 }),
  priorEligibleCount: 30,
};

/**
 * A test double for a trained affect PRIOR, behind the standard `AffectExpert`
 * contract. It records that it was actually invoked (proving the seam wires it
 * into the ensemble) and emits a caller-chosen distribution.
 */
class FakeLearnedPriorExpert implements AffectExpert {
  readonly expertId = "test:fake-learned-prior";
  readonly modality = "audio" as const;
  readonly labelSpace: readonly string[];
  calls = 0;
  constructor(private readonly tilt: Readonly<Record<string, number>>) {
    this.labelSpace = Object.keys(tilt);
  }
  predict(_features: unknown, meta: ExpertInputMeta): Promise<ExpertOutput> {
    this.calls += 1;
    let total = 0;
    for (const v of Object.values(this.tilt)) total += v;
    const probabilities: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.tilt)) probabilities[k] = total > 0 ? v / total : 0;
    return Promise.resolve({
      expertId: this.expertId,
      modality: this.modality,
      available: meta.captureQuality > 0,
      probabilities,
      selfConfidence: 0.3,
      domainMatch: 0.45,
      oodScore: 0.4,
      notes: "test fake learned prior",
    });
  }
}

function priorOf(expert: AffectExpert, cap = 0.45): LearnedAffectPrior {
  return { expert, confidenceCap: cap, capReason: "test affect-prior far-domain penalty (ADR-0005)", artifact: "mem://test-model" };
}

test("an injected learned prior is actually fused and recorded in model provenance", async () => {
  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.5, neutral_close_to_usual: 0.5 });
  const read = await orchestrateHumRead({
    features: cleanHumFeatures(),
    consent: defaultConsent(now),
    modelVersion,
    now,
    history: matureHistory,
    learnedAffectPrior: priorOf(fake),
  });

  assert.ok(fake.calls > 0, "the injected learned prior must be invoked by the spine");
  assert.equal(read.internal.modelProvenance.kind, "learned_affect_prior");
  assert.equal(read.internal.modelProvenance.expertId, "test:fake-learned-prior");
  assert.equal(read.internal.modelProvenance.artifact, "mem://test-model");
  // Drop-in for the speech-emotion slot: replaced, not appended (still 6 experts).
  assert.equal(read.internal.modelProvenance.expertCount, 6);
});

test("the spine runs the heuristic fallback unchanged when no prior is supplied", async () => {
  const base = cleanHumFeatures();
  const input = { features: base, consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  const withoutPrior = await orchestrateHumRead(input);

  assert.equal(withoutPrior.internal.modelProvenance.kind, "heuristic_ensemble");
  assert.equal(withoutPrior.internal.modelProvenance.expertId, null);
  assert.equal(withoutPrior.internal.modelProvenance.expertCount, 6);

  // Shape is unchanged: the output is the same well-formed read either way.
  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.7, neutral_close_to_usual: 0.3 });
  const withPrior = await orchestrateHumRead({ ...input, learnedAffectPrior: priorOf(fake) });
  assert.deepEqual(Object.keys(withPrior).sort(), Object.keys(withoutPrior).sort());
  assert.deepEqual(Object.keys(withPrior.userFacing).sort(), Object.keys(withoutPrior.userFacing).sort());
});

test("a fused trained prior contributes its far-domain cap (ADR-0005); strictest wins", async () => {
  const base = cleanHumFeatures();
  const input = { features: base, consent: defaultConsent(now), modelVersion, now, history: matureHistory };

  const withoutPrior = await orchestrateHumRead(input);
  // A clean, mature hum's binding cap is well above the far-domain prior cap.
  assert.ok(withoutPrior.internal.inference.confidence.appliedCap > 0.45);
  assert.equal(/far-domain|ADR-0005/.test(withoutPrior.internal.inference.confidence.capReason), false);

  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.5, neutral_close_to_usual: 0.5 });
  const withPrior = await orchestrateHumRead({ ...input, learnedAffectPrior: priorOf(fake, 0.45) });
  const c = withPrior.internal.inference.confidence;
  assert.ok(c.appliedCap <= 0.45 + 1e-9, `expected far-domain prior cap to bind, got ${c.appliedCap}`);
  assert.ok(c.confidencePercent <= Math.floor(c.appliedCap * 100));
  assert.match(c.capReason, /far-domain|ADR-0005/);
});

test("claim/safety boundary holds with a risk-leaning trained prior, even with consent", async () => {
  // A prior that leans on the risk-adjacent broad states, run WITH clinical consent
  // (the strongest leak pressure) on a risk-leaning capture.
  const fake = new FakeLearnedPriorExpert({ low_mood: 0.5, tense_anxious: 0.4, neutral_close_to_usual: 0.1 });
  const read: OrchestratedRead = await orchestrateHumRead({
    features: cleanHumFeatures({ clarityScore: 0.2, residualInstabilityScore: 0.7, rmsEnergy: 0.06, activeFrameRatio: 0.45 }),
    consent: withConsent("local_processing", "clinical_risk_surfacing"),
    modelVersion,
    now,
    history: matureHistory,
    learnedAffectPrior: priorOf(fake),
  });

  // No clinical-risk label leaks to the user-facing or recommendation projections.
  assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
  assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
  const allKeys = (v: unknown, acc: Set<string> = new Set()): Set<string> => {
    if (v === null || typeof v !== "object") return acc;
    if (Array.isArray(v)) { for (const x of v) allKeys(x, acc); return acc; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { acc.add(k); allKeys(x, acc); }
    return acc;
  };
  const ufKeys = allKeys(read.userFacing);
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    assert.equal(ufKeys.has(id), false, `'${id}' leaked into user-facing output`);
    assert.equal(ufKeys.has(AFFECT_HEADS[id].internalLabel), false);
  }

  // User-facing copy stays qualitative and forbidden-phrase-free.
  const strings = [read.userFacing.headline, read.userFacing.note, read.userFacing.confidence.summary];
  if (read.userFacing.suggestion) strings.push(read.userFacing.suggestion.copy);
  for (const s of strings) {
    assert.equal(isConfidenceCopySafe(s), true, `raw confidence number in: "${s}"`);
    assert.equal(validateUserFacingText(s).ok, true, `forbidden phrase in: "${s}"`);
  }

  // The provenance field added for the learned prior introduces no raw-audio-like key.
  assert.deepEqual(findRawAudioFields(read), []);
  for (const key of allKeys(read)) assert.equal(isRawAudioFieldName(key), false, `raw-audio-like key '${key}'`);
});

/** A stub coarse-axis prior with a fixed prediction (orchestrator-level wiring proof). */
function stubAxisPrior(
  axis: "valence" | "arousal",
  pred: AxisPrediction,
  opts: { nativeDomain?: boolean } = {},
): AffectAxisPrior {
  return {
    axis,
    balancedAccuracy: 0.85,
    passedGate: true,
    nativeDomain: opts.nativeDomain,
    predict: () => pred,
  };
}

test("axisPriors thread end-to-end: a PROMOTED native prior steers internal.axis within its cap; an OOD prior does not", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };

  // Baseline: no prior → the transparent acoustic value leads, no trained contribution.
  const baseline = await orchestrateHumRead(input);
  const acoustic = baseline.internal.axis.arousal.value;
  assert.equal(baseline.internal.axis.arousal.trainedContribution, "absent");

  // A PROMOTED, in-domain hum-native prior (ADR-0011) leaning high MUST move the read
  // (proves the orchestrator actually threads input.axisPriors → resolveAxisRead → internal.axis,
  // which is the web app's effectiveAxisPriors path) — but stays bounded below its raw lean.
  const promoted = await orchestrateHumRead({
    ...input,
    axisPriors: { arousal: stubAxisPrior("arousal", { value: 0.95, ood: 0.05, inDomain: true, confidence: 0.9 }, { nativeDomain: true }) },
  });
  assert.equal(promoted.internal.axis.arousal.trainedContribution, "in_domain");
  assert.ok(promoted.internal.axis.arousal.value > acoustic, "a promoted in-domain native prior steers the read");
  assert.ok(promoted.internal.axis.arousal.value < 0.95, "even a native prior never fully overrides the acoustic backbone");

  // An UNPROMOTED / out-of-domain prior abstains: the read is unchanged from the acoustic value.
  const ood = await orchestrateHumRead({
    ...input,
    axisPriors: { arousal: stubAxisPrior("arousal", { value: 0.95, ood: 1, inDomain: false, confidence: 0 }) },
  });
  assert.equal(ood.internal.axis.arousal.trainedContribution, "abstained_ood");
  assert.equal(ood.internal.axis.arousal.value, acoustic, "an OOD/unpromoted prior leaves the read on the acoustic backbone");
});

// ---------------------------------------------------------------------------
// v3 PROMOTION-GATE ENFORCEMENT (Part A): a gate-FAILED learned prior is HELD —
// it may not steer the read or raise confidence, but its gate status survives as
// internal audit metadata. An unknown-gate prior is still fused (within its cap).
// ---------------------------------------------------------------------------

const gateFailedPrior = (fake: AffectExpert): LearnedAffectPrior => ({
  ...priorOf(fake),
  gatePassed: false,
  gateNote: "population prior; affect target did NOT pass the 80% balanced_accuracy gate (balanced acc 47.9%).",
});

test("v3: a gate-FAILED learned prior is HELD — the read is byte-identical to supplying NO prior (no steer, no confidence boost)", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  // A confident risk-leaning prior — the strongest pressure to sharpen/steer the fused read.
  const fake = new FakeLearnedPriorExpert({ low_mood: 0.6, tense_anxious: 0.3, neutral_close_to_usual: 0.1 });

  const noPrior = await orchestrateHumRead(input);
  const held = await orchestrateHumRead({ ...input, learnedAffectPrior: gateFailedPrior(fake) });

  // The failed-gate prior never ran (it was held out of the ensemble)…
  assert.equal(fake.calls, 0, "a gate-failed prior must not even be invoked by the spine");
  // …so the steering read is identical to supplying no prior at all.
  assert.deepEqual(held.internal.inference, noPrior.internal.inference, "held prior must not change the inference");
  assert.deepEqual(held.internal.axis, noPrior.internal.axis, "held prior must not change the axis read");
  assert.deepEqual(held.userFacing, noPrior.userFacing, "held prior must not change user-facing copy/confidence");

  // But the gate status SURVIVES as audit metadata (transparency, not steering).
  assert.equal(held.internal.modelProvenance.kind, "heuristic_ensemble");
  assert.equal(held.internal.modelProvenance.priorContribution, "held_failed_gate");
  assert.equal(held.internal.modelProvenance.gatePassed, null, "no STEERING prior ⇒ null gate on the steering slot");
  assert.ok(held.internal.modelProvenance.heldPrior, "the held prior is recorded for audit");
  assert.equal(held.internal.modelProvenance.heldPrior!.gatePassed, false);
  assert.match(held.internal.modelProvenance.heldPrior!.gateNote ?? "", /did NOT pass/);

  // No raw-audio-like key introduced by the new audit field, at any depth.
  assert.deepEqual(findRawAudioFields(held), []);
});

test("v3: a gate-FAILED prior does not improve fusion confidence", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  // A maximally-confident single-state prior would (if fused) sharpen the distribution and
  // could lift fusion confidence up to the cap. Held, it must have ZERO effect.
  const peaky = new FakeLearnedPriorExpert({ calm_regulated: 0.98, neutral_close_to_usual: 0.02 });
  const noPrior = await orchestrateHumRead(input);
  const held = await orchestrateHumRead({ ...input, learnedAffectPrior: gateFailedPrior(peaky) });
  assert.equal(
    held.internal.inference.confidence.confidence,
    noPrior.internal.inference.confidence.confidence,
    "a held gate-failed prior must not raise fusion confidence",
  );
});

test("v3: an UNKNOWN-gate prior is still fused (conservative cap applies, gate-failure is the only hold trigger)", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.5, neutral_close_to_usual: 0.5 });
  // priorOf() sets no gatePassed ⇒ undefined ⇒ NOT a known failure ⇒ fused within the far-domain cap.
  const read = await orchestrateHumRead({ ...input, learnedAffectPrior: priorOf(fake) });
  assert.ok(fake.calls > 0, "an unknown-gate prior is still fused (steers within its cap)");
  assert.equal(read.internal.modelProvenance.kind, "learned_affect_prior");
  assert.equal(read.internal.modelProvenance.priorContribution, "fused");
  assert.equal(read.internal.modelProvenance.gatePassed, null, "unknown gate ⇒ null (no false validation claim)");
  assert.equal(read.internal.modelProvenance.heldPrior, null);
  // The far-domain cap still binds — an unverified prior cannot run confidence away.
  assert.ok(read.internal.inference.confidence.appliedCap <= 0.45 + 1e-9);
});

test("v3: a gate-PASSED far-domain learned prior is fused and steers the secondary read (within its cap)", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.6, neutral_close_to_usual: 0.4 });
  const passed: LearnedAffectPrior = { ...priorOf(fake), gatePassed: true, gateNote: "gate PASSED" };
  const read = await orchestrateHumRead({ ...input, learnedAffectPrior: passed });
  assert.ok(fake.calls > 0, "a gate-passed prior is fused");
  assert.equal(read.internal.modelProvenance.kind, "learned_affect_prior");
  assert.equal(read.internal.modelProvenance.priorContribution, "fused");
  assert.equal(read.internal.modelProvenance.gatePassed, true);
  assert.ok(read.internal.inference.confidence.appliedCap <= 0.45 + 1e-9, "far-domain cap still binds");
});
