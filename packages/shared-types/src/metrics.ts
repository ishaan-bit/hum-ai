/**
 * Classification evaluation metrics — the single source for the honest offline
 * protocol shared by signal-lab's `evaluate` (fusion-label target) and `cohort-eval`
 * (generic target) harnesses. Pure, dependency-free, browser-safe: top-1 accuracy,
 * balanced accuracy, per-class precision/recall/F1, confusion matrix, top-class ECE,
 * and grouped-CV fold assignment.
 *
 * Balanced accuracy is the honest promotion metric: its chance level is a flat
 * 1/numClasses regardless of class imbalance, so an accuracy claim cannot hide behind
 * a skewed prior (raw accuracy can).
 */

/** Per-class precision / recall / F1 with support count. */
export interface ClassMetric {
  readonly label: string;
  readonly support: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** Plain top-1 accuracy. Returns 0 for empty input. */
export function accuracyOf(yTrue: readonly string[], yPred: readonly string[]): number {
  if (yTrue.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) correct++;
  return correct / yTrue.length;
}

/**
 * Balanced accuracy = mean per-class recall over classes WITH support. Chance level
 * is a flat 1/numClasses regardless of imbalance, so it can't be gamed by predicting
 * the majority class. Returns 0 when no class has support.
 */
export function balancedAccuracy(yTrue: readonly string[], yPred: readonly string[], labels: readonly string[]): number {
  let sum = 0;
  let used = 0;
  for (const l of labels) {
    let tp = 0;
    let support = 0;
    for (let i = 0; i < yTrue.length; i++) {
      if (yTrue[i] === l) {
        support++;
        if (yPred[i] === l) tp++;
      }
    }
    if (support > 0) {
      sum += tp / support;
      used++;
    }
  }
  return used > 0 ? sum / used : 0;
}

/** Per-class precision / recall / F1 / support for each label. */
export function perClassMetrics(yTrue: readonly string[], yPred: readonly string[], labels: readonly string[]): ClassMetric[] {
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

/** Row-true × col-pred confusion matrix over `labels`. */
export function confusionMatrix(
  yTrue: readonly string[],
  yPred: readonly string[],
  labels: readonly string[],
): { labels: string[]; matrix: number[][] } {
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (let i = 0; i < yTrue.length; i++) {
    const r = index.get(yTrue[i]!);
    const c = index.get(yPred[i]!);
    if (r !== undefined && c !== undefined) matrix[r]![c]!++;
  }
  return { labels: [...labels], matrix };
}

/**
 * Top-class Expected Calibration Error over `bins` equal-width confidence bins
 * (default 10). The `Math.max(0, …)` bin-floor guard keeps a non-positive top
 * probability from indexing bin −1; for a valid probability in [0, 1] the floor is
 * already ≥ 0, so real values are unchanged (it is purely defensive).
 */
export function expectedCalibrationError(
  yTrue: readonly string[],
  yPred: readonly string[],
  pTop: readonly number[],
  bins = 10,
): number {
  const binAcc = new Array(bins).fill(0);
  const binConf = new Array(bins).fill(0);
  const binN = new Array(bins).fill(0);
  for (let i = 0; i < pTop.length; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(pTop[i]! * bins)));
    binN[b]++;
    binConf[b] += pTop[i]!;
    if (yTrue[i] === yPred[i]) binAcc[b]++;
  }
  let ece = 0;
  const n = pTop.length || 1;
  for (let b = 0; b < bins; b++) {
    if (binN[b] === 0) continue;
    ece += (binN[b] / n) * Math.abs(binAcc[b] / binN[b] - binConf[b] / binN[b]);
  }
  return ece;
}

/**
 * Assign each sample to one of `folds` CV folds by its `group`, round-robin over
 * sorted group ids so a group's rows never split across folds (no group leakage).
 */
export function groupFolds<T extends { readonly group: string }>(samples: readonly T[], folds: number): number[] {
  const groups = Array.from(new Set(samples.map((s) => s.group))).sort();
  const groupFold = new Map<string, number>();
  groups.forEach((g, i) => groupFold.set(g, i % folds));
  return samples.map((s) => groupFold.get(s.group)!);
}

// ---------------------------------------------------------------------------
// Binary screening metrics — the analytics for a SCREENING endpoint (a binary
// reference standard, e.g. PHQ-9 ≥ 10). Threshold-free discrimination (AUC),
// operating-point metrics (sensitivity/specificity/PPV/NPV at a cut), and a
// calibration reliability diagram. Pure + dependency-free; `pos[i]` is the true
// positive class and `score[i]` is the model's predicted P(positive).
// ---------------------------------------------------------------------------

