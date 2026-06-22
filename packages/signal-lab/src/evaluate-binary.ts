import {
  binaryMetricsAtThreshold,
  groupFolds,
  makeRng,
  percentile,
  reliabilityDiagram,
  rocAuc,
  type BinaryClassificationMetrics,
  type ReliabilityDiagram,
} from "@hum-ai/shared-types";
import { predictProba, trainLogReg } from "./model";
import type { EvidenceTier } from "./evaluate";

/**
 * BINARY SCREENING EVALUATION — the analytics for a cross-sectional screening
 * endpoint against a binary reference standard (e.g. PHQ-9 ≥ 10 / GAD-7 ≥ 10).
 *
 * Same honest protocol as the multiclass `evaluate`, retargeted to a screening
 * outcome:
 *  - PARTICIPANT-grouped k-fold CV (group key = participantPseudonym) → zero
 *    leakage of a participant across train/test (the study analog of RAVDESS
 *    actor-grouping).
 *  - Threshold-free discrimination: ROC AUC on pooled out-of-fold scores, with a
 *    participant-grouped bootstrap 95% CI.
 *  - Operating points: metrics at the default 0.5 threshold AND at the
 *    Youden-optimal threshold (sensitivity/specificity/PPV/NPV).
 *  - Calibration: reliability diagram + binary ECE (does P(positive) match the
 *    observed positive rate?).
 *  - Significance: label-permutation null over the same grouped CV → empirical
 *    p-value on AUC.
 *
 * This evaluates a STUDY artifact; the screening probability is internal-only
 * during the pilot and never reaches user-facing copy (ADR-0006).
 */

const POSITIVE: "screen_positive" = "screen_positive";
const NEGATIVE: "screen_negative" = "screen_negative";
const SCREENING_LABELS = [NEGATIVE, POSITIVE] as const;

export interface BinaryLabeledSample {
  readonly vector: readonly number[];
  /** True iff the reference instrument places this row above the screening cut. */
  readonly positive: boolean;
  /** Grouping unit for leakage-free CV — the participant pseudonym. */
  readonly group: string;
}

export interface BinaryEvalResult {
  readonly task: string;
  /** The screening target, e.g. "phq9_ge_10". */
  readonly target: string;
  readonly n: number;
  readonly groupCount: number;
  readonly folds: number;
  readonly prevalence: number;
  readonly auc: number;
  readonly aucCI95: readonly [number, number];
  /** Operating-point metrics at the default 0.5 decision threshold. */
  readonly atDefaultThreshold: BinaryClassificationMetrics;
  /** Operating-point metrics at the Youden-optimal threshold (max sensitivity+specificity−1). */
  readonly atYoudenThreshold: BinaryClassificationMetrics;
  readonly calibration: ReliabilityDiagram;
  readonly significance: {
    readonly test: "label_permutation_grouped_cv_auc";
    readonly permutations: number;
    readonly nullMeanAuc: number;
    readonly pValue: number;
  };
  readonly evidence: { readonly tier: EvidenceTier; readonly rationale: string; readonly caveats: readonly string[] };
  readonly notes: readonly string[];
}

export interface BinaryEvalOptions {
  readonly featureNames: readonly string[];
  readonly target: string;
  readonly folds?: number;
  readonly iterations?: number;
  readonly permutations?: number;
  readonly permIterations?: number;
  readonly bootstrapIterations?: number;
  readonly seed?: number;
  readonly task?: string;
}

/** Out-of-fold P(positive) scores aligned to the input samples (or NaN where a fold was degenerate). */
function oofScores(
  samples: readonly BinaryLabeledSample[],
  foldOf: readonly number[],
  featureNames: readonly string[],
  folds: number,
  iterations: number,
): { pos: boolean[]; score: number[]; group: string[] } {
  const pos: boolean[] = [];
  const score: number[] = [];
  const group: string[] = [];
  for (let f = 0; f < folds; f++) {
    const trainX: number[][] = [];
    const trainY: string[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (foldOf[i] === f) testIdx.push(i);
      else {
        trainX.push(samples[i]!.vector as number[]);
        trainY.push(samples[i]!.positive ? POSITIVE : NEGATIVE);
      }
    }
    if (trainX.length === 0 || testIdx.length === 0) continue;
    // A fold whose training split is single-class cannot learn a boundary; skip it honestly.
    if (new Set(trainY).size < 2) continue;
    const model = trainLogReg(trainX, trainY, { labels: SCREENING_LABELS, featureNames, iterations });
    for (const i of testIdx) {
      const proba = predictProba(model, samples[i]!.vector);
      pos.push(samples[i]!.positive);
      score.push(proba[POSITIVE] ?? 0);
      group.push(samples[i]!.group);
    }
  }
  return { pos, score, group };
}

function bestYoudenThreshold(pos: readonly boolean[], score: readonly number[]): BinaryClassificationMetrics {
  const candidates = Array.from(new Set(score)).sort((a, b) => a - b);
  let best = binaryMetricsAtThreshold(pos, score, candidates[0] ?? 0.5);
  for (const t of candidates) {
    const m = binaryMetricsAtThreshold(pos, score, t);
    if (m.youdenJ > best.youdenJ) best = m;
  }
  return best;
}

