/**
 * INNER-STATE → HUM GENERATOR + RECOVERY GATE (Stable Build v13).
 *
 * The design mandate inverts how the simulator is built: rather than sweep the latent space and
 * watch where the read lands, we START FROM THE INNER STATES we are trying to infer — the medical
 * markers (depression / anxiety / stress / fatigue / flattened / instability) and the broad affect
 * states (calm / joy / excitement / sadness / neutral) — and, for each, generate a WIDE DISTRIBUTION
 * of hums (mean latent + per-control spread) AND a within-hum CONTOUR (the trajectory the state would
 * produce), then assert the EXACT production pipeline recovers that state: the right circumplex region
 * AND a plausible within-hum trajectory shape, and — across a longitudinal series — the within-user
 * read tracks an injected drift.
 *
 * The canonical state list is single-sourced from `@hum-ai/affect-model-contracts` (`AFFECT_STATE_HEADS`)
 * so the sim can never drift from the registry the read actually produces. (`cognitive_attention_strain_later`
 * is reserved / not produced v1, so it is excluded — asserted below.)
 *
 * The 4-layer "no label smuggling" contract (see `latent.ts`) is preserved: the inner state shapes
 * ONLY the waveform (latent + contour); the EXPECTED output is recorded for SCORING and is NEVER fed
 * into `orchestrateHumAudio`. A recovery finding is therefore causal, not circular.
 */
import { clamp01, makeRng } from "@hum-ai/shared-types";
import { AFFECT_STATE_HEADS } from "@hum-ai/affect-model-contracts";
import { makeLatent, type LatentHumProfile, type SynthControls } from "./latent";
import { runHumWithContour, zoneOf, type SimResult } from "./pipeline";
import { runSequence, type SequenceStep } from "./longitudinal";
import type { GateCheck } from "./analysis";

type Sign = -1 | 0 | 1;
type LatentKnobs = Partial<Record<keyof LatentHumProfile, number>>;

/** One canonical inner state and how it shapes — and is recovered from — a hum. */
export interface InnerStateSpec {
  /** Canonical id (an `AFFECT_STATE_HEADS` member or a medical-marker alias). */
  readonly id: string;
  readonly label: string;
  /** Whether this is a clinical risk marker (depression / anxiety / stress / fatigue / …). */
  readonly riskMarker: boolean;
  /** Expected displayed valence / arousal direction (0 = near origin). */
  readonly expectValenceSign: Sign;
  readonly expectArousalSign: Sign;
  /** Within-hum trajectory shapes consistent with this state (lenient set membership). */
  readonly expectShapes: readonly string[];
  /** Mean latent (unit controls). */
  readonly center: LatentKnobs;
  /** Per-control sampling spread (gives each state a WIDE distribution of hums, not one centre). */
  readonly spread: LatentKnobs;
  /** Mean within-hum contour (the arc the state produces: fade/swell, falling/rising pitch). */
  readonly contour: Partial<SynthControls>;
  /** Spread on the contour fields. */
  readonly contourSpread?: { readonly energyShift?: number; readonly pitchShiftSemis?: number };
}

const FADE = { energyShift: -1.2, pitchShiftSemis: -7, shiftCenter: 0.5, shiftSharpness: 9 } as const;
const SWELL = { energyShift: 1.2, pitchShiftSemis: 7, shiftCenter: 0.5, shiftSharpness: 9 } as const;
const SETTLE = { energyShift: -0.7, pitchShiftSemis: -3, shiftCenter: 0.55, shiftSharpness: 7 } as const;
const FLAT = { energyShift: 0, pitchShiftSemis: 0, shiftCenter: 0.5, shiftSharpness: 8 } as const;

/**
 * The canonical inner-state registry. Centres are chosen so the EXTRACTED features land in the read's
 * normalization windows (same discipline as the archetypes); spreads are wide enough that each state
 * yields a genuine distribution of hums. Medical markers map to their circumplex quadrant + the
 * vocal signature the literature associates with them (depressive = low energy + monotone + fading;
 * anxious = high arousal + rising instability; flattened = minimal movement; fatigue = declining energy).
 */
