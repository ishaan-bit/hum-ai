import {
  computeStandardizer,
  applyStandardizer,
  trainLogReg,
  predictProba as logregProba,
  type Standardizer,
} from "./model";

/**
 * A small, dependency-free MODEL COHORT for the multi-dataset experiment.
 *
 * "Baselines first" (research/training/README) — but a single linear baseline can
 * neither confirm nor rule out that a target is learnable. So we evaluate a cohort
 * spanning model families, all pure-TS and deterministic (no RNG except seeded
 * bagging), so a fair cross-model comparison is possible without heavy deps or a
 * GPU:
 *   - linear:      multinomial LogReg (reuses model.ts) + a strongly-regularized variant
 *   - prototype:   nearest-centroid (standardized class means)
 *   - probabilistic: diagonal Gaussian naive Bayes
 *   - instance:    distance-weighted k-NN
 *   - tree:        CART decision tree + a bagged random forest
 *   - ensemble:    probability-averaged calibrated ensemble
 *
 * EVERY model fits its own standardizer on the TRAIN rows it is given, so when the
 * CV harness passes train-fold rows the test fold never leaks into scaling. Each
 * `predictProba` returns a full distribution over the provided `labels` (0 for a
 * class the fitted model never saw), so metrics + ECE are always well-defined.
 */

export interface CohortPredictor {
  predictProba(rawVector: readonly number[]): Record<string, number>;
}

export interface CohortModelSpec {
  readonly name: string;
  readonly family: string;
  train(
    X: readonly (readonly number[])[],
    y: readonly string[],
    labels: readonly string[],
    featureNames: readonly string[],
  ): CohortPredictor;
}

