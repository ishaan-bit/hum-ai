import { clamp01, median, type UnitInterval } from "@hum-ai/shared-types";
import { cusumDrift, estimateTrend, type SeriesPoint } from "./trend";
import type { LongitudinalDiagnosticState } from "./longitudinal";

/**
 * WITHIN-USER RISK-MARKER DECOMPOSITION — the three named, non-diagnostic early
 * signals the product surfaces (consent-gated): a DEPRESSIVE-AFFECT marker, an
 * ANXIETY-TENSION marker, and a RELAPSE-DRIFT marker. This module turns the raw
 * within-user series of hums into those three markers, each as a coarse LEVEL
 * (never a number to the user), with provenance and an early-onset flag.
 *
 * GROUNDING (why this maps to depression / anxiety risk without claiming to
 * diagnose):
 *  - Russell's CIRCUMPLEX MODEL OF AFFECT places affective states on a
 *    valence × arousal plane. Low-valence + LOW/flat-arousal is the canonical
 *    "down / flat / withdrawn" region associated with depressive affect; negative
 *    valence + HIGH arousal is the "tense / on-edge / keyed-up" region associated
 *    with anxious affect. We read each marker from the corresponding QUADRANT, so
 *    the same hum never lights both markers for the same reason.
 *  - Everything is WITHIN-USER. A marker fires only relative to the user's OWN
 *    robust baseline (median ± MAD over their history), so "low" means low FOR YOU,
 *    never low against a population norm. Without a personal baseline we abstain
 *    (`insufficient_data`) — exactly the discipline the relapse engine already uses.
 *  - SUSTAINED-NESS, not a single hum. A marker escalates only when the leaning
 *    holds across consecutive recent hums (mirrors {@link MIN_CONSECUTIVE_DRIFT_HUMS}
 *    in the relapse engine), and we run a sequential CUSUM change-detector for the
 *    ONSET of a shift (early warning) rather than waiting for a long run.
 *
 * DISCIPLINE:
 *  - Pure + deterministic. No DOM, no I/O, no clinical-corpus / screening-model
 *    import (it must be safe to run in the read path; the blinded screening head
 *    stays offline — ADR-0006).
 *  - Magnitudes are INTERNAL ([0,1] `intensity`) and must never reach the user as a
 *    number (ADR-0008); they drive only the coarse dot tone.
 *  - Structurally non-diagnostic (`isDiagnostic: false`). Surfacing is consent-gated
 *    and must pass `@hum-ai/safety-language` (allowed register: "depressive-affect
 *    marker", "anxiety-risk marker", "relapse-risk drift").
 */

export type RiskMarkerId = "depressive_affect" | "anxiety_tension" | "relapse_drift";

/** Coarse, user-safe severity for a marker (the only thing that drives the dot tone). */
export type RiskMarkerLevel = "insufficient_data" | "settled" | "watch" | "elevated";

/** Minimum within-user hums before any acoustic marker can be judged. */
export const MIN_SERIES_FOR_MARKERS = 5;
/** Consecutive leaning hums that escalate a marker to "elevated" (mirrors the relapse rule). */
export const SUSTAINED_ELEVATE_HUMS = 3;
/** A visible floor on the within-user spread so a tight series never makes everything "extreme". */
const SPREAD_FLOOR = 0.12;
/** Below the band by this many spreads ⇒ a hum is "below your usual" for the depressive read. */
const BELOW_BAND_SPREADS = 0.5;
/** Above the arousal band by this many spreads ⇒ a hum is "keyed-up" for the anxiety read. */
const ABOVE_BAND_SPREADS = 0.5;

/** One within-user hum, as the marker engine sees it (oldest → newest in a series). */
export interface RiskSeriesPoint {
  /** Monotonic time key (ms epoch or index) — only ORDER + spacing matter. */
  readonly t: number;
  /** Re-referenced display valence in [-1, 1]. */
  readonly valence: number;
  /** Re-referenced display arousal in [-1, 1]. */
  readonly arousal: number;
  /** Composite within-user risk score in [0, 1]. */
  readonly risk: number;
}

