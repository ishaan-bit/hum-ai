import { clamp01, type UnitInterval } from "@hum-ai/shared-types";
import type { AffectStateHead, MultiHeadAffectInference } from "@hum-ai/affect-model-contracts";

/**
 * INTERNAL clinical-risk score for the CURRENT hum, in [0,1].
 *
 * This is the one place the orchestrator reads raw risk-marker state scores to
 * collapse them into a single opaque scalar. The relapse engine consumes only
 * that scalar (`RelapseSample.riskScore`) — never the labels themselves — so the
 * "engines never see raw clinical labels" boundary (ADR-0006) holds for the
 * longitudinal path the same way `toRecommendationView` holds it for the
 * intervention path.
 *
 * The score is a momentary read: it deliberately EXCLUDES the longitudinal
 * `relapseDrift` head, which is an OUTPUT of the within-user comparison, not an
 * input to scoring this single hum.
 */
const RISK_WEIGHTS: Partial<Record<AffectStateHead, number>> = {
  depressive_affect_markers: 0.22,
  anxiety_like_tension: 0.16,
  stress_overload: 0.14,
  sadness_low_mood: 0.12,
  emotional_instability: 0.1,
  fear_like_activation: 0.09,
  fatigue_low_recovery: 0.09,
  flattened_affect: 0.08,
};

export function clinicalRiskScore(inf: MultiHeadAffectInference): UnitInterval {
  let weighted = 0;
  let weightSum = 0;
  for (const head of Object.keys(RISK_WEIGHTS) as AffectStateHead[]) {
    const w = RISK_WEIGHTS[head] ?? 0;
    weighted += w * inf.states[head];
    weightSum += w;
  }
  return clamp01(weightSum > 0 ? weighted / weightSum : 0);
}
