/**
 * WITHIN-HUM TEMPORAL READ — turn the change-point chunks of one hum into an
 * inner-state TRAJECTORY (Stable Build v12).
 *
 * `@hum-ai/audio-features` `analyzeTemporalDynamics` tracks the mood-variable
 * parameters live across the hum and cuts it into MEANINGFUL chunks at the points it
 * actually shifts (a swell, a settle, a phrase change). This module reads each chunk
 * with the SAME transparent acoustic V/A backbone the whole-hum read uses
 * (`acousticAffectAxes`), then predicts the inner state from the CHUNK-TO-CHUNK
 * VARIATIONS — exactly the signal the design brief calls for: not the average of the
 * hum, but how it moved.
 *
 * Research grounding (see `temporal.ts` for citations):
 *   - declining energy across the hum → waning/withdrawing; sustained/rising → present.
 *   - rising arousal/F0 across the hum → activating/winding-up; falling → settling.
 *   - instability (jitter/shimmer) settling across chunks → self-regulation; growing
 *     → building agitation.
 *   - the number of decisive shifts is itself a signal: a steady hum stays ONE chunk.
 *
 * Honesty + trait-decoupling. Every per-chunk value is a within-hum quantity and every
 * comparison is chunk-to-chunk WITHIN the same hum, so a husky vs bright voice can
 * never manufacture a trajectory (the v11 contract holds for free). The trajectory is
 * a reflective, NON-diagnostic surfaced layer — it complements the whole-hum read, it
 * does not silently rewrite the V/A backbone. All copy passes `@hum-ai/safety-language`.
 */
import { clamp, clamp01, mean, normalize, rangePosition, type RangeStats } from "@hum-ai/shared-types";
import type { AcousticFeatures, TemporalAnalysis } from "@hum-ai/audio-features";
import { acousticAffectAxes, AROUSAL_RMS_LO, AROUSAL_RMS_HI } from "./axis-read";

/**
 * A per-feature LONGITUDINAL vocal-range model (feature → the user's robust reachable span),
 * threaded in from `@hum-ai/personalization-engine`'s `vocal_range_vector`. Typed structurally
 * here so the orchestrator stays decoupled from the personalization package's class surface.
 */
export type FeatureRange = Record<string, RangeStats>;

/** The qualitative within-hum trajectory class predicted from chunk-to-chunk change. */
export type TemporalShape =
  | "steady" // never decisively shifted — one chunk
  | "settling" // arousal/instability eased across chunks (down-regulation)
  | "winding_up" // arousal/agitation rose across chunks
  | "brightening" // valence lifted across chunks
  | "fading" // energy waned across chunks (withdrawing)
  | "unsettled"; // moved a lot with no clean direction

/**
 * How a chunk DIFFERS from the one before it (Stable Build v13). The design brief is explicit
 * that "chunks formed might differ from each other MUSICALLY or they can be INNER-STATE
 * indicators" — a hum can change because the person hummed a different phrase/note/timbre
 * (musical) or because their felt state shifted (energy / arousal / steadiness). We separate the
 * two by which family of WITHIN-HUM differences dominates the transition into this chunk.
 *   - `opening`  the first chunk (nothing precedes it).
 *   - `musical`  differs mainly in pitch register/contour / brightness / melodic movement.
 *   - `state`    differs mainly in energy / arousal / valence / steadiness — an inner-state shift.
 *   - `steady`   no decisive difference from the previous chunk.
 */
export type ChunkKind = "opening" | "musical" | "state" | "steady";

/** Whether the hum's chunks differ mostly musically, as inner-state shifts, both, or not at all. */
export type VariationMode = "steady" | "musical" | "inner_state" | "mixed";

