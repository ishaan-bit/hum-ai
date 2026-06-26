import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  acousticAffectAxes,
  resolveAxisRead,
  reReferenceDisplayRead,
  type AcousticAxisSample,
} from "@hum-ai/orchestrator";
import { refHum } from "./reference";

/**
 * SCENARIO SIMULATION — drive the read with realistic, research-grounded "felt
 * state" archetypes and confirm it responds in the right DIRECTION, that mic
 * fidelity does NOT move the affect read, and that the within-user re-reference
 * unpins a fixed-voice user across moods. Three batteries:
 *
 *  1. MOOD ORDERING — happy / calm / tense / sad acoustic signatures should land in
 *     the right valence/arousal quadrant (Russell V-A circumplex; arousal ↔ energy/
 *     pitch/brightness; valence ↔ prosody contour + settled voice quality).
 *  2. FIDELITY INVARIANCE — degrade ONLY mic/room fidelity (clarity, SNR, flatness,
 *     breathiness, noise floor) on a fixed mood: valence must barely move and the
 *     zone must not flip (the valence-fidelity-decoupling contract).
 *  3. PIN / RE-REFERENCE — a fixed-voice+mic user humming five different moods: the
 *     ABSOLUTE acoustic read clusters (the pin), but the DISPLAYED read (re-referenced
 *     against the user's own usual) must span multiple zones (the display-read fix).
 */

const T = 0.2;

/** The user-visible zone for a (valence, arousal) read — mirrors `axisHeadline` in copy.ts. */
export function zoneOf(valence: number, arousal: number): string {
  const hiA = arousal > T, loA = arousal < -T, hiV = valence > T, loV = valence < -T;
  if (hiA && hiV) return "Bright/Energised";
  if (hiA && loV) return "Tense";
  if (loA && hiV) return "Calm/Content";
  if (loA && loV) return "Low/Flat";
  if (hiA) return "Restless";
  if (loA) return "Quiet";
  if (hiV) return "Warm";
  if (loV) return "Flat";
  return "Steady/Even";
}

const sign = (x: number): -1 | 0 | 1 => (x > T ? 1 : x < -T ? -1 : 0);

// ── 1. Mood ordering ─────────────────────────────────────────────────────────

export interface MoodScenario {
  readonly id: string;
  readonly label: string;
  /** Expected valence / arousal sign (1 = high pole, -1 = low pole, 0 = mid). */
  readonly expectValence: -1 | 0 | 1;
  readonly expectArousal: -1 | 0 | 1;
  readonly over: Partial<AcousticFeatures>;
}

/**
 * Acoustic signatures of four felt states. Each varies ONLY mood-relevant prosody +
 * voice-quality (not fidelity), grounded in the affect-prosody literature:
 * arousal rides energy/pitch/brightness/flux; valence rides pitch height + melodic
 * movement + a settled (smooth/steady/low-agitation) voice quality.
 */
export const MOOD_SCENARIOS: readonly MoodScenario[] = [
  {
    id: "bright_energised",
    label: "Bright & energised (high V, high A)",
    expectValence: 1,
    expectArousal: 1,
    over: {
      meanRms: 0.11, rmsEnergy: 0.11, peakAmplitude: 0.7, activeFrameRatio: 0.9,
      pitchMeanHz: 235, pitchRangeSemitones: 5.5, spectralCentroidHz: 1700, spectralFlux: 0.22,
      smoothnessScore: 0.8, amplitudeStability: 0.85, pitchStability: 0.85,
      residualInstabilityScore: 0.12, musicalityScore: 0.5,
    },
  },
  {
    id: "calm_content",
    label: "Calm & content (high V, low A)",
    expectValence: 1,
    expectArousal: -1,
    over: {
      meanRms: 0.02, rmsEnergy: 0.02, peakAmplitude: 0.22, activeFrameRatio: 0.5,
      pitchMeanHz: 210, pitchRangeSemitones: 2.8, spectralCentroidHz: 800, spectralFlux: 0.03,
      smoothnessScore: 0.9, amplitudeStability: 0.95, pitchStability: 0.95,
      residualInstabilityScore: 0.08, vibratoRegularity: 0.85,
    },
  },
  {
    id: "tense_anxious",
    label: "Tense & wound-up (low V, high A)",
    expectValence: -1,
    expectArousal: 1,
    over: {
      meanRms: 0.1, rmsEnergy: 0.1, peakAmplitude: 0.68, activeFrameRatio: 0.88,
      pitchMeanHz: 150, pitchRangeSemitones: 1.4, spectralCentroidHz: 1800, spectralFlux: 0.28,
      smoothnessScore: 0.35, amplitudeStability: 0.5, pitchStability: 0.5,
      residualInstabilityScore: 0.6, jitter: 0.045, shimmerProxy: 0.45, vibratoRegularity: 0.3,
    },
  },
  {
    id: "low_sad",
    label: "Low & flat (low V, low A)",
    expectValence: -1,
    expectArousal: -1,
    over: {
      meanRms: 0.018, rmsEnergy: 0.018, peakAmplitude: 0.18, activeFrameRatio: 0.45,
      pitchMeanHz: 108, pitchRangeSemitones: 0.8, spectralCentroidHz: 600, spectralFlux: 0.03,
      smoothnessScore: 0.45, amplitudeStability: 0.6, pitchStability: 0.62,
      residualInstabilityScore: 0.45, musicalityScore: 0.1,
    },
  },
];

