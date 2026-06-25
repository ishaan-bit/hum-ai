/**
 * SCENARIO LIBRARY — the coverage matrix the simulator drives through the pipeline.
 *
 * Five batteries, each inferred from what the implementation actually consumes:
 *
 *  1. REACHABILITY SWEEPS — vary ONE affect/voice-quality/fidelity latent control across
 *     its full range (others held neutral), multiple seeded realizations per point, so we
 *     can measure whether each output moves in the expected direction and reaches a
 *     meaningful portion of its range.
 *  2. ARCHETYPES — realistic combined felt-state profiles (multiple realizations each),
 *     to tabulate the user-visible zone histogram (the center-collapse symptom).
 *  3. INTERACTIONS — combinations where cues reinforce / offset / conflict, to expose
 *     accidental coupling, hidden priors, and the fidelity→affect leak.
 *  4. ROBUSTNESS — duration, sample-rate, gain, clipping, reverb, noise, device band,
 *     voicing continuity, register extremes, DC offset.
 *  5. FAILURE / BOUNDARY — near-silent, severe noise, too-short/long, unstable pitch,
 *     clipped, mixed voicing, and MALFORMED raw audio (empty / NaN / zero-rate) that must
 *     trigger explicit quality handling rather than silently produce a neutral read.
 *
 * Each item carries optional `expectValenceSign` / `expectArousalSign` ONLY where the
 * implementation supports a directional claim (responsiveness is asserted only there).
 */
import { makeRng } from "@hum-ai/shared-types";
import type { AudioInput } from "@hum-ai/audio-features";
import { makeLatent, UNIT_LATENT_KEYS, type LatentHumProfile, type UnitLatentKey } from "./latent";

export type Sign = -1 | 0 | 1;

export interface ScenarioItem {
  readonly id: string;
  readonly group: string;
  readonly latent: LatentHumProfile;
  /** The control being swept (for reachability attribution), or null for combined items. */
  readonly drivenBy: UnitLatentKey | null;
  readonly drivenValue: number | null;
  /** Expected sign of the user-facing read, where the implementation supports the claim. */
  readonly expectValenceSign?: Sign;
  readonly expectArousalSign?: Sign;
}

/**
 * Fidelity controls are held at their clean neutral during affect/voice-quality jitter:
 * noise/mic/reverb/clip CONTAMINATE the feature measurement (e.g. noise inflates the spectral
 * centroid), so jittering them into an affect-reachability sweep would confound it. They are
 * exercised on purpose by the robustness + fidelity-invariance batteries instead.
 */
const JITTER_EXCLUDE_FIDELITY = new Set<string>(["noiseLevel", "micBandwidth", "roomReverb", "clipping"]);

/** Small deterministic jitter on the "irrelevant" AFFECT/voice-quality controls (fidelity held clean). */
function jitterIrrelevant(base: Partial<LatentHumProfile>, exclude: ReadonlySet<string>, rng: () => number): Partial<LatentHumProfile> {
  const out: Record<string, number> = {};
  for (const k of UNIT_LATENT_KEYS) {
    if (exclude.has(k) || JITTER_EXCLUDE_FIDELITY.has(k)) continue;
    const baseVal = (base as Record<string, number>)[k] ?? 0.4;
    out[k] = Math.min(1, Math.max(0, baseVal + (rng() * 2 - 1) * 0.06));
  }
  return out as Partial<LatentHumProfile>;
}

// ── 1. Reachability sweeps ─────────────────────────────────────────────────────

export const SWEEP_STEPS = 9;
export const SWEEP_REPS = 3;

/**
 * For each unit latent control, sweep it 0→1 (others neutral + lightly jittered across
 * reps so the sweep isn't dependent on one idealized realization).
 */
export function reachabilitySweeps(steps = SWEEP_STEPS, reps = SWEEP_REPS): ScenarioItem[] {
  const items: ScenarioItem[] = [];
  for (const key of UNIT_LATENT_KEYS) {
    for (let s = 0; s < steps; s++) {
      const v = steps === 1 ? 0.5 : s / (steps - 1);
      for (let r = 0; r < reps; r++) {
        const rng = makeRng(1000 + s * 31 + r);
        const exclude = new Set<string>([key]);
        const jit = jitterIrrelevant({ [key]: v } as Partial<LatentHumProfile>, exclude, rng);
        items.push({
          id: `sweep/${key}/${v.toFixed(3)}/r${r}`,
          group: `sweep:${key}`,
          drivenBy: key,
          drivenValue: v,
          latent: makeLatent({ ...jit, [key]: v, seed: 7000 + s * 11 + r } as Partial<LatentHumProfile>),
        });
      }
    }
  }
  return items;
}