/** One chunk's read — its own V/A + energy, plus where it sits in the hum and how it differs. */
export interface SegmentRead {
  readonly index: number;
  readonly startSec: number;
  readonly endSec: number;
  /** Transparent acoustic valence for this chunk, [-1,1]. */
  readonly valence: number;
  /** Transparent acoustic arousal for this chunk, [-1,1]. */
  readonly arousal: number;
  /** Perceptual (log) loudness of this chunk, [0,1]. */
  readonly energy: number;
  /** How much clear, voiced signal this chunk carried, [0,1]. */
  readonly signalStrength: number;
  /** How this chunk DIFFERS from the previous one (musical vs inner-state vs steady). */
  readonly kind: ChunkKind;
  /**
   * Where this chunk's loudness sits in the user's OWN longitudinal vocal range, [0,1] (low edge →
   * 0, high edge → 1), or null when the range is not yet trustworthy. The absolute-but-personal
   * reference the longitudinal layer supplies — refined each hum.
   */
  readonly energyInRange: number | null;
}

/** The full within-hum temporal read — surfaced + persisted. */
export interface TemporalRead {
  readonly temporalMode: string;
  readonly segmentCount: number;
  readonly segments: readonly SegmentRead[];
  readonly boundarySec: readonly number[];
  /** Net first→last change in valence, [-2,2]. */
  readonly valenceArc: number;
  /** Net first→last change in arousal, [-2,2]. */
  readonly arousalArc: number;
  /** Net first→last change in perceptual energy, [-1,1]. */
  readonly energyArc: number;
  /** Trend of within-chunk instability across chunks (slope; <0 = settling). */
  readonly instabilityTrend: number;
  /** Mean chunk-to-chunk movement magnitude in V/A space + fragmentation, [0,~]. */
  readonly volatility: number;
  readonly shape: TemporalShape;
  /** Whether the chunks differ mostly MUSICALLY, as INNER-STATE shifts, both, or not at all (v13). */
  readonly variationMode: VariationMode;
  /** Qualitative — never a number. */
  readonly confidence: "clear" | "tentative";
  /** Reflective one-liner (safety-screened by the orchestrator with the rest of copy). */
  readonly headline: string;
  /** Short supporting line (safety-screened). */
  readonly detail: string;
  /** Reflective line on whether the chunks differed musically vs as inner-state shifts (screened, v13). */
  readonly variationNote: string;
  /**
   * Reflective line placing the hum in the user's OWN longitudinal vocal range when it is trustworthy
   * (the refined-each-hum longitudinal layer), or "" before the range has formed. Screened (v13).
   */
  readonly rangeNote: string;
  /** Self-normalized [0,1] energy contour for the within-hum sparkline. */
  readonly energyContour: readonly number[];
}

/** Meaningful first→last arc in V/A units before a direction is claimed. */
const ARC_T = 0.18;
/** Meaningful chunk-to-chunk volatility before "unsettled" is claimed. */
const VOL_T = 0.24;
/** Meaningful instability slope (per chunk) before settle/wind is claimed. */
const SETTLE_T = 0.05;

/** Perceptual (log) loudness of a chunk on the same window the arousal cue uses. */
function perceptualEnergy(meanRms: number): number {
  if (!Number.isFinite(meanRms) || meanRms <= 0) return 0;
  return clamp01(normalize(Math.log(meanRms), Math.log(AROUSAL_RMS_LO), Math.log(AROUSAL_RMS_HI)));
}

/** Least-squares slope of a short series against its index (per-chunk units). */
function slope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  let my = 0;
  for (const v of values) my += v;
  my /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    num += dx * ((values[i] as number) - my);
    den += dx * dx;
  }
  return den > 1e-9 ? num / den : 0;
}

/**
 * Perceptual scales that normalize a chunk-to-chunk DIFFERENCE so the musical and state families
 * are comparable. These are scales of CHANGE (differences), not absolute levels — a husky vs bright
 * voice produces the same-scale change across its own chunks, so the musical/state split stays
 * trait-decoupled. A normalized move of ~1 is a clearly noticeable shift.
 */
const STATE_SCALES = { arousal: 0.4, valence: 0.4, energy: 0.3, instability: 0.3 } as const;
const MUSICAL_SCALES = { pitchSemi: 3, pitchRange: 3, brightnessLog: 0.3, musicality: 0.3 } as const;
/** A normalized within-hum move below this is "no decisive difference" (the chunk is steady vs its predecessor). */
const CHUNK_MOVE_T = 0.5;
/** How much musical movement must exceed state movement before a transition is called "musical". */
const MUSICAL_DOMINANCE = 1.3;

