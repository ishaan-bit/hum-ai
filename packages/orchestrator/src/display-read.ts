import { clamp, median, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";
import type { AxisRead, AxisResolution } from "./axis-read";

/**
 * WITHIN-USER RE-REFERENCING OF THE DISPLAYED READ — the fix for the "tense and
 * wound-up every single hum" pin.
 *
 * The transparent acoustic axis read (`acousticAffectAxes`) maps a hum's DSP features
 * to valence/arousal through ONE population-absolute normalization. The problem this
 * solves: for a *given* person on a *given* mic, those absolute features barely move
 * hum-to-hum — a low-voiced hummer always sits near the bottom of the 95–260 Hz pitch
 * band, a steady held tone always has a tiny melodic range, a bright/noisy mic always
 * inflates arousal. So the absolute read carries a large, fixed PERSON+MIC OFFSET that
 * swamps the small within-user variation that actually tracks mood. Every hum lands in
 * the same zone (validated: across five wildly different felt moods the same person+mic
 * moved valence only ~0.2 and never changed zone).
 *
 * Mood lives in how a hum departs from *that person's own usual*, not in its absolute
 * acoustic coordinates. So the DISPLAYED read is re-referenced against the user's own
 * recent acoustic distribution: subtract their personal centre (removes the offset),
 * scale by their personal spread (amplifies the real within-user signal), and squash
 * back into [-1,1]. A hum that is brighter/livelier than usual *for them* reads bright;
 * one that is flatter than usual reads low — regardless of their fixed voice/mic colour.
 *
 * This is the same honesty class as the diary's personal-normal band ("different always
 * means different *for you*") and the personalization layer's re-reference — just applied
 * to the headline read the user actually sees, which the personalization damp-toward-origin
 * step never did.
 *
 * DISCIPLINE:
 *  - It never manufactures affect: with no/too-little personal history the blend weight is
 *    0 and the absolute acoustic read passes through UNCHANGED (honest cold start — we
 *    cannot know someone's usual from one hum). Influence ramps with history, mirroring the
 *    personalization ladder.
 *  - The transparent `acousticValue` on each axis is PRESERVED as provenance; only the
 *    surfaced `value` / `dimensional` are re-referenced.
 *  - Pure + deterministic. The current hum is referenced against PAST hums only (its own
 *    value is never in the centre/spread it is measured against).
 */

/** A recent within-user acoustic axis read (most-recent last). Raw acoustic values only. */
export type AcousticAxisSample = ValenceArousal;

/** Below this many prior hums we cannot know the user's usual — pass the absolute read through. */
export const REREF_MIN_HISTORY = 3;
/**
 * At/above this many prior hums the within-user re-reference reaches full strength.
 * v13.1: tightened 12→8. The re-reference is what cancels the fixed per-person+mic loudness/register
 * offset; until it ramps in, the displayed read is the raw acoustic backbone, which sits low for a
 * gentle hummer (see `axis-read` AROUSAL_RMS recalibration). A probe of an established quiet hummer
 * confirmed the re-reference fully re-centres the read (subdued/usual/lively → −0.47/+0.07/+0.84) —
 * the only gap was how many hums it took to engage. Reaching full strength by hum 8 (not 12) shortens
 * the cold-start window where every read still reads subdued, without changing the converged behaviour.
 */
export const REREF_FULL_HISTORY = 8;
/** Cap on the re-reference weight — the absolute acoustic read always keeps a real say. */
export const REREF_MAX_WEIGHT = 0.85;
/** Tanh gain on the z-score: how strongly a personal deviation opens up the displayed range. */
export const REREF_GAIN = 1.15;
/** Floor on the personal spread (robust σ) so a very consistent hummer can't divide-by-tiny. */
export const REREF_SPREAD_FLOOR = 0.1;

/** Median absolute deviation → robust σ (×1.4826), with a visible floor. */
function robustSpread(values: readonly number[], centre: number): number {
  if (values.length === 0) return REREF_SPREAD_FLOOR;
  const mad = median(values.map((v) => Math.abs(v - centre)));
  return Math.max(mad * 1.4826, REREF_SPREAD_FLOOR);
}

/** How much the within-user re-reference is trusted, given how many prior hums back it. */
export function reReferenceWeight(historyLength: number): UnitInterval {
  if (historyLength < REREF_MIN_HISTORY) return 0;
  const t = Math.min(1, (historyLength - REREF_MIN_HISTORY) / (REREF_FULL_HISTORY - REREF_MIN_HISTORY));
  return REREF_MAX_WEIGHT * t;
}

export interface AxisReReference {
  /** The re-referenced value to display, in [-1,1]. */
  readonly value: number;
  /** Whether the re-reference actually engaged (false ⇒ value === acoustic). */
  readonly applied: boolean;
  /** The user's personal centre for this axis (median of prior acoustic reads). */
  readonly centre: number;
  /** The user's personal spread (robust σ) for this axis. */
  readonly spread: number;
  /** Effective blend weight used. */
  readonly weight: UnitInterval;
}

/**
 * Re-reference ONE axis value against the user's own recent acoustic distribution.
 * `history` is the user's PRIOR acoustic reads on this axis (the current hum excluded).
 */
export function reReferenceAxis(acoustic: number, history: readonly number[]): AxisReReference {
  const weight = reReferenceWeight(history.length);
  if (weight <= 0) {
    return { value: acoustic, applied: false, centre: 0, spread: REREF_SPREAD_FLOOR, weight: 0 };
  }
  const centre = median(history);
  const spread = robustSpread(history, centre);
  const z = (acoustic - centre) / spread;
  const referenced = Math.tanh(REREF_GAIN * z); // personal deviation, opened into the full range
  const value = clamp(acoustic * (1 - weight) + referenced * weight, -1, 1);
  return { value, applied: true, centre, spread, weight };
}

/** Carry the re-referenced value into an axis resolution, preserving its acoustic provenance + confidence. */
function withDisplayValue(res: AxisResolution, value: number): AxisResolution {
  return { ...res, value };
}

/**
 * Produce the DISPLAYED axis read: the acoustic read re-referenced against the user's own
 * recent acoustic history. With too little history this returns the input read unchanged
 * (the absolute acoustic read is the honest cold-start). The transparent `acousticValue`
 * on each axis is preserved.
 */
export function reReferenceDisplayRead(
  read: AxisRead,
  history: readonly AcousticAxisSample[] | undefined,
): AxisRead {
  if (!history || history.length < REREF_MIN_HISTORY) return read;
  // Re-reference against the RAW acoustic backbone of each axis, so a per-person+mic offset
  // present in `acousticValue` is what gets cancelled (not a value already shifted by another
  // layer). The current hum is not in `history`, so it is measured against its own past.
  const v = reReferenceAxis(read.valence.acousticValue, history.map((h) => h.valence));
  const a = reReferenceAxis(read.arousal.acousticValue, history.map((h) => h.arousal));
  if (!v.applied && !a.applied) return read;
  return {
    ...read,
    dimensional: { valence: v.value, arousal: a.value },
    valence: withDisplayValue(read.valence, v.value),
    arousal: withDisplayValue(read.arousal, a.value),
  };
}