export interface RiskMarkerInputs {
  /** The user's recent within-user series, oldest → newest. */
  readonly series: readonly RiskSeriesPoint[];
  /** A personal rolling baseline is active (≥ personal_baseline stage). */
  readonly baselineActive: boolean;
  /** The longitudinal diagnostic state for the latest hum (drives the relapse marker). */
  readonly longitudinal: LongitudinalDiagnosticState | null;
}

export interface RiskMarker {
  readonly id: RiskMarkerId;
  readonly level: RiskMarkerLevel;
  /** Within-user magnitude in [0, 1]. INTERNAL — never surfaced as a number (ADR-0008). */
  readonly intensity: UnitInterval;
  /** Consecutive recent hums (through the newest) that lean this way. */
  readonly sustainedHums: number;
  /** The sequential CUSUM detector flagged the ONSET of a sustained shift (early warning). */
  readonly earlyOnset: boolean;
  /** Series index where a sustained shift began (early-detection changepoint), or null. */
  readonly changeIndex: number | null;
  /** Explainability: the within-user features that drove the marker (coarse words, no numbers). */
  readonly evidenceFeatures: readonly string[];
  readonly isDiagnostic: false;
}

export interface RiskMarkerReport {
  readonly depressive: RiskMarker;
  readonly anxiety: RiskMarker;
  readonly relapse: RiskMarker;
  /** True once a personal baseline exists and there is enough history to judge acoustic markers. */
  readonly baselineReady: boolean;
  readonly isDiagnostic: false;
}

interface RobustBand {
  readonly mid: number;
  readonly spread: number;
}

/** Robust centre (median) + spread (MAD → σ, floored) for a within-user series. */
function robustBand(values: readonly number[]): RobustBand {
  const mid = median(values);
  const mad = median(values.map((v) => Math.abs(v - mid)));
  return { mid, spread: Math.max(mad * 1.4826, SPREAD_FLOOR) };
}

/** Count consecutive hums (from the newest backward) for which `lean` holds. */
function sustainedCount(series: readonly RiskSeriesPoint[], lean: (p: RiskSeriesPoint) => boolean): number {
  let count = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (lean(series[i]!)) count++;
    else break;
  }
  return count;
}

/** Map a sustained count + early-onset + magnitude to a coarse, user-safe level. */
function levelFrom(sustained: number, earlyOnset: boolean, intensity: number): RiskMarkerLevel {
  // A lone deviant hum must NOT reach the top level: the early-onset escalation now also requires the
  // lean to have held for ≥2 hums, so a single outlier tops out at "watch" — consistent with the
  // relapse rule's own MIN_CONSECUTIVE_DRIFT_HUMS and this file's "sustained" framing.
  if (sustained >= SUSTAINED_ELEVATE_HUMS || (earlyOnset && intensity >= 0.6 && sustained >= 2)) return "elevated";
  if (sustained >= 1 || earlyOnset || intensity >= 0.5) return "watch";
  return "settled";
}

const insufficient = (id: RiskMarkerId): RiskMarker => ({
  id,
  level: "insufficient_data",
  intensity: 0,
  sustainedHums: 0,
  earlyOnset: false,
  changeIndex: null,
  evidenceFeatures: [],
  isDiagnostic: false,
});

/**
 * The DEPRESSIVE-AFFECT marker: sustained LOW valence with LOW/flat arousal, below the
 * user's own usual. Uses the within-user valence band for "below", a CUSUM on the
 * valence series for an early downward onset, and the arousal level to require the
 * "flat / withdrawn" quadrant (so a low-but-keyed-up hum reads as anxiety, not low mood).
 */
