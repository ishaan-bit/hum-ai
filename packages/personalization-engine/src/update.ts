import {
  clamp,
  clamp01,
  MODALITIES,
  type DomainClass,
  type IsoTimestamp,
  type ModalityReliability,
  type UnitInterval,
  type ValenceArousal,
} from "@hum-ai/shared-types";
import type { InterventionType } from "@hum-ai/affect-model-contracts";
import type { RelapseSample } from "@hum-ai/relapse-engine";
import { buildAnchoredBaseline, buildRollingBaseline } from "./dual-baseline";
import { stagePolicy } from "./ladder";
import { zDeltasAgainstBaseline, type UserModelProfile } from "./profile";
import { updateSignatureCentroid } from "./signatures";
import {
  FEATURE_HISTORY_LIMIT,
  HIGH_RISK_MIN,
  RELAPSE_HISTORY_LIMIT,
  STABLE_RISK_MAX,
  type PersonalizationState,
} from "./state";

/**
 * THE LEARNING STEP — "as a user hums we start personalising it".
 *
 * `ingestHum` folds one eligible hum into the per-user model and returns the
 * updated state. Each eligible hum:
 *  - extends the bounded per-feature windows and rebuilds the rolling + anchored
 *    baselines (the dual baseline of ADR-0007);
 *  - nudges the learned per-modality and per-domain reliability (EMA toward what
 *    fusion actually trusted this hum);
 *  - extends the recovery / high-risk SIGNATURES (centroids of the hum's z-deltas,
 *    routed by its risk band) once the baseline is active;
 *  - learns how each intervention tends to move the user (intervention response);
 *  - advances the ladder stage and refreshes the confidence cap / calibration
 *    maturity carried on the profile.
 *
 * Ineligible (quality-rejected) hums are returned unchanged — only quality-gated
 * hums shape the model, exactly as the ladder counts them. Pure: a new state is
 * returned and nothing is mutated.
 */

/** EMA rate for learned reliabilities — moderate, so trust adapts but not abruptly. */
export const RELIABILITY_EMA_ALPHA = 0.15;
/** EMA rate for intervention-response learning. */
export const INTERVENTION_EMA_ALPHA = 0.2;

export interface HumObservation {
  readonly capturedAt: IsoTimestamp;
  /** Derived numeric features present for this hum (nulls already dropped). */
  readonly features: Record<string, number>;
  /** Quality-gate eligibility — only eligible hums shape the per-user model. */
  readonly eligible: boolean;
  /** Per-modality reliability observed this hum (e.g. `modalityReliability(experts)`). */
  readonly observedModalityReliability?: ModalityReliability;
  /** Domain the classifier heard, plus the live domain match, to learn domain trust. */
  readonly heardDomain?: DomainClass;
  readonly domainMatch?: UnitInterval;
  /** The (personalized) dimensional read, retained for relapse references. */
  readonly dimensional?: ValenceArousal;
  /** Composite risk score [0,1] for this hum (relapse history + signature routing). */
  readonly riskScore?: UnitInterval;
  /** Observed intervention response: `riskDelta = risk_after − risk_before` (<0 helped). */
  readonly interventionResponse?: { readonly type: InterventionType; readonly riskDelta: number };
  /**
   * Consecutive-drift count this read produced (from the longitudinal state). Stored
   * verbatim so the next read's relapse-drift signal can honour the "min consecutive
   * hums" rule. Omitted ⇒ the prior count is preserved.
   */
  readonly consecutiveDriftHums?: number;
}

