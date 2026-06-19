import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { trainLogReg, predictTop, type LogRegParams } from "./model";

/**
 * Evaluation, confidence, and significance — calibration-first, honest tiers
 * (VALIDATION_PLAN: "calibration over raw accuracy"; ADR-0004). We NEVER cite
 * external priors (MELD 66%, voice-depression AUC, DVDSA F1) as Hum accuracy.
 *
 * Protocol:
 *  - Actor-GROUPED k-fold CV (no speaker leakage — folds hold disjoint RAVDESS
 *    actors). Group leakage would inflate accuracy on acted speech.
 *  - Chance references: majority-class accuracy + stratified-random accuracy.
 *  - Significance: label-permutation test over the SAME grouped CV → empirical
 *    p-value (does the model beat the null where features carry no label info?).
 *  - Calibration: top-class Expected Calibration Error (10-bin).
 *  - Evidence tier: a conservative join of effect size, p-value, and calibration,
 *    always carrying the far-domain / acted-speech / prior-only caveats.
 */

export interface LabeledSample {
  readonly vector: readonly number[];
  readonly label: FusionLabel;
  readonly group: string;
}

export interface ClassMetric {
  readonly label: string;
  readonly support: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export type EvidenceTier = "supported" | "moderate" | "weak" | "insufficient";

export interface EvalResult {
  readonly task: string;
  readonly targetSpace: "FUSION_LABELS";
  readonly labels: readonly string[];
  readonly n: number;
  readonly groupCount: number;
  readonly folds: number;
  readonly accuracy: number;
  readonly macroF1: number;
  readonly perClass: readonly ClassMetric[];
  readonly confusion: { readonly labels: readonly string[]; readonly matrix: readonly (readonly number[])[] };
  readonly chance: {
    readonly majorityLabel: string;
    readonly majorityClassAccuracy: number;
    readonly stratifiedRandomAccuracy: number;
  };
  readonly significance: {
    readonly test: "label_permutation_grouped_cv";
    readonly permutations: number;
    readonly permIterations: number;
    readonly nullMeanAccuracy: number;
    readonly nullStdAccuracy: number;
    readonly pValue: number;
    readonly observedMinusChance: number;
    readonly accuracyCI95: readonly [number, number];
  };
  readonly calibration: { readonly method: string; readonly ece: number; readonly bins: number };
  readonly evidence: { readonly tier: EvidenceTier; readonly rationale: string; readonly caveats: readonly string[] };
  readonly notes: readonly string[];
}

export interface EvalOptions {
  readonly labels: readonly FusionLabel[];
  readonly featureNames: readonly string[];
  readonly folds?: number;
  readonly iterations?: number;
  readonly permutations?: number;
  readonly permIterations?: number;
  readonly seed?: number;
  readonly task?: string;
}

/** mulberry32 deterministic PRNG. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Assign groups to folds round-robin over sorted group ids (disjoint groups per fold). */
function groupFolds(samples: readonly LabeledSample[], folds: number): number[] {
  const groups = Array.from(new Set(samples.map((s) => s.group))).sort();
  const groupFold = new Map<string, number>();
  groups.forEach((g, i) => groupFold.set(g, i % folds));
  return samples.map((s) => groupFold.get(s.group)!);
}

function runGroupedCv(
  samples: readonly LabeledSample[],
  foldOf: readonly number[],
  labels: readonly FusionLabel[],
  featureNames: readonly string[],
  folds: number,
  iterations: number,
): { yTrue: FusionLabel[]; yPred: string[]; pTop: number[] } {
  const yTrue: FusionLabel[] = [];
  const yPred: string[] = [];
  const pTop: number[] = [];
  for (let f = 0; f < folds; f++) {
    const trainX: number[][] = [];
    const trainY: string[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (foldOf[i] === f) testIdx.push(i);
      else {
        trainX.push(samples[i]!.vector as number[]);
        trainY.push(samples[i]!.label);
      }
    }
    if (trainX.length === 0 || testIdx.length === 0) continue;
    const model = trainLogReg(trainX, trainY, { labels, featureNames, iterations });
    for (const i of testIdx) {
      const top = predictTop(model, samples[i]!.vector);
      yTrue.push(samples[i]!.label);
      yPred.push(top.label);
      pTop.push(top.prob);
    }
  }
  return { yTrue, yPred, pTop };
}

function accuracyOf(yTrue: readonly string[], yPred: readonly string[]): number {
  if (yTrue.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) correct++;
  return correct / yTrue.length;
}

function perClassMetrics(yTrue: readonly string[], yPred: readonly string[], labels: readonly string[]): ClassMetric[] {
  return labels.map((label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let i = 0; i < yTrue.length; i++) {
      const t = yTrue[i] === label;
      const p = yPred[i] === label;
      if (t) support++;
      if (t && p) tp++;
      else if (!t && p) fp++;
      else if (t && !p) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, support, precision, recall, f1 };
  });
}