const semis = (hz: number | null): number | null =>
  hz !== null && Number.isFinite(hz) && hz > 0 ? 12 * Math.log2(hz) : null;
const logOr = (x: number | null | undefined): number | null =>
  typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.log(x) : null;
const absDelta = (a: number | null, b: number | null, scale: number): number =>
  a !== null && b !== null ? Math.abs(a - b) / scale : 0;

/**
 * Classify how chunk `cur` differs from chunk `prev` (the transition INTO `cur`): which family of
 * within-hum differences dominates. `state` move spans the inner-state carriers (arousal, valence,
 * loudness, steadiness); `musical` move spans the carriers of what was hummed (pitch register +
 * melodic movement + brightness + musicality). Both are normalized differences (trait-decoupled).
 */
function classifyChunkKind(
  prev: { read: SegmentRead; f: AcousticFeatures },
  cur: { read: SegmentRead; f: AcousticFeatures },
): ChunkKind {
  const stateMove = Math.max(
    Math.abs(cur.read.arousal - prev.read.arousal) / STATE_SCALES.arousal,
    Math.abs(cur.read.valence - prev.read.valence) / STATE_SCALES.valence,
    Math.abs(cur.read.energy - prev.read.energy) / STATE_SCALES.energy,
    Math.abs((cur.f.residualInstabilityScore ?? 0) - (prev.f.residualInstabilityScore ?? 0)) / STATE_SCALES.instability,
  );
  const musicalMove = Math.max(
    absDelta(semis(cur.f.pitchMeanHz), semis(prev.f.pitchMeanHz), MUSICAL_SCALES.pitchSemi),
    absDelta(cur.f.pitchRangeSemitones ?? null, prev.f.pitchRangeSemitones ?? null, MUSICAL_SCALES.pitchRange),
    absDelta(logOr(cur.f.spectralCentroidHz), logOr(prev.f.spectralCentroidHz), MUSICAL_SCALES.brightnessLog),
    absDelta(cur.f.musicalityScore ?? null, prev.f.musicalityScore ?? null, MUSICAL_SCALES.musicality),
  );
  if (Math.max(stateMove, musicalMove) < CHUNK_MOVE_T) return "steady";
  if (musicalMove >= stateMove * MUSICAL_DOMINANCE && musicalMove >= CHUNK_MOVE_T) return "musical";
  if (stateMove >= CHUNK_MOVE_T) return "state";
  return "steady";
}

/** Aggregate the per-chunk kinds into the hum's overall variation mode. */
function variationModeOf(kinds: readonly ChunkKind[]): VariationMode {
  let musical = 0;
  let state = 0;
  for (const k of kinds) {
    if (k === "musical") musical++;
    else if (k === "state") state++;
  }
  if (musical === 0 && state === 0) return "steady";
  if (state === 0) return "musical";
  if (musical === 0) return "inner_state";
  return "mixed";
}

/** Reflective, non-diagnostic line for the variation mode (woven with the chunk count). */
function variationCopy(mode: VariationMode, chunks: number): string {
  switch (mode) {
    case "musical":
      return "Its stretches differed more in melody and tone than in feeling — a musical wander.";
    case "inner_state":
      return "Its stretches differed in energy and steadiness — the shifts read as inner-state, not just melody.";
    case "mixed":
      return "Its stretches differed both musically and in feeling as it went.";
    case "steady":
    default:
      return chunks <= 1 ? "It held one even stretch throughout." : "Its stretches stayed close to one another.";
  }
}