// ── 2. Multi-factor archetypes ─────────────────────────────────────────────────

export interface Archetype {
  readonly id: string;
  readonly center: Partial<LatentHumProfile>;
  readonly expectValenceSign: Sign;
  readonly expectArousalSign: Sign;
  /** Whether this archetype's corner is asserted as a responsiveness test (only the clear ones). */
  readonly asserted: boolean;
}

/**
 * Realistic combined felt-state profiles, in LATENT space (informed by the synth→feature
 * probe so each combination actually lands where intended). Russell V-A circumplex:
 * arousal ↔ energy/pitch/brightness/animation; valence ↔ pitch-height + melody + a settled
 * (low-instability, even-vibrato) voice quality.
 */
export const ARCHETYPES: readonly Archetype[] = [
  { id: "bright_energised", expectValenceSign: 1, expectArousalSign: 1, asserted: true,
    center: { energy: 0.92, pitchHeight: 0.85, melodicMovement: 0.7, brightness: 0.75, timbralChange: 0.55, pitchInstability: 0.1, amplitudeInstability: 0.12, vibratoRegularity: 0.8, vibratoDepth: 0.45 } },
  { id: "calm_content", expectValenceSign: 1, expectArousalSign: -1, asserted: true,
    center: { energy: 0.22, pitchHeight: 0.78, melodicMovement: 0.42, brightness: 0.4, timbralChange: 0.12, pitchInstability: 0.08, amplitudeInstability: 0.1, vibratoRegularity: 0.88, vibratoDepth: 0.5 } },
  { id: "tense_woundup", expectValenceSign: -1, expectArousalSign: 1, asserted: true,
    center: { energy: 0.85, pitchHeight: 0.4, melodicMovement: 0.22, brightness: 0.8, timbralChange: 0.85, pitchInstability: 0.7, amplitudeInstability: 0.7, vibratoRegularity: 0.3, vibratoDepth: 0.3 } },
  { id: "low_flat", expectValenceSign: -1, expectArousalSign: -1, asserted: true,
    center: { energy: 0.16, pitchHeight: 0.1, melodicMovement: 0.1, brightness: 0.22, timbralChange: 0.14, pitchInstability: 0.5, amplitudeInstability: 0.5, vibratoRegularity: 0.35, vibratoDepth: 0.2 } },
  { id: "steady_neutral", expectValenceSign: 0, expectArousalSign: 0, asserted: false,
    center: {} },
  { id: "restless_activated", expectValenceSign: 0, expectArousalSign: 1, asserted: false,
    center: { energy: 0.8, brightness: 0.7, timbralChange: 0.8, pitchHeight: 0.5, melodicMovement: 0.4, pitchInstability: 0.45, amplitudeInstability: 0.45 } },
  { id: "quiet_subdued", expectValenceSign: 0, expectArousalSign: -1, asserted: false,
    center: { energy: 0.2, brightness: 0.3, timbralChange: 0.12, pitchHeight: 0.45, melodicMovement: 0.3 } },
  { id: "warm_steady", expectValenceSign: 1, expectArousalSign: 0, asserted: false,
    center: { pitchHeight: 0.82, melodicMovement: 0.55, brightness: 0.45, energy: 0.45, timbralChange: 0.25, pitchInstability: 0.1, amplitudeInstability: 0.1, vibratoRegularity: 0.85 } },
  { id: "downbeat", expectValenceSign: -1, expectArousalSign: 0, asserted: false,
    center: { pitchHeight: 0.18, melodicMovement: 0.15, brightness: 0.3, energy: 0.42, pitchInstability: 0.5, amplitudeInstability: 0.45, vibratoRegularity: 0.4 } },
];

export const ARCHETYPE_REPS = 5;

export function archetypeScenarios(reps = ARCHETYPE_REPS): ScenarioItem[] {
  const items: ScenarioItem[] = [];
  for (const a of ARCHETYPES) {
    const exclude = new Set<string>(Object.keys(a.center));
    for (let r = 0; r < reps; r++) {
      const rng = makeRng(2000 + r * 17);
      const jit = jitterIrrelevant(a.center, exclude, rng);
      items.push({
        id: `archetype/${a.id}/r${r}`,
        group: `archetype:${a.id}`,
        drivenBy: null,
        drivenValue: null,
        expectValenceSign: a.expectValenceSign,
        expectArousalSign: a.expectArousalSign,
        latent: makeLatent({ ...jit, ...a.center, seed: 3000 + r * 13 } as Partial<LatentHumProfile>),
      });
    }
  }
  return items;
}

/** Just the four asserted corner archetypes (one realization each) — for responsiveness tests. */
export function cornerArchetypes(): ScenarioItem[] {
  return archetypeScenarios(1).filter((it) => ARCHETYPES.find((a) => `archetype:${a.id}` === it.group)?.asserted);
}

