import type { CohortModelSpec } from "./cohort";
import {
  accuracyOf,
  balancedAccuracy,
  confusionMatrix,
  expectedCalibrationError,
  groupFolds,
  makeRng,
  perClassMetrics,
  type ClassMetric,
} from "@hum-ai/shared-types";

// Re-exported for back-compat: the grouped-CV fold assignment used by cohort-eval's tests.
export { groupFolds };

/**
 * Generic, target-agnostic evaluation harness for the model cohort. It mirrors the
 * protocol of `evaluate.ts` (grouped CV, chance baselines, ECE, label-permutation
 * significance) but is generic over (a) the model family and (b) the target label
 * set, so the SAME honest protocol covers the fusion-label, arousal, valence, and
 * domain targets.
 *
 * The promotion metric is BALANCED ACCURACY (mean per-class recall), not raw
 * accuracy: raw accuracy on an imbalanced target is gameable by predicting the
 * majority class, exactly what `evaluate.ts` warns against (it reports
 * majority-class accuracy as chance). Balanced accuracy's chance level is a flat
 * 1/numClasses regardless of imbalance, so an "80%" claim cannot hide behind a
 * skewed prior. See `promotionGate`.
 */

export interface CohortSample {
  readonly vector: readonly number[];
  readonly label: string;
  readonly group: string;
}

/** Per-class metric row — an alias of the shared {@link ClassMetric} (kept for back-compat). */
export type CohortClassMetric = ClassMetric;

export interface CohortMetrics {
  readonly model: string;
  readonly family: string;
  readonly n: number;
  readonly groupCount: number;
  readonly folds: number;
  readonly numClasses: number;
  readonly accuracy: number;
  readonly balancedAccuracy: number;
  readonly macroF1: number;
  readonly perClass: readonly CohortClassMetric[];
  readonly confusion: { readonly labels: readonly string[]; readonly matrix: readonly (readonly number[])[] };
  readonly ece: number;
  readonly chance: { readonly majorityClassAccuracy: number; readonly balancedChance: number };
}

interface CvOutput {
  readonly yTrue: string[];
  readonly yPred: string[];
  readonly pTop: number[];
}

function runGroupedCv(
  samples: readonly CohortSample[],
  foldOf: readonly number[],
  spec: CohortModelSpec,
  labels: readonly string[],
  featureNames: readonly string[],
  folds: number,
): CvOutput {
  const yTrue: string[] = [];
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
    const trainLabels = labels.filter((l) => trainY.includes(l));
    if (trainLabels.length < 2) continue;
    const model = spec.train(trainX, trainY, trainLabels, featureNames);
    for (const i of testIdx) {
      const dist = model.predictProba(samples[i]!.vector);
      let bestLabel = trainLabels[0]!;
      let bestP = -1;
      for (const l of labels) {
        const p = dist[l] ?? 0;
        if (p > bestP) {
          bestP = p;
          bestLabel = l;
        }
      }
      yTrue.push(samples[i]!.label);
      yPred.push(bestLabel);
      pTop.push(bestP);
    }
  }
  return { yTrue, yPred, pTop };
}

function majorityClassAccuracy(yTrue: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const y of yTrue) counts.set(y, (counts.get(y) ?? 0) + 1);
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return yTrue.length > 0 ? max / yTrue.length : 0;
}

function metricsFor(
  out: CvOutput,
  spec: CohortModelSpec,
  labels: readonly string[],
  n: number,
  groupCount: number,
  folds: number,
): CohortMetrics {
  const present = labels.filter((l) => out.yTrue.includes(l));
  const perClass = perClassMetrics(out.yTrue, out.yPred, present);
  return {
    model: spec.name,
    family: spec.family,
    n,
    groupCount,
    folds,
    numClasses: present.length,
    accuracy: accuracyOf(out.yTrue, out.yPred),
    balancedAccuracy: balancedAccuracy(out.yTrue, out.yPred, present),
    macroF1: perClass.length > 0 ? perClass.reduce((s, c) => s + c.f1, 0) / perClass.length : 0,
    perClass,
    confusion: confusionMatrix(out.yTrue, out.yPred, present),
    ece: expectedCalibrationError(out.yTrue, out.yPred, out.pTop),
    chance: { majorityClassAccuracy: majorityClassAccuracy(out.yTrue), balancedChance: 1 / Math.max(1, present.length) },
  };
}

export interface CohortEvalOptions {
  readonly labels: readonly string[];
  readonly featureNames: readonly string[];
  readonly folds?: number;
}

/** Evaluate every model spec under the same grouped CV; returns one metrics row per model. */
export function evaluateCohort(
  samples: readonly CohortSample[],
  specs: readonly CohortModelSpec[],
  opts: CohortEvalOptions,
): CohortMetrics[] {
  const folds = opts.folds ?? 5;
  const foldOf = groupFolds(samples, folds);
  const groupCount = new Set(samples.map((s) => s.group)).size;
  return specs.map((spec) => {
    const out = runGroupedCv(samples, foldOf, spec, opts.labels, opts.featureNames, folds);
    return metricsFor(out, spec, opts.labels, samples.length, groupCount, folds);
  });
}

export interface PermutationResult {
  readonly metric: "balanced_accuracy";
  readonly permutations: number;
  readonly observed: number;
  readonly nullMean: number;
  readonly nullStd: number;
  readonly pValue: number;
}

/**
 * Label-permutation significance on BALANCED accuracy for a single model, over the
 * same grouped CV. Shuffles labels (breaking any feature↔label link) and asks how
 * often the null reaches the observed balanced accuracy.
 */
