import type { NativeHumExample } from "@hum-ai/affect-model-contracts";
import { trainLogReg, predictProba, type LogRegParams } from "@hum-ai/signal-lab/model";
import { toFeatureVector, featureVectorNames } from "@hum-ai/signal-lab/feature-schema";
import { acousticAffectAxes } from "@hum-ai/orchestrator";
import { trainableExamples, type NativeCorpus } from "./corpus";
import { CALIBRATION_DEADZONE, type Axis } from "./calibration";

/**
 * THE RETRAINING LOOP — fit a HUM-NATIVE valence/arousal model on the accumulated
 * corpus, honestly evaluate it, and decide promotion. All pure TypeScript reusing
 * signal-lab's deterministic `trainLogReg` — so the whole loop runs CLIENT-SIDE on
 * the user's own device, on their own confirmed hums.
 *
 * Why this matters: the shipped axis priors are far-domain acted speech and abstain
 * OOD on real hums. A model fit on NATIVE hums fits its own standardizer to hums, so
 * it is IN-DOMAIN for hums — it can actually steer the read, with NO far-domain
 * penalty (`prior.ts`). The honest bar to earn that: beat the transparent acoustic
 * backbone (`acousticAffectAxes`) on held-out native hums by a margin, with enough
 * examples and both poles represented. This is NOT the rigorous 0.80/p<.01/ECE gate
 * of the offline far-domain harness, and it is NOT a clinical claim — it is "this
 * model reads THIS population's hums better than the generic hand-mapping does".
 */

/** Pole label names — identical to signal-lab's axis-prior convention so priors line up. */
export const AXIS_POLE_LABELS: Record<Axis, { low: string; high: string }> = {
  valence: { low: "negative_valence", high: "positive_valence" },
  arousal: { low: "low_arousal", high: "high_arousal" },
};

/** Minimum eligible, non-ambiguous examples before a retrain is even attempted. */
export const NATIVE_MIN_EXAMPLES = 24;
/** Minimum examples per pole (both low AND high) — never train/promote on a skewed set. */
export const NATIVE_MIN_PER_CLASS = 8;
/** Absolute balanced-accuracy floor a challenger must clear regardless of the backbone. */
export const NATIVE_ABS_FLOOR = 0.6;
/** Margin by which the challenger must beat the acoustic backbone to be promoted. */
export const NATIVE_PROMOTE_MARGIN = 0.03;
/** Cross-validation folds for the honest held-out estimate. */
export const NATIVE_CV_FOLDS = 5;
/** Iterations for the in-browser LogReg fits (kept modest for responsiveness). */
export const NATIVE_TRAIN_ITERATIONS = 300;
/**
 * Cap on the rows fed to training/CV per retrain. The corpus ring holds up to 2000
 * examples; CV refits a LogReg (k+1)×iterations times, so on-device retrains are bounded
 * to the most RECENT rows to keep `maybeRetrain` responsive on the main thread. The full
 * corpus is still stored, synced, and used for calibration/readiness — only the per-retrain
 * training window is capped.
 */
export const NATIVE_TRAIN_MAX_ROWS = 600;

interface AxisRow {
  readonly example: NativeHumExample;
  readonly vector: number[];
  readonly label: string;
  readonly high: boolean;
}

/** Build training rows for one axis: eligible, non-ambiguous examples → (vector, pole label). */
export function buildAxisRows(corpus: NativeCorpus, axis: Axis): AxisRow[] {
  const poles = AXIS_POLE_LABELS[axis];
  const rows: AxisRow[] = [];
  for (const ex of trainableExamples(corpus)) {
    const v = ex.label[axis];
    if (!Number.isFinite(v) || Math.abs(v) < CALIBRATION_DEADZONE) continue; // skip ambiguous ground truth
    const high = v >= 0;
    rows.push({ example: ex, vector: toFeatureVector(ex.features), label: high ? poles.high : poles.low, high });
  }
  return rows;
}

function classCounts(rows: readonly AxisRow[]): { low: number; high: number } {
  let high = 0;
  for (const r of rows) if (r.high) high++;
  return { low: rows.length - high, high };
}

function trainOn(rows: readonly AxisRow[], axis: Axis, iterations: number): LogRegParams {
  const poles = AXIS_POLE_LABELS[axis];
  return trainLogReg(
    rows.map((r) => r.vector),
    rows.map((r) => r.label),
    {
      labels: [poles.low, poles.high],
      featureNames: featureVectorNames(),
      iterations,
      version: `native-hum-${axis}/0.1.0`,
    },
  );
}

/** Mean per-pole recall (balanced accuracy) of a {trueHigh, predHigh} confusion. Pure. */
function balancedAccuracy(rows: readonly { trueHigh: boolean; predHigh: boolean }[]): number {
  let highCorrect = 0;
  let highTotal = 0;
  let lowCorrect = 0;
  let lowTotal = 0;
  for (const r of rows) {
    if (r.trueHigh) {
      highTotal++;
      if (r.predHigh) highCorrect++;
    } else {
      lowTotal++;
      if (!r.predHigh) lowCorrect++;
    }
  }
  const recalls: number[] = [];
  if (highTotal > 0) recalls.push(highCorrect / highTotal);
  if (lowTotal > 0) recalls.push(lowCorrect / lowTotal);
  return recalls.length > 0 ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0;
}

/** Deterministic fold index for a row (stable by example id, no RNG → reproducible CV). */
function foldOf(id: string, k: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % k;
}

function challengerPredHigh(model: LogRegParams, axis: Axis, vector: readonly number[]): boolean {
  const poles = AXIS_POLE_LABELS[axis];
  const dist = predictProba(model, vector);
  return (dist[poles.high] ?? 0) >= (dist[poles.low] ?? 0);
}

