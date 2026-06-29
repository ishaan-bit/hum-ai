import { type ValenceArousal } from "@hum-ai/shared-types";
import { selectMusicForTarget, type MusicTrack } from "./music";
import type { MusicVaTarget } from "./templates";

/**
 * SOUND LAB — a user-directed companion to the (passive) music_regulation intervention.
 *
 * The intervention engine decides WHEN a small music step helps and `selectMusicForTarget`
 * turns the model's valence–arousal read into a tempo/mood region + a safe invitation. The
 * Sound Lab lets the person ACT on that: it derives the same regulation DIRECTION from their
 * read, then combines it with their own taste (language · genre · flavor) into a concrete
 * music SEARCH the web app resolves to a real, embeddable track.
 *
 * Two firm separations are preserved here:
 *  - INTERNAL steer labels (settle / steady / gentle_lift / maintain / focused_momentum) are
 *    HOW the read steers; they are never shown to the user as a "genre". The user picks from
 *    real genres only (see {@link MAIN_GENRES}).
 *  - The module is SUPPORT, never treatment: the surfaced copy is reused verbatim from
 *    `selectMusicForTarget` (de Witte et al. register — "may help you unwind / support your
 *    mood"), so every Sound Lab string clears the same `@hum-ai/safety-language` screens.
 *
 * Pure + deterministic (no Date/random): the same read + preferences always build the same
 * plan, so it is unit-testable and the web layer owns the only impure step (the network call).
 */

// ── user-facing taste taxonomy (PREFERENCES, never states) ───────────────────────

/** Language lane the search is biased toward ("Surprise me" leaves it open). */
export type MusicLanguage = "Hindi" | "English" | "Surprise me";
export const MUSIC_LANGUAGES: readonly MusicLanguage[] = ["Hindi", "English", "Surprise me"];

/** The main genre the user picks. These are REAL genres — never the internal steer labels. */
export type MainMusicGenre =
  | "Bollywood"
  | "Indie"
  | "Pop"
  | "Rock"
  | "Metal"
  | "Jazz"
  | "Blues"
  | "Classical"
  | "Folk"
  | "Devotional";
export const MAIN_GENRES: readonly MainMusicGenre[] = [
  "Bollywood",
  "Indie",
  "Pop",
  "Rock",
  "Metal",
  "Jazz",
  "Blues",
  "Classical",
  "Folk",
  "Devotional",
];

/** Optional texture "flavors" layered on the genre (at most {@link MAX_FLAVORS}). */
export type MusicFlavor = "Acoustic" | "Lo-fi" | "Electronic" | "Ambient";
export const MUSIC_FLAVORS: readonly MusicFlavor[] = ["Acoustic", "Lo-fi", "Electronic", "Ambient"];
export const MAX_FLAVORS = 2;

/** A person's saved Sound Lab taste. `genre` is null until they pick one. */
export interface SoundLabPreferences {
  readonly language: MusicLanguage;
  readonly genre: MainMusicGenre | null;
  readonly flavors: readonly MusicFlavor[];
}

/** A locale-neutral starting point: open language, no genre yet, no flavors. */
export function defaultSoundLabPreferences(): SoundLabPreferences {
  return { language: "Surprise me", genre: null, flavors: [] };
}

// ── DYNAMIC FILTER TAXONOMY (language → genre → flow) ──────────────────────────────
// Not every taste combination is coherent: a Bollywood track isn't an *English*-language pick,
// "Lo-fi metal" isn't a real lane. These maps are the single source of truth for which genres a
// language can carry and which flow/textures a genre can carry, so the UI only ever offers
// SENSIBLE combinations (nonsensical ones are removed, not just discouraged). Both directions are
// HARD constraints (a coherence filter); the read's STATE then picks sensible DEFAULTS within
// what's offered (a soft preference the user can always override) — see {@link DIRECTION_DEFAULTS}.

/**
 * Which main genres a language can sensibly carry. "Surprise me" leaves the lane fully open (all
 * genres). Hindi drops the genres that are English-language lanes (Metal/Jazz/Blues); English drops
 * the India-specific lanes (Bollywood/Devotional). Classical + Folk live in both (largely
 * instrumental / cross-tradition).
 */
export const LANGUAGE_GENRES: Readonly<Record<MusicLanguage, readonly MainMusicGenre[]>> = {
  Hindi: ["Bollywood", "Indie", "Pop", "Rock", "Classical", "Folk", "Devotional"],
  English: ["Indie", "Pop", "Rock", "Metal", "Jazz", "Blues", "Classical", "Folk"],
  "Surprise me": MAIN_GENRES,
};

