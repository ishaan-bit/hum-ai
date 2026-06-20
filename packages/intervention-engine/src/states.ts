import type { RecommendationView } from "@hum-ai/affect-model-contracts";
import type { EvidenceLevel } from "@hum-ai/safety-language";

/**
 * CANONICAL INTERVENTION-OF-DAY REGULATION STATES.
 *
 * The intervention layer cannot read raw clinical-risk labels (ADR-0006): it sees
 * only the sanitized `RecommendationView` (dimensional valence/arousal + abstracted
 * bands) plus safe meta (capture usability, baseline maturity, an abstracted
 * longitudinal status). So instead of the 15 internal affect heads, the layer
 * derives a small set of **non-clinical regulation states** from that safe surface.
 *
 * Each state maps to one or more codebase internal heads (see the crosswalk and
 * `worklog/.../STATE_TAXONOMY_EXTRACT.md`), but its NAME is reflective and safe to
 * reason about, and the intervention for a whole V-A region is the same safe step —
 * so collapsing e.g. anger/anxiety/fear into one downshift region loses nothing for
 * the user while honouring the two-head separation.
 */
export const HUM_REGULATION_STATES = [
  // committed reads
  "calm_regulated",
  "positive_activation",
  "high_activation_negative",
  "low_recovery",
  "low_mood",
  "mixed_unsettled",
  "neutral_usual",
  "needs_support",
  // meta / non-affective states (never interpret emotion here)
  "poor_capture",
  "low_confidence",
  "not_enough_history",
] as const;
export type HumRegulationState = (typeof HUM_REGULATION_STATES)[number];

/** Reflective family description for each state (used in docs/tests, not shown raw). */
export const REGULATION_STATE_DESCRIPTION: Readonly<Record<HumRegulationState, string>> = {
  calm_regulated: "settled and steady, close to a regulated pattern",
  positive_activation: "upbeat with extra energy",
  high_activation_negative: "more activated and less steady than usual",
  low_recovery: "lower-energy, tired-sounding",
  low_mood: "quieter and lower than usual",
  mixed_unsettled: "mixed or unsettled — no single clear direction",
  neutral_usual: "close to your usual pattern",
  needs_support: "a heavier pattern that has been showing up across recent hums",
  poor_capture: "the hum was not clear enough to read",
  low_confidence: "the read is not confident enough to interpret",
  not_enough_history: "the personal baseline is still forming",
};

/**
 * Crosswalk from each safe IoD state to the internal codebase heads/classes it
 * abstracts. INTERNAL reference only (for docs/eval) — these strings are never
 * rendered to a user and never used to select copy.
 */
export const REGULATION_STATE_CROSSWALK: Readonly<Record<HumRegulationState, readonly string[]>> = {
  calm_regulated: ["calm_regulated"],
  positive_activation: ["joy_positive_activation", "excitement"],
  high_activation_negative: [
    "stress_overload",
    "anxiety_like_tension",
    "anger_frustration",
    "fear_like_activation",
  ],
  low_recovery: ["fatigue_low_recovery", "flattened_affect"],
  low_mood: ["sadness_low_mood", "depressive_affect_markers"],
  mixed_unsettled: ["mixed_state", "emotional_instability"],
  neutral_usual: ["neutral_close_to_usual"],
  needs_support: ["relapse_drift", "recovery_worsening_unchanged=worsening"],
  poor_capture: ["quality.decision=rejected", "abstain=poor_capture_quality"],
  low_confidence: ["abstain=low_margin|modality_conflict|out_of_distribution|domain_mismatch"],
  not_enough_history: ["abstain=insufficient_baseline|first_hum", "stage=population_prior"],
};

/** A state is "affective" if it reflects an interpreted emotional read. */
export function isAffectiveState(s: HumRegulationState): boolean {
  return s !== "poor_capture" && s !== "low_confidence" && s !== "not_enough_history";
}

/** Abstracted longitudinal status — safe; carries no clinical labels. */
export interface LongitudinalStatus {
  /** A within-user worsening / relapse-drift direction is present. */
  readonly drifting: boolean;
  /** That pattern has persisted across recent sessions (not a single hum). */
  readonly persistent: boolean;
}

