import { clamp, clamp01, mean, median, normalize, inverseNormalize } from "@hum-ai/shared-types";

/**
 * PERSONALITY SIGNATURE — a tentative, within-user, EXPLORATORY read of how someone's voice
 * tends to behave over many hums, mapped onto the Big Five (OCEAN) trait directions and a
 * playful 4-letter "hum type" overlay.
 *
 * ── Why Big Five (not raw MBTI), and why "exploratory" ───────────────────────────────────
 * "Apparent personality from speech" has a real but LIMITED research basis (acoustic-prosodic
 * features carry weak, above-chance signal for trait impressions; Mairesse et al. 2007;
 * INTERSPEECH Speaker-Trait paralinguistics work). Pure Myers-Briggs typing from voice has no
 * sound evidence. So the DEFENSIBLE substrate here is the Big Five DIRECTIONS, computed as a
 * within-user tendency (this person's steady acoustic habits), and the 4-letter type is an
 * explicitly playful OVERLAY derived from those tendencies — never presented as a verdict.
 *
 * This module honours the platform's non-clinical, anti-overclaim ethos:
 *   - it ABSTAINS until enough hums exist (a signature is "forming" below {@link EMERGING_HUMS}),
 *   - confidence is capped qualitatively at "tentative" — it never claims certainty,
 *   - it carries NO clinical label and NO raw number in user copy (every string is screen-safe),
 *   - it is a MIRROR of vocal habits, not a personality test.
 *
 * It is pure (no DOM, no I/O) and reads only DERIVED acoustic feature windows (the longitudinal
 * baseline), so it adds no new privacy surface — raw audio never reaches here.
 */

/** The five trait axes (Big Five / OCEAN). `emotional_stability` is the reverse of neuroticism. */
export type BigFiveKey =
  | "extraversion"
  | "openness"
  | "conscientiousness"
  | "agreeableness"
  | "emotional_stability";

export const BIG_FIVE_KEYS: readonly BigFiveKey[] = [
  "extraversion",
  "openness",
  "conscientiousness",
  "agreeableness",
  "emotional_stability",
];

/** Maturity gates: a signature forms quietly, then firms up — but never beyond "tentative". */
export const EMERGING_HUMS = 5; // below this: "forming" (abstain from a type)
export const TENTATIVE_HUMS = 12; // at/above this: the steadiest read we'll offer

export type SignatureStatus = "forming" | "emerging" | "tentative";

/** A single trait tendency in [-1, 1], with safe pole words and a coarse lean. */
export interface TraitTendency {
  readonly key: BigFiveKey;
  /** Within-user tendency in [-1, 1] (negative = low pole, positive = high pole). */
  readonly value: number;
  readonly lowPole: string;
  readonly highPole: string;
  readonly lean: "low" | "balanced" | "high";
  /** One plain, screen-safe phrase describing this lean (no clinical terms, no numbers). */
  readonly blurb: string;
}

/** A compact, engine-side hint other layers can adapt to (e.g. intervention copy). */
export interface PersonalityLean {
  /** The most pronounced trait (largest |value|), or null when forming. */
  readonly dominant: BigFiveKey | null;
  /** Direction of the dominant lean. */
  readonly direction: "low" | "high" | null;
  /** A safe adjective for the dominant lean (e.g. "expressive", "steady"). */
  readonly adjective: string | null;
  /** Emotional-steadiness tendency in [-1,1] (used to pick gentler vs. brisker framing). */
  readonly steadiness: number;
}

export interface PersonalitySignature {
  readonly status: SignatureStatus;
  readonly humCount: number;
  readonly traits: readonly TraitTendency[];
  /** Playful 4-letter overlay (e.g. "ENFP"), or null while forming. */
  readonly type: string | null;
  readonly typeNickname: string | null;
  readonly typeBlurb: string | null;
  /** One screen-safe summary line for the card header. */
  readonly headline: string;
  readonly lean: PersonalityLean;
  /** Structural assertion: this is exploratory self-reflection, never a clinical/diagnostic claim. */
  readonly isDiagnostic: false;
}

