import type { ModelVersion, UnitInterval, ValenceArousal } from "@hum-ai/shared-types";
import type { AffectStateScores } from "./heads";
import { zeroStateScores } from "./heads";
import type { ConfidenceReport, AbstainReason } from "./confidence";
import type { InterventionType } from "./intervention-types";

/**
 * DVDSA-style within-user change class (`longitudinal_voice_treatment_response_source`).
 * The dedicated relapse engine produces a richer 5-class verdict; this 3-class
 * summary is what surfaces on the affect inference.
 */
export const DVDSA_CLASSES = ["recovery", "worsening", "unchanged"] as const;
export type DvdsaClass = (typeof DVDSA_CLASSES)[number];

/**
 * The single output object of the Hum affect model. Every head in the project
 * brief maps to exactly one field here. This is what fusion returns and what
 * the read/intervention layers consume.
 */
export interface MultiHeadAffectInference {
  readonly modelVersion: ModelVersion;

  // --- dimensional core (heads: valence, arousal) ---
  readonly dimensional: ValenceArousal;

  // --- affect-state scores (15 heads) ---
  readonly states: AffectStateScores;

  // --- longitudinal heads ---
  /** head: relapse_drift */
  readonly relapseDrift: UnitInterval;
  /** head: recovery_worsening_unchanged (null until a baseline comparison exists) */
  readonly recoveryWorseningUnchanged: DvdsaClass | null;

  // --- meta heads ---
  /** head: uncertainty */
  readonly uncertainty: UnitInterval;
  /** earned, calibrated confidence (subsumes the read-confidence in hum_spec §4.8) */
  readonly confidence: ConfidenceReport;
  /** head: abstain_reason */
  readonly abstained: boolean;
  readonly abstainReason: AbstainReason;
  /** head: recommended_intervention (selected via V-A; null when abstaining) */
  readonly recommendedIntervention: InterventionType | null;
}

/**
 * A neutral, low-confidence, abstaining inference — the safe default before any
 * evidence is committed. Useful for tests and as a fusion fallback.
 */
export function neutralInference(modelVersion: ModelVersion): MultiHeadAffectInference {
  const states = zeroStateScores();
  states.neutral_close_to_usual = 1;
  return {
    modelVersion,
    dimensional: { valence: 0, arousal: 0 },
    states,
    relapseDrift: 0,
    recoveryWorseningUnchanged: null,
    uncertainty: 1,
    confidence: {
      rawConfidence: 0,
      confidence: 0,
      confidencePercent: 0,
      appliedCap: 0,
      capReason: "neutral default",
      abstained: true,
      abstainReason: "insufficient_baseline",
    },
    abstained: true,
    abstainReason: "insufficient_baseline",
    recommendedIntervention: null,
  };
}
