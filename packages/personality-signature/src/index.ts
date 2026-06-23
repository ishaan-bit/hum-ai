import { clamp, clamp01, mean, median, normalize, inverseNormalize } from "@hum-ai/shared-types";

/**
 * PERSONALITY SIGNATURE — a tentative, within-user, EXPLORATORY read of how someone's voice
 * tends to behave over many hums, mapped onto the Big Five (OCEAN) trait DIRECTIONS. It
 * foregrounds the two traits that voice/acoustic-prosodic research recovers most reliably:
 * OPENNESS to experience and CONSCIENTIOUSNESS. There is NO Myers-Briggs / 4-letter typing
 * here — that has no acoustic evidence base and was removed.
 *
 * ── Why Big Five (OCEAN), and why "exploratory" ──────────────────────────────────────────
 * "Apparent personality from voice" has a REAL but MODEST research basis: acoustic-prosodic
 * features carry weak, above-chance signal (binary accuracy ~60-80% vs 50% chance; perception
 * correlations r~0.2-0.4), the signal is uneven across traits, and most of it is PERCEIVED
 * personality (what listeners hear), which diverges from SELF-REPORT. We foreground Openness and
 * Conscientiousness for two honest reasons (see docs/research/voice-big-five.md for the cited
 * basis): (1) CONSCIENTIOUSNESS is the strongest acoustically-legible OCEAN trait on
 * perceived-personality corpora (Schuller et al. 2012 INTERSPEECH Speaker-Trait Challenge;
 * Mohammadi & Vinciarelli 2012, IEEE T-AFFC), and its cue — vocal control/evenness — transfers
 * to a hum; (2) OPENNESS is the WEAKEST trait acoustically, but its one recurring transferable
 * cue, pitch-range / melodic variation (Mairesse et al. 2007, JAIR; Song et al. 2023; Kim et al.
 * 2025), is exactly the dimension a sustained hum expresses most directly. So the DEFENSIBLE
 * substrate is the OCEAN DIRECTIONS, computed as a WITHIN-USER tendency (this person's steady
 * acoustic habits relative to the hum protocol), never a between-person verdict.
 *
 * Hums are NOT speech: lexical/disfluency/speech-rate/articulation cues do not exist here (and
 * on self-report those LINGUISTIC cues carry ~80% of the O/C signal — Lukac 2024), so the
 * mapping leans only on the prosodic/voice-quality correlates that survive in a sustained
 * vocalisation (pitch range & melodic variation -> openness; vocal control, evenness, low
 * jitter/shimmer -> conscientiousness). No study maps humming itself to Big Five, so every
 * mapping here is an explicit transfer/extrapolation, which is the deepest reason the read stays
 * "tentative".
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
  | "openness"
  | "conscientiousness"
  | "extraversion"
  | "agreeableness"
  | "emotional_stability";

/** In canonical OCEAN order; the two FOREGROUNDED traits (the best voice-recoverable) lead. */
export const BIG_FIVE_KEYS: readonly BigFiveKey[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "emotional_stability",
];

/**
 * The traits foregrounded in the surface (card lede + headline). Voice/acoustic-prosodic work
 * recovers Openness and Conscientiousness more reliably than the others, and both have a clean
 * mapping onto a sustained hum, so the read leads with them. See docs/research/voice-big-five.md.
 */
export const PRIMARY_KEYS: readonly BigFiveKey[] = ["openness", "conscientiousness"];

/** Maturity gates: a signature forms quietly, then firms up — but never beyond "tentative". */
export const EMERGING_HUMS = 5; // below this: "forming" (abstain from a primary read)
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
  /** Human-readable trait name for the card (e.g. "Openness", "Conscientiousness"). */
  readonly label: string;
  /** True for the foregrounded OCEAN traits (Openness, Conscientiousness) — see {@link PRIMARY_KEYS}. */
  readonly primary: boolean;
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
  /** All five OCEAN tendencies, ordered with the foregrounded traits (Openness, Conscientiousness) first. */
  readonly traits: readonly TraitTendency[];
  /** The two foregrounded traits (Openness, Conscientiousness), for the card lede; empty while forming. */
  readonly primaryTraits: readonly TraitTendency[];
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
  /** Human-readable OCEAN trait name shown on the card. */
  readonly label: string;
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
 * The trait definitions, in OCEAN order with the two foregrounded traits (Openness,
 * Conscientiousness) FIRST. Pole words and blurbs are deliberately warm, plain, and non-clinical
 * (e.g. "steady" / "sensitive", never "neurotic"); they are screened by the package test.
 *
 * Feature→trait mappings are grounded in the voice-personality literature (see
 * docs/research/voice-big-five.md), restricted to the prosodic/voice-quality cues that survive in
 * a sustained HUM (no lexical or speech-rate cues exist here). They remain DIRECTIONAL, within-user
 * heuristics — sensible defaults for the hum protocol, not population-calibrated regressions — which
 * is why the read stays "tentative".
 */
