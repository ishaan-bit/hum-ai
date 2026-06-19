/**
 * Claim-boundary constants shared across packages.
 *
 * These encode hard limits the platform places on what it is allowed to claim —
 * the lowest-level, dependency-free home for numbers that several packages must
 * agree on (confidence, safety-language, relapse, personalization).
 */

/**
 * HARD ceiling on the confidence of any clinical-risk / relapse-drift / recovery
 * signal, applied **regardless of baseline maturity** — even a 20+ hum
 * `relapse_model` account (whose general cap is 0.92) can never report a
 * higher-than-88% clinical-risk signal. This is a safety ceiling on high-stakes
 * outputs, distinct from (and stricter than) the maturity-based confidence caps
 * in the personalization ladder.
 *
 * Source of truth: the clinical-evidence and personalization design reviews both
 * fix this at 88% ("confidence: float // always capped at 88%";
 * "Relapse drift signals | 88% (hard cap) | Safety ceiling on high-stakes
 * outputs"; "HARD CAPPED at 88% regardless of baseline maturity"). Without this,
 * a high-maturity user could receive a 92%-confident "relapse signal" — a
 * de-facto clinical claim the [CLAIMS_LADDER] forbids.
 */
export const CLINICAL_RISK_CONFIDENCE_CAP = 0.88;