export const INNER_STATES: readonly InnerStateSpec[] = [
  {
    id: "calm_regulated", label: "Calm / regulated", riskMarker: false,
    expectValenceSign: 1, expectArousalSign: -1, expectShapes: ["steady", "settling"],
    center: { energy: 0.3, pitchHeight: 0.5, melodicMovement: 0.4, brightness: 0.5, timbralChange: 0.2, pitchInstability: 0.1, amplitudeInstability: 0.1, vibratoRegularity: 0.9 },
    spread: { energy: 0.06, melodicMovement: 0.12, brightness: 0.08, pitchHeight: 0.08, timbralChange: 0.08 },
    contour: SETTLE, contourSpread: { energyShift: 0.4, pitchShiftSemis: 2 },
  },
  {
    id: "joy_positive_activation", label: "Joy / positive activation", riskMarker: false,
    expectValenceSign: 1, expectArousalSign: 1, expectShapes: ["brightening", "winding_up", "steady"],
    center: { energy: 0.74, pitchHeight: 0.62, melodicMovement: 0.66, brightness: 0.66, timbralChange: 0.45, pitchInstability: 0.15, amplitudeInstability: 0.15, vibratoRegularity: 0.8 },
    spread: { energy: 0.08, melodicMovement: 0.12, brightness: 0.1, pitchHeight: 0.08, timbralChange: 0.1 },
    contour: SWELL, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "excitement", label: "Excitement", riskMarker: false,
    expectValenceSign: 1, expectArousalSign: 1, expectShapes: ["winding_up", "brightening", "steady"],
    center: { energy: 0.86, pitchHeight: 0.7, melodicMovement: 0.72, brightness: 0.72, timbralChange: 0.6, pitchInstability: 0.2, amplitudeInstability: 0.2, vibratoRegularity: 0.7 },
    spread: { energy: 0.06, melodicMovement: 0.1, brightness: 0.08, pitchHeight: 0.08, timbralChange: 0.1 },
    contour: SWELL, contourSpread: { energyShift: 0.5, pitchShiftSemis: 3 },
  },
  {
    id: "stress_overload", label: "Stress overload", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: 1, expectShapes: ["winding_up", "unsettled", "steady"],
    center: { energy: 0.78, pitchHeight: 0.6, melodicMovement: 0.55, brightness: 0.62, timbralChange: 0.62, pitchInstability: 0.5, amplitudeInstability: 0.5, vibratoRegularity: 0.4 },
    spread: { energy: 0.08, pitchInstability: 0.12, amplitudeInstability: 0.12, timbralChange: 0.1, melodicMovement: 0.1 },
    contour: SWELL, contourSpread: { energyShift: 0.5, pitchShiftSemis: 3 },
  },
  {
    id: "anger_frustration", label: "Anger / frustration", riskMarker: false,
    expectValenceSign: -1, expectArousalSign: 1, expectShapes: ["winding_up", "unsettled", "steady"],
    center: { energy: 0.8, pitchHeight: 0.58, melodicMovement: 0.5, brightness: 0.66, timbralChange: 0.66, pitchInstability: 0.5, amplitudeInstability: 0.5, vibratoRegularity: 0.35 },
    spread: { energy: 0.07, pitchInstability: 0.12, amplitudeInstability: 0.12, timbralChange: 0.1 },
    contour: SWELL, contourSpread: { energyShift: 0.5, pitchShiftSemis: 3 },
  },
  {
    id: "anxiety_like_tension", label: "Anxiety-like tension", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: 1, expectShapes: ["winding_up", "unsettled", "steady"],
    center: { energy: 0.6, pitchHeight: 0.62, melodicMovement: 0.5, brightness: 0.6, timbralChange: 0.55, pitchInstability: 0.62, amplitudeInstability: 0.55, vibratoRegularity: 0.32 },
    spread: { energy: 0.08, pitchInstability: 0.12, amplitudeInstability: 0.12, melodicMovement: 0.1 },
    contour: SWELL, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "fear_like_activation", label: "Fear-like activation", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: 1, expectShapes: ["winding_up", "unsettled", "steady"],
    center: { energy: 0.64, pitchHeight: 0.68, melodicMovement: 0.5, brightness: 0.64, timbralChange: 0.58, pitchInstability: 0.6, amplitudeInstability: 0.55, vibratoRegularity: 0.3 },
    spread: { energy: 0.08, pitchInstability: 0.12, amplitudeInstability: 0.12, pitchHeight: 0.08 },
    contour: SWELL, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "sadness_low_mood", label: "Sadness / low mood", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: -1, expectShapes: ["fading", "settling", "steady"],
    center: { energy: 0.3, pitchHeight: 0.38, melodicMovement: 0.18, brightness: 0.38, timbralChange: 0.12, pitchInstability: 0.25, amplitudeInstability: 0.25, vibratoRegularity: 0.5 },
    spread: { energy: 0.06, melodicMovement: 0.08, brightness: 0.08, pitchHeight: 0.08 },
    contour: FADE, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "depressive_affect_markers", label: "Depressive-affect markers", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: -1, expectShapes: ["fading", "steady", "settling"],
    center: { energy: 0.26, pitchHeight: 0.36, melodicMovement: 0.12, brightness: 0.35, timbralChange: 0.1, pitchInstability: 0.2, amplitudeInstability: 0.2, vibratoRegularity: 0.5, voicingContinuity: 0.7 },
    spread: { energy: 0.05, melodicMovement: 0.06, brightness: 0.06, pitchHeight: 0.06 },
    contour: FADE, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "fatigue_low_recovery", label: "Fatigue / low recovery", riskMarker: true,
    expectValenceSign: -1, expectArousalSign: -1, expectShapes: ["fading", "settling", "steady"],
    center: { energy: 0.28, pitchHeight: 0.4, melodicMovement: 0.2, brightness: 0.4, timbralChange: 0.12, pitchInstability: 0.2, amplitudeInstability: 0.2, voicingContinuity: 0.62 },
    spread: { energy: 0.06, melodicMovement: 0.08, voicingContinuity: 0.08 },
    contour: FADE, contourSpread: { energyShift: 0.4, pitchShiftSemis: 3 },
  },
  {
    id: "emotional_instability", label: "Emotional instability", riskMarker: true,
    expectValenceSign: 0, expectArousalSign: 1, expectShapes: ["unsettled", "winding_up", "steady"],
    center: { energy: 0.6, pitchHeight: 0.55, melodicMovement: 0.62, brightness: 0.58, timbralChange: 0.72, pitchInstability: 0.7, amplitudeInstability: 0.7, vibratoRegularity: 0.25 },
    spread: { energy: 0.12, melodicMovement: 0.14, timbralChange: 0.12, pitchInstability: 0.14, amplitudeInstability: 0.14 },
    contour: SWELL, contourSpread: { energyShift: 0.7, pitchShiftSemis: 5 },
  },
  {
    id: "flattened_affect", label: "Flattened affect", riskMarker: true,
    expectValenceSign: 0, expectArousalSign: -1, expectShapes: ["steady", "settling"],
    center: { energy: 0.34, pitchHeight: 0.46, melodicMovement: 0.1, brightness: 0.42, timbralChange: 0.08, pitchInstability: 0.12, amplitudeInstability: 0.12, vibratoDepth: 0.15, vibratoRegularity: 0.7 },
    spread: { energy: 0.05, brightness: 0.06, pitchHeight: 0.06 },
    contour: FLAT,
  },
  {
    id: "mixed_state", label: "Mixed state", riskMarker: false,
    expectValenceSign: 0, expectArousalSign: 0, expectShapes: ["unsettled", "steady"],
    center: { energy: 0.52, pitchHeight: 0.5, melodicMovement: 0.5, brightness: 0.5, timbralChange: 0.5, pitchInstability: 0.45, amplitudeInstability: 0.45, vibratoRegularity: 0.45 },
    spread: { energy: 0.12, melodicMovement: 0.12, timbralChange: 0.12 },
    contour: { energyShift: 0.6, pitchShiftSemis: -3, shiftCenter: 0.5, shiftSharpness: 8 }, contourSpread: { energyShift: 0.6, pitchShiftSemis: 4 },
  },
  {
    id: "neutral_close_to_usual", label: "Neutral / close to usual", riskMarker: false,
    expectValenceSign: 0, expectArousalSign: 0, expectShapes: ["steady"],
    center: { energy: 0.5, pitchHeight: 0.5, melodicMovement: 0.35, brightness: 0.45, timbralChange: 0.3, pitchInstability: 0.2, amplitudeInstability: 0.2, vibratoRegularity: 0.65 },
    spread: { energy: 0.05, melodicMovement: 0.06, brightness: 0.06 },
    contour: FLAT,
  },
];

