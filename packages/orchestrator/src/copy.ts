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
  if (hiA && hiV) return "Bright and energised.";
  if (hiA && loV) return "Tense and wound-up.";
  if (loA && hiV) return "Calm and content.";
  if (loA && loV) return "Low and flat.";
  if (hiA) return "Restless and activated.";
  if (loA) return "Quiet and subdued.";
  if (hiV) return "Warm and steady.";
  if (loV) return "A little flat.";
  return "Steady and even.";
}

/**
 * INNER-STATE line — the single reflective sentence the read leads with: "right now you
 * read as …". It fuses the leading VALENCE + AROUSAL axis read with the secondary benign
 * affect lean into one plain sentence so the user sees an inner-state read, not two
 * abstract meters. Reflective and non-diagnostic (it describes how the read came out,
 * never a clinical state or a certainty), and screened at the boundary like all copy.
 *
 * The lean rides on the far-domain 6-way prior, so it is held lightly. ADR-0005 / ADR-0010.
 *
 * DIRECTNESS (v4): the read now LEADS with a plain present-tense statement of the user's state
 * of mind ("Right now you're …"), then a short, specific qualifier — instead of the older
 * cryptic, poetic phrasings. Affect-labeling research (Lieberman/Torre) still applies: the
 * naming is specific, not a vague bin. It stays tentative ("reads as") and non-diagnostic, and
 * is screened at the boundary (no clinical label, no number).
 */
export function innerStateLine(
  valence: number,
  arousal: number,
  affectHint: AffectStateHead | null,
  abstained: boolean,
): string | null {
  if (abstained) return null;
  const T = 0.2;
  const hiA = arousal > T;
  const loA = arousal < -T;
  const hiV = valence > T;
  const loV = valence < -T;

  if (hiA && hiV) return "Right now you're upbeat and energised — bright, with real charge behind it.";
  if (hiA && loV) return "Right now you read as tense and wound-up — keyed up, and maybe a little on edge.";
  if (loA && hiV) return "Right now you're calm and content — settled, with an easy warmth to it.";
  if (loA && loV) return "Right now you read as low and flat — quiet, and running on not very much.";
  if (hiA) return "Right now you're restless and activated — energy that hasn't quite settled.";
  if (loA) return "Right now you're quiet and subdued — turned down low, taking it easy.";
  if (hiV) return "Right now you're warm and steady — comfortable, nothing pushing at the edges.";
  if (loV) return "Right now you read as a little flat and downbeat — even-toned, but the warmth's dialled down.";

  // Near the centre, a subtle lean from the secondary 6-way prior sharpens the read
  // (it is never named as a label — ADR-0005 keeps it tentative, not a verdict).
  if (affectHint === "anxiety_like_tension")
    return "Right now you're mostly even, with a thread of tension running underneath.";
  if (affectHint === "sadness_low_mood")
    return "Right now you're fairly even, sitting a touch on the quiet, low side today.";
  if (affectHint === "fatigue_low_recovery")
    return "Right now you're steady, but it sounds like there isn't much left in reserve.";
  return "Right now you read as steady and even — balanced, nothing pulling hard either way.";
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
  // Frame an early read as baseline-BUILDING, not as doubt — each hum teaches Hum your
  // normal, which is what later lets it notice change early.
  if (opts.isEarlyBaseline) return "One of your early hums — each one teaches Hum a little more of your usual.";
  return "This sits close to the pattern Hum has come to know as yours.";
}
