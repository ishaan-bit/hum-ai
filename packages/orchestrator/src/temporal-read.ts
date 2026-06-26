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
import { clamp, clamp01, normalize } from "@hum-ai/shared-types";
import type { TemporalAnalysis } from "@hum-ai/audio-features";
import { acousticAffectAxes, AROUSAL_RMS_LO, AROUSAL_RMS_HI } from "./axis-read";

/** The qualitative within-hum trajectory class predicted from chunk-to-chunk change. */
export type TemporalShape =
  | "steady" // never decisively shifted — one chunk
  | "settling" // arousal/instability eased across chunks (down-regulation)
  | "winding_up" // arousal/agitation rose across chunks
  | "brightening" // valence lifted across chunks
  | "fading" // energy waned across chunks (withdrawing)
  | "unsettled"; // moved a lot with no clean direction

/** One chunk's read — its own V/A + energy, plus where it sits in the hum. */
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
  /** Qualitative — never a number. */
  readonly confidence: "clear" | "tentative";
  /** Reflective one-liner (safety-screened by the orchestrator with the rest of copy). */
  readonly headline: string;
  /** Short supporting line (safety-screened). */
  readonly detail: string;
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

/**
 * Build the within-hum temporal read from a `TemporalAnalysis`. Returns null when the
 * analysis is empty/degenerate (no usable chunks) — the caller simply omits the layer.
 */
export function computeTemporalRead(ta: TemporalAnalysis | undefined | null): TemporalRead | null {
  if (!ta || ta.segments.length === 0) return null;

  const segments: SegmentRead[] = ta.segments.map((s) => {
    const ax = acousticAffectAxes(s.features);
    return {
      index: s.index,
      startSec: s.startSec,
      endSec: s.endSec,
      valence: ax.valence,
      arousal: ax.arousal,
      energy: perceptualEnergy(s.features.meanRms),
      signalStrength: ax.signalStrength,
    };
  });

  const first = segments[0] as SegmentRead;
  const last = segments[segments.length - 1] as SegmentRead;
  const valenceArc = last.valence - first.valence;
  const arousalArc = last.arousal - first.arousal;
  const energyArc = last.energy - first.energy;
  const instabilityTrend = slope(ta.segments.map((s) => s.features.residualInstabilityScore));

  // Volatility = mean chunk-to-chunk Euclidean step in V/A + a small fragmentation term.
  let stepAcc = 0;
  for (let i = 1; i < segments.length; i++) {
    const dv = (segments[i] as SegmentRead).valence - (segments[i - 1] as SegmentRead).valence;
    const da = (segments[i] as SegmentRead).arousal - (segments[i - 1] as SegmentRead).arousal;
    stepAcc += Math.hypot(dv, da);
  }
  const transitions = Math.max(1, segments.length - 1);
  const volatility = stepAcc / transitions + 0.06 * Math.max(0, segments.length - 2);

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
    confidence,
    headline,
    detail,
    energyContour: ta.energyContour,
  };
}

/** Strings a temporal read contributes to the user-facing copy (for safety screening). */
export function temporalReadStrings(t: TemporalRead | null): string[] {
  if (!t) return [];
  return [t.headline, t.detail];
}