function depressiveMarker(inp: RiskMarkerInputs): RiskMarker {
  const s = inp.series;
  const vBand = robustBand(s.map((p) => p.valence));
  const aBand = robustBand(s.map((p) => p.arousal));
  const below = vBand.mid - BELOW_BAND_SPREADS * vBand.spread;
  // "Down/flat" quadrant: valence below usual AND arousal at or below the user's usual energy.
  const lean = (p: RiskSeriesPoint): boolean => p.valence < below && p.arousal <= aBand.mid + 0.1;
  const sustained = sustainedCount(s, lean);

  // Sequential early detection of a downward valence shift (onset, not a long run).
  const cusum = cusumDrift(s.map((p) => p.valence));
  const trend = estimateTrend(s.map<SeriesPoint>((p) => ({ t: p.t, value: p.valence })), { flatSlopeEps: 1e-9 });
  const latest = s[s.length - 1]!;
  // QUADRANT GATE: a downward valence shift only reads as DEPRESSIVE affect when the
  // latest hum is also flat/low-arousal. A low-but-keyed-up hum is anxiety, not low mood,
  // so it must not trip this marker's early warning.
  const earlyOnset = cusum.drift === "down" && latest.arousal <= aBand.mid + 0.1;

  // `flatness` collapses to 0 as arousal climbs above the user's usual energy, so a
  // low-valence/high-arousal (anxious) hum accrues no depressive intensity.
  const flatness = latest.arousal <= aBand.mid ? 1 : clamp01(1 - (latest.arousal - aBand.mid) / (2 * aBand.spread));
  const depthZ = clamp01((vBand.mid - latest.valence) / (2 * vBand.spread)); // how far below usual
  const downMag = cusum.drift === "down" ? clamp01(cusum.magnitude / 6) : 0; // CUSUM decision interval ~4σ
  const trendDown = trend.direction === "falling" ? trend.confidence : 0;
  const intensity = clamp01(flatness * (0.55 * depthZ + 0.3 * downMag + 0.15 * trendDown));

  const evidence: string[] = [];
  if (sustained >= 1) evidence.push("lower mood than your usual");
  if (latest.arousal <= aBand.mid) evidence.push("flatter, lower energy");
  if (earlyOnset) evidence.push("a downward shift starting");
  if (trend.direction === "falling" && trend.significant) evidence.push("a falling recent trend");

  return {
    id: "depressive_affect",
    level: levelFrom(sustained, earlyOnset, intensity),
    intensity,
    sustainedHums: sustained,
    earlyOnset,
    changeIndex: earlyOnset ? cusum.changeIndex : null,
    evidenceFeatures: evidence,
    isDiagnostic: false,
  };
}

/**
 * The ANXIETY-TENSION marker: sustained HIGH arousal with NEGATIVE/at-or-below valence —
 * the "keyed-up / on-edge" quadrant. Uses the within-user arousal band for "above", a
 * CUSUM on the arousal series for an early upward onset, and requires valence to be at or
 * below usual so a happy-energised hum (high arousal, high valence) never reads as anxiety.
 */
function anxietyMarker(inp: RiskMarkerInputs): RiskMarker {
  const s = inp.series;
  const vBand = robustBand(s.map((p) => p.valence));
  const aBand = robustBand(s.map((p) => p.arousal));
  const above = aBand.mid + ABOVE_BAND_SPREADS * aBand.spread;
  // "Tense/on-edge" quadrant: arousal above usual AND valence not pleasant (at or below usual).
  const lean = (p: RiskSeriesPoint): boolean => p.arousal > above && p.valence <= vBand.mid + 0.1;
  const sustained = sustainedCount(s, lean);

  const cusum = cusumDrift(s.map((p) => p.arousal));
  const trend = estimateTrend(s.map<SeriesPoint>((p) => ({ t: p.t, value: p.arousal })), { flatSlopeEps: 1e-9 });
  // An anxiety onset is an UPWARD arousal shift while valence is not pleasant.
  const latest = s[s.length - 1]!;
  const earlyOnset = cusum.drift === "up" && latest.valence <= vBand.mid + 0.1;

  // QUADRANT GATE: `tensePull` collapses to 0 as valence rises above the user's usual,
  // so a high-arousal/high-valence (happy, energised) hum accrues no anxiety intensity.
  const tensePull = latest.valence >= vBand.mid ? clamp01(1 - (latest.valence - vBand.mid) / (2 * vBand.spread)) : 1;
  const heightZ = clamp01((latest.arousal - aBand.mid) / (2 * aBand.spread)); // how far above usual energy
  const upMag = cusum.drift === "up" ? clamp01(cusum.magnitude / 6) : 0;
  const trendUp = trend.direction === "rising" ? trend.confidence : 0;
  const intensity = clamp01(tensePull * (0.55 * heightZ + 0.3 * upMag + 0.15 * trendUp));

  const evidence: string[] = [];
  if (sustained >= 1) evidence.push("more keyed-up than your usual");
  if (latest.valence <= vBand.mid) evidence.push("tension rather than ease");
  if (earlyOnset) evidence.push("an upward tension shift starting");
  if (trend.direction === "rising" && trend.significant) evidence.push("a rising recent trend");

  return {
    id: "anxiety_tension",
    level: levelFrom(sustained, earlyOnset, intensity),
    intensity,
    sustainedHums: sustained,
    earlyOnset,
    changeIndex: earlyOnset ? cusum.changeIndex : null,
    evidenceFeatures: evidence,
    isDiagnostic: false,
  };
}