/**
 * Which flow/textures sit coherently on each genre. A texture that doesn't exist as a real lane for
 * a genre (lo-fi metal, electronic classical, ambient blues) is removed so the user can't assemble a
 * combination that searches to nothing meaningful.
 */
export const GENRE_FLAVORS: Readonly<Record<MainMusicGenre, readonly MusicFlavor[]>> = {
  Bollywood: ["Acoustic", "Lo-fi", "Electronic"],
  Indie: ["Acoustic", "Lo-fi", "Electronic", "Ambient"],
  Pop: ["Acoustic", "Lo-fi", "Electronic"],
  Rock: ["Acoustic", "Electronic"],
  Metal: ["Electronic", "Ambient"],
  Jazz: ["Acoustic", "Lo-fi", "Ambient"],
  Blues: ["Acoustic", "Lo-fi"],
  Classical: ["Acoustic", "Ambient", "Lo-fi"],
  Folk: ["Acoustic", "Lo-fi", "Ambient"],
  Devotional: ["Acoustic", "Ambient", "Lo-fi"],
};

/**
 * The genres + flow each STEER leans toward, most-pertinent first. These are SOFT preferences: the
 * top genre that survives the language filter becomes the default selection for the read, and the
 * default flow is the listed textures that survive the genre filter. A `settle` read leans calm
 * (Classical / Devotional / Folk), a `focused_momentum` read leans driving (Pop / Rock) — but the
 * user is free to pick any other genre the language allows (these only seed the default).
 */
export const DIRECTION_DEFAULTS: Readonly<
  Record<MusicVaTarget, { readonly genres: readonly MainMusicGenre[]; readonly flavors: readonly MusicFlavor[] }>
> = {
  settle: { genres: ["Classical", "Devotional", "Folk", "Jazz", "Indie", "Blues"], flavors: ["Ambient", "Acoustic"] },
  steady: { genres: ["Indie", "Folk", "Jazz", "Pop", "Bollywood", "Classical"], flavors: ["Lo-fi", "Acoustic"] },
  gentle_lift: { genres: ["Pop", "Indie", "Folk", "Bollywood", "Blues"], flavors: ["Acoustic"] },
  maintain: { genres: ["Indie", "Folk", "Pop", "Jazz", "Bollywood"], flavors: ["Acoustic", "Lo-fi"] },
  focused_momentum: { genres: ["Pop", "Rock", "Bollywood", "Indie", "Metal"], flavors: ["Electronic"] },
};

/** The genres a language can carry (the HARD coherence filter for the genre chips). */
export function genresForLanguage(language: MusicLanguage): readonly MainMusicGenre[] {
  return LANGUAGE_GENRES[language] ?? MAIN_GENRES;
}

/**
 * The flow/textures a genre can carry (the HARD coherence filter for the flow chips). With no genre
 * chosen yet there is nothing to constrain against, so the full set is offered.
 */
export function flavorsForGenre(genre: MainMusicGenre | null): readonly MusicFlavor[] {
  return genre ? GENRE_FLAVORS[genre] ?? MUSIC_FLAVORS : MUSIC_FLAVORS;
}

/**
 * The subset of a language's genres the read's STATE leans toward (most-pertinent first) — what the
 * UI marks as "fits your read". Always a subset of {@link genresForLanguage}; never hides the rest.
 */
export function pertinentGenres(va: ValenceArousal, language: MusicLanguage): readonly MainMusicGenre[] {
  const allowed = new Set(genresForLanguage(language));
  return DIRECTION_DEFAULTS[soundLabDirection(va)].genres.filter((g) => allowed.has(g));
}

/** The default genre for a read + language: the most-pertinent steer genre the language allows. */
export function defaultGenreForState(va: ValenceArousal, language: MusicLanguage): MainMusicGenre | null {
  const allowed = genresForLanguage(language);
  const pertinent = pertinentGenres(va, language);
  return pertinent[0] ?? allowed[0] ?? null;
}

/** The default flow for a read + genre: the steer's textures that the genre can carry (≤ MAX_FLAVORS). */
export function defaultFlavorsForState(va: ValenceArousal, genre: MainMusicGenre | null): readonly MusicFlavor[] {
  const allowed = new Set(flavorsForGenre(genre));
  return DIRECTION_DEFAULTS[soundLabDirection(va)].flavors.filter((f) => allowed.has(f)).slice(0, MAX_FLAVORS);
}

