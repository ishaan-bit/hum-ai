import { clamp01, mean as meanOf } from "@hum-ai/shared-types";
import type { NativeHumExample } from "@hum-ai/affect-model-contracts";
import type { NativeCorpus } from "./corpus";

/**
 * READ CALIBRATION — the honest, model-agnostic answer to "is the read actually
 * right, and is it getting better?" measured against the user's own self-reports.
 *
 * This is convergent validity (NATIVE_HUM_DATA_SPEC §1e: correlation, NOT
 * classification) computed on-device: for every labelled hum we have the model's
 * predicted valence/arousal AND the user's reported valence/arousal, so we can
 * measure agreement, error, and CALIBRATION (does the model's implied confidence
 * match how often it's right) — and watch them improve as the corpus + the
 * retrained model improve. It never asserts the read is clinically accurate; it
 * reports how well it tracks the user's stated feeling.
 */

export type Axis = "valence" | "arousal";

/** Self-reports within this dead-zone of 0 are too ambiguous to score a sign against. */
export const CALIBRATION_DEADZONE = 0.08;
/** Number of reliability-diagram bins for the ECE computation. */
export const ECE_BINS = 5;

export interface ReliabilityBin {
  /** Bin center of the model's implied P(high pole) in [0,1]. */
  readonly p: number;
  /** Empirical fraction of reports that were actually the high pole in this bin. */
  readonly accuracy: number;
  readonly count: number;
}

export interface AxisCalibrationReport {
  readonly axis: Axis;
  readonly n: number;
  /** Fraction with sign(predicted) === sign(reported), over non-ambiguous reports [0,1]. */
  readonly signAgreement: number;
  /** Mean |predicted − reported| over [-1,1] axes (so in [0,2]); lower is better. */
  readonly mae: number;
  /** Pearson correlation of predicted vs reported in [-1,1]; higher is better. */
  readonly correlation: number;
  /** Expected calibration error of the implied P(high pole) [0,1]; lower is better. */
  readonly ece: number;
  readonly reliabilityBins: readonly ReliabilityBin[];
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = meanOf(xs);
  const my = meanOf(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom > 1e-12 ? sxy / denom : 0;
}

/** Predicted/reported value for one axis (finite-guarded). */
function axisPair(ex: NativeHumExample, axis: Axis): { p: number; r: number } {
  return { p: ex.predicted[axis], r: ex.label[axis] };
}

/**
 * Calibration report for one axis over a set of labelled examples. Sign agreement
 * ignores ambiguous (near-zero) reports; ECE bins the implied P(high pole). With
 * fewer than 2 examples every metric is its neutral value.
 */
export function axisCalibrationReport(examples: readonly NativeHumExample[], axis: Axis): AxisCalibrationReport {
  const pairs = examples.map((e) => axisPair(e, axis)).filter((x) => Number.isFinite(x.p) && Number.isFinite(x.r));
  const n = pairs.length;
  if (n === 0) {
    return { axis, n: 0, signAgreement: 0, mae: 0, correlation: 0, ece: 0, reliabilityBins: [] };
  }

  // MAE + correlation over all pairs.
  let absErr = 0;
  for (const { p, r } of pairs) absErr += Math.abs(p - r);
  const mae = absErr / n;
  const correlation = pearson(pairs.map((x) => x.p), pairs.map((x) => x.r));

  // Sign agreement over non-ambiguous reports.
  const clear = pairs.filter((x) => Math.abs(x.r) >= CALIBRATION_DEADZONE);
  let agree = 0;
  for (const { p, r } of clear) if (Math.sign(p) === Math.sign(r) || (p === 0 && r === 0)) agree++;
  const signAgreement = clear.length > 0 ? clamp01(agree / clear.length) : 0;

  // ECE of the implied P(high pole). p_high = (predicted+1)/2; actual = reported >= 0.
  const bins: { sumP: number; hits: number; count: number }[] = Array.from({ length: ECE_BINS }, () => ({ sumP: 0, hits: 0, count: 0 }));
  for (const { p, r } of pairs) {
    const pHigh = clamp01((p + 1) / 2);
    const idx = Math.min(ECE_BINS - 1, Math.floor(pHigh * ECE_BINS));
    const b = bins[idx]!;
    b.sumP += pHigh;
    b.hits += r >= 0 ? 1 : 0;
    b.count += 1;
  }
  let ece = 0;
  const reliabilityBins: ReliabilityBin[] = [];
  for (const b of bins) {
    if (b.count === 0) continue;
    const meanP = b.sumP / b.count;
    const acc = b.hits / b.count;
    ece += (b.count / n) * Math.abs(meanP - acc);
    reliabilityBins.push({ p: meanP, accuracy: acc, count: b.count });
  }

  return { axis, n, signAgreement, mae, correlation, ece, reliabilityBins };
}

export interface CorpusCalibration {
  readonly n: number;
  readonly valence: AxisCalibrationReport;
  readonly arousal: AxisCalibrationReport;
}

export function corpusCalibration(corpus: NativeCorpus): CorpusCalibration {
  return {
    n: corpus.examples.length,
    valence: axisCalibrationReport(corpus.examples, "valence"),
    arousal: axisCalibrationReport(corpus.examples, "arousal"),
  };
}

export type TrendDirection = "improving" | "steady" | "worsening" | "insufficient";

export interface CalibrationTrend {
  readonly axis: Axis;
  readonly direction: TrendDirection;
  /** Sign-agreement on the earlier half of the corpus (chronological). */
  readonly earlierSignAgreement: number;
  /** Sign-agreement on the recent half — the honest "getting better" signal. */
  readonly recentSignAgreement: number;
  readonly earlierMae: number;
  readonly recentMae: number;
}

/** Minimum per-half examples before a trend is anything but "insufficient". */
export const TREND_MIN_PER_HALF = 6;

/**
 * Split the corpus chronologically in half and compare read accuracy on the earlier
 * vs the recent half — the honest, user-visible answer to "is my read getting better
 * as I teach it?". Requires `TREND_MIN_PER_HALF` per side; below that it reports
 * `insufficient` rather than a noisy verdict. Improvement requires BOTH a meaningful
 * sign-agreement gain and no MAE regression (so it can't be gamed by one metric).
 */
export function calibrationTrend(corpus: NativeCorpus, axis: Axis): CalibrationTrend {
  const ordered = [...corpus.examples].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const mid = Math.floor(ordered.length / 2);
  // Disjoint halves that together cover EVERY example (on odd sizes the middle joins the
  // recent half rather than being dropped).
  const earlier = ordered.slice(0, mid);
  const recent = ordered.slice(mid);
  const e = axisCalibrationReport(earlier, axis);
  const r = axisCalibrationReport(recent, axis);
  let direction: TrendDirection = "insufficient";
  if (earlier.length >= TREND_MIN_PER_HALF && recent.length >= TREND_MIN_PER_HALF) {
    const agreeGain = r.signAgreement - e.signAgreement;
    const maeGain = e.mae - r.mae; // positive = error fell
    if (agreeGain > 0.05 && maeGain >= -0.02) direction = "improving";
    else if (agreeGain < -0.05 || maeGain < -0.08) direction = "worsening";
    else direction = "steady";
  }
  return {
    axis,
    direction,
    earlierSignAgreement: e.signAgreement,
    recentSignAgreement: r.signAgreement,
    earlierMae: e.mae,
    recentMae: r.mae,
  };
}