export interface MoodResult {
  readonly id: string;
  readonly label: string;
  readonly valence: number;
  readonly arousal: number;
  readonly zone: string;
  readonly valenceOk: boolean;
  readonly arousalOk: boolean;
}

/** Run the mood archetypes through the rule-based acoustic read and check direction. */
export function runMoodScenarios(): MoodResult[] {
  return MOOD_SCENARIOS.map((m) => {
    const ax = acousticAffectAxes(refHum(m.over));
    const valenceOk = m.expectValence === 0 ? sign(ax.valence) === 0 : sign(ax.valence) === m.expectValence;
    const arousalOk = m.expectArousal === 0 ? sign(ax.arousal) === 0 : sign(ax.arousal) === m.expectArousal;
    return {
      id: m.id,
      label: m.label,
      valence: ax.valence,
      arousal: ax.arousal,
      zone: zoneOf(ax.valence, ax.arousal),
      valenceOk,
      arousalOk,
    };
  });
}

// ── 2. Fidelity invariance ─────────────────────────────────────────────────────

/** A clean mic vs a noisy mic — fidelity-ONLY overlays (no affect-relevant fields). */
export const CLEAN_MIC: Partial<AcousticFeatures> = {
  clarityScore: 0.88, signalToNoiseProxy: 13, spectralFlatness: 0.12, breathinessProxy: 0.12, noiseFloorRms: 0.004,
};
export const NOISY_MIC: Partial<AcousticFeatures> = {
  clarityScore: 0.34, signalToNoiseProxy: 1.6, spectralFlatness: 0.52, breathinessProxy: 0.62, noiseFloorRms: 0.04,
};

export interface FidelityInvariance {
  readonly mood: string;
  readonly cleanValence: number;
  readonly noisyValence: number;
  readonly deltaValence: number;
  readonly cleanArousal: number;
  readonly noisyArousal: number;
  readonly deltaArousal: number;
  readonly cleanZone: string;
  readonly noisyZone: string;
  readonly zoneStable: boolean;
  /**
   * DIRECTIONAL leak: a noisy mic pushed the affect read toward a WRONG POLE (sign flip
   * on a meaningful axis) or AWAY from neutral (manufactured more affect). This is the real
   * contract — fidelity must never invent or invert affect. A read that FADES toward neutral
   * under noise is NOT a leak: it is honest down-weighting of fidelity-fragile cues (the SNR
   * confidence fade in axis-read.ts), the same posture as low evidence paling the read.
   */
  readonly directionalLeak: boolean;
}

/** Largest absolute valence move that switching clean↔noisy mic may cause without failing. */
export const FIDELITY_VALENCE_TOLERANCE = 0.1;

/**
 * Per-axis directional leak: the noisy read crossed neutral to the OPPOSITE pole (mood
 * inversion), or a near-neutral clean read was pushed OUT to a pole (mood invented from the
 * mic). Same-pole movement (a low read going more-low as the energy de-noises under a noisy
 * mic) is NOT a leak — it is honest, the mood is unchanged.
 */
function axisDirectionalLeak(clean: number, noisy: number): boolean {
  const flippedToPole = Math.sign(noisy) !== Math.sign(clean) && Math.abs(clean) > 0.1 && Math.abs(noisy) > 0.1;
  const inventedFromNeutral = Math.abs(clean) < 0.1 && Math.abs(noisy) > 0.25;
  return flippedToPole || inventedFromNeutral;
}

/**
 * For each mood, read it through a CLEAN mic and a NOISY mic (mood fields identical).
 * A passing read does not move the affect toward a WRONG POLE or AWAY from neutral —
 * fidelity belongs to signal strength + confidence. Under genuine noise the read may FADE
 * toward neutral (honest, low-confidence down-weighting); that is not a leak.
 */