/**
 * The RELAPSE-DRIFT marker: the existing longitudinal early-warning, expressed in the same
 * shape as the other two. It is driven by the {@link LongitudinalDiagnosticState} (the
 * sustained drift detector that already enforces ≥ MIN_CONSECUTIVE_DRIFT_HUMS), with the
 * risk-series CUSUM as a corroborating early-onset signal. When no longitudinal state is
 * available it falls back to a risk-series-only read (still within-user).
 */
function relapseMarker(inp: RiskMarkerInputs): RiskMarker {
  const lg = inp.longitudinal;
  const s = inp.series;
  const riskCusum = cusumDrift(s.map((p) => p.risk));
  const earlyOnset = riskCusum.drift === "up";

  if (!lg || lg.abstained || lg.riskHypothesis.status === "insufficient_data") {
    // No within-user longitudinal judgement yet — fall back to the risk series alone.
    if (!inp.baselineActive || s.length < MIN_SERIES_FOR_MARKERS) return insufficient("relapse_drift");
    const intensity = clamp01(riskCusum.magnitude / 6);
    return {
      id: "relapse_drift",
      level: earlyOnset ? levelFrom(0, true, intensity) : "settled",
      intensity,
      sustainedHums: 0,
      earlyOnset,
      changeIndex: earlyOnset ? riskCusum.changeIndex : null,
      evidenceFeatures: earlyOnset ? ["risk drifting up from your steadier level"] : [],
      isDiagnostic: false,
    };
  }

  const drift = lg.relapseDrift;
  const recovering = lg.recovery !== null;
  const markerPresent = lg.riskHypothesis.status === "risk_marker_present";
  const sustainedHums = drift ? drift.driftWindowHums : 0;
  const intensity = clamp01(
    Math.max(drift ? drift.driftMagnitude : 0, markerPresent ? 0.5 : 0, riskCusum.magnitude / 6),
  );

  let level: RiskMarkerLevel;
  if (drift) level = "elevated";
  else if (markerPresent || earlyOnset) level = "watch";
  else level = "settled";

  const evidence: string[] = [];
  if (drift) evidence.push("a sustained drift from your steadier pattern");
  else if (markerPresent) evidence.push("one recent hum apart from your usual");
  if (earlyOnset && !drift) evidence.push("risk drifting up early");
  if (recovering) evidence.push("moving back toward steadier");

  return {
    id: "relapse_drift",
    level,
    intensity,
    sustainedHums,
    earlyOnset,
    changeIndex: drift ? null : earlyOnset ? riskCusum.changeIndex : null,
    evidenceFeatures: evidence,
    isDiagnostic: false,
  };
}

/**
 * Derive the three within-user risk markers from the user's recent series + the
 * longitudinal state. Abstains (`insufficient_data`) for the acoustic markers until
 * there is a personal baseline and {@link MIN_SERIES_FOR_MARKERS} hums; the relapse
 * marker defers to the longitudinal engine's own abstention. Pure.
 */
export function deriveRiskMarkers(inp: RiskMarkerInputs): RiskMarkerReport {
  const baselineReady = inp.baselineActive && inp.series.length >= MIN_SERIES_FOR_MARKERS;
  const depressive = baselineReady ? depressiveMarker(inp) : insufficient("depressive_affect");
  const anxiety = baselineReady ? anxietyMarker(inp) : insufficient("anxiety_tension");
  const relapse = relapseMarker(inp);
  return { depressive, anxiety, relapse, baselineReady, isDiagnostic: false };
}

/** Marker levels in descending severity (for sorting/headlining). */
export const RISK_LEVEL_RANK: Record<RiskMarkerLevel, number> = {
  elevated: 3,
  watch: 2,
  settled: 1,
  insufficient_data: 0,
};