const TRAITS: readonly TraitDef[] = [
  {
    // OPENNESS — the WEAKEST trait acoustically, but its one recurring transferable cue is
    // melodic/pitch VARIATION: a wider pitch range and more musical, varied contour track higher
    // openness; a flat, single-note line tracks lower. (Mairesse et al. 2007 — prosodic set is the
    // best single model of openness; Song et al. 2023, Kim et al. 2025 — wider F0 range -> higher
    // perceived openness; see docs/research/voice-big-five.md.)
    key: "openness",
    label: "Openness",
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
        [safe(w, "musicalityScore"), 0.7],
        [safe(w, "vibratoRegularity"), 0.4],
      ]),
  },
  {
    // CONSCIENTIOUSNESS — the STRONGEST acoustically-legible OCEAN trait on perceived-personality
    // corpora, read via vocal CONTROL/evenness: a controlled, well-held tone with stable pitch and
    // amplitude and low micro-instability (jitter/shimmer) tracks higher conscientiousness; a loose,
    // wavering line tracks lower. The low-weight inverse-shimmer term follows Saeedi et al. 2023
    // (lower shimmer -> higher self-rated conscientiousness; fragile/clinical, so down-weighted).
    // (Schuller et al. 2012; Mohammadi & Vinciarelli 2012; Saeedi et al. 2023; voice-big-five.md.)
    key: "conscientiousness",
    label: "Conscientiousness",
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
        [safe(w, "shimmerProxy") === null ? null : inverseNormalize(safe(w, "shimmerProxy")!, 0.05, 0.5), 0.35],
      ]),
  },
  {
    key: "extraversion",
    label: "Extraversion",
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
    key: "agreeableness",
    label: "Agreeableness",
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
    label: "Emotional steadiness",
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

// ── OCEAN headline (foregrounds Openness + Conscientiousness) ───────────────────────────────
// No 4-letter typing: the read leads with the two best voice-recoverable traits. Each primary
// trait becomes a short, screen-safe clause from its lean (high→highAdj, low→lowAdj, balanced→"sits
// balanced") so the headline mirrors the card's lede.
function leanClause(label: string, t: TraitTendency, d: TraitDef): string {
  if (t.lean === "balanced") return `${label} sits balanced`;
  return `${label} leans ${t.lean === "high" ? d.highAdj : d.lowAdj}`;
}

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
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    emotional_stability: 0,
  };
  const primary = new Set<BigFiveKey>(PRIMARY_KEYS);
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
      label: d.label,
      primary: primary.has(d.key),
      blurb: lean === "high" ? d.highBlurb : lean === "low" ? d.lowBlurb : d.midBlurb,
    };
  });
  const primaryTraits = traits.filter((t) => t.primary);

  // Forming: surface the building state only — never a definite trait read.
  if (status === "forming") {
    return {
      status,
      humCount,
      traits,
      primaryTraits: [],
      headline:
        humCount === 0
          ? "Your hum signature forms as you hum — a tentative Big Five (OCEAN) read of your vocal habits, just for reflection."
          : `Your hum signature is forming · ${humCount} hum${humCount === 1 ? "" : "s"} in. A few more and a tentative read appears.`,
      lean: { dominant: null, direction: null, adjective: null, steadiness: values.emotional_stability },
      isDiagnostic: false,
    };
  }

  // Dominant lean = the trait furthest from centre (for the engine hint + descriptor).
  let dominant: TraitTendency = traits[0]!;
  for (const t of traits) if (Math.abs(t.value) > Math.abs(dominant.value)) dominant = t;
  const dom = TRAITS.find((d) => d.key === dominant.key)!;
  const adjective = dominant.lean === "low" ? dom.lowAdj : dominant.lean === "high" ? dom.highAdj : null;

  // Headline foregrounds the two primary OCEAN traits (Openness, Conscientiousness).
  const open = traits.find((t) => t.key === "openness")!;
  const consc = traits.find((t) => t.key === "conscientiousness")!;
  const openDef = TRAITS.find((d) => d.key === "openness")!;
  const conscDef = TRAITS.find((d) => d.key === "conscientiousness")!;
  const tentativeWord = status === "tentative" ? "tentative" : "early, still-forming";
  const article = status === "tentative" ? "A" : "An"; // "A tentative" vs "An early, still-forming"
  const bothBalanced = open.lean === "balanced" && consc.lean === "balanced";
  const headline = bothBalanced
    ? `${article} ${tentativeWord} read on the Big Five (OCEAN): your openness and conscientiousness sit fairly balanced so far. Exploratory only, a mirror of your voice, not a personality test.`
    : `${article} ${tentativeWord} read on the Big Five (OCEAN). In your hums, ${leanClause("openness", open, openDef)}, and ${leanClause("conscientiousness", consc, conscDef)}. Exploratory only, a mirror of your voice, not a personality test.`;

  return {
    status,
    humCount,
    traits,
    primaryTraits,
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
  for (const t of sig.traits) out.push(t.label, t.lowPole, t.highPole, t.blurb);
  return out;
}
