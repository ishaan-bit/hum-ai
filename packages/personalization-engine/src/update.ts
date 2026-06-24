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
import { featureSalience } from "./salience";
import { newRegimeState, updateRegime } from "./changepoint";
import { updateArm, type InterventionPolicy } from "./bandit";
import { newAxisCalibration, updateAxisCalibration, type PersonalAxisCorrection } from "./axis-calibration";
import { DEVIATION_WINSOR_Z } from "./deviation";
import { newContextualCenters, timeBucket, updateContextualCenters } from "./context";
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

/** Salience-weighted, winsorized signed mean z-delta — the per-hum drift direction. */
function signedSalienceDrift(zDeltas: Record<string, number>, salience: Record<string, number>): number {
  let num = 0;
  let den = 0;
  for (const [f, z] of Object.entries(zDeltas)) {
    if (!Number.isFinite(z)) continue;
    const w = salience[f] ?? 0;
    if (w <= 0) continue;
    num += w * clamp(z, -DEVIATION_WINSOR_Z, DEVIATION_WINSOR_Z);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

export function ingestHum(state: PersonalizationState, obs: HumObservation): PersonalizationState {
  // Every accepted hum (eligible or not) goes into the diary's relapse history so the
  // diary and count badge always reflect the most-recent check-in. The model baseline,
  // ladder, and eligibleHumCount only advance for quality-gated (eligible) hums below.
  const relapseHistoryWithObs: readonly RelapseSample[] =
    obs.dimensional && obs.riskScore !== undefined
      ? pushBounded(
          state.relapseHistory,
          { capturedAt: obs.capturedAt, dimensional: obs.dimensional, riskScore: obs.riskScore },
          RELAPSE_HISTORY_LIMIT,
        )
      : state.relapseHistory;

  // Only eligible hums shape the model (the ladder counts eligible hums).
  if (!obs.eligible) return { ...state, relapseHistory: relapseHistoryWithObs };

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

  // 9. Learn per-feature SALIENCE (informativeness × independence) from the rebuilt
  //    baseline + windows. Cached on the profile so inference reads it cheaply.
  const salience_vector = featureSalience(rolling.vector, { windows: featureWindows });

  // 10. ONLINE REGIME DETECTION: monitor the salience-weighted signed drift of this
  //     hum vs the user's prior usual. A sustained directional run flags a genuine
  //     baseline shift (recovery / decline / new normal) and lifts the adaptation
  //     rate so the personal model re-centers rather than fighting the change.
  let regime = state.profile.regime ?? newRegimeState();
  let adaptation_rate = clamp01((state.profile.adaptation_rate ?? 0) * 0.85);
  if (policy.baselineActive && Object.keys(zDeltas).length > 0) {
    const upd = updateRegime(regime, signedSalienceDrift(zDeltas, salience_vector));
    regime = upd.state;
    if (upd.shift !== "none") adaptation_rate = 1;
  }

  // 11. PERSONALIZED INTERVENTION POLICY (bandit): fold this hum's intervention
  //     outcome into the per-arm reward stats (reward = risk reduction = −riskDelta).
  const intervention_policy: InterventionPolicy = { ...(state.profile.intervention_policy ?? {}) };
  if (ir && ir.type !== "none") {
    intervention_policy[ir.type] = updateArm(intervention_policy[ir.type], -ir.riskDelta);
  }

  // 12. CIRCADIAN CONTEXT: fold this hum into its time-of-day bucket center so the
  //     read can be re-referenced against "your usual at this time of day".
  const contextual_centers = updateContextualCenters(
    state.profile.contextual_centers ?? newContextualCenters(),
    timeBucket(obs.capturedAt),
    obs.features,
  );

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
    salience_vector,
    intervention_policy,
    regime,
    adaptation_rate,
    contextual_centers,
    calibration_maturity: policy.calibrationMaturity,
    confidence_cap: policy.confidenceCap,
    last_updated_at: obs.capturedAt,
  };

  return {
    profile,
    featureWindows,
    relapseHistory: relapseHistoryWithObs,
    eligibleHumCount,
    consecutiveDriftHums: obs.consecutiveDriftHums ?? state.consecutiveDriftHums,
  };
}

/**
 * THE HiTL FEEDBACK STEP — fold ONE user correction into the per-user model.
 *
 * Distinct from `ingestHum` (which learns self-supervised from the model's own
 * outputs on every eligible hum): this folds an EXPLICIT human signal — the user's
 * reported valence/arousal vs what the model read — into the personal axis
 * calibration, re-centring future reads on this person immediately. It updates ONLY
 * the calibration on the profile; baselines, signatures, ladder, and counts are
 * untouched (a correction is not a new hum). Pure: a new state is returned.
 *
 * Corrections on rejected/ineligible captures should not be submitted here — the
 * caller gates on an accepted read — but a correction does not itself advance the
 * baseline/ladder regardless, so it can never let a non-hum shape the model.
 */
export function ingestFeedback(
  state: PersonalizationState,
  correction: PersonalAxisCorrection,
): PersonalizationState {
  const prevCal = state.profile.axis_calibration ?? newAxisCalibration();
  const axis_calibration = updateAxisCalibration(prevCal, correction);
  return {
    ...state,
    profile: { ...state.profile, axis_calibration },
  };
}