/** Classify the trajectory from the chunk-to-chunk variation summaries. */
function classifyShape(a: {
  segmentCount: number;
  valenceArc: number;
  arousalArc: number;
  energyArc: number;
  instabilityTrend: number;
  volatility: number;
}): TemporalShape {
  if (a.segmentCount <= 1) return "steady";
  // Rising activation dominates the arousal axis.
  if (a.arousalArc >= ARC_T && a.arousalArc >= Math.abs(a.valenceArc)) return "winding_up";
  // Rising micro-instability with arousal NOT falling → building agitation = winding up. The mirror
  // of the settling clause below (same SETTLE_T magnitude). Without this the "agitation rose"
  // trajectory this module's docs name had no input — instabilityTrend only drove settling.
  if (a.instabilityTrend >= SETTLE_T && a.arousalArc > -ARC_T) return "winding_up";
  // Energy waning while not activating → withdrawing/fading.
  if (a.energyArc <= -ARC_T && a.arousalArc <= 0 && a.valenceArc <= ARC_T) return "fading";
  // Arousal or micro-instability easing, mood not crashing → down-regulation.
  if ((a.arousalArc <= -ARC_T || a.instabilityTrend <= -SETTLE_T) && a.valenceArc >= -ARC_T) return "settling";
  // Mood lifting on its own.
  if (a.valenceArc >= ARC_T) return "brightening";
  // Plenty of movement, no clean direction.
  if (a.volatility >= VOL_T) return "unsettled";
  return "steady";
}

/** Reflective, non-diagnostic copy for each shape (woven with the actual direction). */
function copyFor(shape: TemporalShape, a: { arousalArc: number; valenceArc: number; energyArc: number }): {
  headline: string;
  detail: string;
} {
  switch (shape) {
    case "settling":
      return {
        headline: "You settled as you went",
        detail: "The hum eased and steadied toward the end — a self-soothing arc.",
      };
    case "winding_up":
      return {
        headline: "You wound up toward the end",
        detail: "The hum picked up energy and movement as it went on.",
      };
    case "brightening":
      return {
        headline: "You brightened as you went",
        detail: "The hum opened and warmed toward the end.",
      };
    case "fading":
      return {
        headline: "Your energy eased off",
        detail: "The hum softened and drew inward toward the end.",
      };
    case "unsettled":
      return {
        headline: "A restless hum",
        detail: "It shifted several times without settling on one direction.",
      };
    case "steady":
    default:
      return {
        headline: "Steady throughout",
        detail: "The hum held an even course from start to finish.",
      };
  }
}

/** Optional inputs to the within-hum read (v13): the user's longitudinal vocal range. */
export interface TemporalReadOptions {
  /** The user's per-feature longitudinal vocal-range model (`vocal_range_vector`), if formed. */
  readonly range?: FeatureRange;
}

/** Reflective line placing the hum's overall loudness in the user's own range (or "" if not formed). */
function rangeNoteFor(energyInRange: number | null): string {
  if (energyInRange === null) return "";
  if (energyInRange >= 0.72) return "Overall, this sat toward the louder end of your usual range.";
  if (energyInRange <= 0.28) return "Overall, this sat toward the quieter end of your usual range.";
  return "Overall, this sat around the middle of your usual range.";
}

/**
 * Build the within-hum temporal read from a `TemporalAnalysis`. Returns null when the
 * analysis is empty/degenerate (no usable chunks) — the caller simply omits the layer. The
 * optional longitudinal vocal `range` (v13) places each chunk + the whole hum in the user's OWN
 * reachable span (refined each hum); absent ⇒ the within-hum read stands alone (honest cold start).
 */