export function runFidelityInvariance(): FidelityInvariance[] {
  return MOOD_SCENARIOS.map((m) => {
    const clean = acousticAffectAxes(refHum({ ...m.over, ...CLEAN_MIC }));
    const noisy = acousticAffectAxes(refHum({ ...m.over, ...NOISY_MIC }));
    const cleanZone = zoneOf(clean.valence, clean.arousal);
    const noisyZone = zoneOf(noisy.valence, noisy.arousal);
    return {
      mood: m.id,
      cleanValence: clean.valence,
      noisyValence: noisy.valence,
      deltaValence: noisy.valence - clean.valence,
      cleanArousal: clean.arousal,
      noisyArousal: noisy.arousal,
      deltaArousal: noisy.arousal - clean.arousal,
      cleanZone,
      noisyZone,
      zoneStable: cleanZone === noisyZone,
      directionalLeak:
        axisDirectionalLeak(clean.valence, noisy.valence) || axisDirectionalLeak(clean.arousal, noisy.arousal),
    };
  });
}

// ── 3. Pin / within-user re-reference ──────────────────────────────────────────

/**
 * A fixed-voice + fixed-mic user: a low, quiet voice on a clear phone mic. The KEY to
 * reproducing the pin is that the user's pitch REGISTER barely moves hum-to-hum (a
 * person doesn't change their fundamental much), so the dominant absolute valence driver
 * (pitch height, population-normalized 95–260 Hz) sits near the floor every hum — the
 * fixed person+mic OFFSET that swamps the small within-user mood signal.
 */
const PERSON_BASE: Partial<AcousticFeatures> = {
  pitchMeanHz: 116, meanRms: 0.045, rmsEnergy: 0.045, peakAmplitude: 0.32, spectralCentroidHz: 820,
  clarityScore: 0.72, signalToNoiseProxy: 7,
};

/**
 * Five moods this SAME person hums. Pitch register is held in a narrow band (112–122 Hz)
 * — as it realistically would be for one person — so the moods are expressed through the
 * smaller-weight, mood-variable features (smoothness, micro-instability, energy, flux,
 * modest melody). The ABSOLUTE acoustic read therefore stays clustered (the pin); only the
 * within-user re-reference can open these subtle departures into distinct zones.
 */
const PERSON_MOODS: ReadonlyArray<{ id: string; over: Partial<AcousticFeatures> }> = [
  { id: "their-usual", over: {} },
  { id: "lighter", over: { pitchMeanHz: 122, pitchRangeSemitones: 3.4, smoothnessScore: 0.86, amplitudeStability: 0.9, residualInstabilityScore: 0.1, meanRms: 0.052, spectralFlux: 0.13 } },
  { id: "flatter", over: { pitchMeanHz: 112, pitchRangeSemitones: 1.3, smoothnessScore: 0.5, residualInstabilityScore: 0.45, meanRms: 0.038, spectralFlux: 0.05 } },
  { id: "wired", over: { meanRms: 0.066, spectralFlux: 0.2, spectralCentroidHz: 1060, residualInstabilityScore: 0.55, smoothnessScore: 0.46, pitchMeanHz: 118 } },
  { id: "settled", over: { amplitudeStability: 0.95, pitchStability: 0.95, smoothnessScore: 0.9, residualInstabilityScore: 0.08, spectralFlux: 0.025, meanRms: 0.04 } },
];

export interface PinResult {
  readonly acoustic: ReadonlyArray<{ id: string; valence: number; arousal: number; zone: string }>;
  readonly displayed: ReadonlyArray<{ id: string; valence: number; arousal: number; zone: string }>;
  readonly acousticZoneCount: number;
  readonly displayedZoneCount: number;
  readonly acousticValenceSpan: number;
  readonly displayedValenceSpan: number;
  /**
   * The fix is working when the re-reference AMPLIFIES the user's within-user variation
   * (displayed valence span meaningfully exceeds the clustered absolute span) AND the
   * displayed read visits several distinct zones — i.e. the pinned absolute read is opened up.
   */
  readonly unpinned: boolean;
}

/** Min distinct displayed zones for the re-reference to count as having unpinned the read. */
export const PIN_MIN_DISPLAYED_ZONES = 3;
/** The displayed valence span must exceed the absolute span by at least this factor. */
export const PIN_MIN_SPAN_GAIN = 1.3;

/**
 * Build ~12 prior acoustic reads for this person (their usual, with small natural
 * spread), then read five moods both ABSOLUTELY and after the within-user
 * re-reference. The absolute reads cluster (the pin); the displayed reads should
 * fan out across zones.
 */