function pushBounded<T>(arr: readonly T[], value: T, limit: number): T[] {
  const next = [...arr, value];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function emaInto(prev: number | undefined, observed: number, alpha: number): number {
  return prev === undefined ? observed : prev + alpha * (observed - prev);
}

export function ingestHum(state: PersonalizationState, obs: HumObservation): PersonalizationState {
  // Only eligible hums shape the model (the ladder counts eligible hums).
  if (!obs.eligible) return state;

  // 1. Append derived features to the bounded windows.
  const featureWindows: Record<string, number[]> = {};
  for (const [k, vals] of Object.entries(state.featureWindows)) featureWindows[k] = [...vals];
  for (const [k, v] of Object.entries(obs.features)) {
    if (!Number.isFinite(v)) continue;
    featureWindows[k] = pushBounded(featureWindows[k] ?? [], v, FEATURE_HISTORY_LIMIT);
  }

  const eligibleHumCount = state.eligibleHumCount + 1;
  const policy = stagePolicy(eligibleHumCount);

  // z-deltas of THIS hum vs the user's PRIOR baseline (their usual *before* this
  // hum) — used for signature learning. Empty until the baseline is active.
  const zDeltas = policy.baselineActive
    ? zDeltasAgainstBaseline(obs.features, state.profile.baseline_vector)
    : {};

  // 2. Rebuild the dual baseline from the windows.
  const rolling = buildRollingBaseline(featureWindows);
  const anchored = buildAnchoredBaseline(featureWindows);

  // 3. Learn per-modality reliability (EMA toward what fusion trusted this hum).
  const modality_reliability_vector: ModalityReliability = { ...state.profile.modality_reliability_vector };
  const observedRel = obs.observedModalityReliability;
  if (observedRel) {
    for (const m of MODALITIES) {
      // Only learn for a modality actually present this hum — don't decay an absent channel.
      if (observedRel[m] > 0) {
        modality_reliability_vector[m] = clamp01(
          emaInto(state.profile.modality_reliability_vector[m], observedRel[m], RELIABILITY_EMA_ALPHA),
        );
      }
    }
  }

  // 4. Learn per-domain trust.
  const domain_reliability_vector: Partial<Record<DomainClass, number>> = {
    ...state.profile.domain_reliability_vector,
  };
  if (obs.heardDomain && obs.domainMatch !== undefined) {
    domain_reliability_vector[obs.heardDomain] = clamp01(
      emaInto(domain_reliability_vector[obs.heardDomain], obs.domainMatch, RELIABILITY_EMA_ALPHA),
    );
  }

  // 5. Learn recovery / high-risk signatures (centroids of z-deltas), by risk band.
  let recovery_signature_vector = state.profile.recovery_signature_vector;
  let high_risk_signature_vector = state.profile.high_risk_signature_vector;
  if (policy.baselineActive && obs.riskScore !== undefined && Object.keys(zDeltas).length > 0) {
    if (obs.riskScore <= STABLE_RISK_MAX) {
      recovery_signature_vector = updateSignatureCentroid(recovery_signature_vector, zDeltas);
    } else if (obs.riskScore >= HIGH_RISK_MIN) {
      high_risk_signature_vector = updateSignatureCentroid(high_risk_signature_vector, zDeltas);
    }
  }

  // 6. Learn intervention response (EMA of the risk change after each intervention).
  const intervention_response_vector: Partial<Record<InterventionType, number>> = {
    ...state.profile.intervention_response_vector,
  };
  const ir = obs.interventionResponse;
  if (ir && ir.type !== "none") {
    intervention_response_vector[ir.type] = clamp(
      emaInto(intervention_response_vector[ir.type], ir.riskDelta, INTERVENTION_EMA_ALPHA),
      -1,
      1,
    );
  }

  // 7. Compact distribution summary (per-feature sample count / coverage).
  const feature_distribution_summary: Record<string, number> = {};
  for (const [k, vals] of Object.entries(featureWindows)) feature_distribution_summary[k] = vals.length;

  // 8. Bounded relapse history (used to build relapse references next read).
  const relapseHistory: readonly RelapseSample[] =
    obs.dimensional && obs.riskScore !== undefined
      ? pushBounded(
          state.relapseHistory,
          { capturedAt: obs.capturedAt, dimensional: obs.dimensional, riskScore: obs.riskScore },
          RELAPSE_HISTORY_LIMIT,
        )
      : state.relapseHistory;

  const profile: UserModelProfile = {
    ...state.profile,
    baseline_vector: rolling.vector,
    anchored_baseline_vector: anchored.active
      ? anchored.vector
      : state.profile.anchored_baseline_vector ?? {},
    feature_distribution_summary,
    modality_reliability_vector,
    domain_reliability_vector,
    recovery_signature_vector,
    high_risk_signature_vector,
    intervention_response_vector,
    calibration_maturity: policy.calibrationMaturity,
    confidence_cap: policy.confidenceCap,
    last_updated_at: obs.capturedAt,
  };

  return {
    profile,
    featureWindows,
    relapseHistory,
    eligibleHumCount,
    consecutiveDriftHums: obs.consecutiveDriftHums ?? state.consecutiveDriftHums,
  };
}
