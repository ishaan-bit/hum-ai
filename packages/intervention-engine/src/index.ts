import type { UnitInterval, ValenceArousal } from "@hum-ai/shared-types";
import {
  toRecommendationView,
  type InterventionType,
  type MultiHeadAffectInference,
  type RecommendationView,
} from "@hum-ai/affect-model-contracts";

// Intervention of the Day — the richer daily regulation-support layer (see
// ./intervention-of-day.ts). The V-A mapper below stays as the minimal contract.
export * from "./states";
export * from "./templates";
export * from "./intervention-of-day";

/**
 * Intervention engine (intentionally minimal this pass — contracts + a V-A
 * mapper, not a learned policy). Interventions are SUPPORT, never treatment.
 * The mapping follows the TriSense Valence–Arousal philosophy: nudge the user
 * from where they are toward a more regulated point.
 *
 * TWO-HEAD HARDENING (ADR-0006): the engine reasons ONLY over the sanitized
 * `RecommendationView` (benign dimensional signal + abstracted risk bands). It
 * never reads raw clinical-risk labels (`depressive_affect_markers`, …). The
 * labels are collapsed into bands at the `toRecommendationView` boundary inside
 * `@hum-ai/affect-model-contracts`. `selectIntervention` is a thin adapter that
 * sanitizes first, then delegates to `selectInterventionFromView`.
 *
 * Music recommendation is justified by `intervention_support_source`
 * (de Witte et al.: music interventions reduce physiological stress d=.380 and
 * psychological stress d=.545) — as INTERVENTION SUPPORT only, never as
 * diagnostic evidence (ADR-0005).
 */
export interface InterventionContext {
  /** Set when the orchestrator detects a sustained risk pattern over sessions. */
  readonly persistentRiskPattern?: boolean;
  /** Safety gate: escalation may only be suggested when this is true. */
  readonly safetyAllowsEscalation?: boolean;
}

export interface InterventionSuggestion {
  readonly type: InterventionType;
  readonly rationale: string;
  /** Where in V-A space we'd gently steer (null for `none`/`escalation`). */
  readonly vaTarget: ValenceArousal | null;
  readonly intensity: UnitInterval;
  readonly sourceRefs: readonly string[];
}

const none = (rationale: string): InterventionSuggestion => ({
  type: "none",
  rationale,
  vaTarget: null,
  intensity: 0,
  sourceRefs: [],
});

/**
 * Select a single intervention from a fused inference. Sanitizes to a
 * `RecommendationView` first so the engine never touches raw clinical labels.
 * Returns `none` when the read abstained — we never intervene on a read we
 * don't trust.
 */
export function selectIntervention(
  inf: MultiHeadAffectInference,
  ctx: InterventionContext = {},
): InterventionSuggestion {
  return selectInterventionFromView(toRecommendationView(inf), ctx);
}

/**
 * Core policy over the sanitized recommendation view. This is the only function
 * that decides an intervention, and it has no access to clinical labels — only
 * the benign dimensional signal and abstracted risk bands.
 */
export function selectInterventionFromView(
  view: RecommendationView,
  ctx: InterventionContext = {},
): InterventionSuggestion {
  if (view.abstained) return none("read abstained — no confident state to act on");

  const { valence, arousal } = view.dimensional;
  const highRisk = view.elevatedRegulationNeed;

  // Escalation is gated by BOTH a persistent pattern AND the safety allowance.
  if (highRisk && ctx.persistentRiskPattern && ctx.safetyAllowsEscalation) {
    return {
      type: "escalation_suggestion",
      rationale: "persistent risk pattern across sessions; safety rules permit a gentle escalation suggestion (not a referral or diagnosis)",
      vaTarget: null,
      intensity: 1,
      sourceRefs: ["longitudinal_voice_treatment_response_source"],
    };
  }

  // High arousal + negative valence → down-regulate with breathing.
  if (arousal >= 0.25 && valence < 0) {
    return {
      type: "breath_regulation",
      rationale: "elevated, tense activation — paced breathing to lower arousal",
      vaTarget: { valence: valence + 0.2, arousal: arousal - 0.5 },
      intensity: 0.7,
      sourceRefs: ["intervention_support_source"],
    };
  }

  // Low arousal + negative valence → fatigue vs low mood.
  if (arousal < 0 && valence < 0) {
    if (view.lowEnergyPattern) {
      return {
        type: "rest_recovery",
        rationale: "low-recovery / tired-sounding pattern — rest and recovery",
        vaTarget: { valence: valence + 0.2, arousal: arousal + 0.1 },
        intensity: 0.6,
        sourceRefs: [],
      };
    }
    if (view.lowMoodPattern) {
      return {
        type: "social_check_in",
        rationale: "sustained lower-mood signal — a light social check-in",
        vaTarget: { valence: valence + 0.4, arousal: arousal + 0.2 },
        intensity: 0.6,
        sourceRefs: [],
      };
    }
    return {
      type: "music_recommendation",
      rationale: "subdued pattern — gently uplifting music (stress-reduction support)",
      vaTarget: { valence: valence + 0.4, arousal: arousal + 0.3 },
      intensity: 0.5,
      sourceRefs: ["intervention_support_source"],
    };
  }

  // Mixed / uncertain → reflective journaling.
  if (view.mixedOrUncertain) {
    return {
      type: "journaling_prompt",
      rationale: "mixed or uncertain pattern — a short reflective prompt",
      vaTarget: null,
      intensity: 0.4,
      sourceRefs: [],
    };
  }

  // Positive / regulated → light music to maintain, or nothing.
  if (valence >= 0.2) {
    return {
      type: "music_recommendation",
      rationale: "settled/positive pattern — music to match and maintain",
      vaTarget: { valence, arousal },
      intensity: 0.3,
      sourceRefs: ["intervention_support_source"],
    };
  }

  return none("close to usual — no intervention needed");
}