export function permutationPValueBalanced(
  samples: readonly CohortSample[],
  spec: CohortModelSpec,
  opts: CohortEvalOptions & { permutations?: number; seed?: number },
): PermutationResult {
  const folds = opts.folds ?? 5;
  const permutations = opts.permutations ?? 40;
  const foldOf = groupFolds(samples, folds);
  const present = opts.labels.filter((l) => samples.some((s) => s.label === l));
  const observed = balancedAccuracy(
    ...(() => {
      const o = runGroupedCv(samples, foldOf, spec, opts.labels, opts.featureNames, folds);
      return [o.yTrue, o.yPred, present] as const;
    })(),
  );
  const rng = makeRng(opts.seed ?? 9973);
  const nulls: number[] = [];
  let ge = 0;
  for (let p = 0; p < permutations; p++) {
    const shuffled = samples.map((s) => s.label);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const permSamples = samples.map((s, i) => ({ ...s, label: shuffled[i]! }));
    const o = runGroupedCv(permSamples, foldOf, spec, opts.labels, opts.featureNames, folds);
    const a = balancedAccuracy(o.yTrue, o.yPred, present);
    nulls.push(a);
    if (a >= observed) ge++;
  }
  const nullMean = nulls.length ? nulls.reduce((s, a) => s + a, 0) / nulls.length : 0;
  const nullStd = nulls.length > 1 ? Math.sqrt(nulls.reduce((s, a) => s + (a - nullMean) ** 2, 0) / (nulls.length - 1)) : 0;
  return {
    metric: "balanced_accuracy",
    permutations,
    observed,
    nullMean,
    nullStd,
    pValue: (ge + 1) / (permutations + 1),
  };
}

export interface PromotionGateResult {
  readonly metric: "balanced_accuracy";
  readonly threshold: number;
  readonly observed: number;
  readonly eceCap: number;
  readonly ece: number;
  readonly pValue: number | null;
  readonly maxPValue: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

/**
 * The 80% promotion gate (EXPERIMENTAL — the repo defines no numeric bar; this is
 * the most defensible reading of its calibration-first evaluation architecture).
 * A target/model is "promotable" ONLY if all hold under grouped CV:
 *   1. balanced accuracy ≥ threshold (default 0.80),
 *   2. label-permutation p < maxPValue (default 0.01) — the signal is real,
 *   3. top-class ECE ≤ eceCap (default 0.15) — it is not just confidently wrong.
 * Anything short of all three returns passed=false with explicit reasons. The gate
 * NEVER rounds up or waives a criterion.
 */
export function promotionGate(
  best: CohortMetrics,
  perm: PermutationResult | null,
  opts: { threshold?: number; eceCap?: number; maxPValue?: number } = {},
): PromotionGateResult {
  const threshold = opts.threshold ?? 0.8;
  const eceCap = opts.eceCap ?? 0.15;
  const maxPValue = opts.maxPValue ?? 0.01;
  const reasons: string[] = [];
  const pValue = perm ? perm.pValue : null;
  if (best.balancedAccuracy < threshold)
    reasons.push(`balanced accuracy ${(best.balancedAccuracy * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`);
  if (pValue === null) reasons.push("no permutation significance test was run");
  else if (pValue >= maxPValue) reasons.push(`permutation p=${pValue.toFixed(3)} ≥ ${maxPValue}`);
  if (best.ece > eceCap) reasons.push(`ECE ${best.ece.toFixed(3)} > ${eceCap}`);
  const passed = reasons.length === 0;
  if (passed) reasons.push(`balanced accuracy ${(best.balancedAccuracy * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%, p=${pValue!.toFixed(3)}, ECE ${best.ece.toFixed(3)}`);
  return { metric: "balanced_accuracy", threshold, observed: best.balancedAccuracy, eceCap, ece: best.ece, pValue, maxPValue, passed, reasons };
}

export interface SelectivePoint {
  readonly threshold: number;
  readonly coverage: number;
  readonly balancedAccuracy: number;
}

/**
 * Selective-prediction (abstention) curve: at each confidence threshold, keep only
 * predictions with pTop ≥ t and report coverage + balanced accuracy on the kept
 * set. This is the cohort analogue of the runtime abstention floor (ADR-0004): a
 * model may clear a bar on the confident subset while abstaining elsewhere.
 */
export function selectiveCurve(
  yTrue: readonly string[],
  yPred: readonly string[],
  pTop: readonly number[],
  labels: readonly string[],
  thresholds: readonly number[] = [0, 0.5, 0.6, 0.7, 0.8, 0.9],
): SelectivePoint[] {
  const present = labels.filter((l) => yTrue.includes(l));
  return thresholds.map((t) => {
    const kt: string[] = [];
    const kp: string[] = [];
    for (let i = 0; i < yTrue.length; i++) if (pTop[i]! >= t) {
      kt.push(yTrue[i]!);
      kp.push(yPred[i]!);
    }
    return {
      threshold: t,
      coverage: yTrue.length > 0 ? kt.length / yTrue.length : 0,
      balancedAccuracy: balancedAccuracy(kt, kp, present),
    };
  });
}

/** Re-run grouped CV for one spec and return raw predictions (for selective curves / inspection). */
export function cvPredictions(
  samples: readonly CohortSample[],
  spec: CohortModelSpec,
  opts: CohortEvalOptions,
): CvOutput {
  const folds = opts.folds ?? 5;
  const foldOf = groupFolds(samples, folds);
  return runGroupedCv(samples, foldOf, spec, opts.labels, opts.featureNames, folds);
}
