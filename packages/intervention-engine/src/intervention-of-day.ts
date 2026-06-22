import type { RecommendationView } from "@hum-ai/affect-model-contracts";
import {
  validateUserFacingText,
  isConfidenceCopySafe,
  UnsafeLanguageError,
  type EvidenceLevel,
} from "@hum-ai/safety-language";
import {
  deriveRegulationState,
  isAffectiveState,
  EVIDENCE_RANK,
  REGULATION_STATE_DESCRIPTION,
  type HumRegulationState,
  type LongitudinalStatus,
  type RecentAffectSummary,
  type RegulationStateMeta,
} from "./states";
import {
  INTERVENTION_TEMPLATES,
  type InterventionCategory,
  type InterventionTemplate,
} from "./templates";
import { selectMusicForTarget, type MusicRecommendation } from "./music";

/**
 * INTERVENTION OF THE DAY.
 *
 * Turns the already-extracted hum signal into ONE small, safe, doable regulation
 * step plus a plain one-sentence reason. The conceptual flow is
 *   hum features → affective signal → confidence/safety gate → simple support,
 * NOT hum → diagnosis → advice.
 *
 * It reads ONLY the sanitized `RecommendationView` (ADR-0006: no clinical labels)
 * plus safe meta (capture usability, qualitative evidence band, baseline maturity,
 * an abstracted within-user trend). Every produced string is screened against
 * `@hum-ai/safety-language`, carries no raw confidence number (ADR-0008), and uses
 * no internal clinical label. It is SUPPORT, never therapy/treatment/diagnosis.
 */

/** Qualitative confidence wording surfaced on the suggestion (never a number). */
export type InterventionConfidenceLanguage =
  | "early_signal"
  | "low_evidence"
  | "moderate_evidence"
  | "stronger_evidence";

export interface InterventionOfDay {
  /** Stable id of the selected template (useful for logging/rotation/testing). */
  readonly id: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly category: InterventionCategory;
  readonly instruction: string;
  /** One plain sentence: what the read showed and why this step follows. */
  readonly whySuggested: string;
  /** Safe, plain descriptors of what informed this — never clinical labels. */
  readonly basedOnSignals: readonly string[];
  /** Explicit scope: what this was NOT based on. */
  readonly notBasedOn: readonly string[];
  readonly confidenceLanguage: InterventionConfidenceLanguage;
  /** A safe, reflective description of the read region this step is shaped for (never clinical). */
  readonly targetStateDescription: string;
  /** One plain, technique-level sentence on why this kind of step helps (research-informed support). */
  readonly researchRationale: string;
  /** A short, plain technique tag cited inline with the rationale (e.g. "paced exhale"). */
  readonly technique: string;
  /**
   * One plain sentence placing today in the context of the user's RECENT hums (history-aware
   * support — "over your last few hums you've sounded …"). Absent until there are enough recent
   * reads. Non-clinical; screened with the rest of the copy.
   */
  readonly recentContext?: string;
  /**
   * One optional sentence tying the step to the user's tentative hum-personality signature
   * (e.g. "this leans into your steadier way of humming"). Exploratory; screened with the copy.
   */
  readonly personalNote?: string;
  /**
   * Two concrete micro-options the user can choose between — the single biggest anti-"generic"
   * lever (single-session-intervention "you're the expert" agency). Omitted for meta states
   * (poor_capture / low_confidence / not_enough_history) where there's nothing to act on.
   */
  readonly microMoves?: readonly string[];
  /** One optional interoceptive pointer ("notice where it sits") — somatic specificity. */
  readonly bodyCue?: string;
  /** Display-safe citations grounding this step (may be empty for generic low-risk actions). */
  readonly sources: readonly { readonly label: string; readonly detail: string }[];
  readonly safetyNote?: string;
  readonly escalation?: {
    readonly show: boolean;
    readonly reason?: string;
    readonly copy?: string;
  };
  /**
   * A concrete music suggestion DERIVED FROM the model's V-A read — present only for a
   * `music_regulation` step with sufficient confidence (≥ medium evidence; the ~72%
   * threshold from MUSIC_INTERVENTION_REQUIREMENTS §5). Support only, never treatment;
   * its strings are safety-screened with the rest of the IoD copy.
   */
  readonly musicRecommendation?: MusicRecommendation;
}

