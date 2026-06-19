import type { LogRegParams } from "./model";

/**
 * Feature-significance analysis for the evidence report — "which parameters carry
 * the signal, which are dead weight". Two complementary, honest views:
 *
 *  - `anovaF`: a MODEL-AGNOSTIC univariate one-way ANOVA F-statistic per feature
 *    across the target classes (between-class variance / within-class variance).
 *    High F = the feature's mean separates the classes; ~1 = no separation. This
 *    does not know about any model, so it cannot be inflated by a model's quirks.
 *  - `logRegWeightMagnitude`: the trained LogReg's mean |weight| per feature (on
 *    standardized inputs), i.e. how much the fitted linear model leans on it.
 *
 * Neither is a biomarker claim (ADR-0005): these are which acoustic columns help
 * separate acted-speech affect labels, a PRIOR-domain statement only.
 */

export interface FeatureScore {
  readonly feature: string;
  readonly score: number;
  readonly rank: number;
}

/** One-way ANOVA F per feature across classes. Larger = more between-class separation. */
export function anovaF(
  X: readonly (readonly number[])[],
  y: readonly string[],
  featureNames: readonly string[],
): FeatureScore[] {
  const N = X.length;
  const D = featureNames.length;
  const classes = Array.from(new Set(y));
  const k = classes.length;
  const byClass = new Map<string, number[]>();
  classes.forEach((c, i) => byClass.set(c, []));
  for (let i = 0; i < N; i++) byClass.get(y[i]!)?.push(i);

  const scores: FeatureScore[] = [];
  for (let j = 0; j < D; j++) {
    let grand = 0;
    for (let i = 0; i < N; i++) grand += X[i]![j]!;
    grand /= Math.max(1, N);
    let ssb = 0; // between
    let ssw = 0; // within
    for (const c of classes) {
      const rows = byClass.get(c)!;
      if (rows.length === 0) continue;
      let mean = 0;
      for (const i of rows) mean += X[i]![j]!;
      mean /= rows.length;
      ssb += rows.length * (mean - grand) ** 2;
      for (const i of rows) ssw += (X[i]![j]! - mean) ** 2;
    }
    const dfB = Math.max(1, k - 1);
    const dfW = Math.max(1, N - k);
    const msW = ssw / dfW;
    const f = msW > 1e-12 ? ssb / dfB / msW : 0;
    scores.push({ feature: featureNames[j]!, score: Number.isFinite(f) ? f : 0, rank: 0 });
  }
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((s, i) => ((s as { rank: number }).rank = i + 1));
  return scores;
}

/** Mean |weight| per feature across classes from a trained LogReg (standardized space). */
export function logRegWeightMagnitude(params: LogRegParams): FeatureScore[] {
  const K = params.weights.length;
  const scores: FeatureScore[] = params.featureNames.map((feature, j) => {
    let s = 0;
    for (let k = 0; k < K; k++) s += Math.abs(params.weights[k]![j]!);
    return { feature, score: K > 0 ? s / K : 0, rank: 0 };
  });
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((s, i) => ((s as { rank: number }).rank = i + 1));
  return scores;
}

export interface FeatureImportanceReport {
  readonly target: string;
  readonly n: number;
  readonly numClasses: number;
  readonly strongest: readonly FeatureScore[];
  readonly weakest: readonly FeatureScore[];
  readonly method: string;
}

/** Top/bottom-`k` ANOVA-F features for a target (the report's "strongest/weakest"). */
export function featureImportanceReport(
  X: readonly (readonly number[])[],
  y: readonly string[],
  featureNames: readonly string[],
  target: string,
  topK = 12,
): FeatureImportanceReport {
  const f = anovaF(X, y, featureNames);
  return {
    target,
    n: X.length,
    numClasses: new Set(y).size,
    strongest: f.slice(0, topK),
    weakest: [...f].slice(-topK).reverse(),
    method: "one-way ANOVA F across target classes (model-agnostic, prior-domain only)",
  };
}