/** Safe, abstracted meta the deriver needs beyond the sanitized affect view. */
export interface RegulationStateMeta {
  /** False when the capture itself was too weak to interpret → repeat the hum. */
  readonly captureUsable: boolean;
  /** True once the personal baseline has activated (≥5 eligible hums, hum_spec §4.6). */
  readonly baselineMature: boolean;
  /** Abstracted within-user trend; absent until the relapse model is active. */
  readonly longitudinal?: LongitudinalStatus;
  /**
   * Qualitative evidence band for THIS single read (ADR-0010). A confident single read
   * is interpreted from hum #1 — before any personal baseline exists — and the baseline
   * later refines it; only a too-weak read (below `low`) falls back to the general
   * "still forming" step. Defaults to `medium` when omitted (a committed read is read).
   */
  readonly evidence?: EvidenceLevel;
}

// V-A thresholds — kept aligned with the existing `selectInterventionFromView` mapper. The IoD
// additionally routes the subdued/ambiguous unpleasant band (valence < 0, mild arousal) to a
// grounding step rather than ever calling a clearly negative read "usual".
const AROUSAL_ACTIVATED = 0.25;
const AROUSAL_POSITIVE_ENERGY = 0.3;
const VALENCE_POSITIVE = 0.2;

/**
 * Map the sanitized view + safe meta to exactly one regulation state. Safety-first
 * order: capture → confidence/history → sustained worsening → affect region.
 * Never reads or returns a clinical label.
 */
export function deriveRegulationState(
  view: RecommendationView,
  meta: RegulationStateMeta,
): HumRegulationState {
  // 1. Capture too weak to read → ask for another hum, do not interpret affect.
  if (!meta.captureUsable) return "poor_capture";

  // 2. Abstained read → never infer an emotional state.
  if (view.abstained) {
    return meta.baselineMature ? "low_confidence" : "not_enough_history";
  }

  // 3. Committed read. The read LEADS from hum #1 (ADR-0010): interpret the affect
  //    region even before a personal baseline exists, as long as THIS single read is
  //    confident enough to lean on. Only fall back to the general "still forming" step
  //    when there is no baseline yet AND this read is too weak to interpret on its own
  //    (below the `low` band). The personal baseline then only refines this, never gates it.
  const evidence = meta.evidence ?? "medium";
  if (!meta.baselineMature && EVIDENCE_RANK[evidence] < EVIDENCE_RANK.low) {
    return "not_enough_history";
  }

  // 4. Sustained, within-user worsening/relapse-drift → safe support (before affect).
  if (meta.longitudinal?.drifting && meta.longitudinal.persistent) {
    return "needs_support";
  }

  // 5. Affect region from V-A + abstracted bands. The CLEAR-signal branches run
  //    before the mixed/uncertain catch, so a confident strong read keeps its
  //    downshift/recovery step instead of being overridden by bare meta-uncertainty
  //    (mirrors the predicate order in `selectInterventionFromView`).
  const { valence, arousal } = view.dimensional;

  // High, tense activation → downshift region (stress/anxiety/anger/fear collapsed).
  if (arousal >= AROUSAL_ACTIVATED && valence < 0) return "high_activation_negative";

  // Subdued, low arousal + negative valence → recovery vs low mood.
  if (arousal < 0 && valence < 0) {
    if (view.lowEnergyPattern) return "low_recovery";
    if (view.lowMoodPattern) return "low_mood";
    return "low_recovery"; // subdued default: the gentler, lower-risk step
  }

  // Mixed/uncertain, OR any remaining unpleasant read with mild/ambiguous arousal
  // (valence < 0, 0 ≤ arousal < AROUSAL_ACTIVATED) → one grounding/simplify step.
  // We never affirm "usual"/"steady" on a clearly negative read.
  if (view.mixedOrUncertain || valence < 0) return "mixed_unsettled";

  // Positive valence.
  if (valence >= VALENCE_POSITIVE) {
    return arousal >= AROUSAL_POSITIVE_ENERGY ? "positive_activation" : "calm_regulated";
  }

  return "neutral_usual";
}

/** Evidence band ordering for "minimum confidence required" comparisons. */
export const EVIDENCE_RANK: Readonly<Record<EvidenceLevel, number>> = {
  early_baseline: 0,
  low: 1,
  medium: 2,
  high: 3,
};