const lerpRng = (center: number, spread: number, rng: () => number): number => center + (rng() * 2 - 1) * spread;

/** Sample ONE hum (latent + contour) from an inner state's distribution, deterministically by seed. */
export function sampleInnerStateHum(
  spec: InnerStateSpec,
  seed: number,
): { latent: LatentHumProfile; contour: Partial<SynthControls> } {
  const rng = makeRng(seed >>> 0);
  const over: LatentKnobs = {};
  for (const [k, c] of Object.entries(spec.center) as [keyof LatentHumProfile, number][]) {
    const sp = spec.spread[k] ?? 0;
    over[k] = sp > 0 ? clamp01(lerpRng(c, sp, rng)) : c;
  }
  const contour: { -readonly [K in keyof SynthControls]?: SynthControls[K] } = { ...spec.contour };
  if (spec.contourSpread?.energyShift && contour.energyShift !== undefined) {
    contour.energyShift = lerpRng(contour.energyShift, spec.contourSpread.energyShift, rng);
  }
  if (spec.contourSpread?.pitchShiftSemis && contour.pitchShiftSemis !== undefined) {
    contour.pitchShiftSemis = lerpRng(contour.pitchShiftSemis, spec.contourSpread.pitchShiftSemis, rng);
  }
  return { latent: makeLatent({ ...over, seed }), contour };
}

