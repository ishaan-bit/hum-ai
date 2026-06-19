import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupFolds,
  evaluateCohort,
  promotionGate,
  selectiveCurve,
  permutationPValueBalanced,
  type CohortSample,
  type CohortMetrics,
  type PermutationResult,
} from "../src/cohort-eval";
import { logRegSpec } from "../src/cohort";

const LABELS = ["low_arousal", "high_arousal"];
const FEATURES = ["a", "b"];

/** Separable samples with G distinct groups (one cluster per class). */
function groupedSeparable(perGroup = 8, groups = 10): CohortSample[] {
  const out: CohortSample[] = [];
  for (let g = 0; g < groups; g++) {
    for (let i = 0; i < perGroup; i++) {
      out.push({ vector: [2, (i % 2) * 0.1], label: "low_arousal", group: `g${g}` });
      out.push({ vector: [-2, (i % 2) * 0.1], label: "high_arousal", group: `g${g}` });
    }
  }
  return out;
}

test("grouped folds never split a group across folds (no leakage)", () => {
  const samples = groupedSeparable();
  const folds = 5;
  const foldOf = groupFolds(samples, folds);
  const groupToFold = new Map<string, number>();
  samples.forEach((s, i) => {
    const f = foldOf[i]!;
    if (groupToFold.has(s.group)) assert.equal(groupToFold.get(s.group), f, `group ${s.group} split across folds`);
    else groupToFold.set(s.group, f);
  });
  // every fold used; folds partition all samples
  assert.ok(new Set(foldOf).size <= folds);
  assert.equal(foldOf.length, samples.length);
});

test("evaluateCohort produces well-formed metrics; balanced chance = 1/numClasses", () => {
  const samples = groupedSeparable();
  const metrics = evaluateCohort(samples, [logRegSpec()], { labels: LABELS, featureNames: FEATURES, folds: 5 });
  const m = metrics[0]!;
  assert.equal(m.numClasses, 2);
  assert.ok(Math.abs(m.chance.balancedChance - 0.5) < 1e-9);
  assert.ok(m.balancedAccuracy > 0.9, `separable data should be easy, got ${m.balancedAccuracy}`);
  assert.ok(m.balancedAccuracy >= 0 && m.balancedAccuracy <= 1);
});

function metricsWith(balAcc: number, ece: number): CohortMetrics {
  return {
    model: "x",
    family: "linear",
    n: 500,
    groupCount: 10,
    folds: 5,
    numClasses: 2,
    accuracy: balAcc,
    balancedAccuracy: balAcc,
    macroF1: balAcc,
    perClass: [],
    confusion: { labels: LABELS, matrix: [[0, 0], [0, 0]] },
    ece,
    chance: { majorityClassAccuracy: 0.5, balancedChance: 0.5 },
  };
}
const sig = (p: number): PermutationResult => ({ metric: "balanced_accuracy", permutations: 150, observed: 0.85, nullMean: 0.5, nullStd: 0.01, pValue: p });

test("promotion gate does NOT claim 80% when not achieved", () => {
  const g = promotionGate(metricsWith(0.7, 0.05), sig(0.001));
  assert.equal(g.passed, false);
  assert.ok(g.reasons.some((r) => r.includes("balanced accuracy")), "explains the shortfall");
});

test("promotion gate passes only when ALL of {≥80%, p<0.01, ECE≤0.15} hold", () => {
  assert.equal(promotionGate(metricsWith(0.85, 0.05), sig(0.001)).passed, true);
  assert.equal(promotionGate(metricsWith(0.85, 0.20), sig(0.001)).passed, false, "ECE too high must fail");
  assert.equal(promotionGate(metricsWith(0.85, 0.05), sig(0.2)).passed, false, "insignificant must fail");
  assert.equal(promotionGate(metricsWith(0.85, 0.05), null).passed, false, "no significance test must fail");
});

test("selective curve: full coverage at t=0, coverage is non-increasing in threshold", () => {
  const yTrue = ["low_arousal", "high_arousal", "low_arousal", "high_arousal"];
  const yPred = ["low_arousal", "high_arousal", "high_arousal", "high_arousal"];
  const pTop = [0.95, 0.9, 0.55, 0.7];
  const curve = selectiveCurve(yTrue, yPred, pTop, LABELS, [0, 0.6, 0.8, 0.92]);
  assert.equal(curve[0]!.coverage, 1);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i]!.coverage <= curve[i - 1]!.coverage, "coverage non-increasing");
});

test("permutation p-value is high for label-shuffled (no real) signal", () => {
  // random labels ⇒ no feature↔label link ⇒ model should not beat the null ⇒ p not tiny.
  const samples: CohortSample[] = [];
  for (let g = 0; g < 8; g++) for (let i = 0; i < 10; i++) {
    samples.push({ vector: [i % 3, (i * 7) % 5], label: i % 2 === 0 ? "low_arousal" : "high_arousal", group: `g${g}` });
  }
  const res = permutationPValueBalanced(samples, logRegSpec({ iterations: 50 }), {
    labels: LABELS,
    featureNames: FEATURES,
    folds: 4,
    permutations: 30,
  });
  assert.ok(res.pValue > 0.05, `expected non-significant, got p=${res.pValue}`);
});