export interface InterventionOfDayInput {
  /** Sanitized affect view — the ONLY affect source (ADR-0006). */
  readonly view: RecommendationView;
  /** False when the capture itself was too weak to interpret → repeat the hum. */
  readonly captureUsable: boolean;
  /** Qualitative confidence band (ADR-0008) — drives confidenceLanguage + caution. */
  readonly evidence: EvidenceLevel;
  /** True once the personal baseline has activated (≥5 eligible hums). */
  readonly baselineMature: boolean;
  /** Abstracted within-user trend (safe; never clinical labels). */
  readonly longitudinal?: LongitudinalStatus;
  /** Recent-reads summary so the step reflects recent history, not just today's hum. */
  readonly recentAffect?: RecentAffectSummary;
  /**
   * Tentative hum-personality lean (from `@hum-ai/personality-signature`, mapped by the caller
   * to this minimal shape so this package stays decoupled). Adds one personalised sentence.
   */
  readonly personality?: {
    /** A safe adjective for the dominant lean (e.g. "steady", "expressive"), or null. */
    readonly adjective: string | null;
    /** Emotional-steadiness tendency in [-1,1] (gentler framing when low). */
    readonly steadiness: number;
  };
  /** Safety gate: support-escalation copy is only offered when true. */
  readonly safetyAllowsEscalation?: boolean;
  /**
   * Deterministic rotation index so the "of the day" choice varies day to day
   * without `Date`/random inside the engine (e.g. pass day-of-year). Default 0.
   */
  readonly rotationSeed?: number;
}

const CONFIDENCE_LANGUAGE: Readonly<Record<EvidenceLevel, InterventionConfidenceLanguage>> = {
  early_baseline: "early_signal",
  low: "low_evidence",
  medium: "moderate_evidence",
  high: "stronger_evidence",
};

/** Safe observation lead per state — phrased relative to the user's learned baseline. */
const REGULATION_STATE_WHY: Readonly<Record<HumRegulationState, string>> = {
  calm_regulated: "Your hum sounded settled and close to your usual steady pattern",
  positive_activation: "Your hum sounded upbeat, with some extra energy",
  high_activation_negative:
    "Your hum showed more activation and less steadiness than your recent baseline",
  low_recovery: "Your hum sounded lower-energy than your usual",
  low_mood: "Your hum sounded quieter and lower than your usual",
  mixed_unsettled: "This read came out mixed, without one clear direction",
  neutral_usual: "Your hum sounded close to your usual pattern",
  needs_support: "Your recent hums seem to be trending a bit heavier than usual",
  poor_capture: "This hum wasn't clear enough to read",
  low_confidence: "This read isn't confident enough to lean on",
  not_enough_history: "Your personal baseline is still forming",
};

/**
 * Baseline-FREE observation leads, used before a personal baseline exists (ADR-0010:
 * the read leads from hum #1). Identical regions to `REGULATION_STATE_WHY` but with no
 * "your usual" / "your recent baseline" comparison — there is no baseline to compare to
 * yet, so a first-hum read describes only how THIS hum sounded. Only the interpreted
 * affective states need a variant; meta states reuse the base map.
 */
const REGULATION_STATE_WHY_NO_BASELINE: Partial<Record<HumRegulationState, string>> = {
  calm_regulated: "Your hum sounded settled and steady",
  positive_activation: "Your hum sounded upbeat, with some extra energy",
  high_activation_negative: "Your hum sounded activated and a little tense",
  low_recovery: "Your hum sounded low on energy",
  low_mood: "Your hum sounded quiet and low",
  mixed_unsettled: "This read came out mixed, without one clear direction",
  neutral_usual: "Your hum sounded fairly even and neutral",
};

/**
 * Per-category, technique-level "why this kind of step helps" — research-INFORMED support
 * (never treatment/diagnosis). Plain enough to pass the safety screen; carries no numbers.
 */