/** Participant-grouped percentile bootstrap CI on AUC (resample whole participants with replacement). */
function groupedBootstrapAucCI(
  pos: readonly boolean[],
  score: readonly number[],
  group: readonly string[],
  rng: () => number,
  iterations: number,
): [number, number] {
  const byGroup = new Map<string, number[]>();
  group.forEach((g, i) => {
    const arr = byGroup.get(g);
    if (arr) arr.push(i);
    else byGroup.set(g, [i]);
  });
  const groupIds = [...byGroup.keys()];
  if (groupIds.length < 2) return [Number.NaN, Number.NaN];
  const aucs: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const rp: boolean[] = [];
    const rs: number[] = [];
    for (let k = 0; k < groupIds.length; k++) {
      const g = groupIds[Math.floor(rng() * groupIds.length)]!;
      for (const i of byGroup.get(g)!) {
        rp.push(pos[i]!);
        rs.push(score[i]!);
      }
    }
    const a = rocAuc(rp, rs);
    if (Number.isFinite(a)) aucs.push(a);
  }
  if (aucs.length === 0) return [Number.NaN, Number.NaN];
  aucs.sort((a, b) => a - b);
  return [percentile(aucs, 0.025), percentile(aucs, 0.975)];
}

function decideBinaryTier(
  auc: number,
  pValue: number,
  ece: number,
  n: number,
): { tier: EvidenceTier; rationale: string } {
  const pct = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
  if (n < 60 || !Number.isFinite(auc)) {
    return { tier: "insufficient", rationale: `only ${n} labeled rows — too few for a stable AUC estimate` };
  }
  if (pValue >= 0.05 || auc < 0.6) {
    return { tier: "weak", rationale: `AUC ${pct(auc)}, permutation p=${pValue.toFixed(3)} — not clearly above chance` };
  }
  if (auc >= 0.75 && pValue < 0.01 && ece <= 0.15) {
    return { tier: "supported", rationale: `AUC ${pct(auc)}, p=${pValue.toFixed(3)}, ECE ${ece.toFixed(3)} — a real but research-stage screening signal` };
  }
  return { tier: "moderate", rationale: `AUC ${pct(auc)}, p=${pValue.toFixed(3)}, ECE ${ece.toFixed(3)} — above chance but modest / imperfectly calibrated` };
}

export function evaluateBinary(samples: readonly BinaryLabeledSample[], opts: BinaryEvalOptions): BinaryEvalResult {
  const folds = opts.folds ?? 5;
  const iterations = opts.iterations ?? 400;
  const permutations = opts.permutations ?? 100;
  const permIterations = opts.permIterations ?? 150;
  const bootstrapIterations = opts.bootstrapIterations ?? 500;
  const notes: string[] = [];

  const n = samples.length;
  const groupCount = new Set(samples.map((s) => s.group)).size;
  const positives = samples.filter((s) => s.positive).length;
  const prevalence = n > 0 ? positives / n : 0;
  const foldOf = groupFolds(samples, folds);

  const { pos, score, group } = oofScores(samples, foldOf, opts.featureNames, folds, iterations);
  const auc = rocAuc(pos, score);
  const atDefaultThreshold = binaryMetricsAtThreshold(pos, score, 0.5);
  const atYoudenThreshold = bestYoudenThreshold(pos, score);
  const calibration = reliabilityDiagram(pos, score);

  const rng = makeRng(opts.seed ?? 12345);
  const nullAuc: number[] = [];
  let geCount = 0;
  for (let p = 0; p < permutations; p++) {
    const shuffled = samples.map((s) => s.positive);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const permSamples = samples.map((s, i) => ({ ...s, positive: shuffled[i]! }));
    const r = oofScores(permSamples, foldOf, opts.featureNames, folds, permIterations);
    const a = rocAuc(r.pos, r.score);
    if (Number.isFinite(a)) {
      nullAuc.push(a);
      if (a >= auc) geCount++;
    }
  }
  const nullMeanAuc = nullAuc.length ? nullAuc.reduce((s, a) => s + a, 0) / nullAuc.length : Number.NaN;
  // Permutation p-value over the VALID null draws only. A permutation whose AUC is NaN
  // (a degenerate single-class CV split) is not a usable null sample, so it counts toward
  // neither the numerator nor the denominator — divide by `nullAuc.length`, not the requested
  // `permutations`. With every permutation valid this is the standard (geCount+1)/(perms+1).
  const pValue = (geCount + 1) / (nullAuc.length + 1);
  const aucCI95 = groupedBootstrapAucCI(pos, score, group, rng, bootstrapIterations);

  if (pos.length < n) notes.push(`${n - pos.length} rows fell in degenerate (single-class) training folds and were not scored`);

  const tier = decideBinaryTier(auc, pValue, calibration.ece, pos.length);

  return {
    task: opts.task ?? "hum_screening_binary",
    target: opts.target,
    n,
    groupCount,
    folds,
    prevalence,
    auc,
    aucCI95,
    atDefaultThreshold,
    atYoudenThreshold,
    calibration,
    significance: { test: "label_permutation_grouped_cv_auc", permutations, nullMeanAuc, pValue },
    evidence: {
      tier: tier.tier,
      rationale: tier.rationale,
      caveats: [
        "Research-stage screening signal — NOT a diagnosis, NOT clinically validated, NOT a medical device.",
        "Participant-grouped CV avoids leakage but does not prove generalization beyond the recruited cohort.",
        "A self-recruited remote cohort is spectrum-biased (QUADAS-2 patient-selection); external replication is required.",
        "Calibration is measured by binary ECE; a screening probability must be calibrated before any operating point is acted on.",
      ],
    },
    notes,
  };
}