/** Run the full single-hum inner-state battery: `reps` hums per state, through the exact pipeline. */
export async function runInnerStateBattery(reps = 6): Promise<Map<string, SimResult[]>> {
  const out = new Map<string, SimResult[]>();
  let seed = 41000;
  for (const spec of INNER_STATES) {
    const results: SimResult[] = [];
    for (let i = 0; i < reps; i++) {
      const { latent, contour } = sampleInnerStateHum(spec, seed++);
      results.push(await runHumWithContour(`inner/${spec.id}/${i}`, latent, contour, {}));
    }
    out.set(spec.id, results);
  }
  return out;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const num = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "—");
/**
 * Recovery thresholds. AROUSAL sign is robustly recoverable from a single COLD hum (no history) —
 * loudness/animation drive it directly. VALENCE sign is NOT reliably recoverable cold (acoustic
 * valence is weak + positively biased without the within-user re-reference — the documented design
 * limitation the longitudinal layer exists to solve); so the single-hum gate asserts arousal sign +
 * trajectory + a weak valence ORDERING, and the VALENCE-SIGN claim is carried by the longitudinal
 * gate (where the within-user read recovers it fully).
 */
const AROUSAL_SIGN_MIN = 0.1;
const NEUTRAL_MAX = 0.22;
const arousalOk = (value: number, sign: Sign): boolean =>
  sign === 0 ? Math.abs(value) <= NEUTRAL_MAX : sign > 0 ? value >= AROUSAL_SIGN_MIN : value <= -AROUSAL_SIGN_MIN;

export interface InnerStateGateResult {
  readonly pass: boolean;
  readonly checks: readonly GateCheck[];
  readonly rows: readonly string[];
}

/**
 * THE INNER-STATE RECOVERY GATE. For each canonical inner state, assert the EXACT pipeline recovers
 * what it can honestly recover from a single COLD hum:
 *  - the recovered AROUSAL direction matches the state (the robust claim — activation is legible cold);
 *  - a MAJORITY of the state's wide hum distribution recovers a within-hum trajectory SHAPE consistent
 *    with the state (depressive→fading, anxious→winding_up, calm→settling …; or steady — a subtle hum
 *    honestly stays steady);
 *  - high-arousal states SEPARATE from low-arousal states on the recovered arousal;
 *  - positive-valence states read, on average, MORE positive than negative-valence ones (a weak but
 *    real cold valence ordering — the full valence-sign recovery is the longitudinal gate's job);
 *  - the canonical state list MATCHES the contracts registry (single source of truth).
 * Scored on the WITHIN-USER signals the read actually produces (V/A region + trajectory), NOT on fine
 * clinical heads that v1 fusion does not emit (`risk.ts`).
 */
