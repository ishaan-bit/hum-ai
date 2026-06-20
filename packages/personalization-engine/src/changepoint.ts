/**
 * ONLINE REGIME / CHANGEPOINT DETECTION (v2).
 *
 * A rolling baseline adapts to a genuine shift in the user's "usual" — but slowly,
 * and silently. For an individual signal that is a problem in both directions: a
 * real change (recovery, a hard stretch, a vocal change, a new normal after life
 * events) should be *recognized as a change*, not quietly absorbed. This is a
 * two-sided Page–Hinkley test on the per-hum signed drift signal — a standard,
 * cheap online changepoint detector — that fires when drift runs consistently in
 * one direction beyond tolerance, reports the direction, and resets.
 *
 * Downstream, a detected shift lets the engine (a) surface "your baseline has
 * shifted" honestly and (b) accelerate baseline adaptation so the personal model
 * re-centers on the new normal instead of fighting it.
 */

export interface RegimeState {
  readonly n: number;
  /** Running mean of the monitored drift signal. */
  readonly mean: number;
  readonly cumUp: number;
  readonly minUp: number;
  readonly cumDown: number;
  readonly maxDown: number;
  /** Eligible hums since the last detected shift (regime age). */
  readonly sinceShift: number;
  /** Direction of the most recent detected shift, if any. */
  readonly lastShift: "none" | "up" | "down";
}

/** Tolerance δ: drift within ±δ of the running mean is "no change" (signal units). */
export const PH_DELTA = 0.25;
/** Threshold λ: cumulative excursion past which a shift is declared (sensitivity). */
export const PH_LAMBDA = 2.5;

export function newRegimeState(): RegimeState {
  return { n: 0, mean: 0, cumUp: 0, minUp: 0, cumDown: 0, maxDown: 0, sinceShift: 0, lastShift: "none" };
}

export interface RegimeUpdate {
  readonly state: RegimeState;
  readonly shift: "none" | "up" | "down";
  /** Larger of the two Page–Hinkley statistics (transparency). */
  readonly statistic: number;
}

export interface RegimeOptions {
  readonly delta?: number;
  readonly lambda?: number;
}

/**
 * Fold one signed drift observation into the regime detector. `x` is the per-hum
 * signed personal-drift signal (e.g. the salience-weighted mean z-delta): positive
 * = drifting above the user's established usual, negative = below.
 */
export function updateRegime(prev: RegimeState, x: number, opts: RegimeOptions = {}): RegimeUpdate {
  const delta = opts.delta ?? PH_DELTA;
  const lambda = opts.lambda ?? PH_LAMBDA;
  if (!Number.isFinite(x)) {
    return { state: { ...prev, sinceShift: prev.sinceShift + 1 }, shift: "none", statistic: 0 };
  }

  const n = prev.n + 1;
  const mean = prev.mean + (x - prev.mean) / n;

  const cumUp = prev.cumUp + (x - mean - delta);
  const minUp = Math.min(prev.minUp, cumUp);
  const cumDown = prev.cumDown + (x - mean + delta);
  const maxDown = Math.max(prev.maxDown, cumDown);

  const phUp = cumUp - minUp; // grows when x persistently exceeds mean + δ
  const phDown = maxDown - cumDown; // grows when x persistently falls below mean − δ
  const statistic = Math.max(phUp, phDown);

  let shift: "none" | "up" | "down" = "none";
  if (phUp > lambda) shift = "up";
  else if (phDown > lambda) shift = "down";

  if (shift !== "none") {
    // Reset the detector; seed the next regime's mean at the triggering value.
    return {
      state: { n: 1, mean: x, cumUp: 0, minUp: 0, cumDown: 0, maxDown: 0, sinceShift: 0, lastShift: shift },
      shift,
      statistic,
    };
  }
  return {
    state: { n, mean, cumUp, minUp, cumDown, maxDown, sinceShift: prev.sinceShift + 1, lastShift: prev.lastShift },
    shift,
    statistic,
  };
}