function confusionMatrix(yTrue: readonly string[], yPred: readonly string[], labels: readonly string[]) {
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (let i = 0; i < yTrue.length; i++) {
    const r = index.get(yTrue[i]!);
    const c = index.get(yPred[i]!);
    if (r !== undefined && c !== undefined) matrix[r]![c]!++;
  }
  return { labels: [...labels], matrix };
}

function wilson95(p: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Top-class Expected Calibration Error (10 equal-width bins). */
function expectedCalibrationError(yTrue: readonly string[], yPred: readonly string[], pTop: readonly number[]): number {
  const bins = 10;
  const binAcc = new Array(bins).fill(0);
  const binConf = new Array(bins).fill(0);
  const binN = new Array(bins).fill(0);
  for (let i = 0; i < pTop.length; i++) {
    const b = Math.min(bins - 1, Math.floor(pTop[i]! * bins));
    binN[b]++;
    binConf[b] += pTop[i]!;
    if (yTrue[i] === yPred[i]) binAcc[b]++;
  }
  let ece = 0;
  const n = pTop.length || 1;
  for (let b = 0; b < bins; b++) {
    if (binN[b] === 0) continue;
    const acc = binAcc[b] / binN[b];
    const conf = binConf[b] / binN[b];
    ece += (binN[b] / n) * Math.abs(acc - conf);
  }
  return ece;
}

function chanceBaselines(yTrue: readonly string[], labels: readonly string[]) {
  const counts = new Map<string, number>();
  for (const y of yTrue) counts.set(y, (counts.get(y) ?? 0) + 1);
  let majorityLabel = labels[0] ?? "";
  let majorityCount = 0;
  for (const [l, c] of counts) if (c > majorityCount) {
    majorityCount = c;
    majorityLabel = l;
  }
  const n = yTrue.length || 1;
  const majorityClassAccuracy = majorityCount / n;
  let stratified = 0;
  for (const c of counts.values()) stratified += (c / n) ** 2;
  return { majorityLabel, majorityClassAccuracy, stratifiedRandomAccuracy: stratified };
}

function decideTier(
  observedAcc: number,
  chanceAcc: number,
  pValue: number,
  ece: number,
  n: number,
): { tier: EvidenceTier; rationale: string } {
  const lift = observedAcc - chanceAcc;
  if (n < 60) return { tier: "insufficient", rationale: `only ${n} labeled samples — too few for a stable estimate` };
  if (pValue >= 0.05 || lift < 0.05) {
    return {
      tier: "weak",
      rationale: `accuracy ${(observedAcc * 100).toFixed(1)}% vs chance ${(chanceAcc * 100).toFixed(1)}% (lift ${(lift * 100).toFixed(1)}pp), permutation p=${pValue.toFixed(3)} — not clearly above chance`,
    };
  }
  if (lift >= 0.15 && pValue < 0.01 && ece <= 0.15) {
    return {
      tier: "supported",
      rationale: `accuracy ${(observedAcc * 100).toFixed(1)}% beats chance ${(chanceAcc * 100).toFixed(1)}% by ${(lift * 100).toFixed(1)}pp, p=${pValue.toFixed(3)}, ECE ${ece.toFixed(3)} — a real but PRIOR-ONLY affect signal`,
    };
  }
  return {
    tier: "moderate",
    rationale: `accuracy ${(observedAcc * 100).toFixed(1)}% above chance ${(chanceAcc * 100).toFixed(1)}% (lift ${(lift * 100).toFixed(1)}pp), p=${pValue.toFixed(3)}, ECE ${ece.toFixed(3)} — above chance but modest / imperfectly calibrated`,
  };
}

/**
 * Full evaluation over labeled samples. Returns honest metrics + significance +
 * an evidence tier. `samples` must already be vectorized + labeled (fusionLabel).
 */
export function evaluate(samples: readonly LabeledSample[], opts: EvalOptions): EvalResult {
  const folds = opts.folds ?? 5;
  const iterations = opts.iterations ?? 400;
  const permutations = opts.permutations ?? 100;
  const permIterations = opts.permIterations ?? 150;
  const labels = opts.labels;
  const notes: string[] = [];

  // Drop labels with zero support so CV/metrics stay well-defined.
  const present = new Set(samples.map((s) => s.label));
  const evalLabels = labels.filter((l) => present.has(l));
  if (evalLabels.length < labels.length) {
    notes.push(`labels with no samples omitted from metrics: ${labels.filter((l) => !present.has(l)).join(", ") || "none"}`);
  }

  const n = samples.length;
  const groupCount = new Set(samples.map((s) => s.group)).size;
  const foldOf = groupFolds(samples, folds);

  const { yTrue, yPred, pTop } = runGroupedCv(samples, foldOf, evalLabels, opts.featureNames, folds, iterations);
  const accuracy = accuracyOf(yTrue, yPred);
  const perClass = perClassMetrics(yTrue, yPred, evalLabels);
  const macroF1 = perClass.length > 0 ? perClass.reduce((s, c) => s + c.f1, 0) / perClass.length : 0;
  const confusion = confusionMatrix(yTrue, yPred, evalLabels);
  const chance = chanceBaselines(yTrue, evalLabels);
  const ece = expectedCalibrationError(yTrue, yPred, pTop);

  // Label-permutation null distribution over the same grouped CV.
  const rng = makeRng(opts.seed ?? 12345);
  const nullAcc: number[] = [];
  let geCount = 0;
  for (let p = 0; p < permutations; p++) {
    const shuffled = samples.map((s) => s.label);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const permSamples = samples.map((s, i) => ({ ...s, label: shuffled[i]! }));
    const r = runGroupedCv(permSamples, foldOf, evalLabels, opts.featureNames, folds, permIterations);
    const a = accuracyOf(r.yTrue, r.yPred);
    nullAcc.push(a);
    if (a >= accuracy) geCount++;
  }
  const nullMean = nullAcc.length ? nullAcc.reduce((s, a) => s + a, 0) / nullAcc.length : 0;
  const nullStd =
    nullAcc.length > 1
      ? Math.sqrt(nullAcc.reduce((s, a) => s + (a - nullMean) ** 2, 0) / (nullAcc.length - 1))
      : 0;
  const pValue = (geCount + 1) / (permutations + 1);
  const ci = wilson95(accuracy, yTrue.length);

  const tier = decideTier(accuracy, chance.majorityClassAccuracy, pValue, ece, n);

  return {
    task: opts.task ?? "ravdess_affect_prior_fusion_label",
    targetSpace: "FUSION_LABELS",
    labels: evalLabels,
    n,
    groupCount,
    folds,
    accuracy,
    macroF1,
    perClass,
    confusion,
    chance,
    significance: {
      test: "label_permutation_grouped_cv",
      permutations,
      permIterations,
      nullMeanAccuracy: nullMean,
      nullStdAccuracy: nullStd,
      pValue,
      observedMinusChance: accuracy - chance.majorityClassAccuracy,
      accuracyCI95: ci,
    },
    calibration: { method: "top-class ECE (10-bin)", ece, bins: 10 },
    evidence: {
      tier: tier.tier,
      rationale: tier.rationale,
      caveats: [
        "Affect PRIOR only — trained on acted speech (RAVDESS), domain_gap_to_hum=far (penalty 0.45). Never hum truth, never clinical (ADR-0005).",
        "Acted emotion is performed, not lived; labels are the dataset's annotations, not lived affect.",
        "Actor-grouped CV avoids speaker leakage but does not prove generalization to real hums.",
        "Not clinically validated; no diagnosis. Calibration measured by top-class ECE, not a clinical accuracy.",
      ],
    },
    notes,
  };
}
