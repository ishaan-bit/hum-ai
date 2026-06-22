import { clamp, vaDistance, type ValenceArousal } from "@hum-ai/shared-types";
import type { MusicVaTarget } from "./templates";

/**
 * MUSIC RECOMMENDATION — derived from the model's valence–arousal read.
 *
 * The intervention engine already decides WHEN music helps (the `music_regulation`
 * templates + their `musicTarget` steer). This module turns that decision plus the
 * model's V-A coordinates into a concrete, non-diagnostic recommendation: a tempo/mood
 * region and one or two illustrative track profiles to "take a moment with".
 *
 * Grounding + guardrails (MUSIC_INTERVENTION_REQUIREMENTS.md, de Witte et al. 2020/2025;
 * ADR-0005/0006/0008):
 *  - SUPPORT only. Music is framed as "may help you unwind / support your mood", never as
 *    treatment, stress reduction, or anything clinical. Every string here is screened by the
 *    intervention-of-day safety check (`assertInterventionOfDaySafe`).
 *  - Slow tempo (~60–80 BPM) is applied as a SOFT preference for settling (trend in de Witte),
 *    never as a hard or therapeutic claim.
 *  - The catalog is a small ILLUSTRATIVE seed of mood/tempo PROFILES (not specific licensed
 *    tracks): the recommendation is a region + character matched to the user's V-A, not a
 *    claim about any one song's effect.
 *  - Caller gates this on sufficient confidence (≥ the medium evidence band) before attaching.
 *
 * V-A convention: valence and arousal are both in [-1, 1] (the system-wide `ValenceArousal`
 * space), NOT the 0..1 arousal of the source spec — kept consistent with the rest of the engine.
 */

export interface MusicTrack {
  readonly id: string;
  /** A descriptive mood/tempo PROFILE (not a specific licensed track). */
  readonly title: string;
  readonly genre: string;
  /** Tempo in beats per minute (a tempo, never a confidence figure). */
  readonly bpm: number;
  /** Where this profile sits in V-A space, both in [-1, 1]. */
  readonly valence: number;
  readonly arousal: number;
}

export interface MusicRecommendation {
  /** Which steer this serves (mirrors the chosen template's musicTarget). */
  readonly target: MusicVaTarget;
  /** Qualitative tempo band, e.g. "slow (around 60–80 BPM)". Safe to surface. */
  readonly tempoBand: string;
  /** One or two illustrative profiles nearest the steered V-A region. */
  readonly tracks: readonly MusicTrack[];
  /** A non-diagnostic invitation (allowed register from MUSIC_INTERVENTION_REQUIREMENTS §4). */
  readonly copy: string;
  /** Plain descriptor of what the match was derived from. */
  readonly basedOn: string;
}

/**
 * Illustrative seed catalog — mood/tempo profiles spanning the V-A space and 60–120 BPM.
 * Intentionally generic (no licensed track names); a real catalog would carry the same
 * `{ valence, arousal, bpm, genre }` metadata the recommender matches on.
 */
export const SEED_MUSIC_CATALOG: readonly MusicTrack[] = [
  { id: "soft_soundscape", title: "Soft nature soundscape", genre: "ambient", bpm: 60, valence: 0.1, arousal: -0.8 },
  { id: "slow_ambient", title: "Slow ambient pads", genre: "ambient", bpm: 64, valence: 0.2, arousal: -0.7 },
  { id: "calm_piano", title: "Calm solo piano", genre: "neoclassical", bpm: 70, valence: 0.3, arousal: -0.6 },
  { id: "steady_lofi", title: "Steady lo-fi beat", genre: "lo-fi", bpm: 82, valence: 0.1, arousal: -0.3 },
  { id: "warm_acoustic", title: "Warm acoustic guitar", genre: "acoustic", bpm: 86, valence: 0.4, arousal: -0.2 },
  { id: "mellow_jazz", title: "Mellow jazz", genre: "jazz", bpm: 90, valence: 0.3, arousal: -0.05 },
  { id: "gentle_folk", title: "Gentle folk", genre: "folk", bpm: 94, valence: 0.4, arousal: 0.05 },
  { id: "soft_indie", title: "Soft indie", genre: "indie", bpm: 98, valence: 0.5, arousal: 0.15 },
  { id: "bright_pop", title: "Bright, easy pop", genre: "pop", bpm: 108, valence: 0.6, arousal: 0.4 },
  { id: "upbeat_focus", title: "Upbeat focus instrumental", genre: "electronic", bpm: 116, valence: 0.4, arousal: 0.5 },
];

