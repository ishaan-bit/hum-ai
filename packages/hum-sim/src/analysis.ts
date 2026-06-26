/**
 * ANALYSIS HARNESS — turns a batch of `SimResult`s into evidence about WHERE output
 * variation lives and dies. It answers, with numbers:
 *
 *  - Which extracted features actually vary vs collapse to near-zero variance?
 *  - Which outputs respond when relevant latent controls change (latent→feature→output
 *    Jacobian), and which stay near center regardless?
 *  - Does the extractor RECOVER each synthesis control (extractor-fidelity)?
 *  - Does recording fidelity (noise / mic band / reverb) leak into the affect read
 *    (a contract violation)?
 *  - The user-visible zone histogram + V-A reachability hull (the center-collapse symptom),
 *    attributed across pipeline stages (acoustic backbone → displayed → internal fusion).
 *
 * Everything here is descriptive statistics over the REAL pipeline's outputs — no
 * scores are widened, nothing is fabricated.
 */
import { mean, clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import type { SimResult } from "./pipeline";
import { zoneOf, ZONE_THRESHOLD } from "./pipeline";
import type { UnitLatentKey } from "./latent";

// ── descriptive statistics ───────────────────────────────────────────────────

export interface Stat {
  readonly n: number;
  readonly min: number;
  readonly max: number;
  readonly span: number;
  readonly mean: number;
  readonly std: number;
  readonly p05: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const r = q * (sorted.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return lo === hi ? a : a + (b - a) * (r - lo);
}

export function stat(xs: readonly number[]): Stat {
  const finite = xs.filter((x) => Number.isFinite(x));
  if (finite.length === 0) {
    return { n: 0, min: NaN, max: NaN, span: 0, mean: NaN, std: NaN, p05: NaN, p25: NaN, p50: NaN, p75: NaN, p95: NaN };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const m = mean(finite);
  const variance = mean(finite.map((x) => (x - m) * (x - m)));
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;
  return {
    n: finite.length,
    min,
    max,
    span: max - min,
    mean: m,
    std: Math.sqrt(variance),
    p05: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
  };
}

// ── numeric probe vector (features + every stage's outputs) ─────────────────────

const EVIDENCE_ORDINAL: Record<string, number> = { early_baseline: 0, low: 1, medium: 2, high: 3 };

/** Flatten a SimResult to a numeric map: extracted features + every read output. */
export function probeVector(r: SimResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.features)) {
    if (typeof v === "number" && Number.isFinite(v)) out[`feat.${k}`] = v;
  }
  out["out.acousticValence"] = r.axisAcoustic.valence;
  out["out.acousticArousal"] = r.axisAcoustic.arousal;
  out["out.signalStrength"] = r.axisAcoustic.signalStrength;
  out["out.displayValence"] = r.displayAxis.valence;
  out["out.displayArousal"] = r.displayAxis.arousal;
  out["out.internalValence"] = r.internalDimensional.valence;
  out["out.internalArousal"] = r.internalDimensional.arousal;
  out["out.riskScore"] = r.riskScore;
  out["out.captureQualityScore"] = r.quality.captureQualityScore;
  out["out.domainMatch"] = r.domain.domainMatch;
  out["out.evidenceOrdinal"] = EVIDENCE_ORDINAL[r.userFacing.evidenceLevel] ?? 0;
  return out;
}

// ── feature variance ────────────────────────────────────────────────────────────

export interface FeatureVariance {
  readonly feature: string;
  readonly stat: Stat;
  readonly nullFraction: number;
  readonly coefVar: number;
  /** Near-zero variance for this scenario set (a dead/saturated extractor output). */
  readonly lowVariance: boolean;
}

/** Per-feature distribution across a result set, flagging near-zero variance. */
export function featureVariance(results: readonly SimResult[]): FeatureVariance[] {
  const keys = new Set<string>();
  for (const r of results) for (const [k, v] of Object.entries(r.features)) {
    if (typeof v === "number") keys.add(k);
  }
  const rows: FeatureVariance[] = [];
  for (const k of keys) {
    const raw = results.map((r) => (r.features as unknown as Record<string, number | null>)[k]);
    const nulls = raw.filter((v) => v === null).length;
    const xs = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const s = stat(xs);
    const coefVar = Math.abs(s.mean) > 1e-9 ? s.std / Math.abs(s.mean) : s.std > 1e-9 ? Infinity : 0;
    rows.push({
      feature: k,
      stat: s,
      nullFraction: results.length ? nulls / results.length : 0,
      coefVar,
      lowVariance: s.span < 1e-6 || coefVar < 0.02,
    });
  }
  return rows.sort((a, b) => a.coefVar - b.coefVar);
}

// ── sensitivity (one driver → many targets) ─────────────────────────────────────

export interface Effect {
  readonly target: string;
  readonly span: number;
  readonly atLow: number;
  readonly atHigh: number;
  readonly slopeSign: -1 | 0 | 1;
  readonly monotonic: boolean;
  readonly saturatedLow: boolean;
  readonly saturatedHigh: boolean;
  readonly dead: boolean;
}

const MONO_EPS = 1e-4;

function effectFromSeries(target: string, xs: readonly number[], deadSpan: number): Effect {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo;
  const atLow = xs[0] as number;
  const atHigh = xs[xs.length - 1] as number;
  const dead = span < deadSpan;
  const slopeSign: -1 | 0 | 1 = dead ? 0 : atHigh > atLow ? 1 : -1;
  let nondec = true;
  let noninc = true;
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    if (d < -MONO_EPS) nondec = false;
    if (d > MONO_EPS) noninc = false;
  }
  const q = Math.max(1, Math.floor(xs.length / 5));
  const slack = Math.max(deadSpan, span * 0.05);
  return {
    target,
    span,
    atLow,
    atHigh,
    slopeSign,
    monotonic: !dead && (nondec || noninc),
    saturatedLow: !dead && Math.abs((xs[q] as number) - (xs[0] as number)) < slack,
    saturatedHigh: !dead && Math.abs((xs[xs.length - 1] as number) - (xs[xs.length - 1 - q] as number)) < slack,
    dead,
  };
}

