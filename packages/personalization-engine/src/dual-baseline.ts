import { computeRobustStats, mean, zDelta, type RobustStats } from "@hum-ai/shared-types";
import { FIDELITY_FEATURE_KEYS } from "@hum-ai/audio-features";
import type { BaselineVector } from "./profile";

/** Mic/room artefacts — a change in them is not within-user drift (see audio-features taxonomy). */
const FIDELITY_FEATURES = new Set<string>(FIDELITY_FEATURE_KEYS);

/**
 * DUAL BASELINE (ADR-0007).
 *
 * A single rolling baseline cannot do two opposite jobs at once: it must adapt
 * fast enough to track genuine change, yet stay stable enough to be a trustworthy
 * reference for relapse/drift. So Hum keeps two:
 *
 *  - **Rolling short-term baseline** — robust stats over the last `window` (24,
 *    per `hum_spec` §4.6) eligible hums. Fast-adapting; this is "your recent
 *    usual" and what z-deltas are computed against day to day.
 *  - **Anchored long-term baseline** — a slowly-updated, drift-resistant
 *    reference established once the account is mature (≥ `ANCHOR_MIN_HUMS`),
 *    computed over a long window and updated by a small-α EMA. This is "your
 *    established usual" and the stable anchor the relapse engine compares against.
 *
 * The **divergence** between rolling and anchored is itself the signal: a rolling
 * center that has drifted far from the anchor (in anchored-σ units) is exactly
 * the short-vs-long-term separation the relapse-drift head needs.
 */

/** Eligible-hum count at which the anchored baseline activates (relapse stage). */
export const ANCHOR_MIN_HUMS = 20;
/** Long window the anchored baseline summarizes (drift-resistant). */
export const ANCHOR_LONG_WINDOW = 180;
/** Rolling short-term window (hum_spec §4.6). */
export const ROLLING_WINDOW = 24;
/** EMA smoothing for online anchored updates — small, so the anchor moves slowly. */
export const ANCHOR_EMA_ALPHA = 0.05;

export interface RollingBaseline {
  readonly kind: "rolling";
  readonly window: number;
  readonly sampleCount: number;
  readonly vector: BaselineVector;
}

export interface AnchoredBaseline {
  readonly kind: "anchored";
  readonly window: number;
  readonly sampleCount: number;
  /** False until the account is mature enough to anchor (≥ ANCHOR_MIN_HUMS). */
  readonly active: boolean;
  readonly vector: BaselineVector;
}

export interface DualBaseline {
  readonly rolling: RollingBaseline;
  readonly anchored: AnchoredBaseline;
}

function maxSampleCount(samplesByFeature: Record<string, readonly number[]>): number {
  let n = 0;
  for (const values of Object.values(samplesByFeature)) n = Math.max(n, values.length);
  return n;
}

function baselineFromWindow(
  samplesByFeature: Record<string, readonly number[]>,
  window: number,
): BaselineVector {
  const out: BaselineVector = {};
  for (const [feature, values] of Object.entries(samplesByFeature)) {
    out[feature] = computeRobustStats(values.slice(-window));
  }
  return out;
}

/** Build the rolling short-term baseline (last `window` eligible hums). */
export function buildRollingBaseline(
  samplesByFeature: Record<string, readonly number[]>,
  window = ROLLING_WINDOW,
): RollingBaseline {
  return {
    kind: "rolling",
    window,
    sampleCount: maxSampleCount(samplesByFeature),
    vector: baselineFromWindow(samplesByFeature, window),
  };
}

/**
 * Build the anchored long-term baseline. Inactive (empty vector) until the
 * account has at least `ANCHOR_MIN_HUMS` eligible hums — we never anchor on a
 * thin history.
 */
export function buildAnchoredBaseline(
  samplesByFeature: Record<string, readonly number[]>,
  opts: { readonly minHums?: number; readonly window?: number } = {},
): AnchoredBaseline {
  const minHums = opts.minHums ?? ANCHOR_MIN_HUMS;
  const window = opts.window ?? ANCHOR_LONG_WINDOW;
  const sampleCount = maxSampleCount(samplesByFeature);
  if (sampleCount < minHums) {
    return { kind: "anchored", window, sampleCount, active: false, vector: {} };
  }
  return {
    kind: "anchored",
    window,
    sampleCount,
    active: true,
    vector: baselineFromWindow(samplesByFeature, window),
  };
}

/** Build both baselines from the same eligible-hum feature samples. */
export function buildDualBaseline(
  samplesByFeature: Record<string, readonly number[]>,
  opts: { readonly rollingWindow?: number; readonly anchorMinHums?: number; readonly anchorWindow?: number } = {},
): DualBaseline {
  return {
    rolling: buildRollingBaseline(samplesByFeature, opts.rollingWindow),
    anchored: buildAnchoredBaseline(samplesByFeature, {
      minHums: opts.anchorMinHums,
      window: opts.anchorWindow,
    }),
  };
}

/**
 * Online EMA update of the anchored center toward a new eligible-hum sample.
 * Only the center (`median`) is nudged; spread is left to periodic rebuilds.
 * Small α keeps the anchor slow-moving and drift-resistant.
 */
export function updateAnchoredCenter(
  anchored: AnchoredBaseline,
  sampleByFeature: Record<string, number>,
  alpha = ANCHOR_EMA_ALPHA,
): AnchoredBaseline {
  if (!anchored.active) return anchored;
  const vector: BaselineVector = { ...anchored.vector };
  for (const [feature, value] of Object.entries(sampleByFeature)) {
    const prev = vector[feature];
    if (!prev || prev.n === 0) continue;
    const nextMedian = prev.median + alpha * (value - prev.median);
    vector[feature] = { ...prev, median: nextMedian };
  }
  return { ...anchored, vector, sampleCount: anchored.sampleCount + 1 };
}

export interface BaselineDivergence {
  /** Per-feature signed drift of the rolling center vs the anchor (anchored-σ). */
  readonly perFeature: Record<string, number>;
  /** Mean absolute drift magnitude across features [0,∞). */
  readonly magnitude: number;
  /** False when the anchor is inactive — divergence is undefined, not zero. */
  readonly anchored: boolean;
}

/**
 * Divergence of the rolling short-term center from the anchored long-term center,
 * per feature, in anchored robust-σ units. This is the short-vs-long separation
 * that feeds the relapse-drift head. Undefined (magnitude 0, `anchored: false`)
 * until the anchor is active.
 */
export function baselineDivergence(dual: DualBaseline): BaselineDivergence {
  if (!dual.anchored.active) {
    return { perFeature: {}, magnitude: 0, anchored: false };
  }
  const perFeature: Record<string, number> = {};
  for (const [feature, anchorStats] of Object.entries(dual.anchored.vector)) {
    if (FIDELITY_FEATURES.has(feature)) continue; // a mic/room shift is not within-user drift
    const rolling: RobustStats | undefined = dual.rolling.vector[feature];
    if (rolling && rolling.n > 0 && anchorStats.n > 0) {
      perFeature[feature] = zDelta(rolling.median, anchorStats);
    }
  }
  const magnitude = mean(Object.values(perFeature).map((z) => Math.abs(z)));
  return { perFeature, magnitude, anchored: true };
}
