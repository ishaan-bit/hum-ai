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
 * INNER-STATE line — the single reflective sentence the read leads with: "right now you
 * read as …". It fuses the leading VALENCE + AROUSAL axis read with the secondary benign
 * affect lean into one plain sentence so the user sees an inner-state read, not two
 * abstract meters. Reflective and non-diagnostic (it describes how the read came out,
 * never a clinical state or a certainty), and screened at the boundary like all copy.
 *
 * The lean rides on the far-domain 6-way prior, so it is phrased tentatively ("leaning
 * toward …") and the neutral "close to your usual" head is dropped (it implies a baseline
 * that may not exist yet and adds nothing). ADR-0005 / ADR-0010.
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

  // One earned, granular observation — energy QUALIFIES the mood word (never two robot
  // meters), and the read is held as a hypothesis from inside the sentence ("if that's
  // close") rather than with a bolted-on hedge. Affect-labeling research (Lieberman/Torre):
  // a precise, specific naming is what takes the edge off, so we avoid bin labels like
  // "energized"/"stressed". Tentative + non-diagnostic; screened at the boundary.
  if (hiA && hiV) return "There's a bright, slightly buzzing energy to you right now — up, but not quite landed.";
  if (hiA && loV) return "Reads a bit wound-up — keyed up, and maybe tired of being keyed up, if that's close.";
  if (loA && hiV) return "You sound settled, like the noise finally dropped a notch.";
  if (loA && loV) return "Something feels low and slow in this one — more flat than down, maybe.";
  if (hiA) return "A restless, can't-quite-settle quality to this one.";
  if (loA) return "Quiet and even — running on a smaller flame than usual.";
  if (hiV) return "Warm and steady, nothing pushing at the edges.";
  if (loV) return "A little flat today — even-toned, but the warmth's dialled down, if that fits.";

  // Near the centre, a subtle lean from the secondary 6-way prior colours the adjective
  // (it is never named as a label — ADR-0005 keeps it tentative, not a verdict).
  if (affectHint === "anxiety_like_tension")
    return "Mostly even, with a faint thread of tension running under it, if that fits.";
  if (affectHint === "sadness_low_mood")
    return "Even-keeled, though it sits a touch on the quiet side today.";
  if (affectHint === "fatigue_low_recovery")
    return "Steady enough, but it sounds like there isn't a lot in reserve right now.";
  return "Fairly steady and even — nothing loud in either direction.";
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
