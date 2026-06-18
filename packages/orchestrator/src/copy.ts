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