// ── feature → trait mapping ──────────────────────────────────────────────────────────────
// Directional, within-user heuristics over robust per-feature centres. Ranges are sensible
// defaults for the hum protocol (NOT population-calibrated) — this is why the read stays
// "tentative". Each contribution is normalised to [0,1]; a trait is the weighted blend,
// re-centred to [-1,1]. Missing features simply drop out (weights renormalise).

const safe = (windows: Record<string, readonly number[]>, key: string): number | null => {
  const arr = windows[key];
  if (!arr || arr.length === 0) return null;
  const vals = arr.filter((x) => Number.isFinite(x));
  return vals.length ? median(vals) : null;
};

/** A weighted blend of normalised contributions; null contributions are skipped. */
function blend(parts: ReadonlyArray<readonly [number | null, number]>): number {
  let sum = 0;
  let w = 0;
  for (const [v, weight] of parts) {
    if (v === null) continue;
    sum += clamp01(v) * weight;
    w += weight;
  }
  if (w === 0) return 0.5; // no evidence → centred
  return sum / w;
}

const toBipolar = (x: number): number => clamp(x * 2 - 1, -1, 1);

interface TraitDef {
  readonly key: BigFiveKey;
  readonly lowPole: string;
  readonly highPole: string;
  readonly lowBlurb: string;
  readonly highBlurb: string;
  readonly midBlurb: string;
  /** The dominant-lean adjective surfaced to other layers, per direction. */
  readonly lowAdj: string;
  readonly highAdj: string;
  readonly compute: (w: Record<string, readonly number[]>) => number; // → [0,1]
}

/**
 * The trait definitions. Pole words and blurbs are deliberately warm, plain, and non-clinical
 * (e.g. "steady" / "sensitive", never "neurotic"); they are screened by the package test.
 */