// ── 3. Interaction tests ────────────────────────────────────────────────────────

/**
 * Combinations where cues reinforce, offset, or conflict — to expose accidental feature
 * coupling, over-reliance on one cue, hidden priors, and the fidelity→affect leak.
 */
export function interactionScenarios(): ScenarioItem[] {
  const items: ScenarioItem[] = [];
  const add = (id: string, center: Partial<LatentHumProfile>, eV?: Sign, eA?: Sign) =>
    items.push({
      id: `interaction/${id}`,
      group: "interaction",
      drivenBy: null,
      drivenValue: null,
      expectValenceSign: eV,
      expectArousalSign: eA,
      latent: makeLatent({ ...center, seed: 4000 + items.length }),
    });

  // Reinforcing vs conflicting energy/pitch (does loud-but-low-pitch read tense?).
  add("loud_lowpitch", { energy: 0.9, pitchHeight: 0.15, brightness: 0.7, timbralChange: 0.7, pitchInstability: 0.6 }, -1, 1);
  add("soft_highpitch", { energy: 0.18, pitchHeight: 0.9, melodicMovement: 0.5, brightness: 0.4 }, 1, -1);
  // Brightness vs noise (does noise masquerade as brightness/arousal?).
  add("bright_clean", { brightness: 0.95, noiseLevel: 0.0, energy: 0.6 });
  add("dark_noisy", { brightness: 0.1, noiseLevel: 0.9, energy: 0.6 });
  // Melodic-but-unstable (expressive vs agitated) — valence tug-of-war.
  add("melodic_unstable", { melodicMovement: 0.9, pitchInstability: 0.8, amplitudeInstability: 0.8, pitchHeight: 0.6 });
  add("flat_stable", { melodicMovement: 0.05, pitchInstability: 0.05, amplitudeInstability: 0.05, vibratoRegularity: 0.95, pitchHeight: 0.5 });
  // Vibrato regular vs ragged at fixed everything-else.
  add("vibrato_even", { vibratoDepth: 0.9, vibratoRegularity: 0.95 });
  add("vibrato_ragged", { vibratoDepth: 0.9, vibratoRegularity: 0.1 });
  return items;
}

/**
 * FIDELITY-LEAK probe: a FIXED mood, with ONLY the fidelity controls (noise / mic band /
 * reverb) varied across a range. A correct pipeline keeps valence AND arousal essentially
 * invariant here (fidelity belongs to signal-strength + confidence, never the affect read).
 * Returns groups keyed by the fixed mood so the analysis can measure the affect drift.
 */
export function fidelityInvarianceScenarios(): ScenarioItem[] {
  const moods: Array<{ id: string; center: Partial<LatentHumProfile> }> = [
    { id: "neutral", center: {} },
    { id: "calm", center: ARCHETYPES.find((a) => a.id === "calm_content")!.center },
    { id: "energised", center: ARCHETYPES.find((a) => a.id === "bright_energised")!.center },
  ];
  const items: ScenarioItem[] = [];
  for (const m of moods) {
    for (const [fk, label] of [["noiseLevel", "noise"], ["micBandwidth", "mic"], ["roomReverb", "reverb"]] as const) {
      for (let s = 0; s < 5; s++) {
        const v = s / 4;
        items.push({
          id: `fidelity/${m.id}/${label}/${v.toFixed(2)}`,
          group: `fidelity:${m.id}:${label}`,
          drivenBy: fk,
          drivenValue: v,
          latent: makeLatent({ ...m.center, [fk]: v, seed: 5000 + s } as Partial<LatentHumProfile>),
        });
      }
    }
  }
  return items;
}

// ── 4. Robustness tests ─────────────────────────────────────────────────────────

export function robustnessScenarios(): ScenarioItem[] {
  const items: ScenarioItem[] = [];
  const add = (id: string, over: Partial<LatentHumProfile>) =>
    items.push({ id: `robust/${id}`, group: "robustness", drivenBy: null, drivenValue: null, latent: makeLatent({ ...over, seed: 6000 + items.length }) });

  for (const d of [2, 4, 8, 12, 20, 30]) add(`duration_${d}s`, { durationSec: d });
  for (const sr of [8000, 16000, 22050, 44100, 48000]) add(`samplerate_${sr}`, { sampleRate: sr });
  for (const g of [0.05, 0.2, 0.5, 1, 1.5, 2.5]) add(`gain_${g}`, { gain: g });
  for (const cl of [0, 0.3, 0.6, 1]) add(`clip_${cl}`, { clipping: cl, energy: 0.8 });
  for (const rv of [0, 0.3, 0.6, 1]) add(`reverb_${rv}`, { roomReverb: rv });
  for (const nz of [0, 0.3, 0.6, 1]) add(`noise_${nz}`, { noiseLevel: nz });
  for (const mb of [0, 0.3, 0.6, 1]) add(`micband_${mb}`, { micBandwidth: mb });
  for (const vc of [0.05, 0.25, 0.5, 0.85, 1]) add(`continuity_${vc}`, { voicingContinuity: vc });
  for (const dc of [-1, -0.5, 0, 0.5, 1]) add(`dcoffset_${dc}`, { dcOffset: dc });
  for (const ph of [0, 0.5, 1]) add(`register_${ph}`, { pitchHeight: ph });
  return items;
}

