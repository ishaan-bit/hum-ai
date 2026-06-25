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