const TRAITS: readonly TraitDef[] = [
  {
    key: "extraversion",
    lowPole: "reserved",
    highPole: "outgoing",
    lowAdj: "reserved",
    highAdj: "expressive",
    lowBlurb: "Your hums tend to run quieter and more inward — an even, unhurried voice.",
    highBlurb: "Your hums tend to come out full and energetic — an outgoing, present voice.",
    midBlurb: "Your hums sit between quiet and outgoing — neither held back nor pushed forward.",
    compute: (w) =>
      blend([
        [safe(w, "meanRms") === null ? null : normalize(safe(w, "meanRms")!, 0.04, 0.25), 1.0],
        [safe(w, "peakAmplitude") === null ? null : normalize(safe(w, "peakAmplitude")!, 0.1, 0.7), 0.7],
        [safe(w, "activeFrameRatio") === null ? null : normalize(safe(w, "activeFrameRatio")!, 0.4, 0.95), 0.6],
        [safe(w, "spectralCentroidHz") === null ? null : normalize(safe(w, "spectralCentroidHz")!, 600, 1400), 0.4],
      ]),
  },
  {
    key: "openness",
    lowPole: "grounded",
    highPole: "exploratory",
    lowAdj: "grounded",
    highAdj: "exploratory",
    lowBlurb: "Your hums hold close to one note — you settle into a simple, grounded line.",
    highBlurb: "Your hums wander and vary in pitch — a curious, exploratory streak.",
    midBlurb: "Your hums mix steadiness with a little wander — grounded, but open to variation.",
    compute: (w) =>
      blend([
        [safe(w, "pitchRangeSemitones") === null ? null : normalize(safe(w, "pitchRangeSemitones")!, 0.3, 4), 1.0],
        [safe(w, "musicalityScore"), 0.6],
        [safe(w, "vibratoRegularity"), 0.4],
      ]),
  },
  {
    key: "conscientiousness",
    lowPole: "spontaneous",
    highPole: "deliberate",
    lowAdj: "spontaneous",
    highAdj: "deliberate",
    lowBlurb: "Your hums are loose and spontaneous — you let the note do what it does.",
    highBlurb: "Your hums are controlled and even — a deliberate, well-held tone.",
    midBlurb: "Your hums balance control and ease — held, but not rigid.",
    compute: (w) =>
      blend([
        [safe(w, "controlledExpressionScore"), 1.0],
        [safe(w, "amplitudeStability") === null ? null : normalize(safe(w, "amplitudeStability")!, 0.5, 0.99), 0.8],
        [safe(w, "pitchStability") === null ? null : normalize(safe(w, "pitchStability")!, 0.6, 0.99), 0.8],
        [safe(w, "residualInstabilityScore") === null ? null : inverseNormalize(safe(w, "residualInstabilityScore")!, 0.1, 0.6), 0.6],
      ]),
  },
  {
    key: "agreeableness",
    lowPole: "direct",
    highPole: "warm",
    lowAdj: "direct",
    highAdj: "warm",
    lowBlurb: "Your hums have a plain, direct edge — clear and to the point.",
    highBlurb: "Your hums carry a soft, warm tone — rounded and easy on the ear.",
    midBlurb: "Your hums land between plain and warm — clear, with a gentle edge.",
    compute: (w) =>
      blend([
        [safe(w, "smoothnessScore"), 1.0],
        [safe(w, "spectralCentroidHz") === null ? null : inverseNormalize(safe(w, "spectralCentroidHz")!, 700, 1600), 0.7],
        [safe(w, "breathinessProxy") === null ? null : inverseNormalize(safe(w, "breathinessProxy")!, 0.1, 0.7), 0.4],
      ]),
  },
  {
    key: "emotional_stability",
    lowPole: "sensitive",
    highPole: "steady",
    lowAdj: "sensitive",
    highAdj: "steady",
    lowBlurb: "Your hums shift and waver a little more — a sensitive, responsive voice.",
    highBlurb: "Your hums hold remarkably even — a steady, settled voice.",
    midBlurb: "Your hums are mostly even, with a little natural movement.",
    compute: (w) =>
      blend([
        [safe(w, "jitter") === null ? null : inverseNormalize(safe(w, "jitter")!, 0.005, 0.05), 0.9],
        [safe(w, "shimmerProxy") === null ? null : inverseNormalize(safe(w, "shimmerProxy")!, 0.05, 0.5), 0.7],
        [safe(w, "residualPitchInstability") === null ? null : inverseNormalize(safe(w, "residualPitchInstability")!, 0.05, 0.6), 0.7],
        [safe(w, "amplitudeStability") === null ? null : normalize(safe(w, "amplitudeStability")!, 0.5, 0.99), 0.6],
      ]),
  },
];

const leanOf = (value: number): "low" | "balanced" | "high" =>
  value >= 0.22 ? "high" : value <= -0.22 ? "low" : "balanced";

// ── playful 4-letter "hum type" overlay ───────────────────────────────────────────────────
// The conventional Big-Five → MBTI bridges: E/I←Extraversion, N/S←Openness, F/T←Agreeableness,
// J/P←Conscientiousness. Emotional stability has no letter (it colours the "steady↔sensitive"
// descriptor instead). This is a FUN reflection, not a typology claim.
function humType(traits: Record<BigFiveKey, number>): { type: string; nickname: string; blurb: string } {
  const e = traits.extraversion >= 0 ? "E" : "I";
  const n = traits.openness >= 0 ? "N" : "S";
  const f = traits.agreeableness >= 0 ? "F" : "T";
  const j = traits.conscientiousness >= 0 ? "J" : "P";
  const type = `${e}${n}${f}${j}`;
  const nickname = TYPE_NICKNAME[type] ?? "the Hummer";
  const blurb = `A playful read of your hum habits — explore it, don't take it to heart.`;
  return { type, nickname, blurb };
}