const CATEGORY_RATIONALE: Readonly<Record<InterventionCategory, string>> = {
  breath_regulation: "Slowing the breath with a longer exhale is a well-recognised way to ease a more activated state.",
  grounding: "A brief sensory grounding step is a common way to steady a charged moment without overthinking it.",
  music_regulation: "Calm, low-stimulation music is associated with winding down and easing stress load.",
  movement_reset: "A short burst of easy movement helps a charged moment discharge, and gently lifts a flat one.",
  rest_recovery: "Short, deliberate recovery breaks suit a tired-sounding read better than pushing on.",
  journaling: "Briefly naming how a moment feels is a light, low-effort way to make it clearer.",
  social_check_in: "A small, low-pressure social connection is a gentle lift on a lower day.",
  reduce_load: "Easing demand for a short while is a safer response to a heavier read than adding more.",
  repeat_capture: "A clearer hum gives a more useful read — so the most useful next step is simply another one.",
  no_action_needed: "When a read sounds settled, the steadiest move is to keep your rhythm.",
  safety_support: "When a heavier pattern keeps showing up, easing your load and leaning on someone are caring next steps.",
};

/**
 * A short, plain TECHNIQUE TAG per category, cited inline with the rationale so the "why this"
 * line ends in a named method instead of a vague claim (research-informed; carries no number,
 * names no clinical condition). Required for every category.
 */
const CATEGORY_TECHNIQUE: Readonly<Record<InterventionCategory, string>> = {
  breath_regulation: "paced exhale",
  grounding: "sensory grounding",
  music_regulation: "low-stimulation music",
  movement_reset: "behavioural activation",
  rest_recovery: "deliberate recovery",
  journaling: "affect labelling",
  social_check_in: "social connection",
  reduce_load: "easing demand",
  repeat_capture: "a cleaner signal",
  no_action_needed: "keeping your rhythm",
  safety_support: "easing load and reaching out",
};

/**
 * Two concrete MICRO-MOVES per action category — the user picks whichever fits (agency is the
 * strongest anti-"generic AI" lever). Meta states (poor_capture / low_confidence /
 * not_enough_history / no_action_needed) get none — there is nothing to act on there.
 * All spelled-out (no digits) so the confidence-copy guard never trips.
 */
const CATEGORY_MICRO_MOVES: Partial<Record<InterventionCategory, readonly [string, string]>> = {
  breath_regulation: [
    "Breathe out slowly six times, each exhale a little longer than the breath in.",
    "Or in for four, hold for four, out for four — for about a minute.",
  ],
  grounding: [
    "Name five things you can see, then four you can hear.",
    "Or plant both feet, feel the floor, and take one long breath out.",
  ],
  music_regulation: [
    "Put on one steady, low-key track and just listen.",
    "Or play a song you quietly love and let it run.",
  ],
  movement_reset: [
    "Move gently for two minutes — a slow walk or an easy stretch.",
    "Or step outside and unclench your jaw and hands.",
  ],
  rest_recovery: [
    "Sit back and let your shoulders drop for a few minutes.",
    "Or make a warm drink, slowly, away from any screen.",
  ],
  journaling: [
    "Write one line for how this feels — a label, not an essay.",
    "Or jot down one thing that's going okay, however small.",
  ],
  social_check_in: [
    "Send one small hello — it doesn't have to be deep.",
    "Or reply to the message you've been meaning to get to.",
  ],
  reduce_load: [
    "Take one task off the next hour and give that time back.",
    "Or pick the one thing that matters today and let the rest wait.",
  ],
  safety_support: [
    "Take one thing off your plate today.",
    "Or share how you've been doing with someone you trust.",
  ],
};

/** One interoceptive BODY CUE per action category — somatic specificity reads as earned, not generic. */
const CATEGORY_BODY_CUE: Partial<Record<InterventionCategory, string>> = {
  breath_regulation: "Notice where the charge sits — chest, jaw, or shoulders — and let that spot soften on each way out.",
  grounding: "Let your attention drop out of your head and down into your feet as you do it.",
  music_regulation: "Notice your shoulders come down a little as the track settles in.",
  movement_reset: "Notice the bit of looseness that follows once you've moved.",
  rest_recovery: "Find where you're holding on, and let it go heavy for a moment.",
  journaling: "Once it's named, notice whether it loosens even slightly.",
  social_check_in: "Notice it gets a touch lighter once you've sent it.",
  reduce_load: "Notice the small relief of one less thing to hold.",
  safety_support: "Feel where your weight rests for a moment — you don't have to carry it all at once.",
};