export interface DriverSensitivity {
  readonly driver: UnitLatentKey;
  readonly drivenValues: readonly number[];
  readonly effects: Record<string, Effect>;
}

/**
 * For one sweep group (all results share `drivenBy`), average each probe target per
 * driven value and measure the response. `deadSpanFor(target)` lets us use a different
 * "dead" threshold for unit-scale outputs vs Hz-scale features.
 */
export function driverSensitivity(
  group: readonly SimResult[],
  deadSpanFor: (target: string) => number,
): DriverSensitivity | null {
  const driver = group[0]?.latent ? (group[0] as SimResult).id : null;
  const drivenBy = inferDriver(group);
  if (!drivenBy) return null;
  // bucket by driven value
  const byValue = new Map<number, SimResult[]>();
  for (const r of group) {
    const v = drivenValueOf(r, drivenBy);
    if (v === null) continue;
    (byValue.get(v) ?? byValue.set(v, []).get(v)!).push(r);
  }
  const values = [...byValue.keys()].sort((a, b) => a - b);
  const targets = new Set<string>();
  for (const r of group) for (const k of Object.keys(probeVector(r))) targets.add(k);

  const effects: Record<string, Effect> = {};
  for (const t of targets) {
    const series = values.map((v) => mean((byValue.get(v) as SimResult[]).map((r) => probeVector(r)[t] ?? NaN).filter((x) => Number.isFinite(x))));
    if (series.some((x) => !Number.isFinite(x))) continue;
    effects[t] = effectFromSeries(t, series, deadSpanFor(t));
  }
  void driver;
  return { driver: drivenBy, drivenValues: values, effects };
}

function inferDriver(group: readonly SimResult[]): UnitLatentKey | null {
  // the sweep scenarios encode the driver in the id `sweep/<key>/...`
  const id = group[0]?.id ?? "";
  const m = /^sweep\/([a-zA-Z]+)\//.exec(id);
  return (m?.[1] as UnitLatentKey) ?? null;
}
function drivenValueOf(r: SimResult, key: UnitLatentKey): number | null {
  const v = (r.latent as unknown as Record<string, number>)[key];
  return typeof v === "number" ? v : null;
}

// ── extractor-fidelity: does the extractor RECOVER each synthesis control? ────────

/** Expected monotone recovery: a latent control should move its target feature in `sign`. */
export const FEATURE_RECOVERY: ReadonlyArray<{ driver: UnitLatentKey; feature: string; sign: 1 | -1 }> = [
  { driver: "energy", feature: "feat.meanRms", sign: 1 },
  { driver: "pitchHeight", feature: "feat.pitchMeanHz", sign: 1 },
  { driver: "melodicMovement", feature: "feat.pitchRangeSemitones", sign: 1 },
  { driver: "brightness", feature: "feat.spectralCentroidHz", sign: 1 },
  { driver: "timbralChange", feature: "feat.spectralFlux", sign: 1 },
  { driver: "pitchInstability", feature: "feat.jitter", sign: 1 },
  { driver: "amplitudeInstability", feature: "feat.shimmerProxy", sign: 1 },
  { driver: "amplitudeInstability", feature: "feat.amplitudeStability", sign: -1 },
  { driver: "noiseLevel", feature: "feat.signalToNoiseProxy", sign: -1 },
];

export interface RecoveryCheck {
  readonly driver: UnitLatentKey;
  readonly feature: string;
  readonly expectedSign: 1 | -1;
  readonly observedSlopeSign: -1 | 0 | 1;
  readonly span: number;
  readonly atLow: number;
  readonly atHigh: number;
  readonly recovered: boolean;
}

