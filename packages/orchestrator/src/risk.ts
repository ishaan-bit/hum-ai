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
 * `relapse_drift` head, which is an OUTPUT of the within-user comparison, not an
 * input to scoring this single hum.
 *
 * ── v1 SCOPE / KNOWN LIMITATION (do not mistake this for a calibrated detector) ──
 * The v1 fusion label space (`FUSION_LABEL_AFFECT`, affect-model-contracts) only
 * ever populates a COARSE set of affect-state heads: `calm_regulated`,
 * `joy_positive_activation`, `anger_frustration`, `sadness_low_mood`,
 * `anxiety_like_tension`, `fatigue_low_recovery`, `neutral_close_to_usual`.
 * The finer-grained clinical markers (`depressive_affect_markers`,
 * `stress_overload`, `emotional_instability`, `fear_like_activation`,
 * `flattened_affect`) are NOT produced by v1 fusion — separating them requires
 * trained experts (see docs/validation/DIAGNOSTIC_ROADMAP.md). A prior version of
 * this file weighted those five unreachable heads, which (a) was dead weight and
 * (b) mathematically capped the score below ~0.16 — under the 0.6 HIGH_RISK_BAND —
 * so `risk_marker_present` and high-risk-signature learning could NEVER engage.
 *
 * This version scores ONLY the risk-bearing heads v1 fusion actually emits, as a
 * SEVERITY-weighted sum of probability mass. Because `inf.states` sums to 1 across
 * all heads and non-risk heads carry severity 0, the result lies in
 * [0, max severity] and CAN cross the high-risk band when a hum is dominated by a
 * high-severity state — restoring the high-risk pathway. The severities are
 * PRINCIPLED DEFAULTS, ordered by clinical salience; they are NOT calibrated on
 * outcome data, and `anger_frustration` is intentionally left unscored in v1
 * (an open taxonomy question deferred to the roadmap, matching the prior behaviour).
 */
const RISK_SEVERITY: Partial<Record<AffectStateHead, number>> = {
  sadness_low_mood: 0.85,
  anxiety_like_tension: 0.8,
  fatigue_low_recovery: 0.55,
};

export function clinicalRiskScore(inf: MultiHeadAffectInference): UnitInterval {
  let score = 0;
  for (const head of Object.keys(RISK_SEVERITY) as AffectStateHead[]) {
    score += (RISK_SEVERITY[head] ?? 0) * (inf.states[head] ?? 0);
  }
  return clamp01(score);
}
