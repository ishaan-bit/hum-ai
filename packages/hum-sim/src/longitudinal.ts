/**
 * LONGITUDINAL (STATEFUL) HARNESS — replays a scripted SEQUENCE of synthesized hums
 * through the full personalization loop, carrying forward the on-device state exactly
 * as the product does:
 *
 *   history = humHistoryFromState(state) (+ the within-user acoustic ring)
 *   read    = orchestrateHumAudio({ audio, ..., history })
 *   state   = ingestHum(state, observationFromRead(read))
 *
 * This is the ONLY way to exercise the outputs that are NOT single-hum inferable
 * (audit §3): the personalization re-reference / pull, the within-user DISPLAY
 * re-reference (`reReferenceDisplayRead`, the design's counter-measure to the
 * person+mic pin), the dual-baseline divergence, and relapse/longitudinal drift.
 * A single-hum harness passes those through at cold start and would wrongly report
 * them as "not collapsed" — or wrongly report the re-reference as collapsed.
 *
 * Two questions it answers with evidence:
 *  1. Does personalization damp a genuinely-deviant hum toward origin (H3)? Drive a
 *     stable baseline, then inject a strong-affect hum and watch the internal read.
 *  2. Does the within-user DISPLAY re-reference actually RE-OPEN variation for a
 *     fixed-voice user humming different moods (the intended un-pin)? Compare the
 *     absolute-acoustic zone spread to the displayed zone spread as history grows.
 */
import type { IsoTimestamp } from "@hum-ai/shared-types";
import { newPersonalizationState, type PersonalizationState } from "@hum-ai/personalization-engine";
import {
  acousticAffectAxes,
  humHistoryFromState,
  ingestHum,
  observationFromRead,
  orchestrateHumAudio,
  type AcousticAxisSample,
} from "@hum-ai/orchestrator";
import { asUserId } from "@hum-ai/shared-types";
import { renderHum } from "./synth";
import { makeLatent, type LatentHumProfile } from "./latent";
import { captureResult, zoneOf, type SimResult } from "./pipeline";
import { consentLocal, SIM_MODEL_VERSION, simTimestamp } from "./context";
import { REREF_MIN_HISTORY } from "@hum-ai/orchestrator";

/** One step of a longitudinal sequence: a latent profile captured at a day offset. */
export interface SequenceStep {
  readonly id: string;
  readonly latent: LatentHumProfile;
  /** Day offset from the sequence start (drives the timestamp + risk-series spacing). */
  readonly day: number;
}

/** Per-step longitudinal capture (the full SimResult plus the carried-state context). */
export interface LongitudinalStep {
  readonly index: number;
  readonly day: number;
  readonly result: SimResult;
  /** Eligible-hum count BEFORE this hum (history depth feeding personalization). */
  readonly priorEligibleCount: number;
  /** Acoustic-ring depth feeding the DISPLAY re-reference (engages at REREF_MIN_HISTORY). */
  readonly priorAcousticHistory: number;
  readonly rereferenceEngaged: boolean;
}

export interface SequenceOutcome {
  readonly steps: readonly LongitudinalStep[];
  /** Final on-device state (for chaining / inspection). */
  readonly finalState: PersonalizationState;
}

/**
 * Replay a scripted sequence through the full stateful loop and capture each step.
 * Deterministic given the step latents + day offsets.
 */
export async function runSequence(steps: readonly SequenceStep[]): Promise<SequenceOutcome> {
  const start = simTimestamp(0);
  let state = newPersonalizationState(asUserId("sim-user"), start, SIM_MODEL_VERSION);
  const acousticRing: AcousticAxisSample[] = [];
  const captured: LongitudinalStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as SequenceStep;
    const now: IsoTimestamp = simTimestamp(step.day);
    const priorEligibleCount = state.eligibleHumCount;
    const priorAcousticHistory = acousticRing.length;

    const baseHistory = humHistoryFromState(state, now);
    const history = { ...baseHistory, acousticAxisHistory: acousticRing.slice() };

    const t0 = Date.now();
    const audio = renderHum(step.latent);
    const read = await orchestrateHumAudio({
      audio,
      consent: consentLocal(now),
      modelVersion: SIM_MODEL_VERSION,
      now,
      history,
    });
    const result = captureResult(step.id, step.latent, audio, read, Date.now() - t0);

    captured.push({
      index: i,
      day: step.day,
      result,
      priorEligibleCount,
      priorAcousticHistory,
      rereferenceEngaged: priorAcousticHistory >= REREF_MIN_HISTORY,
    });

    // Carry state forward: push this hum's RAW acoustic backbone into the ring (the
    // display re-reference measures the next hum against these), then ingest the hum.
    const ac = acousticAffectAxes(read.internal.features);
    acousticRing.push({ valence: ac.valence, arousal: ac.arousal });
    state = ingestHum(state, observationFromRead(read, now));
  }

  return { steps: captured, finalState: state };
}