/**
 * The hum-derived DEFAULT taste for a read + language: a coherent {language, genre, flow} the UI can
 * apply the moment a language is chosen, so the user starts from a sensible state-tied selection
 * (never a blank slate) and tunes from there. Pure + deterministic.
 */
export function defaultPrefsForState(va: ValenceArousal, language: MusicLanguage): SoundLabPreferences {
  const genre = defaultGenreForState(va, language);
  return { language, genre, flavors: defaultFlavorsForState(va, genre) };
}

/**
 * Clamp a (possibly stale or hand-edited) taste back onto the coherence taxonomy: drop a genre the
 * language can't carry, and drop any flow the resulting genre can't carry. Used whenever language or
 * genre changes so an incoherent combination can never persist or reach the search. Pure.
 */
export function reconcilePreferences(prefs: SoundLabPreferences): SoundLabPreferences {
  const genre = prefs.genre && genresForLanguage(prefs.language).includes(prefs.genre) ? prefs.genre : null;
  // Flow only attaches to a genre: if the genre was dropped, the flow goes with it. De-dupe so a
  // corrupt blob can't waste a flavor slot on a repeat.
  const allowedFlavors = new Set(genre ? flavorsForGenre(genre) : []);
  const flavors = [...new Set(prefs.flavors.filter((f) => allowedFlavors.has(f)))].slice(0, MAX_FLAVORS);
  return { language: prefs.language, genre, flavors };
}

// ── read → regulation DIRECTION ──────────────────────────────────────────────────
// Same V-A thresholds the intervention layer uses (see ./states + ./index) so the Sound
// Lab steers a read the same way the passive music step would, for ANY read region.

const AROUSAL_ACTIVATED = 0.25;
const AROUSAL_POSITIVE_ENERGY = 0.3;
const VALENCE_POSITIVE = 0.2;

/**
 * The music steer for a given valence–arousal read — defined over the WHOLE V-A plane so the
 * Sound Lab always has a direction (unlike the template set, which only attaches music to a
 * few states). Mirrors the music templates' state→target mapping:
 *  - tense activation (high arousal, negative valence) → settle
 *  - subdued (low arousal, negative valence)           → gentle_lift
 *  - bright + energised (positive, high arousal)        → focused_momentum
 *  - bright + calm (positive, low arousal)              → maintain
 *  - everything mixed / neutral in between              → steady
 */
export function soundLabDirection(va: ValenceArousal): MusicVaTarget {
  const { valence, arousal } = va;
  if (arousal >= AROUSAL_ACTIVATED && valence < 0) return "settle";
  if (arousal < 0 && valence < 0) return "gentle_lift";
  if (valence >= VALENCE_POSITIVE) {
    return arousal >= AROUSAL_POSITIVE_ENERGY ? "focused_momentum" : "maintain";
  }
  return "steady";
}

/** A short, SAFE label for the steer (shown as "where this is leaning", never as a genre). */
export const DIRECTION_LABEL: Readonly<Record<MusicVaTarget, string>> = {
  settle: "Settle",
  steady: "Steady",
  gentle_lift: "Gentle lift",
  maintain: "Keep the thread",
  focused_momentum: "Momentum",
};

/**
 * Mood/descriptor words per steer, used to bias the music search. The FIRST term is the
 * primary mood that always enters the query; the rest are shown as read-only "vibe" chips so
 * the person can see what's shaping the search. Plain, non-clinical descriptors only.
 */
export const DIRECTION_TERMS: Readonly<Record<MusicVaTarget, readonly string[]>> = {
  settle: ["calm", "slow", "soothing", "unwind"],
  steady: ["steady", "mellow", "easy", "low-key"],
  gentle_lift: ["warm", "uplifting", "gentle", "feel-good"],
  maintain: ["easy", "steady groove", "warm"],
  focused_momentum: ["upbeat", "focus", "driving"],
};

// ── preference → query terms ──────────────────────────────────────────────────────

/** Search keywords for a genre (slightly enriched where the bare name searches poorly). */
function genreTerm(genre: MainMusicGenre): string {
  switch (genre) {
    case "Devotional":
      return "devotional bhajan";
    case "Classical":
      return "classical";
    default:
      return genre.toLowerCase();
  }
}

