import { AFFECT_HEADS } from "@hum-ai/affect-model-contracts";
import type { AffectStateHead, InterventionType } from "@hum-ai/affect-model-contracts";
import { userFacingLabel } from "@hum-ai/safety-language";

/**
 * USER-FACING COPY for the orchestrated read.
 *
 * Every string here is plain, reflective, and non-diagnostic, and is screened
 * by `validateUserFacingText` / `assertSafeUserFacingText` at the orchestrator
 * boundary before it can be returned. We never surface the intervention engine's
 * internal rationale verbatim (it talks in risk/regulation terms); instead we
 * map each intervention TYPE to a gentle suggestion the user can read directly.
 */

/** Gentle, non-diagnostic line per intervention type. Screened at the boundary. */
export const INTERVENTION_COPY: Readonly<Record<InterventionType, string>> = {
  music_recommendation: "Maybe some music that matches where you are right now.",
  breath_regulation: "A minute of slow, paced breathing might help things settle.",
  journaling_prompt: "A short note to yourself could help make sense of a mixed moment.",
  rest_recovery: "This might be a good moment to ease off and rest.",
  social_check_in: "A light check-in with someone could be a gentle lift.",
  escalation_suggestion:
    "If this lower pattern keeps showing up, talking it through with someone you trust might help.",
  none: "Nothing needed right now — you sound close to your usual.",
};

/** Headline built from the dominant BENIGN broad-affect state (never a risk marker). */
export function broadHeadline(dominant: AffectStateHead | null, abstained: boolean): string {
  if (abstained) return "We couldn't get a clear read from this hum.";
  const label = dominant ? userFacingLabel(AFFECT_HEADS[dominant].internalLabel) : "a pattern in your hum";
  return `This hum sounded like ${label}.`;
}

/**
 * Headline from the leading VALENCE + AROUSAL axis read (the dimensional read the
 * runtime now leads with). Reflective and non-diagnostic — describes how the hum
 * SOUNDED, never a state label or a clinical claim. Screened at the boundary like
 * all user copy.
 */
export function axisHeadline(valence: number, arousal: number, abstained: boolean): string {
  if (abstained) return "We couldn't get a clear read from this hum.";
  const T = 0.2;
  const hiA = arousal > T;
  const loA = arousal < -T;
  const hiV = valence > T;
  const loV = valence < -T;
  if (hiA && hiV) return "This hum sounded bright and energized.";
  if (hiA && loV) return "This hum sounded tense and activated.";
  if (loA && hiV) return "This hum sounded calm and settled.";
  if (loA && loV) return "This hum sounded subdued and low in energy.";
  if (hiA) return "This hum sounded activated.";
  if (loA) return "This hum sounded quiet and settled.";
  if (hiV) return "This hum sounded warm and even.";
  if (loV) return "This hum sounded a little flat.";
  return "This hum sounded steady and close to neutral.";
}

/**
 * A gentle, NON-ALARMING note. Baseline divergence may nudge the wording toward
 * "a little different from your recent usual" — but never names a risk, never
 * diagnoses, and never raises an alarm (ADR-0006 / ADR-0008 framing).
 */
export function readNote(opts: {
  readonly abstained: boolean;
  readonly isEarlyBaseline: boolean;
  readonly divergenceActive: boolean;
  readonly divergenceMagnitude: number;
}): string {
  if (opts.abstained) return "We'll try again next time — this one wasn't clear enough to read.";
  if (opts.divergenceActive && opts.divergenceMagnitude >= 1.0) {
    return "This one sits a little apart from your recent usual.";
  }
  if (opts.isEarlyBaseline) return "Still learning what's usual for you — early reads are rough.";
  return "Close to what we've learned is usual for you.";
}