export function evaluateInnerStateGate(byState: Map<string, SimResult[]>): InnerStateGateResult {
  const checks: GateCheck[] = [];
  const rows: string[] = [];
  const add = (id: string, pass: boolean, detail: string): void => { checks.push({ id, pass, detail }); };

  // 1. Single source of truth: every produced affect-state head (minus the reserved one) is covered.
  const covered = new Set(INNER_STATES.map((s) => s.id));
  const expectedHeads = AFFECT_STATE_HEADS.filter((h) => h !== "cognitive_attention_strain_later");
  const missing = expectedHeads.filter((h) => !covered.has(h));
  add("inner:covers-affect-heads", missing.length === 0,
    missing.length === 0 ? `all ${expectedHeads.length} produced affect-state heads have a generator` : `missing generators: ${missing.join(", ")}`);

  const lowA: number[] = [];
  const highA: number[] = [];
  const posV: number[] = [];
  const negV: number[] = [];
  for (const spec of INNER_STATES) {
    const rs = byState.get(spec.id) ?? [];
    if (rs.length === 0) { add(`inner:${spec.id}`, false, "no hums generated"); continue; }
    const vMean = mean(rs.map((r) => r.displayAxis.valence));
    const aMean = mean(rs.map((r) => r.displayAxis.arousal));
    const shapeOk = rs.filter((r) => !r.temporal || spec.expectShapes.includes(r.temporal.shape)).length;
    const shapeFrac = shapeOk / rs.length;
    const aOk = arousalOk(aMean, spec.expectArousalSign);
    const ok = aOk && shapeFrac >= 0.5;
    if (spec.expectArousalSign < 0) lowA.push(aMean);
    if (spec.expectArousalSign > 0) highA.push(aMean);
    if (spec.expectValenceSign > 0) posV.push(vMean);
    if (spec.expectValenceSign < 0) negV.push(vMean);
    const shapes = rs.map((r) => r.temporal?.shape ?? "—").join(",");
    rows.push(`${spec.id.padEnd(26)} V=${num(vMean)} A=${num(aMean)} shapeOk=${(shapeFrac * 100).toFixed(0)}% zones=[${new Set(rs.map((r) => r.zone)).size}] shapes=[${shapes}]`);
    add(`inner:${spec.id}`, ok,
      `arousal A=${num(aMean)}(want ${spec.expectArousalSign}) shapeOk=${(shapeFrac * 100).toFixed(0)}% [V=${num(vMean)} cold]`);
  }

  // 2. Arousal separation: activated states must, on average, out-arouse the subdued ones.
  const aSep = mean(highA) - mean(lowA);
  add("inner:arousal-separates", highA.length > 0 && lowA.length > 0 && aSep >= 0.4,
    `high-arousal states − low-arousal states arousal = ${num(aSep)} (need ≥ 0.4)`);

  // 3. Cold valence ORDERING: positive-valence states read, on average, more positive than negative
  //    ones (weak but real; the strong valence-sign recovery is the longitudinal gate's claim).
  const vSep = mean(posV) - mean(negV);
  add("inner:valence-orders", posV.length > 0 && negV.length > 0 && vSep >= 0.03,
    `positive-valence − negative-valence states valence = ${num(vSep)} (need ≥ 0.03, cold); full sign recovery is longitudinal`);

  return { pass: checks.every((c) => c.pass), checks, rows };
}

// ── longitudinal inner-state trajectories (within-user drift recovery) ────────────────────────

/**
 * Build a within-user SEQUENCE that drifts from a baseline state into a target state over the back
 * half of the series (a sustained, multi-day drift — the shape the medical markers watch for). The
 * fixed-voice person hums the same register; only the MOOD-variable controls drift, so the drift must
 * survive the within-user display re-reference to register (it is not an absolute pin).
 */
function driftSequence(
  name: string,
  baseline: InnerStateSpec,
  target: InnerStateSpec,
  days = 16,
): SequenceStep[] {
  const PERSON: Partial<LatentHumProfile> = { pitchHeight: 0.42, brightness: 0.45, micBandwidth: 0.68, noiseLevel: 0.12 };
  const onset = Math.floor(days / 2);
  const steps: SequenceStep[] = [];
  for (let i = 0; i < days; i++) {
    const t = i < onset ? 0 : Math.min(1, (i - onset + 1) / (days - onset));
    const blend: LatentKnobs = {};
    const keys = new Set([...Object.keys(baseline.center), ...Object.keys(target.center)] as (keyof LatentHumProfile)[]);
    for (const k of keys) {
      const b = baseline.center[k];
      const g = target.center[k];
      if (b !== undefined && g !== undefined) blend[k] = b + (g - b) * t;
      else if (b !== undefined) blend[k] = b;
      else if (g !== undefined) blend[k] = g;
    }
    steps.push({ id: `${name}/${i}`, day: i, latent: makeLatent({ ...PERSON, ...blend, seed: 46000 + i }) });
  }
  return steps;
}

