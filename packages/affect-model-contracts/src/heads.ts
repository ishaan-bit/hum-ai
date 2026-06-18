import type { UnitInterval } from "@hum-ai/shared-types";

/**
 * The Hum affect contract is deliberately NOT a single emotion classifier.
 * Following `ser_mental_health_review` (categorical AND dimensional models are
 * both useful, dimensional is under-explored) and `trisense_architecture`
 * (V-A circumplex), Hum exposes a **multi-head** inference: a dimensional core,
 * a bank of affect-state scores, longitudinal heads, and meta heads.
 *
 * Every head listed in the project brief maps to exactly one field of
 * `MultiHeadAffectInference` (see ./inference.ts). This registry adds the
 * metadata the safety/claims layer needs: which heads are clinical-risk
 * markers (extra evidence + non-diagnostic language required), and how each
 * head's internal research label differs from anything user-facing.
 */

/** Affect-state scores; each is a unit-interval activation/marker score [0,1]. */
export const AFFECT_STATE_HEADS = [
  "calm_regulated",
  "joy_positive_activation",
  "excitement",
  "stress_overload",
  "anger_frustration",
  "anxiety_like_tension",
  "fear_like_activation",
  "sadness_low_mood",
  "depressive_affect_markers",
  "fatigue_low_recovery",
  "emotional_instability",
  "flattened_affect",
  "cognitive_attention_strain_later",
  "mixed_state",
  "neutral_close_to_usual",
] as const;
export type AffectStateHead = (typeof AFFECT_STATE_HEADS)[number];

/** The complete head namespace, including dimensional/longitudinal/meta heads. */
export const ALL_AFFECT_HEADS = [
  "valence",
  "arousal",
  ...AFFECT_STATE_HEADS,
  "relapse_drift",
  "recovery_worsening_unchanged",
  "uncertainty",
  "abstain_reason",
  "recommended_intervention",
] as const;
export type AffectHeadId = (typeof ALL_AFFECT_HEADS)[number];

export type AffectHeadKind = "dimensional" | "state" | "longitudinal" | "meta";
export type AffectHeadValueType =
  | "continuous_bipolar" // [-1, 1]
  | "unit_score" // [0, 1]
  | "categorical"
  | "enum"
  | "boolean";

export interface AffectHeadSpec {
  readonly id: AffectHeadId;
  readonly kind: AffectHeadKind;
  readonly valueType: AffectHeadValueType;
  /**
   * Risk markers (anxiety/depressive/relapse) require extra evidence before
   * surfacing and may NEVER be phrased as a diagnosis. The safety-language
   * package enforces the wording.
   */
  readonly riskMarker: boolean;
  /** Internal research label — used in logs/eval, never shown verbatim to users. */
  readonly internalLabel: string;
  /** Whether this head may inform any user-facing copy at all. */
  readonly userVisible: boolean;
  readonly description: string;
  readonly sourceRefs: readonly string[];
}

const score = (
  id: AffectHeadId,
  internalLabel: string,
  riskMarker: boolean,
  description: string,
  sourceRefs: readonly string[],
  userVisible = true,
): AffectHeadSpec => ({
  id,
  kind: "state",
  valueType: "unit_score",
  riskMarker,
  internalLabel,
  userVisible,
  description,
  sourceRefs,
});

