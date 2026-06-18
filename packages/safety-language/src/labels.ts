/**
 * Separation of INTERNAL research labels from USER-FACING copy. The affect
 * model thinks in clinical-ish internal labels (e.g. `depressive_affect_marker`);
 * users must only ever see reflective, non-diagnostic phrasing. This map is the
 * one-way translation, keyed by the `internalLabel` values in
 * `@hum-ai/affect-model-contracts` AFFECT_HEADS.
 */
export const INTERNAL_TO_USER_FACING: Readonly<Record<string, string>> = {
  valence_axis: "how pleasant your hum felt",
  arousal_axis: "how activated your hum felt",
  calm_regulated_state: "a settled, regulated pattern",
  positive_activation: "an upbeat, positive pattern",
  high_positive_arousal: "an energised pattern",
  stress_load_high: "a higher stress-load signal than your usual",
  anger_frustration: "a more charged pattern",
  anxiety_like_tension_marker: "more tension than your usual",
  fear_like_activation: "a more on-edge pattern",
  low_mood_state: "a lower-mood signal than your usual",
  depressive_affect_marker: "a lower-mood pattern worth gently noting",
  fatigue_low_recovery: "a low-recovery / tired-sounding pattern",
  affect_instability: "a less steady pattern than your usual",
  flattened_affect_marker: "a flatter, more muted pattern",
  attention_strain_future: "(reserved — not shown yet)",
  mixed_state: "a mixed pattern",
  neutral_close_to_usual: "close to your usual pattern",
  relapse_drift_score: "a drift away from your steadier pattern",
  dvdsa_3class: "your change since last time",
  epistemic_uncertainty: "how sure this read is",
  abstain_reason: "(internal)",
  recommended_intervention: "a suggestion you might try",
};

/** True if a label is internal-only and must never be surfaced verbatim. */
export function isInternalOnly(internalLabel: string): boolean {
  return internalLabel === "abstain_reason" || internalLabel === "attention_strain_future";
}

/**
 * Translate an internal label to safe user copy; falls back to a neutral line.
 * Internal-only labels (`isInternalOnly`) are NEVER surfaced — not even their
 * placeholder copy — so the internal-only contract is enforced in the one
 * function callers actually use, not merely advertised by a separate predicate.
 */
export function userFacingLabel(internalLabel: string): string {
  if (isInternalOnly(internalLabel)) return "a pattern in your hum";
  return INTERNAL_TO_USER_FACING[internalLabel] ?? "a pattern in your hum";
}
