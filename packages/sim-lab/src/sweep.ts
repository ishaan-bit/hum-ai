import type { AcousticFeatures } from "@hum-ai/audio-features";
import { resolveAxisRead } from "@hum-ai/orchestrator";
import { assessPersonalitySignature, type BigFiveKey } from "@hum-ai/personality-signature";
import { FEATURE_SPECS, featuresToWindows, refHum, type FeatureKind, type FeatureSpec } from "./reference";

/**
 * ONE-AT-A-TIME SENSITIVITY SWEEP over the rule-based read backbone + the OCEAN
 * signature. For each captured parameter we vary it across its realistic range
 * (every other field held at the neutral reference) and measure how each output
 * responds — its span, direction, monotonicity, saturation and whether it is dead.
 *
 * This is the "calibrate / scale / vectorise the parameters" instrument: it turns
 * the opaque weight tables in `axis-read.ts` / `personality-signature/index.ts` into
 * an observed input→output Jacobian, so a miscalibrated weight, a saturated window,
 * a dead parameter, or a research-contract violation (e.g. a fidelity feature moving
 * valence) is a measured fact rather than a guess.
 */

/** The read outputs a parameter can move. */
export const OUTPUT_KEYS = [
  "valence",
  "arousal",
  "signalStrength",
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "emotional_stability",
] as const;
export type OutputKey = (typeof OUTPUT_KEYS)[number];

/** How many points to sample across each parameter's range. */
export const SWEEP_STEPS = 21;
/** Below this output span a parameter is "dead" for that output (no real influence). */
export const DEAD_SPAN = 0.02;
/** A monotonic step may dip by at most this much (numerical slack). */
const MONO_EPS = 1e-4;
/** Hum count used for the OCEAN read (≥ TENTATIVE_HUMS so traits are read, not "forming"). */
export const OCEAN_HUM_COUNT = 16;

/** The full output vector for one feature vector (rule-based read + OCEAN signature). */
export function readOutputs(features: AcousticFeatures): Record<OutputKey, number> {
  const axis = resolveAxisRead(features);
  const windows = featuresToWindows(features, OCEAN_HUM_COUNT);
  const sig = assessPersonalitySignature(windows, OCEAN_HUM_COUNT);
  const trait = (k: BigFiveKey) => sig.traits.find((t) => t.key === k)?.value ?? 0;
  return {
    valence: axis.dimensional.valence,
    arousal: axis.dimensional.arousal,
    signalStrength: axis.signalStrength,
    openness: trait("openness"),
    conscientiousness: trait("conscientiousness"),
    extraversion: trait("extraversion"),
    agreeableness: trait("agreeableness"),
    emotional_stability: trait("emotional_stability"),
  };
}

/** How one output responded to a parameter sweep. */
export interface Effect {
  readonly output: OutputKey;
  /** max(output) − min(output) across the sweep. */
  readonly span: number;
  /** Output value at the low and high ends of the input range. */
  readonly atLow: number;
  readonly atHigh: number;
  /** Overall direction: sign(atHigh − atLow). 0 when below DEAD_SPAN. */
  readonly slopeSign: -1 | 0 | 1;
  /** Strictly/weakly monotonic across the whole sweep. */
  readonly monotonic: boolean;
  /** The first quintile of the sweep produced no movement (input floor doesn't matter). */
  readonly saturatedLow: boolean;
  /** The last quintile of the sweep produced no movement (input ceiling doesn't matter). */
  readonly saturatedHigh: boolean;
  /** span < DEAD_SPAN — this parameter does not move this output at all. */
  readonly dead: boolean;
}

export interface FeatureSensitivity {
  readonly feature: string;
  readonly kind: FeatureKind;
  readonly group: string;
  readonly min: number;
  readonly max: number;
  readonly note: string;
  /** The input samples used. */
  readonly inputs: readonly number[];
  /** Per-output response. */
  readonly effects: Record<OutputKey, Effect>;
}

function quantize(spec: FeatureSpec): number[] {
  const xs: number[] = [];
  for (let i = 0; i < SWEEP_STEPS; i++) {
    xs.push(spec.min + ((spec.max - spec.min) * i) / (SWEEP_STEPS - 1));
  }
  return xs;
}

function effectFrom(output: OutputKey, series: readonly number[]): Effect {
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo;
  const atLow = series[0]!;
  const atHigh = series[series.length - 1]!;
  const dead = span < DEAD_SPAN;
  const slopeSign: -1 | 0 | 1 = dead ? 0 : atHigh > atLow ? 1 : -1;

  let nondec = true;
  let noninc = true;
  for (let i = 1; i < series.length; i++) {
    const d = series[i]! - series[i - 1]!;
    if (d < -MONO_EPS) nondec = false;
    if (d > MONO_EPS) noninc = false;
  }
  const monotonic = !dead && (nondec || noninc);

  // saturation: a whole end-quintile produced < 5% of the total span of movement
  const q = Math.max(1, Math.floor(series.length / 5));
  const moved = (a: number, b: number) => Math.abs(series[b]! - series[a]!);
  const satSlack = Math.max(DEAD_SPAN, span * 0.05);
  const saturatedLow = !dead && moved(0, q) < satSlack;
  const saturatedHigh = !dead && moved(series.length - 1 - q, series.length - 1) < satSlack;

  return { output, span, atLow, atHigh, slopeSign, monotonic, saturatedLow, saturatedHigh, dead };
}

/** Sweep ONE parameter across its range and measure every output's response. */
export function sweepFeature(spec: FeatureSpec): FeatureSensitivity {
  const inputs = quantize(spec);
  const series: Record<OutputKey, number[]> = {
    valence: [], arousal: [], signalStrength: [],
    openness: [], conscientiousness: [], extraversion: [], agreeableness: [], emotional_stability: [],
  };
  for (const x of inputs) {
    const outs = readOutputs(refHum({ [spec.feature]: x } as Partial<AcousticFeatures>));
    for (const k of OUTPUT_KEYS) series[k].push(outs[k]);
  }
  const effects = {} as Record<OutputKey, Effect>;
  for (const k of OUTPUT_KEYS) effects[k] = effectFrom(k, series[k]);
  return {
    feature: String(spec.feature),
    kind: spec.kind,
    group: spec.group,
    min: spec.min,
    max: spec.max,
    note: spec.note,
    inputs,
    effects,
  };
}

/** Sweep every parameter in `FEATURE_SPECS`. */
export function sweepAll(): FeatureSensitivity[] {
  return FEATURE_SPECS.map(sweepFeature);
}

/** A driver of one output: feature + signed span (positive = increases the output). */
export interface Driver {
  readonly feature: string;
  readonly kind: FeatureKind;
  readonly span: number;
  readonly slopeSign: -1 | 0 | 1;
  readonly monotonic: boolean;
  readonly saturated: boolean;
}

/** Rank the parameters that drive one output, strongest first (dead ones dropped). */
export function driversFor(sensitivities: readonly FeatureSensitivity[], output: OutputKey): Driver[] {
  return sensitivities
    .map((s) => {
      const e = s.effects[output];
      return {
        feature: s.feature,
        kind: s.kind,
        span: e.span,
        slopeSign: e.slopeSign,
        monotonic: e.monotonic,
        saturated: e.saturatedLow || e.saturatedHigh,
      };
    })
    .filter((d) => d.span >= DEAD_SPAN)
    .sort((a, b) => b.span - a.span);
}
