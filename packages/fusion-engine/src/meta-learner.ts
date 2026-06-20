import { FUSION_LABELS, type FusionLabel, type ExpertOutput } from "@hum-ai/affect-model-contracts";
import { expertWeight } from "./reliability";

export type FusionDistribution = Record<FusionLabel, number>;

/**
 * Late-fusion meta-learner contract. Mirrors the TriSense design: independent
 * expert probability vectors in, one fused distribution out. A trained model
 * (Logistic Regression v1, attention/gated-MoE v2) drops in behind this.
 */
export interface MetaLearner {
  readonly kind: "stub_weighted" | "logistic_regression" | "attention_moe";
  combine(experts: readonly ExpertOutput[]): FusionDistribution;
}

function zeroDist(): FusionDistribution {
  const d = {} as FusionDistribution;
  for (const l of FUSION_LABELS) d[l] = 0;
  return d;
}

function normalize(d: FusionDistribution): FusionDistribution {
  let total = 0;
  for (const l of FUSION_LABELS) total += Math.max(d[l], 0);
  const out = zeroDist();
  if (total <= 0) {
    for (const l of FUSION_LABELS) out[l] = 1 / FUSION_LABELS.length;
    return out;
  }
  for (const l of FUSION_LABELS) out[l] = Math.max(d[l], 0) / total;
  return out;
}

/**
 * v1 default: reliability-weighted late fusion. This is the deterministic
 * stand-in for the LogReg meta-learner — same interface, no training required.
 * Only available experts contribute; each is weighted by `expertWeight`.
 */
export class StubWeightedMetaLearner implements MetaLearner {
  readonly kind = "stub_weighted" as const;
  combine(experts: readonly ExpertOutput[]): FusionDistribution {
    const acc = zeroDist();
    for (const e of experts) {
      if (!e.available) continue;
      const w = expertWeight(e);
      if (w <= 0) continue;
      for (const l of FUSION_LABELS) acc[l] += w * (e.probabilities[l] ?? 0);
    }
    return normalize(acc);
  }
}

/**
 * Typed shape of a trained Logistic-Regression meta-learner (the TriSense LogReg
 * fusion). The feature vector is the concatenation of each expert's probability
 * vector over `FUSION_LABELS`, in `expertOrder` (a missing/unavailable expert
 * contributes a zero block, so the layout is fixed). `weights[class]` aligns with
 * `FUSION_LABELS` order. Train with {@link fitMetaLearner}; serialize to JSON.
 */
export interface LogisticRegressionParams {
  readonly expertOrder: readonly string[];
  /** weights[class][feature]; class index k ↔ FUSION_LABELS[k]. */
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
  /** How many samples it was fit on (provenance; 0 ⇒ hand-authored). */
  readonly trainCount?: number;
}

/** Probability a given expert assigns to each FUSION label, in FUSION_LABELS order. */
function expertBlock(e: ExpertOutput | undefined): number[] {
  const block = new Array<number>(FUSION_LABELS.length).fill(0);
  if (!e || !e.available) return block;
  for (let k = 0; k < FUSION_LABELS.length; k++) block[k] = Math.max(e.probabilities[FUSION_LABELS[k]!] ?? 0, 0);
  return block;
}

/**
 * The fixed-layout feature vector for the meta-learner: the concatenation of each
 * expert's FUSION_LABELS probability block, in `expertOrder`. Experts absent from
 * `experts` (or unavailable) contribute a zero block so the dimensionality is stable
 * regardless of which experts fired this hum.
 */
export function metaFeatureVector(experts: readonly ExpertOutput[], expertOrder: readonly string[]): number[] {
  const byId = new Map(experts.map((e) => [e.expertId, e]));
  const v: number[] = [];
  for (const id of expertOrder) v.push(...expertBlock(byId.get(id)));
  return v;
}

function softmax(z: readonly number[]): number[] {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  let sum = 0;
  const out = new Array<number>(z.length);
  for (let k = 0; k < z.length; k++) {
    const e = Math.exp(z[k]! - max);
    out[k] = e;
    sum += e;
  }
  for (let k = 0; k < z.length; k++) out[k] = out[k]! / (sum || 1);
  return out;
}

/**
 * The trained late-fusion meta-learner (the drop-in for `StubWeightedMetaLearner`
 * once weights are fit). `combine` runs the forward pass: build the fixed-layout
 * feature vector, score each class (`bias + w·x`), softmax → a `FusionDistribution`.
 * Untrained (no params) it throws with a helpful message — the deterministic
 * `StubWeightedMetaLearner` is always available as the honest fallback.
 */
export class LogisticRegressionMetaLearner implements MetaLearner {
  readonly kind = "logistic_regression" as const;
  constructor(private readonly params?: LogisticRegressionParams) {}