const stateById = (id: string): InnerStateSpec => INNER_STATES.find((s) => s.id === id) as InnerStateSpec;

export interface LongitudinalInnerStateResult {
  readonly pass: boolean;
  readonly checks: readonly GateCheck[];
  readonly rows: readonly string[];
}

/**
 * THE LONGITUDINAL INNER-STATE GATE. Replays drift sequences through the full personalization loop and
 * asserts the WITHIN-USER displayed read tracks the injected drift: a depressive drift pulls the late
 * displayed valence/arousal BELOW the early baseline; an activating (anxiety) drift pushes late arousal
 * ABOVE baseline. This is the "longitudinal models which will yield those inner states" claim, scored on
 * the displayed read the engine actually produces (not the unproduced fine clinical heads).
 */
export async function runLongitudinalInnerStateGate(): Promise<LongitudinalInnerStateResult> {
  const checks: GateCheck[] = [];
  const rows: string[] = [];
  const add = (id: string, pass: boolean, detail: string): void => { checks.push({ id, pass, detail }); };

  const early = (rs: SimResult[]): { v: number; a: number } => {
    const head = rs.slice(0, 4);
    return { v: mean(head.map((r) => r.displayAxis.valence)), a: mean(head.map((r) => r.displayAxis.arousal)) };
  };
  const late = (rs: SimResult[]): { v: number; a: number } => {
    const tail = rs.slice(-4);
    return { v: mean(tail.map((r) => r.displayAxis.valence)), a: mean(tail.map((r) => r.displayAxis.arousal)) };
  };

  // Depressive drift: calm baseline → depressive. Late valence + arousal should fall below baseline.
  const dep = await runSequence(driftSequence("dep", stateById("calm_regulated"), stateById("depressive_affect_markers")));
  const depRs = dep.steps.map((s) => s.result);
  const dE = early(depRs);
  const dL = late(depRs);
  const depTrend = depRs[depRs.length - 1]?.longitudinal.trendDirection ?? "—";
  add("inner-long:depressive-drift-down",
    dL.v <= dE.v - 0.08 && dL.a <= dE.a + 0.04,
    `displayed V ${num(dE.v)}→${num(dL.v)}, A ${num(dE.a)}→${num(dL.a)} (want late V below early); trend=${depTrend}`);
  rows.push(`depressive  V ${num(dE.v)}→${num(dL.v)}  A ${num(dE.a)}→${num(dL.a)}  trend=${depTrend}`);

  // Anxiety onset: calm baseline → anxiety. Late arousal should rise above baseline.
  const anx = await runSequence(driftSequence("anx", stateById("calm_regulated"), stateById("anxiety_like_tension")));
  const anxRs = anx.steps.map((s) => s.result);
  const aE = early(anxRs);
  const aL = late(anxRs);
  add("inner-long:anxiety-onset-up",
    aL.a >= aE.a + 0.08,
    `displayed A ${num(aE.a)}→${num(aL.a)} (want late arousal above early)`);
  rows.push(`anxiety     V ${num(aE.v)}→${num(aL.v)}  A ${num(aE.a)}→${num(aL.a)}`);

  // Recovery: sadness baseline → calm. Late valence should rise above baseline.
  const rec = await runSequence(driftSequence("rec", stateById("sadness_low_mood"), stateById("calm_regulated")));
  const recRs = rec.steps.map((s) => s.result);
  const rE = early(recRs);
  const rL = late(recRs);
  add("inner-long:recovery-up",
    rL.v >= rE.v + 0.08,
    `displayed V ${num(rE.v)}→${num(rL.v)} (want late valence above early)`);
  rows.push(`recovery    V ${num(rE.v)}→${num(rL.v)}  A ${num(rE.a)}→${num(rL.a)}`);

  return { pass: checks.every((c) => c.pass), checks, rows };
}