/** Authoritative metadata for every head. */
export const AFFECT_HEADS: Readonly<Record<AffectHeadId, AffectHeadSpec>> = {
  valence: {
    id: "valence",
    kind: "dimensional",
    valueType: "continuous_bipolar",
    riskMarker: false,
    internalLabel: "valence_axis",
    userVisible: true,
    description: "Russell circumplex valence, unpleasant(−1)→pleasant(+1).",
    sourceRefs: ["trisense_architecture", "ser_mental_health_review"],
  },
  arousal: {
    id: "arousal",
    kind: "dimensional",
    valueType: "continuous_bipolar",
    riskMarker: false,
    internalLabel: "arousal_axis",
    userVisible: true,
    description: "Russell circumplex arousal, calm(−1)→activated(+1).",
    sourceRefs: ["trisense_architecture", "ser_mental_health_review"],
  },
  calm_regulated: score("calm_regulated", "calm_regulated_state", false, "Regulated, settled activation.", ["hum_spec"]),
  joy_positive_activation: score("joy_positive_activation", "positive_activation", false, "Positive, upbeat activation.", ["trisense_architecture"]),
  excitement: score("excitement", "high_positive_arousal", false, "High-arousal positive state.", ["trisense_architecture"]),
  stress_overload: score("stress_overload", "stress_load_high", true, "Elevated stress-load signal.", ["intervention_support_source", "vocal_biomarker_and_singing_protocol_support"]),
  anger_frustration: score("anger_frustration", "anger_frustration", false, "High-arousal negative (anger/frustration).", ["trisense_architecture"]),
  anxiety_like_tension: score("anxiety_like_tension", "anxiety_like_tension_marker", true, "Anxiety-like tension marker (non-diagnostic).", ["clinical_voice_biomarker_review", "ser_mental_health_review"]),
  fear_like_activation: score("fear_like_activation", "fear_like_activation", true, "Fear-like high-arousal negative activation.", ["ser_mental_health_review"]),
  sadness_low_mood: score("sadness_low_mood", "low_mood_state", true, "Low-mood / sadness signal.", ["clinical_voice_biomarker_review"]),
  depressive_affect_markers: score("depressive_affect_markers", "depressive_affect_marker", true, "Depressive-affect marker (screening signal, non-diagnostic).", ["clinical_voice_biomarker_review", "longitudinal_voice_treatment_response_source"]),
  fatigue_low_recovery: score("fatigue_low_recovery", "fatigue_low_recovery", true, "Fatigue / low recovery signal.", ["hum_spec"]),
  emotional_instability: score("emotional_instability", "affect_instability", true, "Emotional instability / lability marker.", ["hum_spec"]),
  flattened_affect: score("flattened_affect", "flattened_affect_marker", true, "Flattened / blunted affect marker.", ["clinical_voice_biomarker_review"]),
  cognitive_attention_strain_later: {
    ...score("cognitive_attention_strain_later", "attention_strain_future", true, "Cognitive/attention strain — RESERVED for a later release; not produced v1.", ["vocal_biomarker_and_singing_protocol_support"], false),
  },
  mixed_state: score("mixed_state", "mixed_state", false, "No single dominant state; conflicting heads.", ["ser_mental_health_review"]),
  neutral_close_to_usual: score("neutral_close_to_usual", "neutral_close_to_usual", false, "Close to the user's usual baseline pattern.", ["hum_spec"]),
  relapse_drift: {
    id: "relapse_drift",
    kind: "longitudinal",
    valueType: "unit_score",
    riskMarker: true,
    internalLabel: "relapse_drift_score",
    userVisible: true,
    description: "Drift toward a previously-observed high-risk signature [0,1].",
    sourceRefs: ["longitudinal_voice_treatment_response_source"],
  },
  recovery_worsening_unchanged: {
    id: "recovery_worsening_unchanged",
    kind: "longitudinal",
    valueType: "categorical",
    riskMarker: true,
    internalLabel: "dvdsa_3class",
    userVisible: true,
    description: "DVDSA-style within-user change class: recovery | worsening | unchanged.",
    sourceRefs: ["longitudinal_voice_treatment_response_source"],
  },
  uncertainty: {
    id: "uncertainty",
    kind: "meta",
    valueType: "unit_score",
    riskMarker: false,
    internalLabel: "epistemic_uncertainty",
    userVisible: true,
    description: "How unsure the system is about this inference [0,1].",
    sourceRefs: ["ser_mental_health_review"],
  },
  abstain_reason: {
    id: "abstain_reason",
    kind: "meta",
    valueType: "enum",
    riskMarker: false,
    internalLabel: "abstain_reason",
    userVisible: false,
    description: "Why the system declined to commit to a state (if it abstained).",
    sourceRefs: ["hum_spec"],
  },
  recommended_intervention: {
    id: "recommended_intervention",
    kind: "meta",
    valueType: "enum",
    riskMarker: false,
    internalLabel: "recommended_intervention",
    userVisible: true,
    description: "Intervention selected via the V-A mapping (support, not treatment).",
    sourceRefs: ["trisense_architecture", "intervention_support_source"],
  },
};

/** Heads that are clinical-risk markers and require gated, non-diagnostic handling. */
export const RISK_MARKER_HEADS: readonly AffectHeadId[] = ALL_AFFECT_HEADS.filter(
  (id) => AFFECT_HEADS[id].riskMarker,
);

export type AffectStateScores = Record<AffectStateHead, UnitInterval>;

export function zeroStateScores(): AffectStateScores {
  const out = {} as AffectStateScores;
  for (const h of AFFECT_STATE_HEADS) out[h] = 0;
  return out;
}