// ── 5. Failure / boundary tests ──────────────────────────────────────────────────

/** Degenerate-but-valid latent profiles that SHOULD trip explicit quality handling. */
export function failureScenarios(): ScenarioItem[] {
  const items: ScenarioItem[] = [];
  const add = (id: string, over: Partial<LatentHumProfile>) =>
    items.push({ id: `failure/${id}`, group: "failure", drivenBy: null, drivenValue: null, latent: makeLatent({ ...over, seed: 6500 + items.length }) });

  add("near_silent", { energy: 0.0, gain: 0.02, noiseLevel: 0.0 });
  add("too_faint", { energy: 0.0, gain: 0.08 });
  add("severe_noise", { noiseLevel: 1, energy: 0.2 });
  add("too_short", { durationSec: 3 });
  add("very_long", { durationSec: 40 });
  add("heavy_clip", { clipping: 1, gain: 2.5, energy: 0.9 });
  add("barely_voiced", { voicingContinuity: 0.05, energy: 0.3 });
  add("unstable_pitch", { pitchInstability: 1, melodicMovement: 1, vibratoRegularity: 0.05, vibratoDepth: 1 });
  add("breathy_unvoiced", { energy: 0.15, noiseLevel: 0.7, voicingContinuity: 0.2, brightness: 0.9 });
  return items;
}

/** A malformed raw-audio case fed DIRECTLY to the extractor/orchestrator (bypasses synth). */
export interface MalformedCase {
  readonly id: string;
  readonly audio: AudioInput;
  readonly note: string;
  /** Whether the production code is expected to throw (vs return a safe rejected read). */
  readonly mayThrow: boolean;
}

/** Invalid / malformed inputs the production code must handle explicitly (not crash silently). */
export function malformedAudioCases(): MalformedCase[] {
  const sr = 48000;
  const n = sr * 2;
  const nan = new Float32Array(8).fill(Number.NaN);
  const inf = new Float32Array(8).fill(Number.POSITIVE_INFINITY);
  const full = new Float32Array(n);
  for (let i = 0; i < n; i++) full[i] = i % 2 === 0 ? 1 : -1; // rail-to-rail (max clipping)
  const dc = new Float32Array(n).fill(0.5); // pure DC, no AC content
  return [
    { id: "malformed/empty", audio: { sampleRate: sr, samples: new Float32Array(0) }, note: "zero-length buffer", mayThrow: false },
    { id: "malformed/one_sample", audio: { sampleRate: sr, samples: new Float32Array([0.5]) }, note: "single sample", mayThrow: false },
    { id: "malformed/all_zero", audio: { sampleRate: sr, samples: new Float32Array(n) }, note: "pure digital silence", mayThrow: false },
    { id: "malformed/nan", audio: { sampleRate: sr, samples: nan }, note: "NaN samples", mayThrow: false },
    { id: "malformed/infinity", audio: { sampleRate: sr, samples: inf }, note: "Infinity samples", mayThrow: false },
    { id: "malformed/rail_to_rail", audio: { sampleRate: sr, samples: full }, note: "full-scale square (max clip)", mayThrow: false },
    { id: "malformed/pure_dc", audio: { sampleRate: sr, samples: dc }, note: "constant DC offset, no AC", mayThrow: false },
    { id: "malformed/zero_samplerate", audio: { sampleRate: 0, samples: new Float32Array(100) }, note: "sampleRate 0", mayThrow: true },
    { id: "malformed/negative_samplerate", audio: { sampleRate: -48000, samples: new Float32Array(100) }, note: "negative sampleRate", mayThrow: true },
  ];
}

/** The full default scenario suite (everything except malformed raw-audio cases). */
export function fullScenarioSuite(): ScenarioItem[] {
  return [
    ...reachabilitySweeps(),
    ...archetypeScenarios(),
    ...interactionScenarios(),
    ...fidelityInvarianceScenarios(),
    ...robustnessScenarios(),
    ...failureScenarios(),
  ];
}
