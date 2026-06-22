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
