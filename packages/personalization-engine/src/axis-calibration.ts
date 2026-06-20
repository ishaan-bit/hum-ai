import { clamp, clamp01, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";

/**
 * PERSONAL AXIS CALIBRATION — the online (within-user) half of the human-in-the-loop.
 *
 * The acoustic axis read (`@hum-ai/orchestrator` `acousticAffectAxes`) maps a hum's
 * DSP features to coarse valence/arousal with ONE population mapping. But two people
 * can produce acoustically-similar hums and genuinely feel differently, and a given
 * person's felt-neutral can sit systematically above/below the population zero. When
 * the user CORRECTS a read (HiTL), the per-axis residual `reported − predicted` is
 * exactly that personal offset.
 *
 * We learn it online with a slow EMA so the read re-centres on THIS person's axes
 * immediately — the fast, individual complement to the batch retraining of the global
 * hum-native model (`@hum-ai/native-corpus`). One correction feeds both: the personal
 * calibration here (instant) and the global corpus (next retrain).
 *
 * DISCIPLINE: calibration only SHIFTS/centres the read toward the user's own
 * self-report; the offset is bounded (`MAX_AXIS_OFFSET`) and shrunk toward 0 until
 * enough corrections accumulate, so a couple of taps cannot redraw the axis. It never
 * amplifies and never manufactures confidence. Pure + deterministic; sync-safe (fixed
 * keys, no free-form feature names, no raw-audio tokens).
 */

/** Learned calibration for one axis: an EMA additive offset + how many corrections back it. */
export interface AxisCalibration {
  /** EMA of `reported − predicted` for this axis, bounded to ±`MAX_AXIS_OFFSET`. */
  readonly offset: number;
  /** Number of corrections folded in — confidence the offset is real (shrinks small n). */
  readonly count: number;
}

export interface PersonalAxisCalibration {
  readonly valence: AxisCalibration;
  readonly arousal: AxisCalibration;
}

/** One HiTL correction event: what the model read vs what the user reported. */
export interface PersonalAxisCorrection {
  readonly predicted: ValenceArousal;
  readonly reported: ValenceArousal;
  /**
   * Weight in [0,1]. A deliberate ADJUST carries full weight; a one-tap CONFIRM (the
   * user agreed with the read) can be down-weighted by the caller since it is weaker
   * evidence of a systematic offset (residual ≈ 0 either way).
   */
  readonly weight?: UnitInterval;
}

/** EMA rate for the offset — moderate, so calibration adapts without lurching. */
export const AXIS_CALIBRATION_EMA_ALPHA = 0.25;
/** Hard bound on the learned offset so calibration centres but never relocates the read. */
export const MAX_AXIS_OFFSET = 0.6;
/** Below this many corrections the offset is linearly shrunk toward 0 (don't over-trust 1–2). */
export const AXIS_CALIBRATION_MIN_CONFIDENT = 4;

export function newAxisCalibration(): PersonalAxisCalibration {
  return { valence: { offset: 0, count: 0 }, arousal: { offset: 0, count: 0 } };
}

function updateOne(prev: AxisCalibration, residual: number, alpha: number): AxisCalibration {
  if (!Number.isFinite(residual)) return prev;
  const next = prev.count === 0 ? residual : prev.offset + alpha * (residual - prev.offset);
  return { offset: clamp(next, -MAX_AXIS_OFFSET, MAX_AXIS_OFFSET), count: prev.count + 1 };
}

/** Fold one correction into the per-axis offsets. Pure; nothing mutated. */
export function updateAxisCalibration(
  prev: PersonalAxisCalibration,
  corr: PersonalAxisCorrection,
  alpha = AXIS_CALIBRATION_EMA_ALPHA,
): PersonalAxisCalibration {
  const a = alpha * clamp01(corr.weight ?? 1);
  return {
    valence: updateOne(prev.valence, corr.reported.valence - corr.predicted.valence, a),
    arousal: updateOne(prev.arousal, corr.reported.arousal - corr.predicted.arousal, a),
  };
}

/** Shrinkage in [0,1]: the offset reaches full strength only once enough corrections back it. */
export function axisCalibrationConfidence(count: number): UnitInterval {
  return clamp01(count / AXIS_CALIBRATION_MIN_CONFIDENT);
}

/**
 * Apply the learned per-axis offsets to a dimensional read, each shrunk by its own
 * confidence and clamped back into [-1, 1]. With no corrections the read is returned
 * unchanged (offset 0, confidence 0). Pure.
 */
export function applyAxisCalibration(
  cal: PersonalAxisCalibration | undefined,
  dim: ValenceArousal,
): ValenceArousal {
  if (!cal) return dim;
  return {
    valence: clamp(dim.valence + cal.valence.offset * axisCalibrationConfidence(cal.valence.count), -1, 1),
    arousal: clamp(dim.arousal + cal.arousal.offset * axisCalibrationConfidence(cal.arousal.count), -1, 1),
  };
}

/** True once the calibration has at least one correction on either axis (worth applying/showing). */
export function axisCalibrationEngaged(cal: PersonalAxisCalibration | undefined): boolean {
  return !!cal && (cal.valence.count > 0 || cal.arousal.count > 0);
}