function flavorTerm(flavor: MusicFlavor): string {
  switch (flavor) {
    case "Lo-fi":
      return "lofi";
    case "Acoustic":
      return "acoustic";
    case "Electronic":
      return "electronic";
    case "Ambient":
      return "ambient";
  }
}

/** Language keyword, or "" for "Surprise me" (leave the lane open). */
function languageTerm(language: MusicLanguage): string {
  if (language === "Hindi") return "hindi";
  if (language === "English") return "english";
  return "";
}

// ── the plan ──────────────────────────────────────────────────────────────────────

/** A concrete, non-diagnostic Sound Lab plan: the steer, safe copy, and a search to resolve. */
export interface SoundLabPlan {
  /** Which steer this serves (derived from the read's V-A). */
  readonly direction: MusicVaTarget;
  /** Safe display label for the steer (never a genre). */
  readonly directionLabel: string;
  /** Qualitative tempo band, e.g. "slow (around 60–80 BPM)". */
  readonly tempoBand: string;
  /** The de-Witte-register invitation, reused verbatim from `selectMusicForTarget` (safe). */
  readonly copy: string;
  /** Plain descriptor of what the steer was derived from. */
  readonly basedOn: string;
  /** Read-only mood/vibe words shaping the search (for display chips). */
  readonly descriptors: readonly string[];
  /** The YouTube-style search the web layer resolves to a real track. */
  readonly query: string;
  /** The nearest illustrative mood/tempo PROFILE (genre + BPM) — "what kind of track". */
  readonly profile: MusicTrack | null;
}

export interface SoundLabPlanInput {
  /** The model's current valence–arousal read (both in [-1, 1]). */
  readonly va: ValenceArousal;
  readonly prefs: SoundLabPreferences;
  /**
   * An optional extra search nudge from recent feedback (e.g. "slower" after "too intense").
   * Appended to the query only; never alters the steer or the safe copy.
   */
  readonly extraTerms?: readonly string[];
}

/**
 * Build the Sound Lab plan for a read + preferences. The steer, tempo band and invitation come
 * straight from `selectMusicForTarget` (so they stay safety-screened and consistent with the
 * passive music step); only the search `query` is new. Pure + deterministic.
 */
export function planSoundLab(input: SoundLabPlanInput): SoundLabPlan {
  const direction = soundLabDirection(input.va);
  const rec = selectMusicForTarget(input.va, direction, { limit: 1 });
  // Reconcile the taste at the QUERY BOUNDARY: whatever the caller passes (live UI prefs, a stale
  // persisted blob, a hand-mutated object), an incoherent language×genre or genre×flow can never
  // reach the search. This is the single chokepoint every caller flows through, so no UI mutator can
  // leak a nonsensical combination regardless of how its own guards behave.
  const prefs = reconcilePreferences(input.prefs);
  return {
    direction,
    directionLabel: DIRECTION_LABEL[direction],
    tempoBand: rec.tempoBand,
    copy: rec.copy,
    basedOn: rec.basedOn,
    descriptors: DIRECTION_TERMS[direction],
    query: buildSoundQuery(direction, prefs, input.extraTerms),
    profile: rec.tracks[0] ?? null,
  };
}

/**
 * Compose the music search from the steer's primary mood + the user's taste (flavors → genre →
 * language) + any feedback nudge, ending in "music". Deduplicates terms so a nudge that repeats
 * the mood doesn't double it. Pure.
 */
export function buildSoundQuery(
  direction: MusicVaTarget,
  prefs: SoundLabPreferences,
  extraTerms: readonly string[] = [],
): string {
  const primaryMood = DIRECTION_TERMS[direction][0] ?? "calm";
  const parts: string[] = [primaryMood];
  for (const f of prefs.flavors) parts.push(flavorTerm(f));
  if (prefs.genre) parts.push(genreTerm(prefs.genre));
  const lang = languageTerm(prefs.language);
  if (lang) parts.push(lang);
  for (const t of extraTerms) if (t) parts.push(t);
  parts.push("music");

  // Dedupe (case-insensitive, order-preserving) so e.g. a "calm" nudge on a settle steer
  // doesn't repeat the primary mood. Tokenize so multi-word terms don't reintroduce dupes.
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    for (const word of part.split(/\s+/)) {
      const key = word.toLowerCase();
      if (!word || seen.has(key)) continue;
      seen.add(key);
      tokens.push(word);
    }
  }
  return tokens.join(" ");
}