export function runPinReReference(): PinResult {
  // Personal acoustic history: the user's own usual, jittered, as raw acoustic axis samples.
  const history: AcousticAxisSample[] = [];
  for (let i = 0; i < 12; i++) {
    const wobble = ((i % 5) - 2) * 0.01;
    const ax = acousticAffectAxes(
      refHum({ ...PERSON_BASE, pitchMeanHz: 118 + wobble * 60, smoothnessScore: 0.7 + wobble }),
    );
    history.push({ valence: ax.valence, arousal: ax.arousal });
  }

  const acoustic = PERSON_MOODS.map((m) => {
    const ax = resolveAxisRead(refHum({ ...PERSON_BASE, ...m.over }));
    return { id: m.id, valence: ax.dimensional.valence, arousal: ax.dimensional.arousal, zone: zoneOf(ax.dimensional.valence, ax.dimensional.arousal) };
  });

  const displayed = PERSON_MOODS.map((m) => {
    const read = resolveAxisRead(refHum({ ...PERSON_BASE, ...m.over }));
    const disp = reReferenceDisplayRead(read, history);
    return { id: m.id, valence: disp.dimensional.valence, arousal: disp.dimensional.arousal, zone: zoneOf(disp.dimensional.valence, disp.dimensional.arousal) };
  });

  const span = (xs: ReadonlyArray<{ valence: number }>) =>
    Math.max(...xs.map((x) => x.valence)) - Math.min(...xs.map((x) => x.valence));
  const zones = (xs: ReadonlyArray<{ zone: string }>) => new Set(xs.map((x) => x.zone)).size;

  const acousticZoneCount = zones(acoustic);
  const displayedZoneCount = zones(displayed);
  return {
    acoustic,
    displayed,
    acousticZoneCount,
    displayedZoneCount,
    acousticValenceSpan: span(acoustic),
    displayedValenceSpan: span(displayed),
    unpinned:
      displayedZoneCount >= PIN_MIN_DISPLAYED_ZONES &&
      span(displayed) > span(acoustic) * PIN_MIN_SPAN_GAIN,
  };
}

// ── 4. Cross-voice invariance (v11 trait-decoupling) ───────────────────────────

/**
 * FIVE different VOICES feeling the SAME (neutral) mood: only the IDENTITY features vary —
 * pitch register + brightness register — while every mood-variable state cue is held at the
 * neutral reference. The v11 trait-decoupled read must NOT spread much across these: a heavier/
 * huskier voice and a brighter voice that feel the same must read alike on the first hum. (The
 * remaining cross-person separation is earned only once a personal baseline forms — the within-
 * user re-reference + models retrained on within-person deviations.)
 */
const CROSS_VOICES: ReadonlyArray<{ id: string; over: Partial<AcousticFeatures> }> = [
  { id: "husky-low", over: { pitchMeanHz: 110, spectralCentroidHz: 650 } },
  { id: "low", over: { pitchMeanHz: 145, spectralCentroidHz: 850 } },
  { id: "mid", over: { pitchMeanHz: 175, spectralCentroidHz: 1000 } },
  { id: "high", over: { pitchMeanHz: 215, spectralCentroidHz: 1300 } },
  { id: "bright-high", over: { pitchMeanHz: 250, spectralCentroidHz: 1650 } },
];

export interface CrossVoiceResult {
  readonly perVoice: ReadonlyArray<{ id: string; valence: number; arousal: number; zone: string }>;
  readonly valenceSpan: number;
  readonly arousalSpan: number;
  readonly invariant: boolean;
}

/** Max displayed valence span across voices feeling the same mood (the v11 cross-person contract). */
export const CROSS_VOICE_VALENCE_MAX = 0.45;
/** Max displayed arousal span across voices feeling the same mood. */
export const CROSS_VOICE_AROUSAL_MAX = 0.3;

/** Read five voices (fixed neutral mood) cold and measure how much voice identity spreads the read. */
export function runCrossVoice(): CrossVoiceResult {
  const perVoice = CROSS_VOICES.map((v) => {
    const ax = resolveAxisRead(refHum(v.over));
    return { id: v.id, valence: ax.dimensional.valence, arousal: ax.dimensional.arousal, zone: zoneOf(ax.dimensional.valence, ax.dimensional.arousal) };
  });
  const valenceSpan = Math.max(...perVoice.map((p) => p.valence)) - Math.min(...perVoice.map((p) => p.valence));
  const arousalSpan = Math.max(...perVoice.map((p) => p.arousal)) - Math.min(...perVoice.map((p) => p.arousal));
  return {
    perVoice,
    valenceSpan,
    arousalSpan,
    invariant: valenceSpan <= CROSS_VOICE_VALENCE_MAX && arousalSpan <= CROSS_VOICE_AROUSAL_MAX,
  };
}
