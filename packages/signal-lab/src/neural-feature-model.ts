import type { AcousticFeatures } from "@hum-ai/audio-features";
import { softmax } from "@hum-ai/shared-types";
import { toFeatureVector, featureVectorNames } from "./feature-schema";
import { applyStandardizer } from "./model";

/**
 * Pure-TS executor for a feature-space neural model exported by the Python harness
 * (`research/training/signal_neural/export_ts.py`). This is the runtime-integration
 * boundary: a feature-space neural winner runs in the TypeScript runtime with NO
 * Python, ONNX, or GPU dependency — it consumes the SAME 58-d `toFeatureVector`
 * contract as the classical LogReg, so production never gains a heavy ML dependency.
 *
 * The op-graph is executed in order on the raw feature vector:
 *   standardize → [linear → batchnorm → relu]* → linear → softmax.
 * BatchNorm1d is folded to its eval-time affine form by the exporter; Dropout is
 * identity at eval (omitted). Audio (mel) models are NOT executable here — those
 * are served by the Python CLI wrapper and the TS runtime keeps its classical
 * fallback (see the neural manifest's `inferenceImpact`).
 *
 * Governance (ADR-0005): a promoted arousal/valence model is a coarse, far-domain
 * acted-speech PRIOR (penalty 0.45). It is surfaced as an auxiliary, gate-passed
 * signal and does NOT by itself steer the affect head or interventions.
 */

export interface LinearOp {
  readonly op: "linear";
  readonly W: readonly (readonly number[])[]; // [out][in]
  readonly b: readonly number[]; // [out]
}
export interface BatchNormOp {
  readonly op: "batchnorm";
  readonly mean: readonly number[];
  readonly var: readonly number[];
  readonly weight: readonly number[];
  readonly bias: readonly number[];
  readonly eps: number;
}
export interface ReluOp {
  readonly op: "relu";
}
export type NeuralOp = LinearOp | BatchNormOp | ReluOp;

export interface NeuralFeatureModel {
  readonly version: string;
  readonly kind: "feature_mlp_opgraph";
  readonly target: string;
  readonly family: string;
  readonly labels: readonly string[];
  readonly featureNames: readonly string[];
  readonly standardizer: { readonly mean: readonly number[]; readonly std: readonly number[] };
  readonly ops: readonly NeuralOp[];
  readonly evidence: {
    readonly balancedAccuracy: number;
    readonly ece: number;
    readonly pValue: number;
    readonly classicalBaseline: number | null;
    readonly validation: string;
  };
  readonly governance: string;
}

export class NeuralFeatureModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeuralFeatureModelError";
  }
}

/** Validate a parsed op-graph against the live feature contract; throws on mismatch. */
export function parseNeuralFeatureModel(json: string | unknown): NeuralFeatureModel {
  const m = (typeof json === "string" ? JSON.parse(json) : json) as NeuralFeatureModel;
  if (!m || m.kind !== "feature_mlp_opgraph") {
    throw new NeuralFeatureModelError("not a feature_mlp_opgraph artifact");
  }
  if (!Array.isArray(m.ops) || !Array.isArray(m.labels) || !m.standardizer) {
    throw new NeuralFeatureModelError("malformed neural feature model (ops/labels/standardizer missing)");
  }
  const expected = featureVectorNames();
  if (m.featureNames.length !== expected.length) {
    throw new NeuralFeatureModelError(
      `feature contract drift: model expects ${m.featureNames.length} features, runtime emits ${expected.length}`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (m.featureNames[i] !== expected[i]) {
      throw new NeuralFeatureModelError(
        `feature contract drift at index ${i}: model '${m.featureNames[i]}' vs runtime '${expected[i]}'`,
      );
    }
  }
  if (m.standardizer.mean.length !== expected.length || m.standardizer.std.length !== expected.length) {
    throw new NeuralFeatureModelError("standardizer length does not match the feature vector length");
  }
  return m;
}

function applyOp(x: number[], op: NeuralOp): number[] {
  switch (op.op) {
    case "linear": {
      const out = new Array<number>(op.b.length);
      for (let o = 0; o < op.b.length; o++) {
        let s = op.b[o]!;
        const wo = op.W[o]!;
        for (let i = 0; i < x.length; i++) s += wo[i]! * x[i]!;
        out[o] = s;
      }
      return out;
    }
    case "batchnorm": {
      const out = new Array<number>(x.length);
      for (let i = 0; i < x.length; i++) {
        out[i] = ((x[i]! - op.mean[i]!) / Math.sqrt(op.var[i]! + op.eps)) * op.weight[i]! + op.bias[i]!;
      }
      return out;
    }
    case "relu":
      return x.map((v) => (v > 0 ? v : 0));
  }
}


/** Run the op-graph on a RAW feature vector → probability distribution over labels. */
export function predictNeural(model: NeuralFeatureModel, rawVector: readonly number[]): Record<string, number> {
  let x = applyStandardizer(rawVector, model.standardizer);
  for (const op of model.ops) x = applyOp(x, op);
  const p = softmax(x);
  const out: Record<string, number> = {};
  for (let k = 0; k < model.labels.length; k++) out[model.labels[k]!] = p[k] ?? 0;
  return out;
}

export interface NeuralPrediction {
  readonly target: string;
  readonly topLabel: string;
  readonly probability: number;
  readonly distribution: Readonly<Record<string, number>>;
}

/** Predict from `AcousticFeatures` (applies the standard vectorizer). */
export function predictNeuralFromFeatures(model: NeuralFeatureModel, features: AcousticFeatures): NeuralPrediction {
  const dist = predictNeural(model, toFeatureVector(features));
  let topLabel = model.labels[0] ?? "";
  let best = -1;
  for (const l of model.labels) {
    const p = dist[l] ?? 0;
    if (p > best) {
      best = p;
      topLabel = l;
    }
  }
  return { target: model.target, topLabel, probability: best < 0 ? 0 : best, distribution: dist };
}
