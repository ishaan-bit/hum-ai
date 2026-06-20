import {
  computeRobustStats,
  zDelta,
  type IsoTimestamp,
  type ModelVersion,
  type ModalityReliability,
  type RobustStats,
  type UnitInterval,
  type UserId,
} from "@hum-ai/shared-types";
import type { DomainClass } from "@hum-ai/shared-types";
import type { InterventionType } from "@hum-ai/affect-model-contracts";
import { ROLLING_WINDOW } from "./dual-baseline";
import { stagePolicy } from "./ladder";
import { newRegimeState, type RegimeState } from "./changepoint";
import type { InterventionPolicy } from "./bandit";

/** Per-feature robust baseline: feature name → robust stats over eligible hums. */
export type BaselineVector = Record<string, RobustStats>;

/**
 * The individual model each user develops over time. Derived data only — no raw
 * audio, no per-session feature history beyond what the rolling baseline keeps.
 */
export interface UserModelProfile {
  readonly user_id: UserId;
  /**
   * Rolling short-term baseline: robust center+scale per feature
   * (median/MAD/IQR/robustStd) over the last `rollingWindow` eligible hums.
   * "Your recent usual." See `buildDualBaseline` (ADR-0007).
   */
  readonly baseline_vector: BaselineVector;
  /**
   * Anchored long-term baseline: a slowly-updated, drift-resistant reference,
   * empty until the account is mature (≥ `ANCHOR_MIN_HUMS`). "Your established
   * usual" — the stable anchor the relapse engine compares against (ADR-0007).
   */
  readonly anchored_baseline_vector?: BaselineVector;
  /** Compact distribution summary (e.g. n, coverage) for quick checks. */
  readonly feature_distribution_summary: Record<string, number>;
  readonly modality_reliability_vector: ModalityReliability;
  readonly domain_reliability_vector: Partial<Record<DomainClass, number>>;
  /** Centroid of feature z-deltas observed during recovered/stable periods. */
  readonly recovery_signature_vector: Record<string, number>;
  /** Centroid of feature z-deltas observed during high-risk periods. */
  readonly high_risk_signature_vector: Record<string, number>;
  /** How each intervention tends to move the user (response learning). */
  readonly intervention_response_vector: Partial<Record<InterventionType, number>>;
  readonly calibration_maturity: UnitInterval;
  readonly confidence_cap: UnitInterval;
  readonly last_updated_at: IsoTimestamp;
  readonly model_version: ModelVersion;

  // --- v2 adaptive-personalization fields (optional ⇒ back-compatible) ---
  /**
   * Learned per-feature SALIENCE (informativeness × independence). Weights the
   * personal deviation toward the user's reliable, distinctive axes. See `salience.ts`.
   */
  readonly salience_vector?: Record<string, number>;
  /**
   * Per-intervention BANDIT policy stats (count / mean reward / variance) — the
   * personalized intervention policy (`bandit.ts`). Supersedes the flat EMA
   * `intervention_response_vector`, which is kept for compatibility.
   */
  readonly intervention_policy?: InterventionPolicy;
  /**
   * Online CHANGEPOINT detector state over the user's signed drift (`changepoint.ts`)
   * — recognizes a genuine shift in "your usual" instead of silently absorbing it.
   */
  readonly regime?: RegimeState;
  /**
   * Current baseline adaptation rate [0,1]. Rises briefly after a detected regime
   * shift so the personal model re-centers on the new normal, then relaxes.
   */
  readonly adaptation_rate?: UnitInterval;
}

/**
 * Build the robust baseline vector from eligible-hum feature samples. Mirrors
 * `hum_spec` §4.6: median / MAD / IQR per feature, rolling window of up to 24.
 */
export function buildBaselineVector(
  samplesByFeature: Record<string, readonly number[]>,
  rollingWindow = ROLLING_WINDOW,
): BaselineVector {
  const out: BaselineVector = {};
  for (const [feature, values] of Object.entries(samplesByFeature)) {
    const windowed = values.slice(-rollingWindow);
    out[feature] = computeRobustStats(windowed);
  }
  return out;
}

/** z-deltas of the current capture's features against the personal baseline. */
export function zDeltasAgainstBaseline(
  current: Record<string, number>,
  baseline: BaselineVector,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [feature, value] of Object.entries(current)) {
    const stats = baseline[feature];
    if (stats && stats.n > 0) out[feature] = zDelta(value, stats);
  }
  return out;
}

/** Construct a fresh profile for a brand-new user (population prior stage). */
export function newUserProfile(
  user_id: UserId,
  now: IsoTimestamp,
  model_version: ModelVersion,
): UserModelProfile {
  const policy = stagePolicy(0);
  return {
    user_id,
    baseline_vector: {},
    anchored_baseline_vector: {},
    feature_distribution_summary: {},
    modality_reliability_vector: { audio: 0, face: 0, text: 0 },
    domain_reliability_vector: {},
    recovery_signature_vector: {},
    high_risk_signature_vector: {},
    intervention_response_vector: {},
    calibration_maturity: policy.calibrationMaturity,
    confidence_cap: policy.confidenceCap,
    last_updated_at: now,
    model_version,
    salience_vector: {},
    intervention_policy: {},
    regime: newRegimeState(),
    adaptation_rate: 0,
  };
}