/** Check each expected recovery against the measured sweep sensitivities. */
export function extractorFidelity(sensitivities: readonly DriverSensitivity[]): RecoveryCheck[] {
  const byDriver = new Map(sensitivities.map((s) => [s.driver, s]));
  return FEATURE_RECOVERY.map((exp) => {
    const eff = byDriver.get(exp.driver)?.effects[exp.feature];
    const observedSlopeSign = eff?.slopeSign ?? 0;
    return {
      driver: exp.driver,
      feature: exp.feature,
      expectedSign: exp.sign,
      observedSlopeSign,
      span: eff?.span ?? 0,
      atLow: eff?.atLow ?? NaN,
      atHigh: eff?.atHigh ?? NaN,
      recovered: !!eff && !eff.dead && observedSlopeSign === exp.sign,
    };
  });
}

// ── zone histogram + V-A reachability ─────────────────────────────────────────────

export interface ZoneHistogram {
  readonly counts: Record<string, number>;
  readonly total: number;
  readonly centerFraction: number;
  readonly singleAxisFraction: number;
  readonly diagonalFraction: number;
  readonly distinctZones: number;
}

const DIAGONAL_ZONES = new Set(["Bright/Energised", "Tense/Wound-up", "Calm/Content", "Low/Flat"]);
const SINGLE_AXIS_ZONES = new Set(["Restless", "Quiet/Subdued", "Warm/Steady", "A-little-flat"]);

/** Headline-zone histogram over a result set (uses each result's user-facing displayAxis). */
export function zoneHistogram(results: readonly SimResult[]): ZoneHistogram {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.zone] = (counts[r.zone] ?? 0) + 1;
  const total = results.length;
  const center = counts["Steady/Even"] ?? 0;
  let single = 0;
  let diag = 0;
  for (const [z, c] of Object.entries(counts)) {
    if (SINGLE_AXIS_ZONES.has(z)) single += c;
    if (DIAGONAL_ZONES.has(z)) diag += c;
  }
  return {
    counts,
    total,
    centerFraction: total ? center / total : 0,
    singleAxisFraction: total ? single / total : 0,
    diagonalFraction: total ? diag / total : 0,
    distinctZones: Object.keys(counts).length,
  };
}

export interface VABox {
  readonly valence: Stat;
  readonly arousal: Stat;
}

/** Bounding stats of a chosen stage's V-A across results. */
export function vaBox(results: readonly SimResult[], stage: "acoustic" | "display" | "internal"): VABox {
  const pick = (r: SimResult): { v: number; a: number } =>
    stage === "acoustic" ? { v: r.axisAcoustic.valence, a: r.axisAcoustic.arousal }
    : stage === "display" ? { v: r.displayAxis.valence, a: r.displayAxis.arousal }
    : { v: r.internalDimensional.valence, a: r.internalDimensional.arousal };
  return {
    valence: stat(results.map((r) => pick(r).v)),
    arousal: stat(results.map((r) => pick(r).a)),
  };
}

// ── fidelity → affect leak ────────────────────────────────────────────────────────

export const FIDELITY_AFFECT_TOL = 0.15;

export interface FidelityLeak {
  readonly group: string;
  readonly mood: string;
  readonly control: string;
  /** Raw span of the affect read across the fidelity sweep (includes honest fade-to-neutral). */
  readonly valenceDrift: number;
  readonly arousalDrift: number;
  /**
   * DIRECTIONAL leak: the most a degraded capture MANUFACTURED affect — pushed the read toward
   * a pole (|affect| beyond the clean read) or flipped its sign — relative to the cleanest
   * capture of the same mood. Fading TOWARD neutral under noise is not counted (it is honest
   * low-confidence down-weighting, not a leak).
   */
  readonly directionalValence: number;
  readonly directionalArousal: number;
  readonly zonesVisited: number;
  readonly leaks: boolean;
}

/** Pick the cleanest item of a fidelity group (least-degraded capture for that control). */
function cleanestOf(rs: readonly SimResult[], control: string): SimResult {
  const fidelityOf = (r: SimResult): number =>
    control === "noise" ? -r.latent.noiseLevel
    : control === "reverb" ? -r.latent.roomReverb
    : control === "mic" ? r.latent.micBandwidth
    : r.features.signalToNoiseProxy;
  return [...rs].sort((a, b) => fidelityOf(b) - fidelityOf(a))[0] as SimResult;
}

/**
 * Manufactured affect on one axis: the read crossed neutral to the OPPOSITE pole (mood
 * inversion), or a near-neutral clean read was pushed OUT to a pole (mood invented from
 * recording noise). Same-pole intensification (a low hum reading more-low under noise as the
 * energy de-noises) is NOT manufacture — it is the same mood, honestly.
 */