/** mulberry32 deterministic PRNG (shared with evaluate's protocol). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function zeroDist(labels: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of labels) out[l] = 0;
  return out;
}

// ---------------------------------------------------------------------------
// Linear — multinomial logistic regression (reuses the trained model.ts core).
// ---------------------------------------------------------------------------
export function logRegSpec(opts: { name?: string; l2?: number; iterations?: number } = {}): CohortModelSpec {
  return {
    name: opts.name ?? "logreg",
    family: "linear",
    train(X, y, labels, featureNames) {
      const params = trainLogReg(X, y, { labels, featureNames, l2: opts.l2, iterations: opts.iterations });
      return { predictProba: (v) => logregProba(params, v) };
    },
  };
}

// ---------------------------------------------------------------------------
// Prototype — nearest centroid in standardized space (softmax over -distance²).
// ---------------------------------------------------------------------------
export const nearestCentroidSpec: CohortModelSpec = {
  name: "nearest_centroid",
  family: "prototype",
  train(X, y, labels) {
    const std = computeStandardizer(X);
    const Xs = X.map((v) => applyStandardizer(v, std));
    const d = Xs.length > 0 ? Xs[0]!.length : 0;
    const sum = new Map<string, number[]>();
    const count = new Map<string, number>();
    for (const l of labels) {
      sum.set(l, new Array(d).fill(0));
      count.set(l, 0);
    }
    for (let i = 0; i < Xs.length; i++) {
      const c = sum.get(y[i]!);
      if (!c) continue;
      const x = Xs[i]!;
      for (let j = 0; j < d; j++) c[j]! += x[j]!;
      count.set(y[i]!, (count.get(y[i]!) ?? 0) + 1);
    }
    const centroids = new Map<string, number[]>();
    for (const l of labels) {
      const n = count.get(l) ?? 0;
      if (n === 0) continue;
      centroids.set(l, sum.get(l)!.map((s) => s / n));
    }
    return {
      predictProba(rawVector) {
        const x = applyStandardizer(rawVector, std);
        const present = labels.filter((l) => centroids.has(l));
        const neg = present.map((l) => {
          const c = centroids.get(l)!;
          let dist = 0;
          for (let j = 0; j < c.length; j++) {
            const diff = x[j]! - c[j]!;
            dist += diff * diff;
          }
          return -dist / Math.max(1, c.length); // scale-stable
        });
        const p = softmax(neg);
        const out = zeroDist(labels);
        present.forEach((l, i) => (out[l] = p[i]!));
        return out;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Probabilistic — diagonal Gaussian naive Bayes (log-prior + per-feature logpdf).
// ---------------------------------------------------------------------------
export const gaussianNbSpec: CohortModelSpec = {
  name: "gaussian_nb",
  family: "probabilistic",
  train(X, y, labels) {
    const std = computeStandardizer(X);
    const Xs = X.map((v) => applyStandardizer(v, std));
    const d = Xs.length > 0 ? Xs[0]!.length : 0;
    const idx = new Map<string, number[]>();
    labels.forEach((l) => idx.set(l, []));
    for (let i = 0; i < Xs.length; i++) idx.get(y[i]!)?.push(i);
    const VAR_FLOOR = 1e-2;
    const stats = new Map<string, { mean: number[]; var: number[]; logPrior: number }>();
    for (const l of labels) {
      const rows = idx.get(l)!;
      if (rows.length === 0) continue;
      const mean = new Array(d).fill(0);
      for (const i of rows) for (let j = 0; j < d; j++) mean[j] += Xs[i]![j]!;
      for (let j = 0; j < d; j++) mean[j] /= rows.length;
      const varr = new Array(d).fill(0);
      for (const i of rows) for (let j = 0; j < d; j++) {
        const diff = Xs[i]![j]! - mean[j];
        varr[j] += diff * diff;
      }
      for (let j = 0; j < d; j++) varr[j] = Math.max(VAR_FLOOR, varr[j] / Math.max(1, rows.length));
      stats.set(l, { mean, var: varr, logPrior: Math.log(rows.length / Xs.length) });
    }
    return {
      predictProba(rawVector) {
        const x = applyStandardizer(rawVector, std);
        const present = labels.filter((l) => stats.has(l));
        const logp = present.map((l) => {
          const s = stats.get(l)!;
          let lp = s.logPrior;
          for (let j = 0; j < s.mean.length; j++) {
            const diff = x[j]! - s.mean[j]!;
            lp += -0.5 * (Math.log(2 * Math.PI * s.var[j]!) + (diff * diff) / s.var[j]!);
          }
          return lp;
        });
        const p = softmax(logp);
        const out = zeroDist(labels);
        present.forEach((l, i) => (out[l] = p[i]!));
        return out;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Instance — distance-weighted k-NN in standardized space.
// ---------------------------------------------------------------------------
export function knnSpec(k = 15): CohortModelSpec {
  return {
    name: `knn_k${k}`,
    family: "instance",
    train(X, y, labels) {
      const std = computeStandardizer(X);
      const Xs = X.map((v) => applyStandardizer(v, std));
      return {
        predictProba(rawVector) {
          const x = applyStandardizer(rawVector, std);
          const dists = Xs.map((v, i) => {
            let d = 0;
            for (let j = 0; j < v.length; j++) {
              const diff = x[j]! - v[j]!;
              d += diff * diff;
            }
            return { d, i };
          });
          dists.sort((a, b) => a.d - b.d || a.i - b.i);
          const kk = Math.min(k, dists.length);
          const out = zeroDist(labels);
          let total = 0;
          for (let n = 0; n < kk; n++) {
            const w = 1 / (1 + Math.sqrt(dists[n]!.d));
            const lab = y[dists[n]!.i]!;
            if (lab in out) {
              out[lab]! += w;
              total += w;
            }
          }
          if (total > 0) for (const l of labels) out[l]! /= total;
          else for (const l of labels) out[l] = 1 / labels.length;
          return out;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tree — CART (gini) decision tree + bagged random forest.
// ---------------------------------------------------------------------------
interface TreeNode {
  readonly leaf: boolean;
  readonly dist?: number[]; // leaf class probabilities (over labels order)
  readonly feature?: number;
  readonly threshold?: number;
  readonly left?: TreeNode;
  readonly right?: TreeNode;
}

interface TreeOpts {
  readonly maxDepth: number;
  readonly minLeaf: number;
  readonly thresholds: number; // quantile candidate thresholds per feature
  readonly mtry: number | null; // feature subsample size (null = all)
  readonly rng: () => number;
}

function gini(counts: number[], total: number): number {
  if (total === 0) return 0;
  let s = 0;
  for (const c of counts) {
    const p = c / total;
    s += p * p;
  }
  return 1 - s;
}

function candidateThresholds(values: number[], maxT: number): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length <= 1) return [];
  if (sorted.length - 1 <= maxT) {
    const out: number[] = [];
    for (let i = 1; i < sorted.length; i++) out.push((sorted[i - 1]! + sorted[i]!) / 2);
    return out;
  }
  const out: number[] = [];
  for (let t = 1; t <= maxT; t++) {
    const q = (t / (maxT + 1)) * (sorted.length - 1);
    const lo = Math.floor(q);
    out.push((sorted[lo]! + sorted[Math.min(sorted.length - 1, lo + 1)]!) / 2);
  }
  return [...new Set(out)];
}

function buildTree(
  rows: number[],
  X: readonly (readonly number[])[],
  yIdx: readonly number[],
  K: number,
  depth: number,
  opts: TreeOpts,
): TreeNode {
  const counts = new Array(K).fill(0);
  for (const i of rows) counts[yIdx[i]!]++;
  const total = rows.length;
  const dist = counts.map((c) => c / Math.max(1, total));
  const pure = counts.some((c) => c === total);
  if (depth >= opts.maxDepth || total < 2 * opts.minLeaf || pure) {
    return { leaf: true, dist };
  }
  const D = X[0]!.length;
  let featurePool = Array.from({ length: D }, (_, j) => j);
  if (opts.mtry && opts.mtry < D) {
    // seeded partial Fisher-Yates → first mtry features
    for (let a = 0; a < opts.mtry; a++) {
      const b = a + Math.floor(opts.rng() * (D - a));
      [featurePool[a], featurePool[b]] = [featurePool[b]!, featurePool[a]!];
    }
    featurePool = featurePool.slice(0, opts.mtry);
  }

  const parentGini = gini(counts, total);
  let best: { feat: number; thr: number; gain: number; left: number[]; right: number[] } | null = null;
  for (const feat of featurePool) {
    const vals = rows.map((i) => X[i]![feat]!);
    for (const thr of candidateThresholds(vals, opts.thresholds)) {
      const lc = new Array(K).fill(0);
      const rc = new Array(K).fill(0);
      const left: number[] = [];
      const right: number[] = [];
      for (const i of rows) {
        if (X[i]![feat]! <= thr) {
          left.push(i);
          lc[yIdx[i]!]++;
        } else {
          right.push(i);
          rc[yIdx[i]!]++;
        }
      }
      if (left.length < opts.minLeaf || right.length < opts.minLeaf) continue;
      const wl = left.length / total;
      const wr = right.length / total;
      const gain = parentGini - (wl * gini(lc, left.length) + wr * gini(rc, right.length));
      if (gain > 0 && (!best || gain > best.gain)) best = { feat, thr, gain, left, right };
    }
  }
  if (!best) return { leaf: true, dist };
  return {
    leaf: false,
    feature: best.feat,
    threshold: best.thr,
    left: buildTree(best.left, X, yIdx, K, depth + 1, opts),
    right: buildTree(best.right, X, yIdx, K, depth + 1, opts),
  };
}

function treeDist(node: TreeNode, x: readonly number[]): number[] {
  let n = node;
  while (!n.leaf) n = x[n.feature!]! <= n.threshold! ? n.left! : n.right!;
  return n.dist!;
}

export function decisionTreeSpec(opts: { maxDepth?: number; minLeaf?: number; thresholds?: number } = {}): CohortModelSpec {
  return {
    name: "decision_tree",
    family: "tree",
    train(X, y, labels) {
      const labelIndex = new Map(labels.map((l, i) => [l, i]));
      const yIdx = y.map((l) => labelIndex.get(l) ?? 0);
      const root = buildTree(
        X.map((_, i) => i),
        X,
        yIdx,
        labels.length,
        0,
        { maxDepth: opts.maxDepth ?? 7, minLeaf: opts.minLeaf ?? 8, thresholds: opts.thresholds ?? 10, mtry: null, rng: makeRng(1) },
      );
      return {
        predictProba(rawVector) {
          const dist = treeDist(root, rawVector);
          const out = zeroDist(labels);
          labels.forEach((l, i) => (out[l] = dist[i]!));
          return out;
        },
      };
    },
  };
}

export function randomForestSpec(
  opts: { trees?: number; maxDepth?: number; minLeaf?: number; thresholds?: number; seed?: number } = {},
): CohortModelSpec {
  const nTrees = opts.trees ?? 15;
  return {
    name: `random_forest_${nTrees}`,
    family: "tree",
    train(X, y, labels) {
      const labelIndex = new Map(labels.map((l, i) => [l, i]));
      const yIdx = y.map((l) => labelIndex.get(l) ?? 0);
      const D = X.length > 0 ? X[0]!.length : 0;
      const mtry = Math.max(1, Math.round(Math.sqrt(D)));
      const rng = makeRng(opts.seed ?? 7);
      const N = X.length;
      const trees: TreeNode[] = [];
      for (let t = 0; t < nTrees; t++) {
        const boot: number[] = new Array(N);
        for (let i = 0; i < N; i++) boot[i] = Math.floor(rng() * N);
        trees.push(
          buildTree(boot, X, yIdx, labels.length, 0, {
            maxDepth: opts.maxDepth ?? 6,
            minLeaf: opts.minLeaf ?? 8,
            thresholds: opts.thresholds ?? 8,
            mtry,
            rng,
          }),
        );
      }
      return {
        predictProba(rawVector) {
          const agg = new Array(labels.length).fill(0);
          for (const tr of trees) {
            const dist = treeDist(tr, rawVector);
            for (let i = 0; i < agg.length; i++) agg[i] += dist[i]!;
          }
          const out = zeroDist(labels);
          labels.forEach((l, i) => (out[l] = agg[i]! / Math.max(1, trees.length)));
          return out;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Ensemble — probability-averaged calibrated ensemble of member specs.
// ---------------------------------------------------------------------------
export function ensembleSpec(members: readonly CohortModelSpec[], name = "calibrated_ensemble"): CohortModelSpec {
  return {
    name,
    family: "ensemble",
    train(X, y, labels, featureNames) {
      const fitted = members.map((m) => m.train(X, y, labels, featureNames));
      return {
        predictProba(rawVector) {
          const out = zeroDist(labels);
          for (const f of fitted) {
            const d = f.predictProba(rawVector);
            for (const l of labels) out[l]! += (d[l] ?? 0) / fitted.length;
          }
          return out;
        },
      };
    },
  };
}

/** The default cohort evaluated by the experiment (diverse families, fast settings). */
export function defaultCohort(): CohortModelSpec[] {
  const logreg = logRegSpec();
  const logregReg = logRegSpec({ name: "logreg_l2_strong", l2: 0.05 });
  const nb = gaussianNbSpec;
  const forest = randomForestSpec();
  return [
    logreg,
    logregReg,
    nearestCentroidSpec,
    nb,
    knnSpec(15),
    decisionTreeSpec(),
    forest,
    ensembleSpec([logreg, nb, forest]),
  ];
}
