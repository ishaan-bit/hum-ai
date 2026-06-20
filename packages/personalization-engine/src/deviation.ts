import { clamp, clamp01, type UnitInterval } from "@hum-ai/shared-types";
import type { BaselineVector } from "./profile";
import { evidenceWeight } from "./shrinkage";

/**
 * PERSONAL DEVIATION v2 — a salience- and evidence-weighted robust distance from
 * the user's own baseline, replacing v1's plain median-of-|z|.
 *
 *  - Each feature's z-delta is weighted by its **salience** (how informative /
 *    independent it is for this user) × its **evidence** (n/(n+K) shrinkage), so
 *    the read leans on the user's reliable, distinctive axes.
 *  - |z| is **winsorized** at `winsorZ` so a single degenerate (near-constant)
 *    feature whose σ floored to ε can't explode the whole read.
 *  - The aggregate is a weighted robust mean → mapped to `selfNormality ∈ (0,1]`
 *    via an exponential decay ("how usual is this hum for you?").
 *  - It also reports the **top contributors** — the features that actually drove
 *    the deviation ("what's different about your hum today"), which the read can
 *    surface as honest, individual evidence.
 */

/** Cap on |z| per feature so a degenerate feature cannot dominate. */
export const DEVIATION_WINSOR_Z = 4;
/** Robust-σ scale at which a hum is considered fully "unusual for you". */
export const SELF_NORMALITY_TAU = 1.5;

export interface FeatureDeviation {
  readonly feature: string;
  /** Signed z-delta against the user's baseline. */
  readonly z: number;
  /** Combined salience × evidence weight used for this feature. */
  readonly weight: number;
  /** Share of the deviation magnitude this feature contributed (weight × |winsor z|). */
  readonly contribution: number;
}

export interface PersonalDeviationV2 {
  /** Salience/evidence-weighted robust |z| aggregate, [0,∞). */
  readonly magnitude: number;
  /** How close this hum is to the user's OWN usual, (0,1]; 1 = right on baseline. */
  readonly selfNormality: UnitInterval;
  /** Number of features that had a usable personal baseline to compare against. */
  readonly support: number;
  /** Aggregate per-feature evidence (salience-weighted mean of n/(n+K)), [0,1]. */
  readonly effectiveEvidence: UnitInterval;
  /** Features that drove the deviation, strongest first. */
  readonly topContributors: readonly FeatureDeviation[];
}

export interface DeviationOptions {
  /** Per-feature salience weights (default: uniform 1). */
  readonly salience?: Record<string, number>;
  /** Baseline (for per-feature evidence n); default: full evidence. */
  readonly baseline?: BaselineVector;
  readonly tau?: number;
  readonly winsorZ?: number;
  readonly topK?: number;
}

/**
 * Compute the v2 personal deviation from per-feature z-deltas. Pure. With no
 * salience/baseline it degrades to a winsorized, evenly-weighted robust |z| —
 * still an improvement on the v1 plain median, and a safe fallback.
 */
export function personalDeviationV2(
  zDeltas: Record<string, number>,
  opts: DeviationOptions = {},
): PersonalDeviationV2 {
  const tau = opts.tau ?? SELF_NORMALITY_TAU;
  const winsorZ = opts.winsorZ ?? DEVIATION_WINSOR_Z;
  const topK = opts.topK ?? 3;

  const contribs: FeatureDeviation[] = [];
  let salienceSum = 0;
  let weightSum = 0;
  let weightedAbs = 0;

  for (const [feature, zRaw] of Object.entries(zDeltas)) {
    if (!Number.isFinite(zRaw)) continue;
    const salience = opts.salience ? opts.salience[feature] ?? 0 : 1;
    const n = opts.baseline?.[feature]?.n;
    const evidence = n === undefined ? 1 : evidenceWeight(n);
    const weight = salience * evidence;
    if (weight <= 0) continue;
    const wz = clamp(zRaw, -winsorZ, winsorZ);
    const contribution = weight * Math.abs(wz);
    salienceSum += salience;
    weightSum += weight;
    weightedAbs += contribution;
    contribs.push({ feature, z: zRaw, weight, contribution });
  }

  const support = contribs.length;
  if (support === 0 || weightSum <= 0) {
    return { magnitude: 0, selfNormality: 1, support: 0, effectiveEvidence: 0, topContributors: [] };
  }

  const magnitude = weightedAbs / weightSum;
  const selfNormality = clamp01(Math.exp(-magnitude / Math.max(tau, 1e-6)));
  // Aggregate evidence (salience-weighted mean of per-feature n/(n+K)) gates how
  // strongly personalization is allowed to act.
  const effectiveEvidence = salienceSum > 0 ? clamp01(weightSum / salienceSum) : 0;
  const topContributors = contribs.sort((a, b) => b.contribution - a.contribution).slice(0, topK);

  return { magnitude, selfNormality, support, effectiveEvidence, topContributors };
}