/** Distinct displayed headline zones visited across a sequence (un-pin evidence). */
export function distinctDisplayZones(outcome: SequenceOutcome): Set<string> {
  return new Set(outcome.steps.map((s) => s.result.zone));
}

/** Distinct ABSOLUTE-acoustic zones across a sequence (the pinned baseline to beat). */
export function distinctAcousticZones(outcome: SequenceOutcome): Set<string> {
  return new Set(
    outcome.steps.map((s) => zoneOf(s.result.axisAcoustic.valence, s.result.axisAcoustic.arousal)),
  );
}

// ── canonical longitudinal sequences ────────────────────────────────────────────

/**
 * PIN / UN-PIN sequence — a FIXED-VOICE, FIXED-MIC user (low register, narrow pitch
 * band, consistent fidelity) humming a repeating cycle of felt states over ~18 days.
 * Mood is expressed through the smaller-weight, mood-variable controls (energy, melody,
 * timbral change, micro-instability) with only a tiny pitch wobble — as a real person's
 * voice realistically would. The ABSOLUTE acoustic read therefore clusters (the person+mic
 * pin); the DISPLAYED read should fan out across zones once the within-user re-reference
 * has enough history (≥3 to start, full at ≥12).
 */
export function pinUnpinSequence(days = 18): SequenceStep[] {
  // The same low, quiet voice on the same mic every time.
  const PERSON: Partial<LatentHumProfile> = { pitchHeight: 0.2, brightness: 0.4, micBandwidth: 0.65, noiseLevel: 0.12 };
  // Five within-user moods, expressed WITHOUT moving the fixed register much.
  const MOODS: Array<Partial<LatentHumProfile>> = [
    { energy: 0.45, melodicMovement: 0.35, timbralChange: 0.3, pitchInstability: 0.2, amplitudeInstability: 0.2 }, // usual
    { energy: 0.62, melodicMovement: 0.55, timbralChange: 0.45, pitchInstability: 0.12, amplitudeInstability: 0.12, pitchHeight: 0.24 }, // lighter
    { energy: 0.32, melodicMovement: 0.15, timbralChange: 0.15, pitchInstability: 0.45, amplitudeInstability: 0.45, pitchHeight: 0.16 }, // flatter
    { energy: 0.72, melodicMovement: 0.3, timbralChange: 0.8, pitchInstability: 0.55, amplitudeInstability: 0.55 }, // wired
    { energy: 0.42, melodicMovement: 0.4, timbralChange: 0.18, pitchInstability: 0.08, amplitudeInstability: 0.08, vibratoRegularity: 0.92 }, // settled
  ];
  const steps: SequenceStep[] = [];
  for (let i = 0; i < days; i++) {
    const mood = MOODS[i % MOODS.length] as Partial<LatentHumProfile>;
    steps.push({ id: `pin/${i}`, day: i, latent: makeLatent({ ...PERSON, ...mood, seed: 8000 + i }) });
  }
  return steps;
}

/**
 * PERSONALIZATION-DAMP sequence (H3) — N "usual calm" hums to build a stable baseline,
 * then a single STRONG bright/energised hum. If personalization damps a genuinely-deviant
 * hum toward origin (the H3 hypothesis), the INTERNAL personalized read of the final hum
 * collapses; if it correctly preserves a deviation, it does not. The displayed read uses
 * the separate re-reference path. Run both reads to distinguish the two.
 */
export function personalizationDampSequence(baselineHums = 22): SequenceStep[] {
  const CALM: Partial<LatentHumProfile> = { energy: 0.3, pitchHeight: 0.5, melodicMovement: 0.3, brightness: 0.4, timbralChange: 0.2, pitchInstability: 0.15, amplitudeInstability: 0.15 };
  const STRONG: Partial<LatentHumProfile> = { energy: 0.95, pitchHeight: 0.9, melodicMovement: 0.75, brightness: 0.8, timbralChange: 0.6, pitchInstability: 0.1, amplitudeInstability: 0.1 };
  const steps: SequenceStep[] = [];
  for (let i = 0; i < baselineHums; i++) steps.push({ id: `damp/base${i}`, day: i, latent: makeLatent({ ...CALM, seed: 8500 + i }) });
  steps.push({ id: `damp/strong`, day: baselineHums, latent: makeLatent({ ...STRONG, seed: 8999 }) });
  return steps;
}