/**
 * Threshold-free ROC AUC via the rank (Mann–Whitney U) identity, with tie-aware
 * average ranks. Equals the probability a random positive scores above a random
 * negative. Returns `NaN` when either class is empty (AUC is undefined then —
 * surfaced honestly rather than defaulted to 0.5).
 */
export function rocAuc(pos: readonly boolean[], score: readonly number[]): number {
  const n = Math.min(pos.length, score.length);
  if (n === 0) return Number.NaN;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[a]! - score[b]!);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && score[idx[j + 1]!]! === score[idx[i]!]!) j++;
    const avgRank = (i + j + 2) / 2; // 1-based average rank for tied positions i..j
    for (let k = i; k <= j; k++) ranks[idx[k]!] = avgRank;
    i = j + 1;
  }
  let sumRankPos = 0;
  let nPos = 0;
  for (let k = 0; k < n; k++) {
    if (pos[k]) {
      sumRankPos += ranks[k]!;
      nPos++;
    }
  }
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return Number.NaN;
  return (sumRankPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export interface BinaryClassificationMetrics {
  readonly threshold: number;
  readonly tp: number;
  readonly fp: number;
  readonly tn: number;
  readonly fn: number;
  /** Recall / true-positive rate. */
  readonly sensitivity: number;
  /** True-negative rate. */
  readonly specificity: number;
  /** Positive predictive value / precision. */
  readonly ppv: number;
  /** Negative predictive value. */
  readonly npv: number;
  readonly accuracy: number;
  readonly balancedAccuracy: number;
  readonly f1: number;
  /** Youden's J = sensitivity + specificity − 1 (operating-point selection). */
  readonly youdenJ: number;
}

/** Confusion-derived operating-point metrics at a decision threshold (predict positive iff score ≥ threshold). */
export function binaryMetricsAtThreshold(
  pos: readonly boolean[],
  score: readonly number[],
  threshold: number,
): BinaryClassificationMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const n = Math.min(pos.length, score.length);
  for (let i = 0; i < n; i++) {
    const predPos = score[i]! >= threshold;
    if (pos[i] && predPos) tp++;
    else if (pos[i] && !predPos) fn++;
    else if (!pos[i] && predPos) fp++;
    else tn++;
  }
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const ppv = tp + fp > 0 ? tp / (tp + fp) : 0;
  const npv = tn + fn > 0 ? tn / (tn + fn) : 0;
  const accuracy = n > 0 ? (tp + tn) / n : 0;
  const f1 = ppv + sensitivity > 0 ? (2 * ppv * sensitivity) / (ppv + sensitivity) : 0;
  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    sensitivity,
    specificity,
    ppv,
    npv,
    accuracy,
    balancedAccuracy: (sensitivity + specificity) / 2,
    f1,
    youdenJ: sensitivity + specificity - 1,
  };
}

export interface ReliabilityBin {
  readonly lo: number;
  readonly hi: number;
  readonly count: number;
  /** Mean predicted probability in the bin. */
  readonly meanScore: number;
  /** Observed positive rate in the bin. */
  readonly observedRate: number;
}

export interface ReliabilityDiagram {
  readonly bins: readonly ReliabilityBin[];
  /** Binary Expected Calibration Error: Σ (n_b/N)·|observedRate − meanScore|. */
  readonly ece: number;
}

/**
 * Calibration reliability diagram over `bins` equal-width probability bins for a
 * binary target, plus the binary ECE. Unlike the top-class `expectedCalibrationError`
 * (multiclass), this measures whether `score` (P(positive)) matches the observed
 * positive rate — the calibration question for a screening probability.
 */
export function reliabilityDiagram(
  pos: readonly boolean[],
  score: readonly number[],
  bins = 10,
): ReliabilityDiagram {
  const n = Math.min(pos.length, score.length);
  const count = new Array(bins).fill(0);
  const sumScore = new Array(bins).fill(0);
  const sumPos = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(score[i]! * bins)));
    count[b]++;
    sumScore[b] += score[i]!;
    if (pos[i]) sumPos[b]++;
  }
  const out: ReliabilityBin[] = [];
  let ece = 0;
  const denom = n || 1;
  for (let b = 0; b < bins; b++) {
    const meanScore = count[b] > 0 ? sumScore[b] / count[b] : 0;
    const observedRate = count[b] > 0 ? sumPos[b] / count[b] : 0;
    if (count[b] > 0) ece += (count[b] / denom) * Math.abs(observedRate - meanScore);
    out.push({ lo: b / bins, hi: (b + 1) / bins, count: count[b], meanScore, observedRate });
  }
  return { bins: out, ece };
}