/** Display-safe citation strings for the source ids on a template (no numbers, no clinical terms). */
const SOURCE_DISPLAY: Readonly<Record<string, { label: string; detail: string }>> = {
  intervention_support_source: {
    label: "Music & stress",
    detail: "de Witte et al. — a large meta-analysis linking music to lower stress.",
  },
  longitudinal_voice_treatment_response_source: {
    label: "Voice change over time",
    detail: "Kim et al. — tracking recovery versus worsening within the same person over time.",
  },
  ser_mental_health_review: {
    label: "Voice & affect",
    detail: "Jordan et al. — a review of voice-based affect sensing and its uncertainty.",
  },
  trisense_architecture: {
    label: "Mood–energy map",
    detail: "Ilyas et al. — the valence–arousal model behind how the read is mapped.",
  },
  vocal_biomarker_and_singing_protocol_support: {
    label: "Sustained voice",
    detail: "Sustained, sung phonation as a language-independent vocal-signal source.",
  },
  clinical_voice_biomarker_review: {
    label: "Voice signals",
    detail: "A review of acoustic voice features that track affective state, used as a research prior.",
  },
  hum_spec: {
    label: "The 12-second hum",
    detail: "Hum AI's standardised capture and personal-baseline protocol.",
  },
};

function sourcesFor(refs: readonly string[]): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = [];
  for (const id of refs) {
    const s = SOURCE_DISPLAY[id];
    if (s) out.push({ label: s.label, detail: s.detail });
  }
  return out;
}

/** What the suggestion is explicitly NOT based on (worded to pass safety-language). */
export const NOT_BASED_ON: readonly string[] = [
  "any medical or clinical label",
  "the words you said — a hum has no speech content",
  "any camera, photo, or video",
  "a single certainty score",
];

function basedOnSignals(state: HumRegulationState, baselineMature: boolean): string[] {
  switch (state) {
    case "poor_capture":
      return ["how clear the hum recording was"];
    case "low_confidence":
      return ["how confident this read is", "how clear the hum was"];
    case "not_enough_history":
      return ["how many clean hums we have so far"];
    case "needs_support":
      // Derived from the WITHIN-USER trend, not this single hum's affect — say so,
      // and do not claim a per-hum emotional read that did not drive this state.
      return ["your trend across recent hums", "how today's hums compare with your recent baseline"];
    default:
      break;
  }
  // Affective read. Only claim a baseline comparison once a baseline actually exists.
  const signals = ["how activated your hum sounded", "how pleasant or settled it sounded"];
  if (baselineMature) signals.push("how today's hum compares with your recent baseline");
  if (state === "low_recovery") signals.push(baselineMature ? "your recent energy and recovery pattern" : "your hum's energy level");
  if (state === "low_mood") signals.push(baselineMature ? "how subdued the hum sounded versus usual" : "how subdued the hum sounded");
  if (state === "mixed_unsettled") signals.push("how mixed or steady the read was");
  return signals;
}

/** Compose the single-sentence whySuggested from the state observation + the action clause. */
function composeWhy(
  state: HumRegulationState,
  evidence: EvidenceLevel,
  template: InterventionTemplate,
  baselineMature: boolean,
): string {
  // `needs_support` is a longitudinal, risk-adjacent state (sustained worsening /
  // relapse-drift). Its claim rides on the WITHIN-USER trend, not on this single
  // read's confidence — so it ALWAYS carries an explicit, non-diagnostic tentative
  // frame, independent of the single-read evidence band (CLAIMS_LADDER tier-3:
  // uncertainty surfaced + non-diagnostic framing regardless of band).
  if (state === "needs_support") {
    return `${REGULATION_STATE_WHY[state]} — a tentative pattern to gently note, not a conclusion — so ${template.whyAction}.`;
  }
  // Before a personal baseline exists, describe only how THIS hum sounded — never claim
  // a comparison to a "usual" that hasn't formed yet (ADR-0010 honest first-hum read).
  let observation =
    !baselineMature && isAffectiveState(state)
      ? (REGULATION_STATE_WHY_NO_BASELINE[state] ?? REGULATION_STATE_WHY[state])
      : REGULATION_STATE_WHY[state];
  // For other interpreted reads, surface single-read uncertainty when confidence is low.
  if (isAffectiveState(state) && EVIDENCE_RANK[evidence] <= EVIDENCE_RANK.low) {
    observation += " (an early, low-confidence read)";
  }
  return `${observation}, so ${template.whyAction}.`;
}

