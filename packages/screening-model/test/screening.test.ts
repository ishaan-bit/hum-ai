import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import { computeFeatures, type AudioInput, type AcousticFeatures } from "@hum-ai/audio-features";
import { buildPhq9Response, type ClinicalHumExample } from "@hum-ai/affect-model-contracts";
import type { BinaryEvalResult } from "@hum-ai/signal-lab/evaluate-binary";
import { appendClinicalExample, emptyClinicalCorpus, type ClinicalCorpus } from "@hum-ai/clinical-corpus";
import { assessScreeningPromotion, buildScreeningSamples, DEFAULT_SCREENING_GATE, evaluateScreening } from "../src/screening";

const NOW = asIsoTimestamp("2026-06-22T10:00:00.000Z");

function humFeatures(freq: number, amp: number): AcousticFeatures {
  const sampleRate = 16000;
  const n = sampleRate * 12;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return computeFeatures({ sampleRate, samples } as AudioInput);
}

// Positive rows get total 18 (positive at ≥10) + a distinct acoustic cluster; negatives total 4.
const POS_PHQ = buildPhq9Response([2, 2, 2, 2, 2, 2, 2, 2, 2], NOW);
const NEG_PHQ = buildPhq9Response([1, 1, 1, 1, 0, 0, 0, 0, 0], NOW);

function row(id: string, participant: string, positive: boolean): ClinicalHumExample {
  return {
    id,
    participantPseudonym: participant,
    studyId: "study-1",
    capturedAt: NOW,
    features: positive ? humFeatures(300, 0.32) : humFeatures(120, 0.14),
    phq: positive ? POS_PHQ : NEG_PHQ,
    gad: null,
    captureQualityScore: 0.85,
    eligible: true,
    deviceClass: "ios_safari",
    featureSchemaVersion: "hum-acoustic-v2",
  };
}

function separableCorpus(): ClinicalCorpus {
  let c = emptyClinicalCorpus();
  for (let p = 0; p < 8; p++) {
    c = appendClinicalExample(c, row(`pos-${p}`, `participant-${p}`, true));
    c = appendClinicalExample(c, row(`neg-${p}`, `participant-${p}`, false));
  }
  return c;
}

test("buildScreeningSamples keeps only eligible rows carrying the instrument, grouped by participant", () => {
  let c = emptyClinicalCorpus();
  c = appendClinicalExample(c, row("a", "p-1", true));
  c = appendClinicalExample(c, row("b", "p-2", false));
  c = appendClinicalExample(c, { ...row("c", "p-3", true), eligible: false }); // excluded
  // anxiety target: no rows carry GAD → empty
  assert.equal(buildScreeningSamples(c, "anxiety").length, 0);
  const dep = buildScreeningSamples(c, "depression");
  assert.equal(dep.length, 2);
  assert.deepEqual(dep.map((s) => s.group).sort(), ["p-1", "p-2"]);
  assert.equal(dep.filter((s) => s.positive).length, 1);
});

test("evaluateScreening runs participant-grouped CV and returns a finite AUC on separable data", () => {
  const result = evaluateScreening(separableCorpus(), "depression", { seed: 7 });
  assert.equal(result.target, "phq9_ge_10");
  assert.equal(result.n, 16);
  assert.equal(result.groupCount, 8);
  assert.ok(Number.isFinite(result.auc));
  assert.ok(result.auc >= 0.5 && result.auc <= 1);
});

function fakeResult(over: Partial<BinaryEvalResult> = {}): BinaryEvalResult {
  return {
    task: "hum_screening_depression",
    target: "phq9_ge_10",
    n: 400,
    groupCount: 150,
    folds: 5,
    prevalence: 0.4,
    auc: 0.86,
    aucCI95: [0.78, 0.92],
    atDefaultThreshold: { threshold: 0.5, tp: 1, fp: 1, tn: 1, fn: 1, sensitivity: 0.85, specificity: 0.75, ppv: 0.7, npv: 0.8, accuracy: 0.8, balancedAccuracy: 0.8, f1: 0.77, youdenJ: 0.6 },
    atYoudenThreshold: { threshold: 0.42, tp: 1, fp: 1, tn: 1, fn: 1, sensitivity: 0.85, specificity: 0.75, ppv: 0.7, npv: 0.8, accuracy: 0.8, balancedAccuracy: 0.8, f1: 0.77, youdenJ: 0.6 },
    calibration: { bins: [], ece: 0.06 },
    significance: { test: "label_permutation_grouped_cv_auc", permutations: 100, nullMeanAuc: 0.5, pValue: 0.001 },
    evidence: { tier: "supported", rationale: "", caveats: [] },
    notes: [],
    ...over,
  };
}

test("promotion gate promotes only when EVERY pre-registered criterion clears", () => {
  assert.equal(assessScreeningPromotion(fakeResult()).decision, "promote");
});

test("promotion gate holds with reasons when a criterion fails", () => {
  const thinN = assessScreeningPromotion(fakeResult({ n: 50, groupCount: 20 }));
  assert.equal(thinN.decision, "hold");
  assert.ok(thinN.reasons.length >= 1);

  const lowAuc = assessScreeningPromotion(fakeResult({ auc: 0.62, aucCI95: [0.55, 0.7] }));
  assert.equal(lowAuc.decision, "hold");

  const badCal = assessScreeningPromotion(fakeResult({ calibration: { bins: [], ece: 0.3 } }));
  assert.equal(badCal.decision, "hold");
});

test("DEFAULT_SCREENING_GATE is a strict clinical-grade placeholder", () => {
  assert.ok(DEFAULT_SCREENING_GATE.minAuc >= 0.8);
  assert.ok(DEFAULT_SCREENING_GATE.maxPValue <= 0.01);
});
