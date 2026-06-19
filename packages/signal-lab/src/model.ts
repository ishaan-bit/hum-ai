/**
 * Baseline model: a deterministic, dependency-free multinomial logistic
 * regression (softmax) over standardized acoustic-feature vectors.
 *
 * This is the "baselines first" model the repo's training plan calls for
 * (`research/training/README.md`: LogReg is the v1 target; heavy SSL models are
 * future work). It is trained ONLY as an affect PRIOR on far-domain acted speech
 * (RAVDESS) and is surfaced through the existing `AffectExpert` contract — it is
 * NOT hum truth, NOT clinically validated, and carries the far-domain penalty
 * (ADR-0005). Training is full-batch gradient descent with zero-initialized
 * weights, so it is fully deterministic and reproducible (no RNG).
 */

export interface Standardizer {
  readonly mean: readonly number[];
  readonly std: readonly number[];
}

export interface LogRegParams {
  readonly version: string;
  readonly featureNames: readonly string[];
  readonly labels: readonly string[];
  readonly standardizer: Standardizer;
  /** weights[class][feature]; bias[class]. */
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
  readonly l2: number;
  readonly iterations: number;
  readonly learningRate: number;
  readonly trainCount: number;
  readonly classWeighted: boolean;
}

export interface TrainOptions {
  readonly labels: readonly string[];
  readonly featureNames: readonly string[];
  readonly l2?: number;
  readonly iterations?: number;
  readonly learningRate?: number;
  /** Inverse-frequency class weighting to counter label imbalance. Default true. */
  readonly classWeighted?: boolean;
  readonly version?: string;
}

const EPS = 1e-9;

export function computeStandardizer(vectors: readonly (readonly number[])[]): Standardizer {
  const n = vectors.length;
  const d = n > 0 ? vectors[0]!.length : 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(1);
  if (n === 0) return { mean, std };
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j]!;
  for (let j = 0; j < d; j++) mean[j] /= n;
  const varr = new Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) {
    const diff = v[j]! - mean[j];
    varr[j] += diff * diff;
  }
  for (let j = 0; j < d; j++) {
    const sd = Math.sqrt(varr[j] / Math.max(1, n));
    std[j] = sd > 1e-6 ? sd : 1; // a near-constant column gets unit scale (its weight will learn ~0)
  }
  return { mean, std };
}

export function applyStandardizer(v: readonly number[], s: Standardizer): number[] {
  const out = new Array(v.length);
  for (let j = 0; j < v.length; j++) out[j] = (v[j]! - s.mean[j]!) / s.std[j]!;
  return out;
}

function softmax(z: readonly number[]): number[] {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  let sum = 0;
  const out = new Array(z.length);
  for (let k = 0; k < z.length; k++) {
    const e = Math.exp(z[k]! - max);
    out[k] = e;
    sum += e;
  }
  for (let k = 0; k < z.length; k++) out[k] /= sum || 1;
  return out;
}

function scoresFor(x: readonly number[], weights: number[][], bias: number[]): number[] {
  const K = weights.length;
  const z = new Array(K);
  for (let k = 0; k < K; k++) {
    let s = bias[k]!;
    const wk = weights[k]!;
    for (let j = 0; j < x.length; j++) s += wk[j]! * x[j]!;
    z[k] = s;
  }
  return z;
}

/**
 * Train a multinomial logistic regression. `X` are RAW feature vectors (the
 * standardizer is fit here from `X`); `y` are label strings (must be in
 * `opts.labels`). Deterministic: zero init, full-batch GD.
 */