/**
 * Pick the template for a state given the evidence band + baseline maturity. Honours
 * minimum-evidence, baseline requirement, and contraindications, then rotates
 * deterministically. Falls back to the lowest-evidence in-state template if the
 * evidence floor filters everything out, so a state is never left without a step.
 */
export function selectTemplateForState(
  state: HumRegulationState,
  evidence: EvidenceLevel,
  baselineMature: boolean,
  rotationSeed = 0,
): InterventionTemplate {
  const inState = INTERVENTION_TEMPLATES.filter(
    (t) => t.targetStates.includes(state) && !t.contraindicatedStates.includes(state),
  );
  const baselineOk = inState.filter((t) => !t.requiresBaselineMature || baselineMature);

  let candidates = baselineOk.filter((t) => EVIDENCE_RANK[evidence] >= EVIDENCE_RANK[t.minEvidence]);
  if (candidates.length === 0) {
    // Evidence below the floor of every matched step: fall back to the gentlest
    // baseline-ELIGIBLE option (never a baseline-required one), so the baseline gate
    // still holds even in the fallback rather than being silently bypassed.
    candidates = [...baselineOk].sort((a, b) => EVIDENCE_RANK[a.minEvidence] - EVIDENCE_RANK[b.minEvidence]);
  }
  if (candidates.length === 0) {
    throw new Error(`no intervention template available for state "${state}" — template library gap`);
  }
  const n = candidates.length;
  // Sanitize a caller-supplied seed: non-finite (NaN/±Infinity) would make the
  // modulo NaN and index out of bounds. Negative finite seeds wrap correctly.
  const seed = Number.isFinite(rotationSeed) ? Math.trunc(rotationSeed) : 0;
  const idx = ((seed % n) + n) % n;
  return candidates[idx]!;
}

/** Build the escalation block for the needs-support state (gated by the safety flag). */
function buildEscalation(
  state: HumRegulationState,
  input: InterventionOfDayInput,
): InterventionOfDay["escalation"] {
  if (state !== "needs_support") return undefined;
  const show = Boolean(input.safetyAllowsEscalation) && Boolean(input.longitudinal?.persistent);
  if (!show) return { show: false };
  return {
    show: true,
    reason: "a heavier pattern seems to have persisted across your recent hums",
    copy: "If this heavier pattern keeps showing up, it can help to ease your load and talk things through with someone you trust.",
  };
}

/**
 * One plain sentence summarising the user's RECENT hums (history-aware support). Returns
 * undefined when there isn't enough recent history to characterise. Non-clinical.
 */
function recentContextLine(ra: RecentAffectSummary | undefined): string | undefined {
  if (!ra || ra.count < 2) return undefined;
  const v = ra.meanValence;
  const a = ra.meanArousal;
  if (v < -0.2 && a > 0.2) return "Over your last few hums you've sounded a bit wound-up and on the lower side.";
  if (v < -0.2) return "Over your last few hums you've sounded on the quieter, lower side.";
  if (v > 0.2 && a > 0.2) return "Over your last few hums you've sounded bright and full of energy.";
  if (a < -0.2) return "Over your last few hums you've sounded calm and low-key.";
  if (v > 0.2) return "Over your last few hums you've sounded warm and fairly settled.";
  return "Over your last few hums you've sounded fairly steady.";
}

/** One optional sentence tying the step to the user's tentative hum-personality lean. */
function personalNoteLine(p: InterventionOfDayInput["personality"]): string | undefined {
  if (!p || !p.adjective) return undefined;
  return `This leans into your more ${p.adjective} way of humming — go with what fits.`;
}

/** Gather every user-facing string on an InterventionOfDay for the safety screen. */
export function interventionOfDayStrings(iod: InterventionOfDay): string[] {
  const strings = [iod.title, iod.instruction, iod.whySuggested, ...iod.basedOnSignals, ...iod.notBasedOn];
  strings.push(iod.targetStateDescription, iod.researchRationale, iod.technique);
  if (iod.recentContext) strings.push(iod.recentContext);
  if (iod.personalNote) strings.push(iod.personalNote);
  if (iod.microMoves) strings.push(...iod.microMoves);
  if (iod.bodyCue) strings.push(iod.bodyCue);
  for (const s of iod.sources) strings.push(s.label, s.detail);
  if (iod.safetyNote) strings.push(iod.safetyNote);
  if (iod.escalation?.reason) strings.push(iod.escalation.reason);
  if (iod.escalation?.copy) strings.push(iod.escalation.copy);
  if (iod.musicRecommendation) {
    const m = iod.musicRecommendation;
    strings.push(m.copy, m.tempoBand, m.basedOn, ...m.tracks.flatMap((t) => [t.title, t.genre]));
  }
  return strings;
}