export function computeTemporalRead(
  ta: TemporalAnalysis | undefined | null,
  opts: TemporalReadOptions = {},
): TemporalRead | null {
  if (!ta || ta.segments.length === 0) return null;

  const range = opts.range;
  const rmsRange = range?.["meanRms"];

  // Pass 1: per-chunk V/A + energy + where its loudness sits in the user's own range.
  const base = ta.segments.map((s) => {
    const ax = acousticAffectAxes(s.features);
    return {
      features: s.features,
      read: {
        index: s.index,
        startSec: s.startSec,
        endSec: s.endSec,
        valence: ax.valence,
        arousal: ax.arousal,
        energy: perceptualEnergy(s.features.meanRms),
        signalStrength: ax.signalStrength,
        kind: "opening" as ChunkKind,
        energyInRange: rmsRange ? rangePosition(s.features.meanRms, rmsRange) : null,
      } as SegmentRead,
    };
  });

  // Pass 2: classify how each chunk DIFFERS from the one before it (musical vs inner-state).
  const segments: SegmentRead[] = base.map((b, i) => {
    if (i === 0) return b.read;
    const prev = base[i - 1] as { read: SegmentRead; features: AcousticFeatures };
    const kind = classifyChunkKind({ read: prev.read, f: prev.features }, { read: b.read, f: b.features });
    return { ...b.read, kind };
  });

  const kinds = segments.slice(1).map((s) => s.kind);
  const variationMode = variationModeOf(kinds);
  const variationNote = variationCopy(variationMode, ta.segmentCount);
  // Whole-hum position in the user's range = the mean of the chunk positions (when the range is live).
  const inRange = segments.map((s) => s.energyInRange).filter((v): v is number => v !== null);
  const rangeNote = inRange.length > 0 ? rangeNoteFor(mean(inRange)) : "";

  // DIAGNOSTIC arcs + volatility accumulate ONLY the NON-musical chunk-to-chunk steps. The brief is
  // explicit: if one chunk differs from another MUSICALLY (a different melody / note / timbre), that
  // difference must NOT contribute to the diagnostic read — only INNER-STATE differences (energy /
  // arousal / valence / steadiness) do. So a hum that merely wanders melodically reads as STEADY, not
  // as a mood shift, and the net arc is the sum of the state-bearing steps (NOT raw first→last, which
  // would re-admit a musical jump). A purely-musical hum yields arcs ≈ 0 → "steady". `instabilityTrend`
  // stays over all chunks (micro-instability is a state cue, never a musical one).
  let valenceArc = 0;
  let arousalArc = 0;
  let energyArc = 0;
  let stepAcc = 0;
  let stateTransitions = 0;
  for (let i = 1; i < segments.length; i++) {
    const cur = segments[i] as SegmentRead;
    if (cur.kind === "musical") continue; // musical wander ⊥ diagnostics
    const prv = segments[i - 1] as SegmentRead;
    const dv = cur.valence - prv.valence;
    const da = cur.arousal - prv.arousal;
    valenceArc += dv;
    arousalArc += da;
    energyArc += cur.energy - prv.energy;
    stepAcc += Math.hypot(dv, da);
    stateTransitions++;
  }
  const instabilityTrend = slope(ta.segments.map((s) => s.features.residualInstabilityScore));
  const volatility = (stateTransitions > 0 ? stepAcc / stateTransitions : 0) + 0.06 * Math.max(0, stateTransitions - 1);

  const summary = { segmentCount: ta.segmentCount, valenceArc, arousalArc, energyArc, instabilityTrend, volatility };
  const shape = classifyShape(summary);
  const { headline, detail } = copyFor(shape, { arousalArc, valenceArc, energyArc });

  const dominant = Math.max(Math.abs(valenceArc), Math.abs(arousalArc), Math.abs(energyArc));
  const confidence: TemporalRead["confidence"] =
    shape !== "steady" && (dominant >= 0.3 || volatility >= 0.35) ? "clear" : "tentative";

  return {
    temporalMode: ta.temporalMode,
    segmentCount: ta.segmentCount,
    segments,
    boundarySec: ta.boundarySec,
    valenceArc: clamp(valenceArc, -2, 2),
    arousalArc: clamp(arousalArc, -2, 2),
    energyArc: clamp(energyArc, -1, 1),
    instabilityTrend,
    volatility,
    shape,
    variationMode,
    confidence,
    headline,
    detail,
    variationNote,
    rangeNote,
    energyContour: ta.energyContour,
  };
}

/** Strings a temporal read contributes to the user-facing copy (for safety screening). */
export function temporalReadStrings(t: TemporalRead | null): string[] {
  if (!t) return [];
  return [t.headline, t.detail, t.variationNote, t.rangeNote].filter((s) => s.length > 0);
}