function manufactured(clean: number, degraded: number): number {
  const flipped = Math.sign(degraded) !== Math.sign(clean) && Math.abs(clean) > 0.1 && Math.abs(degraded) > 0.1;
  if (flipped) return Math.abs(degraded) + Math.abs(clean);
  if (Math.abs(clean) < 0.1 && Math.abs(degraded) > 0.2) return Math.abs(degraded);
  return 0;
}

/** Measure affect drift across each fixed-mood fidelity sweep (groups `fidelity:<mood>:<control>`). */
export function fidelityLeaks(results: readonly SimResult[]): FidelityLeak[] {
  const groups = new Map<string, SimResult[]>();
  for (const r of results) {
    if (r.id.startsWith("fidelity/")) {
      const parts = r.id.split("/"); // fidelity / mood / control / value
      const key = `fidelity:${parts[1]}:${parts[2]}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
  }
  const out: FidelityLeak[] = [];
  for (const [key, rs] of groups) {
    const [, mood, control] = key.split(":");
    const clean = cleanestOf(rs, control ?? "");
    const vs = rs.map((r) => r.displayAxis.valence);
    const as = rs.map((r) => r.displayAxis.arousal);
    const dirV = Math.max(...rs.map((r) => manufactured(clean.displayAxis.valence, r.displayAxis.valence)));
    const dirA = Math.max(...rs.map((r) => manufactured(clean.displayAxis.arousal, r.displayAxis.arousal)));
    out.push({
      group: key,
      mood: mood ?? "",
      control: control ?? "",
      valenceDrift: Math.max(...vs) - Math.min(...vs),
      arousalDrift: Math.max(...as) - Math.min(...as),
      directionalValence: dirV,
      directionalArousal: dirA,
      zonesVisited: new Set(rs.map((r) => r.zone)).size,
      leaks: dirV > FIDELITY_AFFECT_TOL || dirA > FIDELITY_AFFECT_TOL,
    });
  }
  return out.sort((a, b) => Math.max(b.directionalValence, b.directionalArousal) - Math.max(a.directionalValence, a.directionalArousal));
}

// ── cross-voice invariance (v11 trait-decoupling) ──────────────────────────────────

export interface CrossVoiceInvariance {
  readonly voices: number;
  /** Spread (max−min) of the SURFACED (displayed) read across the fixed-mood voices. */
  readonly displayValenceSpan: number;
  readonly displayArousalSpan: number;
  /** Spread of the ABSOLUTE acoustic backbone across voices (the real identity difference). */
  readonly acousticValenceSpan: number;
  readonly acousticArousalSpan: number;
  /** The displayed read per voice, for the report table. */
  readonly perVoice: ReadonlyArray<{ readonly id: string; readonly valence: number; readonly arousal: number }>;
}

const spanOf = (xs: readonly number[]): number => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

/**
 * Measure how much the read spreads across DIFFERENT voices feeling the SAME mood (the v11
 * trait-decoupling contract). A small displayed span = voice identity does NOT dictate the read.
 */
export function crossVoiceInvariance(results: readonly SimResult[]): CrossVoiceInvariance {
  return {
    voices: results.length,
    displayValenceSpan: spanOf(results.map((r) => r.displayAxis.valence)),
    displayArousalSpan: spanOf(results.map((r) => r.displayAxis.arousal)),
    acousticValenceSpan: spanOf(results.map((r) => r.axisAcoustic.valence)),
    acousticArousalSpan: spanOf(results.map((r) => r.axisAcoustic.arousal)),
    perVoice: results.map((r) => ({ id: r.id, valence: r.displayAxis.valence, arousal: r.displayAxis.arousal })),
  };
}

// ── center-collapse diagnosis (the synthesis) ──────────────────────────────────────

export interface DriverRank {
  readonly driver: UnitLatentKey;
  readonly span: number;
  readonly slopeSign: -1 | 0 | 1;
  readonly monotonic: boolean;
  readonly saturated: boolean;
}

export interface CollapseDiagnosis {
  readonly nResults: number;
  readonly zones: ZoneHistogram;
  readonly displayBox: VABox;
  readonly acousticBox: VABox;
  readonly internalBox: VABox;
  readonly deadFeatures: readonly string[];
  readonly valenceDrivers: readonly DriverRank[];
  readonly arousalDrivers: readonly DriverRank[];
  readonly failingFidelityLeaks: readonly FidelityLeak[];
  readonly verdicts: readonly string[];
}

/** Rank the latent drivers of a given display output by measured span across the sweeps. */
function rankDrivers(sensitivities: readonly DriverSensitivity[], target: string): DriverRank[] {
  return sensitivities
    .map((s) => {
      const e = s.effects[target];
      return e
        ? { driver: s.driver, span: e.span, slopeSign: e.slopeSign, monotonic: e.monotonic, saturated: e.saturatedLow || e.saturatedHigh }
        : null;
    })
    .filter((d): d is DriverRank => d !== null && d.span >= 0.04)
    .sort((a, b) => b.span - a.span);
}

/**
 * Synthesize the full center-collapse diagnosis from a broad result set (archetypes +
 * interactions + sweeps), the per-driver sensitivities, and the fidelity-leak measures.
 */
export function diagnoseCollapse(
  broad: readonly SimResult[],
  sensitivities: readonly DriverSensitivity[],
  leaks: readonly FidelityLeak[],
): CollapseDiagnosis {
  const zones = zoneHistogram(broad);
  const displayBox = vaBox(broad, "display");
  const acousticBox = vaBox(broad, "acoustic");
  const internalBox = vaBox(broad, "internal");
  const fv = featureVariance(broad);
  const deadFeatures = fv.filter((f) => f.lowVariance).map((f) => f.feature);
  const valenceDrivers = rankDrivers(sensitivities, "out.displayValence");
  const arousalDrivers = rankDrivers(sensitivities, "out.displayArousal");
  const failingLeaks = leaks.filter((l) => l.leaks);

  const verdicts: string[] = [];
  if (zones.centerFraction > 0.4) {
    verdicts.push(`CENTER COLLAPSE: ${(zones.centerFraction * 100).toFixed(0)}% of varied hums land in "Steady/Even"; diagonals reached ${(zones.diagonalFraction * 100).toFixed(0)}%.`);
  }
  // OFF-CENTRE PIN — the inverse of center collapse: varied hums pile into ONE non-neutral zone (the
  // "every hum reads quiet/subdued" symptom). Reported descriptively here; gated in `evaluateReleaseGate`.
  const topOffCentre = Object.entries(zones.counts)
    .filter(([z]) => z !== "Steady/Even")
    .sort((a, b) => b[1] - a[1])[0];
  if (topOffCentre && zones.total && topOffCentre[1] / zones.total > 0.4) {
    verdicts.push(`OFF-CENTRE PIN: ${((topOffCentre[1] / zones.total) * 100).toFixed(0)}% of varied hums land in the off-centre "${topOffCentre[0]}" zone — outcomes collapse to one pole instead of tracking the hum (arousal median ${displayBox.arousal.p50.toFixed(2)}, valence median ${displayBox.valence.p50.toFixed(2)}).`);
  }
  if (displayBox.arousal.p95 - displayBox.arousal.p05 < 0.6) {
    verdicts.push(`AROUSAL COMPRESSED: displayed arousal P05–P95 spans only ${(displayBox.arousal.p05).toFixed(2)}…${(displayBox.arousal.p95).toFixed(2)} (of [-1,1]).`);
  }
  if (displayBox.valence.p50 > 0.1 && displayBox.valence.p05 > -0.2) {
    verdicts.push(`VALENCE POSITIVE-BIASED: displayed valence median ${displayBox.valence.p50.toFixed(2)}, P05 ${displayBox.valence.p05.toFixed(2)} (low pole hard to reach).`);
  }
  if (failingLeaks.length > 0) {
    const worst = failingLeaks[0] as FidelityLeak;
    verdicts.push(`FIDELITY→AFFECT LEAK: ${failingLeaks.length} fixed-mood fidelity sweeps MANUFACTURE affect beyond ${FIDELITY_AFFECT_TOL} (worst: ${worst.group} manufactured V=${worst.directionalValence.toFixed(2)} A=${worst.directionalArousal.toFixed(2)}).`);
  }
  const liveV = valenceDrivers.filter((d) => d.span >= 0.1).map((d) => d.driver);
  if (liveV.length <= 2) verdicts.push(`VALENCE NEARLY ONE-DIMENSIONAL: live drivers = [${liveV.join(", ")}].`);

  return {
    nResults: broad.length,
    zones,
    displayBox,
    acousticBox,
    internalBox,
    deadFeatures,
    valenceDrivers,
    arousalDrivers,
    failingFidelityLeaks: failingLeaks,
    verdicts,
  };
}

// ── release gate (the hard pass/fail contract) ──────────────────────────────────────

export interface GateCheck {
  readonly id: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface ReleaseGate {
  readonly pass: boolean;
  readonly checks: readonly GateCheck[];
}

/**
 * Gate thresholds — derived from the observed v9 baseline corpus (with margin), NOT arbitrary
 * aesthetic targets. They encode the implementation's own semantics: the four corner archetypes
 * must SEPARATE, a neutral hum must sit near the origin, recording fidelity must not manufacture
 * affect, the extractor must recover every control, and invalid audio must abstain (never become a
 * confident neutral emotional read). Each is a regression an `axis-read` / DSP change could
 * re-introduce; the gate fails the build if it does.
 */
export const GATE = {
  /** bright-energised − low-flat arousal separation (observed ≈1.15). */
  AROUSAL_SEPARATION: 0.6,
  /** bright-energised − low-flat valence separation (observed ≈0.76). */
  VALENCE_SEPARATION: 0.4,
  /** a genuinely energetic corner must reach at least this arousal (high pole reachable; obs ≈0.6). */
  AROUSAL_HIGH_MIN: 0.35,
  /** a genuinely subdued corner must reach at most this arousal (low pole reachable; obs ≈−0.55). */
  AROUSAL_LOW_MAX: -0.3,
  /** a bright corner must reach at least this valence (obs ≈0.42). */
  VALENCE_HIGH_MIN: 0.25,
  /** a downbeat corner must reach at most this valence — the low pole the v8 read could not reach (obs ≈−0.34). */
  VALENCE_LOW_MAX: -0.2,
  /**
   * |neutral read| on each axis — the zero-point must sit near the origin. The `steady_neutral`
   * archetype now resolves to the TRUE neutral reference (the harness holds its un-set controls at
   * `NEUTRAL_LATENT`, not a degraded 0.4 — see `jitterIrrelevant`), so this guard tests an actual
   * moderate hum (which reads ≈(0.05, −0.02)). The tolerance is therefore tightened to sit INSIDE the
   * ±`ZONE_THRESHOLD` (0.2) headline-zone boundary: a neutral hum that reads past ±0.15 on an axis is
   * about to display an off-centre zone ("Quiet/Subdued" et al.) instead of "Steady/Even" — exactly the
   * pin this gate must catch. The old 0.3 tolerance was LOOSER than the zone boundary, so it green-lit a
   * neutral hum reading −0.23 arousal (displayed "Quiet/Subdued") — the regression that shipped.
   */
  NEUTRAL_ABS_MAX: 0.15,
  /**
   * v11 CROSS-VOICE INVARIANCE: with mood held fixed, five voices spanning low/husky → bright/high
   * must read within this displayed span on each axis. The v11 trait-decoupled read keeps the
   * husky→bright valence span ≈0.33 / arousal ≈0.17; the pre-v11 read (pitch-register-heavy) spread
   * ≈0.55 / ≈0.33, so these thresholds CATCH a revert to reading voice identity as mood while leaving
   * the honest residual (one cold hum cannot fully separate a low voice from a low mood). The full
   * separation is earned as the personal baseline forms (the within-user display re-reference + the
   * models retrained on within-person deviations) — measured by the longitudinal pin/un-pin check.
   */
  CROSS_VOICE_VALENCE_MAX: 0.45,
  CROSS_VOICE_AROUSAL_MAX: 0.3,
  /**
   * The displayed read across the broad VARIED set must not be globally SKEWED off-origin: each axis'
   * MEDIAN must sit near 0. A varied population of hums should straddle the origin — a persistently
   * non-zero median means a global offset is pushing every hum toward one pole (the "every hum reads
   * quiet/subdued" pin) no matter how the hum is produced. This is the direct, corpus-level guard on the
   * exact symptom; the shipped read had a broad arousal median of ≈−0.25.
   */
  READ_MEDIAN_ABS_MAX: 0.18,
  /**
   * No single OFF-CENTRE headline zone may dominate the varied-hum histogram. When outcomes genuinely
   * depend on the hum's style, the modal zone is the neutral "Steady/Even" and the rest spread out; a
   * pile-up of varied hums in ONE off-centre zone is the collapse symptom itself (the shipped read put
   * 43% of varied hums in "Quiet/Subdued"). 0.45 leaves head-room for an honestly lopsided sample while
   * catching a genuine one-zone pin.
   */
  MAX_OFFCENTER_ZONE_FRACTION: 0.45,
} as const;

/** Mean displayed V-A of an archetype group (by archetype id), or null if absent. */
function archetypeVA(results: readonly SimResult[], archetypeId: string): { v: number; a: number } | null {
  const rs = results.filter((r) => r.id.startsWith(`archetype/${archetypeId}/`));
  if (rs.length === 0) return null;
  return { v: mean(rs.map((r) => r.displayAxis.valence)), a: mean(rs.map((r) => r.displayAxis.arousal)) };
}

/**
 * The HARD release gate `npm run hum-sim` enforces. Fails loudly (and the CLI exits non-zero)
 * when any genuine, previously-fixed defect regresses. Inputs are the real-pipeline outputs —
 * nothing is widened or fabricated.
 */
export function evaluateReleaseGate(args: {
  readonly archetypes: readonly SimResult[];
  readonly recovery: readonly RecoveryCheck[];
  readonly leaks: readonly FidelityLeak[];
  readonly malformed: ReadonlyArray<{ id: string; threw: boolean; abstained: boolean | null; decision: string | null }>;
  readonly failures: ReadonlyArray<{ id: string; abstained: boolean; decision: string }>;
  /** v11: cross-voice invariance (fixed mood, varied voice identity) — optional so older callers still run. */
  readonly crossVoice?: CrossVoiceInvariance;
  /**
   * The displayed-read distribution across the broad VARIED set (archetypes + interactions + affect
   * sweeps) — its per-axis medians and headline-zone histogram. Drives the global-skew / one-zone-pin
   * guards that catch a read collapsing every varied hum onto one pole. Optional so older callers run.
   */
  readonly distribution?: { readonly arousalMedian: number; readonly valenceMedian: number; readonly zones: ZoneHistogram };
}): ReleaseGate {
  const checks: GateCheck[] = [];
  const add = (id: string, pass: boolean, detail: string): void => { checks.push({ id, pass, detail }); };

  const bright = archetypeVA(args.archetypes, "bright_energised");
  const low = archetypeVA(args.archetypes, "low_flat");
  const calm = archetypeVA(args.archetypes, "calm_content");
  const tense = archetypeVA(args.archetypes, "tense_woundup");
  const neutral = archetypeVA(args.archetypes, "steady_neutral");

  // 1. Fidelity must not MANUFACTURE affect (the core contract).
  const failingLeaks = args.leaks.filter((l) => l.leaks);
  add("fidelity-no-manufacture", failingLeaks.length === 0,
    failingLeaks.length === 0 ? "no fidelity sweep manufactures affect" : `${failingLeaks.length} fidelity sweep(s) manufacture affect: ${failingLeaks.map((l) => l.group).join(", ")}`);

  // 2. The extractor must recover every synthesis control (clean acoustic differences survive).
  const recovered = args.recovery.filter((r) => r.recovered).length;
  add("extractor-recovery", recovered === args.recovery.length,
    `${recovered}/${args.recovery.length} controls recovered` + (recovered === args.recovery.length ? "" : ` — missing: ${args.recovery.filter((r) => !r.recovered).map((r) => r.driver).join(", ")}`));

  // 3. High- and low-energy mood families must SEPARATE on arousal (range reachable + discriminable).
  if (bright && low) {
    const sep = bright.a - low.a;
    add("arousal-separation", sep >= GATE.AROUSAL_SEPARATION, `bright−low arousal = ${sep.toFixed(2)} (need ≥ ${GATE.AROUSAL_SEPARATION})`);
    add("arousal-high-reachable", bright.a >= GATE.AROUSAL_HIGH_MIN, `energised arousal = ${bright.a.toFixed(2)} (need ≥ ${GATE.AROUSAL_HIGH_MIN})`);
    add("arousal-low-reachable", low.a <= GATE.AROUSAL_LOW_MAX, `low-flat arousal = ${low.a.toFixed(2)} (need ≤ ${GATE.AROUSAL_LOW_MAX})`);
  } else add("arousal-separation", false, "missing bright_energised / low_flat archetypes");

  // 4. Positive- and negative-valence mood families must SEPARATE (the low pole the v8 read missed).
  if (bright && low) {
    const sep = bright.v - low.v;
    add("valence-separation", sep >= GATE.VALENCE_SEPARATION, `bright−low valence = ${sep.toFixed(2)} (need ≥ ${GATE.VALENCE_SEPARATION})`);
    add("valence-high-reachable", bright.v >= GATE.VALENCE_HIGH_MIN, `bright valence = ${bright.v.toFixed(2)} (need ≥ ${GATE.VALENCE_HIGH_MIN})`);
    add("valence-low-reachable", low.v <= GATE.VALENCE_LOW_MAX, `low-flat valence = ${low.v.toFixed(2)} (need ≤ ${GATE.VALENCE_LOW_MAX})`);
  } else add("valence-separation", false, "missing bright_energised / low_flat archetypes");

  // 5. The arousal/valence ZERO-POINT must sit near the origin for a neutral hum (no global offset).
  if (neutral) {
    add("neutral-zero-point", Math.abs(neutral.a) <= GATE.NEUTRAL_ABS_MAX && Math.abs(neutral.v) <= GATE.NEUTRAL_ABS_MAX,
      `neutral read = (${neutral.v.toFixed(2)}, ${neutral.a.toFixed(2)}) (|each| ≤ ${GATE.NEUTRAL_ABS_MAX})`);
  } else add("neutral-zero-point", false, "missing steady_neutral archetype");

  // 6. Invalid / malformed audio must NEVER become a confident neutral emotional read.
  const badMalformed = args.malformed.filter((m) => !m.threw && m.abstained !== true);
  add("malformed-abstains", badMalformed.length === 0,
    badMalformed.length === 0 ? "all malformed audio throws or abstains" : `${badMalformed.length} malformed case(s) produced a non-abstained read: ${badMalformed.map((m) => m.id).join(", ")}`);
  // Near-silent / too-faint degenerate hums must abstain or be rejected, not read as emotion.
  const silentLeak = args.failures.filter((f) => /near_silent|too_faint/.test(f.id) && !f.abstained && f.decision !== "rejected");
  add("near-silent-abstains", silentLeak.length === 0,
    silentLeak.length === 0 ? "near-silent hums abstain/reject" : `${silentLeak.map((f) => f.id).join(", ")} produced an emotional read`);

  // 7. Tense (high-A, low-V) and calm (low-A, high-V) must be ordered correctly vs each other
  //    (the diagonal must not collapse — a coarse internal-coherence check).
  if (tense && calm) {
    add("diagonal-ordering", tense.a > calm.a && calm.v > tense.v,
      `tense(${tense.v.toFixed(2)},${tense.a.toFixed(2)}) vs calm(${calm.v.toFixed(2)},${calm.a.toFixed(2)}): arousal & valence must order`);
  }

  // 8. v11 CROSS-VOICE INVARIANCE — voice identity must not dictate the read (the headline contract).
  if (args.crossVoice) {
    const cv = args.crossVoice;
    const ok = cv.displayValenceSpan <= GATE.CROSS_VOICE_VALENCE_MAX && cv.displayArousalSpan <= GATE.CROSS_VOICE_AROUSAL_MAX;
    add("cross-voice-invariance", ok,
      `${cv.voices} voices, same mood → displayed span V ${cv.displayValenceSpan.toFixed(2)} (≤ ${GATE.CROSS_VOICE_VALENCE_MAX}), A ${cv.displayArousalSpan.toFixed(2)} (≤ ${GATE.CROSS_VOICE_AROUSAL_MAX})`);
  }

  // 9. The varied-hum population must STRADDLE the origin — no global axis skew pinning every hum to one
  //    pole. This is the direct guard on the "every hum reads quiet/subdued" symptom: a varied corpus
  //    with a strongly non-zero median read means the outcome is driven by a fixed offset, not the hum.
  if (args.distribution) {
    const { arousalMedian, valenceMedian, zones } = args.distribution;
    add("read-not-skewed",
      Math.abs(arousalMedian) <= GATE.READ_MEDIAN_ABS_MAX && Math.abs(valenceMedian) <= GATE.READ_MEDIAN_ABS_MAX,
      `varied-hum median read = (${valenceMedian.toFixed(2)}, ${arousalMedian.toFixed(2)}) (|each| ≤ ${GATE.READ_MEDIAN_ABS_MAX})`);

    // 10. No single OFF-CENTRE zone may dominate — the histogram-level form of the same contract.
    const offCenter = Object.entries(zones.counts).filter(([z]) => z !== "Steady/Even");
    const worst = offCenter.sort((a, b) => b[1] - a[1])[0];
    const worstFrac = worst && zones.total ? worst[1] / zones.total : 0;
    add("no-single-zone-pin", worstFrac <= GATE.MAX_OFFCENTER_ZONE_FRACTION,
      worst
        ? `most common off-centre zone "${worst[0]}" = ${(worstFrac * 100).toFixed(0)}% of varied hums (≤ ${(GATE.MAX_OFFCENTER_ZONE_FRACTION * 100).toFixed(0)}%)`
        : "no off-centre zones");
  }

  return { pass: checks.every((c) => c.pass), checks };
}

/** Convenience: split a sweep-suite into per-driver groups and compute sensitivities. */
export function sweepSensitivities(sweepResults: readonly SimResult[]): DriverSensitivity[] {
  const byDriver = new Map<string, SimResult[]>();
  for (const r of sweepResults) {
    const m = /^sweep\/([a-zA-Z]+)\//.exec(r.id);
    if (!m) continue;
    const k = m[1] as string;
    (byDriver.get(k) ?? byDriver.set(k, []).get(k)!).push(r);
  }
  const deadSpanFor = (target: string): number => {
    if (target.startsWith("out.")) return 0.04; // unit-scale read outputs
    if (target.startsWith("feat.")) {
      // Hz-scale features need a larger absolute "dead" threshold; small-magnitude perturbation
      // features (jitter ~0.01–0.02) need a finer one so a real response isn't called dead.
      if (/Hz$/.test(target)) return 5;
      if (/jitter|Instability/.test(target)) return 0.004;
      return 0.01;
    }
    return 0.02;
  };
  const out: DriverSensitivity[] = [];
  for (const rs of byDriver.values()) {
    const s = driverSensitivity(rs, deadSpanFor);
    if (s) out.push(s);
  }
  return out;
}

/** Helper used by the report + tests: average a probe target over a result set. */
export function avgTarget(results: readonly SimResult[], target: string): number {
  return mean(results.map((r) => probeVector(r)[target] ?? NaN).filter((x) => Number.isFinite(x)));
}

/** Clamp helper re-export so report code can normalize fractions without another import. */
export { clamp01 };
