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
  type HumRegulationState,
  type LongitudinalStatus,
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

/** Safe observation lead per state. Affective leads only fire with a mature baseline. */
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

/** What the suggestion is explicitly NOT based on (worded to pass safety-language). */
export const NOT_BASED_ON: readonly string[] = [
  "any medical or clinical label",
  "the words you said — a hum has no speech content",
  "any camera, photo, or video",
  "a single certainty score",
];

function basedOnSignals(state: HumRegulationState): string[] {
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
  const signals = [
    "how activated your hum sounded",
    "how pleasant or settled it sounded",
    "how today's hum compares with your recent baseline",
  ];
  if (state === "low_recovery") signals.push("your recent energy and recovery pattern");
  if (state === "low_mood") signals.push("how subdued the hum sounded versus usual");
  if (state === "mixed_unsettled") signals.push("how mixed or steady the read was");
  return signals;
}

/** Compose the single-sentence whySuggested from the state observation + the action clause. */
function composeWhy(state: HumRegulationState, evidence: EvidenceLevel, template: InterventionTemplate): string {
  // `needs_support` is a longitudinal, risk-adjacent state (sustained worsening /
  // relapse-drift). Its claim rides on the WITHIN-USER trend, not on this single
  // read's confidence — so it ALWAYS carries an explicit, non-diagnostic tentative
  // frame, independent of the single-read evidence band (CLAIMS_LADDER tier-3:
  // uncertainty surfaced + non-diagnostic framing regardless of band).
  if (state === "needs_support") {
    return `${REGULATION_STATE_WHY[state]} — a tentative pattern to gently note, not a conclusion — so ${template.whyAction}.`;
  }
  let observation = REGULATION_STATE_WHY[state];
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

/** Gather every user-facing string on an InterventionOfDay for the safety screen. */
export function interventionOfDayStrings(iod: InterventionOfDay): string[] {
  const strings = [iod.title, iod.instruction, iod.whySuggested, ...iod.basedOnSignals, ...iod.notBasedOn];
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
    whySuggested: composeWhy(state, input.evidence, template),
    basedOnSignals: basedOnSignals(state),
    notBasedOn: NOT_BASED_ON,
    confidenceLanguage: CONFIDENCE_LANGUAGE[input.evidence],
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
  });
}
