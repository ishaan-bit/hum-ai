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
export * from "./music";
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

/** Arousal at/above which activation is "elevated". */
const AROUSAL_ACTIVATION = 0.25;
/** Valence at/above which the read is treated as settled/positive. */
const VALENCE_POSITIVE = 0.2;

/** The benign V-A region of a read. */
type VaRegion = "high_arousal_negative" | "low_arousal_negative" | "mixed_uncertain" | "positive" | "neutral";

/**
 * The single source of the V-A region boundaries — shared by the safety rule
 * (`selectInterventionFromView`) and the supportive-candidate set (`supportiveCandidates`)
 * so the two can never disagree on which region a read is in. `null` for an abstained read.
 */
function vaRegion(view: RecommendationView): VaRegion | null {
  if (view.abstained) return null;
  const { valence, arousal } = view.dimensional;
  if (arousal >= AROUSAL_ACTIVATION && valence < 0) return "high_arousal_negative";
  if (arousal < 0 && valence < 0) return "low_arousal_negative";
  if (view.mixedOrUncertain) return "mixed_uncertain";
  if (valence >= VALENCE_POSITIVE) return "positive";
  return "neutral";
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
  const region = vaRegion(view);

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
  if (region === "high_arousal_negative") {
    return {
      type: "breath_regulation",
      rationale: "elevated, tense activation — paced breathing to lower arousal",
      vaTarget: { valence: valence + 0.2, arousal: arousal - 0.5 },
      intensity: 0.7,
      sourceRefs: ["intervention_support_source"],
    };
  }

  // Low arousal + negative valence → fatigue vs low mood.
  if (region === "low_arousal_negative") {
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
  if (region === "mixed_uncertain") {
    return {
      type: "journaling_prompt",
      rationale: "mixed or uncertain pattern — a short reflective prompt",
      vaTarget: null,
      intensity: 0.4,
      sourceRefs: [],
    };
  }

  // Positive / regulated → light music to maintain, or nothing.
  if (region === "positive") {
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

/**
 * PERSONALIZED INTERVENTION SELECTION (v2).
 *
 * `selectInterventionFromView` stays the single safety authority — it decides the
 * V-A region and owns the gated `escalation_suggestion` / `none` / abstain
 * decisions. The personalization policy (the bandit in `@hum-ai/personalization-engine`)
 * is allowed to choose ONLY among the safe SUPPORTIVE options for the same region,
 * so "which supportive step" becomes individual ("what has helped you before, and
 * what's worth trying") without ever touching the safety gates.
 */

const SUPPORTIVE_TYPES: ReadonlySet<InterventionType> = new Set<InterventionType>([
  "music_recommendation",
  "breath_regulation",
  "journaling_prompt",
  "rest_recovery",
  "social_check_in",
]);

/** True for a supportive intervention the policy may re-rank (never none/escalation). */
export function isSupportiveIntervention(type: InterventionType): boolean {
  return SUPPORTIVE_TYPES.has(type);
}

/**
 * The supportive interventions plausible for the current V-A region — the safe
 * option set a personalized policy may choose among. Mirrors the regions of
 * `selectInterventionFromView`; the rule's own pick is always included. Returns
 * `[]` for the abstain / "close to usual" cases (nothing to personalize).
 */
export function supportiveCandidates(view: RecommendationView): InterventionType[] {
  switch (vaRegion(view)) {
    case "high_arousal_negative":
      return ["breath_regulation", "music_recommendation"];
    case "low_arousal_negative":
      return ["rest_recovery", "social_check_in", "music_recommendation"];
    case "mixed_uncertain":
      return ["journaling_prompt", "music_recommendation"];
    case "positive":
      return ["music_recommendation", "journaling_prompt"];
    default: // abstained (null) or neutral — nothing to personalize
      return [];
  }
}

const SUPPORTIVE_TARGET: Record<
  InterventionType,
  { readonly va: (va: ValenceArousal) => ValenceArousal | null; readonly intensity: number; readonly refs: readonly string[] }
> = {
  breath_regulation: { va: ({ valence, arousal }) => ({ valence: valence + 0.2, arousal: arousal - 0.5 }), intensity: 0.7, refs: ["intervention_support_source"] },
  rest_recovery: { va: ({ valence, arousal }) => ({ valence: valence + 0.2, arousal: arousal + 0.1 }), intensity: 0.6, refs: [] },
  social_check_in: { va: ({ valence, arousal }) => ({ valence: valence + 0.4, arousal: arousal + 0.2 }), intensity: 0.6, refs: [] },
  music_recommendation: { va: ({ valence, arousal }) => ({ valence: valence + 0.4, arousal: arousal + 0.3 }), intensity: 0.5, refs: ["intervention_support_source"] },
  journaling_prompt: { va: () => null, intensity: 0.4, refs: [] },
  escalation_suggestion: { va: () => null, intensity: 1, refs: [] },
  none: { va: () => null, intensity: 0, refs: [] },
};

/**
 * Build a suggestion for a supportive `type` the personalization policy chose among
 * `supportiveCandidates`. The V-A target nudges toward regulation exactly as the rule
 * policy would; the rationale is honest about being a personalized pick.
 */
export function buildSupportiveSuggestion(type: InterventionType, view: RecommendationView): InterventionSuggestion {
  const spec = SUPPORTIVE_TARGET[type];
  return {
    type,
    rationale: "personalized support: chosen from your safe options by what has helped you before (and what's worth trying)",
    vaTarget: spec.va(view.dimensional),
    intensity: spec.intensity,
    sourceRefs: spec.refs,
  };
}