function backbonePredHigh(example: NativeHumExample, axis: Axis): boolean {
  return acousticAffectAxes(example.features)[axis] >= 0;
}

/** k-fold balanced accuracy of the trained challenger over held-out rows. */
function crossValChallenger(rows: readonly AxisRow[], axis: Axis, k: number, iterations: number): number {
  const conf: { trueHigh: boolean; predHigh: boolean }[] = [];
  for (let f = 0; f < k; f++) {
    const train = rows.filter((r) => foldOf(r.example.id, k) !== f);
    const test = rows.filter((r) => foldOf(r.example.id, k) === f);
    if (test.length === 0) continue;
    // Need both poles in the training split for a meaningful fit; else skip the fold.
    const tc = classCounts(train);
    if (tc.low === 0 || tc.high === 0) continue;
    const model = trainOn(train, axis, iterations);
    for (const r of test) conf.push({ trueHigh: r.high, predHigh: challengerPredHigh(model, axis, r.vector) });
  }
  return balancedAccuracy(conf);
}

/** Balanced accuracy of the fixed acoustic backbone over the same rows (no training). */
function backboneBalancedAccuracy(rows: readonly AxisRow[], axis: Axis): number {
  return balancedAccuracy(rows.map((r) => ({ trueHigh: r.high, predHigh: backbonePredHigh(r.example, axis) })));
}

export interface AxisPromotion {
  readonly axis: Axis;
  readonly decision: "promote" | "hold";
  readonly n: number;
  readonly classCounts: { readonly low: number; readonly high: number };
  /** Held-out balanced accuracy of the hum-native challenger [0,1]. */
  readonly challengerBalancedAccuracy: number;
  /** Held-out balanced accuracy of the transparent acoustic backbone [0,1]. */
  readonly backboneBalancedAccuracy: number;
  /** challenger − backbone (the honest win margin). */
  readonly margin: number;
  /** Plain reasons for the decision (held: which criteria failed; promote: why it cleared). */
  readonly reasons: readonly string[];
  /** The full-data trained model — present ONLY when `decision === "promote"`. */
  readonly model: LogRegParams | null;
}

/**
 * Evaluate whether a hum-native model for one axis should be PROMOTED to steer the
 * read. Trains on all eligible non-ambiguous examples, cross-validates the challenger,
 * compares it to the acoustic backbone on the same rows, and applies the honest gate
 * (enough data + both poles + absolute floor + beats the backbone by a margin). Never
 * promotes on a skewed or thin corpus; never rounds a criterion up.
 */
export function evaluateAxisPromotion(corpus: NativeCorpus, axis: Axis): AxisPromotion {
  const allRows = buildAxisRows(corpus, axis);
  // Bound the per-retrain training window to the most recent rows (responsiveness).
  const rows = allRows.length > NATIVE_TRAIN_MAX_ROWS ? allRows.slice(allRows.length - NATIVE_TRAIN_MAX_ROWS) : allRows;
  const counts = classCounts(rows);
  const reasons: string[] = [];

  const enough = rows.length >= NATIVE_MIN_EXAMPLES;
  const balanced = counts.low >= NATIVE_MIN_PER_CLASS && counts.high >= NATIVE_MIN_PER_CLASS;
  if (!enough) reasons.push(`needs ≥${NATIVE_MIN_EXAMPLES} clear labelled hums (have ${rows.length})`);
  if (!balanced) reasons.push(`needs ≥${NATIVE_MIN_PER_CLASS} per pole (low ${counts.low}, high ${counts.high})`);

  if (!enough || !balanced) {
    return {
      axis,
      decision: "hold",
      n: rows.length,
      classCounts: counts,
      challengerBalancedAccuracy: 0,
      backboneBalancedAccuracy: 0,
      margin: 0,
      reasons,
      model: null,
    };
  }

  const challenger = crossValChallenger(rows, axis, NATIVE_CV_FOLDS, NATIVE_TRAIN_ITERATIONS);
  const backbone = backboneBalancedAccuracy(rows, axis);
  const margin = challenger - backbone;

  const clearsFloor = challenger >= NATIVE_ABS_FLOOR;
  const beatsBackbone = margin >= NATIVE_PROMOTE_MARGIN;
  if (!clearsFloor) reasons.push(`held-out accuracy ${(challenger * 100).toFixed(0)}% below the ${(NATIVE_ABS_FLOOR * 100).toFixed(0)}% floor`);
  if (!beatsBackbone) reasons.push(`does not beat the acoustic read by ≥${(NATIVE_PROMOTE_MARGIN * 100).toFixed(0)}% (margin ${(margin * 100).toFixed(0)}%)`);

  const promote = clearsFloor && beatsBackbone;
  if (promote) {
    reasons.push(
      `beats the acoustic read on your hums (${(challenger * 100).toFixed(0)}% vs ${(backbone * 100).toFixed(0)}% held-out)`,
    );
  }

  return {
    axis,
    decision: promote ? "promote" : "hold",
    n: rows.length,
    classCounts: counts,
    challengerBalancedAccuracy: challenger,
    backboneBalancedAccuracy: backbone,
    margin,
    reasons,
    model: promote ? trainOn(rows, axis, NATIVE_TRAIN_ITERATIONS) : null,
  };
}

export interface RetrainResult {
  readonly valence: AxisPromotion;
  readonly arousal: AxisPromotion;
}

/** Evaluate promotion for both axes from the current corpus. Pure; no I/O. */
export function retrainNativeAxes(corpus: NativeCorpus): RetrainResult {
  return {
    valence: evaluateAxisPromotion(corpus, "valence"),
    arousal: evaluateAxisPromotion(corpus, "arousal"),
  };
}