export function trainLogReg(
  X: readonly (readonly number[])[],
  y: readonly string[],
  opts: TrainOptions,
): LogRegParams {
  const labels = opts.labels;
  const K = labels.length;
  const N = X.length;
  const D = N > 0 ? X[0]!.length : opts.featureNames.length;
  const l2 = opts.l2 ?? 1e-3;
  const iterations = opts.iterations ?? 400;
  const lr = opts.learningRate ?? 0.5;
  const classWeighted = opts.classWeighted ?? true;
  const labelIndex = new Map(labels.map((l, i) => [l, i]));

  const standardizer = computeStandardizer(X);
  const Xs = X.map((v) => applyStandardizer(v, standardizer));
  const yi = y.map((l) => {
    const idx = labelIndex.get(l);
    if (idx === undefined) throw new Error(`trainLogReg: label '${l}' not in label space`);
    return idx;
  });

  // Inverse-frequency class weights (normalized to mean 1) to counter imbalance.
  const counts = new Array(K).fill(0);
  for (const k of yi) counts[k]++;
  const classWeight = new Array(K).fill(1);
  if (classWeighted) {
    let wsum = 0;
    for (let k = 0; k < K; k++) {
      classWeight[k] = counts[k] > 0 ? N / (K * counts[k]) : 0;
      wsum += classWeight[k];
    }
    const norm = wsum > 0 ? K / wsum : 1;
    for (let k = 0; k < K; k++) classWeight[k] *= norm;
  }

  const weights: number[][] = Array.from({ length: K }, () => new Array(D).fill(0));
  const bias: number[] = new Array(K).fill(0);

  if (N > 0) {
    for (let it = 0; it < iterations; it++) {
      const gW: number[][] = Array.from({ length: K }, () => new Array(D).fill(0));
      const gB: number[] = new Array(K).fill(0);
      let wTotal = 0;
      for (let i = 0; i < N; i++) {
        const x = Xs[i]!;
        const p = softmax(scoresFor(x, weights, bias));
        const target = yi[i]!;
        const cw = classWeight[target]!;
        wTotal += cw;
        for (let k = 0; k < K; k++) {
          const err = cw * (p[k]! - (k === target ? 1 : 0));
          gB[k]! += err;
          const gWk = gW[k]!;
          for (let j = 0; j < D; j++) gWk[j]! += err * x[j]!;
        }
      }
      const inv = wTotal > 0 ? 1 / wTotal : 0;
      for (let k = 0; k < K; k++) {
        bias[k]! -= lr * gB[k]! * inv;
        const wk = weights[k]!;
        const gWk = gW[k]!;
        for (let j = 0; j < D; j++) wk[j]! -= lr * (gWk[j]! * inv + l2 * wk[j]!);
      }
    }
  }

  return {
    version: opts.version ?? "signal-lab-logreg/0.1.0",
    featureNames: opts.featureNames,
    labels,
    standardizer,
    weights,
    bias,
    l2,
    iterations,
    learningRate: lr,
    trainCount: N,
    classWeighted,
  };
}

/** Probability distribution over `labels` for a RAW feature vector. */
export function predictProba(params: LogRegParams, rawVector: readonly number[]): Record<string, number> {
  const x = applyStandardizer(rawVector, params.standardizer);
  const z = scoresFor(x, params.weights as number[][], params.bias as number[]);
  const p = softmax(z);
  const out: Record<string, number> = {};
  for (let k = 0; k < params.labels.length; k++) out[params.labels[k]!] = p[k]!;
  return out;
}

/** Top label + probability + margin to the runner-up. */
export function predictTop(
  params: LogRegParams,
  rawVector: readonly number[],
): { label: string; prob: number; margin: number; dist: Record<string, number> } {
  const dist = predictProba(params, rawVector);
  const sorted = [...params.labels].sort((a, b) => (dist[b] ?? 0) - (dist[a] ?? 0));
  const label = sorted[0]!;
  const prob = dist[label] ?? 0;
  const second = sorted.length > 1 ? dist[sorted[1]!] ?? 0 : 0;
  return { label, prob, margin: prob - second, dist };
}

/**
 * Per-feature contribution to a class score for one sample (weight × standardized
 * value), used by the inference adapter to explain "what evidence supported it".
 */
export function featureContributions(
  params: LogRegParams,
  rawVector: readonly number[],
  label: string,
): { feature: string; contribution: number }[] {
  const k = params.labels.indexOf(label);
  if (k < 0) return [];
  const x = applyStandardizer(rawVector, params.standardizer);
  const wk = params.weights[k]!;
  const out = params.featureNames.map((feature, j) => ({ feature, contribution: wk[j]! * x[j]! }));
  out.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return out;
}

export function serializeModel(params: LogRegParams): string {
  return JSON.stringify(params, null, 2);
}

export function deserializeModel(json: string): LogRegParams {
  const p = JSON.parse(json) as LogRegParams;
  if (!Array.isArray(p.weights) || !Array.isArray(p.labels) || !p.standardizer) {
    throw new Error("deserializeModel: malformed model JSON");
  }
  return p;
}
