/**
 * Intervention vocabulary. Defined here (in the model contract) so both the
 * affect inference and the intervention engine agree on the type, and so the
 * dependency points one way (intervention-engine → affect-model-contracts).
 *
 * `escalation_suggestion` is special: it may only be produced under a
 * persistent risk pattern AND when safety rules allow (see intervention-engine
 * and safety-language). It is never a clinical referral by itself.
 */
export const INTERVENTION_TYPES = [
  "music_recommendation",
  "breath_regulation",
  "journaling_prompt",
  "rest_recovery",
  "social_check_in",
  "escalation_suggestion",
  "none",
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];