  combine(experts: readonly ExpertOutput[]): FusionDistribution {
    const p = this.params;
    if (!p) {
      throw new Error(
        "LogisticRegressionMetaLearner is untrained. Fit params with fitMetaLearner(...), " +
          "or use StubWeightedMetaLearner for the deterministic reliability-weighted fusion.",
      );
    }
    const x = metaFeatureVector(experts, p.expertOrder);
    const K = FUSION_LABELS.length;
    const z = new Array<number>(K);
    for (let k = 0; k < K; k++) {
      let s = p.bias[k] ?? 0;
      const wk = p.weights[k];
      if (wk) for (let j = 0; j < x.length; j++) s += (wk[j] ?? 0) * x[j]!;
      z[k] = s;
    }
    const probs = softmax(z);
    const out = zeroDist();
    for (let k = 0; k < K; k++) out[FUSION_LABELS[k]!] = probs[k]!;
    return out; // already a proper distribution (softmax sums to 1)
  }
}

export interface MetaLearnerSample {
  readonly experts: readonly ExpertOutput[];
  readonly label: FusionLabel;
}

export interface FitMetaOptions {
  /** Fixed expert order; defaults to the order seen in the first sample's experts. */
  readonly expertOrder?: readonly string[];
  readonly l2?: number;
  readonly iterations?: number;
  readonly learningRate?: number;
}

/**
 * Fit the LogReg meta-learner on labelled expert-output samples (the concatenated
 * expert probability vectors → the observed fusion label). Deterministic multinomial
 * logistic regression: zero-init, full-batch gradient descent, L2, inverse-frequency
 * class weighting — same machinery as `signal-lab` `trainLogReg`, kept self-contained
 * so `fusion-engine` stays dependency-light. Returns params consumable by
 * `LogisticRegressionMetaLearner`. (Live wiring — corpus → experts → label — is a
 * follow-up; this makes the trained model a tested drop-in.)
 */
export function fitMetaLearner(samples: readonly MetaLearnerSample[], opts: FitMetaOptions = {}): LogisticRegressionParams {
  const expertOrder = opts.expertOrder ?? (samples[0]?.experts.map((e) => e.expertId) ?? []);
  const K = FUSION_LABELS.length;
  const D = expertOrder.length * K;
  const l2 = opts.l2 ?? 1e-3;
  const iterations = opts.iterations ?? 400;
  const lr = opts.learningRate ?? 0.5;
  const labelIndex = new Map(FUSION_LABELS.map((l, i) => [l, i]));

  const X = samples.map((s) => metaFeatureVector(s.experts, expertOrder));
  const y = samples.map((s) => {
    const idx = labelIndex.get(s.label);
    if (idx === undefined) throw new Error(`fitMetaLearner: label '${s.label}' not in FUSION_LABELS`);
    return idx;
  });
  const N = X.length;

  // Inverse-frequency class weights (normalized to mean 1) to counter imbalance.
  const counts = new Array<number>(K).fill(0);
  for (const k of y) counts[k]!++;
  const classWeight = new Array<number>(K).fill(1);
  let wsum = 0;
  for (let k = 0; k < K; k++) {
    classWeight[k] = counts[k]! > 0 ? N / (K * counts[k]!) : 0;
    wsum += classWeight[k]!;
  }
  const norm = wsum > 0 ? K / wsum : 1;
  for (let k = 0; k < K; k++) classWeight[k]! *= norm;

  const weights: number[][] = Array.from({ length: K }, () => new Array<number>(D).fill(0));
  const bias = new Array<number>(K).fill(0);

  for (let it = 0; it < iterations && N > 0; it++) {
    const gW: number[][] = Array.from({ length: K }, () => new Array<number>(D).fill(0));
    const gB = new Array<number>(K).fill(0);
    let wTotal = 0;
    for (let i = 0; i < N; i++) {
      const x = X[i]!;
      const z = new Array<number>(K);
      for (let k = 0; k < K; k++) {
        let s = bias[k]!;
        const wk = weights[k]!;
        for (let j = 0; j < D; j++) s += wk[j]! * x[j]!;
        z[k] = s;
      }
      const p = softmax(z);
      const target = y[i]!;
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

  return { expertOrder, weights, bias, trainCount: N };
}

export function argmax(d: FusionDistribution): { label: FusionLabel; prob: number; margin: number } {
  const sorted = [...FUSION_LABELS].sort((a, b) => d[b] - d[a]);
  const label = sorted[0] as FusionLabel;
  const top = d[label];
  const second = sorted.length > 1 ? d[sorted[1] as FusionLabel] : 0;
  return { label, prob: top, margin: top - second };
}