interface Steer {
  /** Destination region to match tracks against (a function of the current V-A). */
  readonly dest: (current: ValenceArousal) => ValenceArousal;
  /** Preferred BPM window (soft). */
  readonly bpm: readonly [number, number];
  readonly tempoBand: string;
  readonly copy: string;
}

// Per-target steer goals. Destinations are where music gently nudges TO (regulation only).
const STEER: Readonly<Record<MusicVaTarget, Steer>> = {
  settle: {
    dest: () => ({ valence: 0.3, arousal: -0.6 }),
    bpm: [60, 80],
    tempoBand: "slow (around 60–80 BPM)",
    copy: "Music that may help you unwind — slow-tempo tracks are often associated with winding down.",
  },
  steady: {
    dest: () => ({ valence: 0.0, arousal: -0.3 }),
    bpm: [70, 92],
    tempoBand: "steady (around 70–90 BPM)",
    copy: "A steady, low-key track to take a moment with.",
  },
  gentle_lift: {
    dest: () => ({ valence: 0.4, arousal: 0.05 }),
    bpm: [82, 104],
    tempoBand: "easy mid-tempo (around 80–100 BPM)",
    copy: "Something warm that can gently support your mood, if you'd like a small lift.",
  },
  maintain: {
    dest: (cur) => ({ valence: clamp(cur.valence, 0, 1), arousal: cur.arousal }),
    bpm: [80, 108],
    tempoBand: "matched to your steady mood",
    copy: "Music to match and keep the steady mood you're in.",
  },
  focused_momentum: {
    dest: () => ({ valence: 0.4, arousal: 0.45 }),
    bpm: [100, 120],
    tempoBand: "upbeat (around 100–120 BPM)",
    copy: "An upbeat track to take into the thing you want to start.",
  },
};

/** Soft, normalized penalty for sitting outside the preferred BPM window. */
const bpmPenalty = (bpm: number, [lo, hi]: readonly [number, number]): number => {
  if (bpm < lo) return (lo - bpm) / 40;
  if (bpm > hi) return (bpm - hi) / 40;
  return 0;
};

export interface MusicSelectOptions {
  /** How many illustrative tracks to return (default 2). */
  readonly limit?: number;
  /** Override the catalog (tests / a real catalog). Defaults to {@link SEED_MUSIC_CATALOG}. */
  readonly catalog?: readonly MusicTrack[];
}

/**
 * Recommend music for the chosen `target` given the model's current V-A read. Maps the
 * steer's destination region + a soft BPM preference onto the catalog and returns the
 * nearest one or two profiles. Pure + deterministic (stable tie-break by id) — no Date/random.
 */
export function selectMusicForTarget(
  current: ValenceArousal,
  target: MusicVaTarget,
  opts: MusicSelectOptions = {},
): MusicRecommendation {
  const steer = STEER[target];
  const dest = steer.dest(current);
  const catalog = opts.catalog ?? SEED_MUSIC_CATALOG;
  const limit = Math.max(1, opts.limit ?? 2);

  const ranked = [...catalog]
    .map((t) => ({
      t,
      score: vaDistance({ valence: t.valence, arousal: t.arousal }, dest) + 0.15 * bpmPenalty(t.bpm, steer.bpm),
    }))
    .sort((a, b) => a.score - b.score || a.t.id.localeCompare(b.t.id));

  return {
    target,
    tempoBand: steer.tempoBand,
    tracks: ranked.slice(0, limit).map((r) => r.t),
    copy: steer.copy,
    basedOn: "your hum's energy and how settled it sounded",
  };
}
