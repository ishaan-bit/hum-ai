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

test("manifest gate status flows into model provenance without changing the read (honesty metadata)", async () => {
  const input = { features: cleanHumFeatures(), consent: defaultConsent(now), modelVersion, now, history: matureHistory };
  const fake = new FakeLearnedPriorExpert({ calm_regulated: 0.5, neutral_close_to_usual: 0.5 });

  // A prior carrying gate status (as the signal-lab bridge sets it from model_manifest.json).
  const gated: LearnedAffectPrior = {
    ...priorOf(fake),
    gatePassed: false,
    gateNote: "population prior; affect target did NOT pass the 80% balanced_accuracy gate (balanced acc 47.9%).",
  };
  const read = await orchestrateHumRead({ ...input, learnedAffectPrior: gated });
  assert.equal(read.internal.modelProvenance.gatePassed, false);
  assert.match(read.internal.modelProvenance.gateNote ?? "", /did NOT pass/);

  // A prior WITHOUT gate fields → null (no false validation claim, no missing-field crash).
  const ungated = await orchestrateHumRead({ ...input, learnedAffectPrior: priorOf(fake) });
  assert.equal(ungated.internal.modelProvenance.gatePassed, null);
  assert.equal(ungated.internal.modelProvenance.gateNote, null);

  // Heuristic fallback carries null gate metadata (honest "unknown / not a trained model").
  const fallback = await orchestrateHumRead(input);
  assert.equal(fallback.internal.modelProvenance.gatePassed, null);
  assert.equal(fallback.internal.modelProvenance.gateNote, null);

  // Gate status is metadata ONLY — the fused inference is identical with or without it.
  assert.deepEqual(read.internal.inference, ungated.internal.inference);

  // The new provenance fields introduce no raw-audio-like key at any depth.
  assert.deepEqual(findRawAudioFields(read), []);
});