export class UnsafeInterventionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeInterventionError";
  }
}

/**
 * Defense in depth: every user-facing string must pass the safety-language screen
 * (no diagnosis/treatment/clinical-certainty phrasing) and carry no raw confidence
 * number. Throws loudly if a template ever regresses. Used by `selectInterventionOfDay`
 * and by the package tests.
 */
export function assertInterventionOfDaySafe(iod: InterventionOfDay): void {
  for (const text of interventionOfDayStrings(iod)) {
    const r = validateUserFacingText(text);
    if (!r.ok) {
      throw new UnsafeLanguageError(r.violations);
    }
    if (!isConfidenceCopySafe(text)) {
      throw new UnsafeInterventionError(`intervention copy leaked a raw confidence number: "${text}"`);
    }
  }
}

/**
 * Select today's Intervention of the Day from the sanitized view + safe meta.
 * Always returns a supportive step (even "try another hum" or "keep your rhythm").
 * The result is self-screened before it is returned.
 */
export function selectInterventionOfDay(input: InterventionOfDayInput): InterventionOfDay {
  const meta: RegulationStateMeta = {
    captureUsable: input.captureUsable,
    baselineMature: input.baselineMature,
    longitudinal: input.longitudinal,
    recentAffect: input.recentAffect,
    evidence: input.evidence,
  };
  const state = deriveRegulationState(input.view, meta);
  const template = selectTemplateForState(state, input.evidence, input.baselineMature, input.rotationSeed ?? 0);

  const escalation = buildEscalation(state, input);

  // Music suggestion DERIVED FROM the model's V-A read — only for a music_regulation step
  // with sufficient confidence (≥ medium evidence ≈ the ~72% spec threshold) and a real
  // (non-abstained) read. Below the gate the generic template text still shows, but no
  // specific recommendation is made (MUSIC_INTERVENTION_REQUIREMENTS §5).
  const music =
    template.category === "music_regulation" &&
    template.musicTarget &&
    !input.view.abstained &&
    EVIDENCE_RANK[input.evidence] >= EVIDENCE_RANK.medium
      ? selectMusicForTarget(input.view.dimensional, template.musicTarget)
      : undefined;

  const iod: InterventionOfDay = {
    id: template.id,
    title: template.title,
    durationMinutes: template.durationMinutes,
    category: template.category,
    instruction: template.instruction,
    whySuggested: composeWhy(state, input.evidence, template, input.baselineMature),
    basedOnSignals: basedOnSignals(state, input.baselineMature),
    notBasedOn: NOT_BASED_ON,
    confidenceLanguage: CONFIDENCE_LANGUAGE[input.evidence],
    targetStateDescription: REGULATION_STATE_DESCRIPTION[state],
    researchRationale: CATEGORY_RATIONALE[template.category],
    technique: CATEGORY_TECHNIQUE[template.category],
    ...(recentContextLine(input.recentAffect) ? { recentContext: recentContextLine(input.recentAffect) } : {}),
    ...(personalNoteLine(input.personality) ? { personalNote: personalNoteLine(input.personality) } : {}),
    ...(CATEGORY_MICRO_MOVES[template.category] ? { microMoves: CATEGORY_MICRO_MOVES[template.category] } : {}),
    ...(CATEGORY_BODY_CUE[template.category] ? { bodyCue: CATEGORY_BODY_CUE[template.category] } : {}),
    sources: sourcesFor(template.sourceRefs),
    ...(template.safetyNote ? { safetyNote: template.safetyNote } : {}),
    ...(escalation ? { escalation } : {}),
    ...(music ? { musicRecommendation: music } : {}),
  };

  assertInterventionOfDaySafe(iod);
  return iod;
}

/** The regulation state that drove a given input — exposed for tests/eval. */
export function regulationStateFor(input: InterventionOfDayInput): HumRegulationState {
  return deriveRegulationState(input.view, {
    captureUsable: input.captureUsable,
    baselineMature: input.baselineMature,
    longitudinal: input.longitudinal,
    evidence: input.evidence,
  });
}