/** Light, friendly nicknames per 4-letter overlay (all screen-safe). */
const TYPE_NICKNAME: Readonly<Record<string, string>> = {
  ENFJ: "the Warm Conductor", ENFP: "the Bright Wanderer", ENTJ: "the Steady Driver", ENTP: "the Restless Spark",
  ESFJ: "the Open Host", ESFP: "the Free Singer", ESTJ: "the Plain Anchor", ESTP: "the Quick Mover",
  INFJ: "the Quiet Tuner", INFP: "the Inward Dreamer", INTJ: "the Careful Planner", INTP: "the Curious Drifter",
  ISFJ: "the Gentle Keeper", ISFP: "the Soft Improviser", ISTJ: "the Even Keel", ISTP: "the Calm Tinkerer",
};

/**
 * Assess the within-user personality signature from longitudinal acoustic feature windows
 * (the personal baseline's `featureWindows`). `humCount` is the number of eligible hums that
 * fed those windows — it gates how firmly we read the signature.
 */
export function assessPersonalitySignature(
  featureWindows: Record<string, readonly number[]>,
  humCount: number,
): PersonalitySignature {
  const status: SignatureStatus =
    humCount < EMERGING_HUMS ? "forming" : humCount < TENTATIVE_HUMS ? "emerging" : "tentative";

  const values: Record<BigFiveKey, number> = {
    extraversion: 0,
    openness: 0,
    conscientiousness: 0,
    agreeableness: 0,
    emotional_stability: 0,
  };
  const traits: TraitTendency[] = TRAITS.map((d) => {
    const value = toBipolar(d.compute(featureWindows));
    values[d.key] = value;
    const lean = leanOf(value);
    return {
      key: d.key,
      value,
      lowPole: d.lowPole,
      highPole: d.highPole,
      lean,
      blurb: lean === "high" ? d.highBlurb : lean === "low" ? d.lowBlurb : d.midBlurb,
    };
  });

  // Forming: surface the building state only — never a type or a definite trait read.
  if (status === "forming") {
    return {
      status,
      humCount,
      traits,
      type: null,
      typeNickname: null,
      typeBlurb: null,
      headline:
        humCount === 0
          ? "Your hum signature forms as you hum — a tentative read of your vocal habits, just for reflection."
          : `Your hum signature is forming · ${humCount} hum${humCount === 1 ? "" : "s"} in. A few more and a tentative read appears.`,
      lean: { dominant: null, direction: null, adjective: null, steadiness: values.emotional_stability },
      isDiagnostic: false,
    };
  }

  // Dominant lean = the trait furthest from centre (for the engine hint + headline).
  let dominant: TraitTendency = traits[0]!;
  for (const t of traits) if (Math.abs(t.value) > Math.abs(dominant.value)) dominant = t;
  const dom = TRAITS.find((d) => d.key === dominant.key)!;
  const adjective = dominant.lean === "low" ? dom.lowAdj : dominant.lean === "high" ? dom.highAdj : null;

  const { type, nickname, blurb } = humType(values);
  const tentativeWord = status === "tentative" ? "tentative" : "early, still-forming";
  const headline =
    adjective !== null
      ? `A ${tentativeWord} read: your hums lean ${adjective}. Exploratory — a mirror of your voice, not a personality test.`
      : `A ${tentativeWord} read of your hum habits — fairly balanced so far. Exploratory only.`;

  return {
    status,
    humCount,
    traits,
    type,
    typeNickname: nickname,
    typeBlurb: blurb,
    headline,
    lean: {
      dominant: dominant.key,
      direction: dominant.lean === "balanced" ? null : dominant.lean,
      adjective,
      steadiness: values.emotional_stability,
    },
    isDiagnostic: false,
  };
}

/** Every user-facing string a signature can surface — for the safety-language screen + tests. */
export function personalitySignatureStrings(sig: PersonalitySignature): string[] {
  const out = [sig.headline];
  for (const t of sig.traits) out.push(t.lowPole, t.highPole, t.blurb);
  if (sig.typeNickname) out.push(sig.typeNickname);
  if (sig.typeBlurb) out.push(sig.typeBlurb);
  return out;
}
