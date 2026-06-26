/**
 * LATENT HUM PROFILE — the explicit "intended state" of a simulated hum.
 *
 * The Hum Simulator keeps four layers strictly separated, exactly as the design
 * mandate requires:
 *
 *   1. INTENDED LATENT STATE  (this file)      — generic, extensible controls in [0,1]
 *   2. SYNTHESIS CONTROLS     (`latentToControls`) — concrete DSP knobs (Hz, decay, depth…)
 *   3. EXTRACTED FEATURES     (`computeFeatures`)  — what the REAL extractor measures
 *   4. PREDICTED OUTPUTS      (`orchestrateHumRead`) — the read the pipeline produces
 *
 * A latent profile NEVER sets an expected output or feeds a hidden label into the
 * pipeline. It only shapes the WAVEFORM; the production extractor then derives the
 * features naturally, and the production read reasons over those. This is what makes
 * a center-collapse finding causal rather than circular: if a latent control moves
 * but the output doesn't, the break is in extraction or read math — not in a label
 * we smuggled through.
 *
 * The latent schema is deliberately DERIVED FROM WHAT THE IMPLEMENTATION MEASURES.
 * Each control maps onto a real `AcousticFeatures` family that the read code
 * (`axis-read.ts` `acousticAffectAxes`, the quality gate, the domain classifier)
 * actually consumes, tagged with the research-grounded ROLE that family is permitted
 * to play (mirroring `@hum-ai/sim-lab`'s `FeatureKind`):
 *
 *   - prosody       mood-variable contour the person controls hum-to-hum (the legible
 *                   carrier of AROUSAL and the weak-but-real carrier of VALENCE).
 *   - energy        loudness / activity — the strongest reliable AROUSAL cue.
 *   - voice_quality steadiness / micro-perturbation — the "settled" half of VALENCE.
 *   - fidelity      mic + room artefacts — MUST NOT move the affect read (only
 *                   signal-strength + confidence). Simulated so we can PROVE invariance.
 *   - structural    duration / sample-rate / gain / DC — bookkeeping + robustness.
 *
 * Honesty: these are SYNTHETIC controls for mechanistic validation. A latent profile
 * is not a person and not clinical ground truth — it is a reproducible way to push the
 * real pipeline across its reachable range.
 */

/** The role a latent control is research-permitted to play in the read. */
export type LatentRole = "prosody" | "energy" | "voice_quality" | "fidelity" | "structural";

/**
 * The latent profile. Affect-relevant + voice-quality + continuity controls are unit
 * intervals [0,1] (0 = low pole, 1 = high pole). Fidelity controls are [0,1] severities.
 * Structural controls carry natural units. Every field is optional in the partial
 * constructor (`makeLatent`); `NEUTRAL_LATENT` supplies the reference centre.
 */
export interface LatentHumProfile {
  // ── affect-relevant: mood-variable prosody + energy (drives valence/arousal) ──
  /** Loudness / activity. → meanRms, rmsEnergy, activeFrameRatio. Strongest AROUSAL cue. */
  readonly energy: number;
  /** Pitch register (low ↔ high voice). → pitchMeanHz. AROUSAL + (mood-variable) VALENCE. */
  readonly pitchHeight: number;
  /** Melodic movement (held tone ↔ roving). → pitchRangeSemitones, musicalityScore. AROUSAL + VALENCE. */
  readonly melodicMovement: number;
  /** Timbral brightness (dark ↔ bright). → spectralCentroidHz, rolloff, bandwidth. AROUSAL. */
  readonly brightness: number;
  /** Timbral animation (steady ↔ changing). → spectralFlux. The "animation" half of AROUSAL. */
  readonly timbralChange: number;

  // ── voice-quality: person-ish micro-structure (the "settled" half of valence) ──
  /** Cycle-to-cycle pitch perturbation. → jitter, ↓pitchStability. Emotional steadiness (inverse). */
  readonly pitchInstability: number;
  /** Amplitude perturbation. → shimmerProxy, ↓amplitudeStability. Steadiness (inverse). */
  readonly amplitudeInstability: number;
  /** Vibrato extent (none ↔ deep). → vibrato presence; feeds vibratoRegularity + range. */
  readonly vibratoDepth: number;
  /** Vibrato evenness (ragged ↔ even). → vibratoRegularity. VALENCE (settled). */
  readonly vibratoRegularity: number;

  // ── continuity: phrasing ──
  /** Voiced coverage (choppy ↔ sustained). → activeFrameRatio, pitchCoverage, breaks/pauses. */
  readonly voicingContinuity: number;

  // ── fidelity: mic + room (MUST NOT move the affect read) ──
  /** Background noise severity. → ↓signalToNoiseProxy, ↑noiseFloorRms, ↑spectralFlatness. Confidence only. */
  readonly noiseLevel: number;
  /** Device bandwidth (telephone ↔ studio). → caps spectralCentroidHz. A recording-condition offset. */
  readonly micBandwidth: number;
  /** Room reverb severity. → spectral smearing. A recording-condition offset. */
  readonly roomReverb: number;

  // ── structural / robustness ──
  /** Hard-clip drive past full scale. → clippedFrameRatio (a capture artefact). */
  readonly clipping: number;
  /** Overall linear gain applied last. The pipeline has NO AGC, so this directly scales energy. */
  readonly gain: number;
  /** Constant DC bias added to the signal. The extractor removes it (robustness probe). */
  readonly dcOffset: number;
  /** Capture length, seconds. < 8 s is rejected by the gate (too_short). */
  readonly durationSec: number;
  /** Render sample rate, Hz. The pipeline must handle 8k…48k without assuming one rate. */
  readonly sampleRate: number;
  /** Deterministic PRNG seed — every waveform is byte-for-byte reproducible. */
  readonly seed: number;
}

/** The research role of each latent control (lets the harness assert the fidelity ⊥ affect contract). */
export const LATENT_ROLES: Readonly<Record<keyof LatentHumProfile, LatentRole>> = {
  energy: "energy",
  pitchHeight: "prosody",
  melodicMovement: "prosody",
  brightness: "prosody",
  timbralChange: "prosody",
  pitchInstability: "voice_quality",
  amplitudeInstability: "voice_quality",
  vibratoDepth: "voice_quality",
  vibratoRegularity: "voice_quality",
  voicingContinuity: "structural",
  noiseLevel: "fidelity",
  micBandwidth: "fidelity",
  roomReverb: "fidelity",
  clipping: "structural",
  gain: "structural",
  dcOffset: "structural",
  durationSec: "structural",
  sampleRate: "structural",
  seed: "structural",
};

/** The unit-interval [0,1] latent controls that span the affect + voice-quality + fidelity space. */
export const UNIT_LATENT_KEYS = [
  "energy",
  "pitchHeight",
  "melodicMovement",
  "brightness",
  "timbralChange",
  "pitchInstability",
  "amplitudeInstability",
  "vibratoDepth",
  "vibratoRegularity",
  "voicingContinuity",
  "noiseLevel",
  "micBandwidth",
  "roomReverb",
  "clipping",
] as const satisfies readonly (keyof LatentHumProfile)[];
export type UnitLatentKey = (typeof UNIT_LATENT_KEYS)[number];

/**
 * The NEUTRAL reference latent: a clean, audible, well-voiced, moderately steady
 * sustained hum that the quality gate grades "good" and the domain classifier hears
 * as a "hum". Controls sit near the middle of the read code's normalization windows so
 * a one-at-a-time sweep can move outputs in BOTH directions and surface saturation.
 *
 * Centre values are chosen so the EXTRACTED features land near `@hum-ai/sim-lab`'s
 * `REFERENCE_HUM` (verified by the extractor-fidelity check), keeping the two harnesses
 * comparable: sim-lab injects that reference, hum-sim synthesizes toward it.
 */
export const NEUTRAL_LATENT: LatentHumProfile = {
  energy: 0.5,
  pitchHeight: 0.5,
  melodicMovement: 0.35,
  brightness: 0.45,
  timbralChange: 0.3,
  pitchInstability: 0.2,
  amplitudeInstability: 0.2,
  vibratoDepth: 0.4,
  vibratoRegularity: 0.65,
  voicingContinuity: 0.85,
  noiseLevel: 0.1,
  micBandwidth: 0.7,
  roomReverb: 0.05,
  clipping: 0,
  gain: 1,
  dcOffset: 0,
  durationSec: 12,
  sampleRate: 48000,
  seed: 1,
};

/** Build a latent profile from a partial override (rest = neutral reference). */
export function makeLatent(over: Partial<LatentHumProfile> = {}): LatentHumProfile {
  return { ...NEUTRAL_LATENT, ...over };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));
/** Geometric (log-linear) interpolation — natural for Hz cutoffs and RMS levels. */
const geo = (a: number, b: number, t: number): number => a * Math.pow(b / a, Math.min(1, Math.max(0, t)));

/**
 * SYNTHESIS CONTROLS — the concrete, physically-meaningful DSP knobs the renderer
 * consumes. This is layer (2): a transparent, inspectable projection of the latent
 * profile into Hz / fractions / depths. Persisted in every sim artifact so a run can
 * be fully reconstructed and the latent→control mapping audited.
 */
export interface SynthControls {
  readonly sampleRate: number;
  readonly durationSec: number;
  /** Centre fundamental, Hz. */
  readonly f0Hz: number;
  /** Peak-to-peak melodic excursion of the slow pitch contour, semitones. */
  readonly contourRangeSemitones: number;
  /** Harmonic roll-off exponent (a_h = h^-decay); small = bright, large = dark. */
  readonly harmonicDecay: number;
  /** Depth of the slow timbre/brightness sweep [0,1] (drives spectral flux). */
  readonly timbreSweepDepth: number;
  /** Amplitude tremolo depth [0,1]. */
  readonly tremoloDepth: number;
  /** Tremolo / timbre-sweep rate, Hz. */
  readonly modRateHz: number;
  /** Vibrato fractional depth (±frac of f0). */
  readonly vibratoFrac: number;
  /** Vibrato rate, Hz. */
  readonly vibratoRateHz: number;
  /** Vibrato regularity [0,1]; <1 wanders the rate + phase. */
  readonly vibratoRegularity: number;
  /** Frame-rate random-walk fractional jitter on f0. */
  readonly jitterFrac: number;
  /** Frame-rate random-walk fractional shimmer on amplitude. */
  readonly shimmerFrac: number;
  /** Active (voiced) duty cycle in [0,1]; 1 = fully sustained. */
  readonly dutyCycle: number;
  /** Target mean RMS of the voiced body (before noise + gain). */
  readonly targetRms: number;
  /** Background noise RMS. */
  readonly noiseRms: number;
  /** One-pole low-pass cutoff emulating device bandwidth, Hz. */
  readonly lowpassHz: number;
  /** Reverb wet mix [0,1]. */
  readonly reverbMix: number;
  /** Clip drive (>1 pushes the tone past full scale before hard-clipping). */
  readonly clipDrive: number;
  /** Linear output gain. */
  readonly gain: number;
  /** Constant DC bias. */
  readonly dcOffset: number;
  /** Leading silent pad, seconds (onset delay). */
  readonly onsetPadSec: number;
  readonly seed: number;

  // ── v12 within-hum CONTOUR (net trend across the hum; 0 ⇒ no trend, byte-identical) ──
  /**
   * Signed late-vs-early fractional AMPLITUDE shift across the body (logistic at
   * `shiftCenter`). >0 swells (quiet→loud), <0 fades (loud→quiet). The body is still
   * RMS-normalized, so the MEAN level is preserved — only the trajectory changes. Used
   * by the v12 temporal battery to validate change-point direction recovery. Default 0.
   */
  readonly energyShift: number;
  /** Signed late-vs-early F0 glide across the body, semitones. >0 rises, <0 falls. Default 0. */
  readonly pitchShiftSemis: number;
  /** Position of the contour transition along the body, [0,1]. Default 0.5 (mid-hum). */
  readonly shiftCenter: number;
  /** Logistic steepness of the transition (small = gradual ramp, large = step). Default 8. */
  readonly shiftSharpness: number;
}

/**
 * Map the latent profile to concrete synthesis controls. Every mapping is a transparent
 * monotone function of one or two latent controls, documented with the feature family it
 * is meant to move. The constants are calibrated so the EXTRACTED features land in the
 * read code's normalization windows (validated by the extractor-fidelity check, which
 * fails loudly if a latent control stops moving its target feature in the right direction).
 */
export function latentToControls(p: LatentHumProfile): SynthControls {
  return {
    sampleRate: p.sampleRate,
    durationSec: p.durationSec,
    // pitch register: below the read window (95 Hz) at the floor so we can probe saturation.
    f0Hz: lerp(85, 275, p.pitchHeight),
    // melodic movement → realized pitchRangeSemitones (read window 0.5–8 st).
    contourRangeSemitones: lerp(0.3, 8.5, p.melodicMovement),
    // brightness → harmonic roll-off (dark 2.6 → bright 0.7) → spectralCentroidHz.
    harmonicDecay: lerp(2.6, 0.7, p.brightness),
    // timbral animation → slow spectral-shape sweep + tremolo → spectralFlux.
    timbreSweepDepth: p.timbralChange,
    tremoloDepth: 0.45 * p.timbralChange,
    modRateHz: lerp(3.5, 7.5, p.timbralChange),
    // vibrato extent (±3% max) + rate.
    vibratoFrac: 0.03 * p.vibratoDepth,
    vibratoRateHz: lerp(4.2, 6.4, p.vibratoRegularity),
    vibratoRegularity: p.vibratoRegularity,
    // micro-instability: frame-rate random walks → jitter (≤5%) / shimmer (≤55%).
    jitterFrac: 0.05 * p.pitchInstability,
    shimmerFrac: 0.55 * p.amplitudeInstability,
    // voiced coverage: 0.4–1.0 duty (fully sustained at the top).
    dutyCycle: lerp(0.4, 1.0, p.voicingContinuity),
    // energy → mean RMS (read window 0.01–0.14); geometric for a natural loudness spread.
    targetRms: geo(0.008, 0.16, p.energy),
    // fidelity (confidence only, must not move affect): noise floor, device band, reverb.
    // Floor at ~0.0004 keeps a clean hum near 35 dB SNR (so spectralCentroidHz is
    // tone-driven, not noise-driven); the top (0.04) is a genuinely noisy capture.
    noiseRms: geo(0.0004, 0.04, p.noiseLevel),
    lowpassHz: geo(1800, 18000, p.micBandwidth),
    reverbMix: 0.4 * p.roomReverb,
    // structural / robustness.
    clipDrive: lerp(1, 2.6, p.clipping),
    gain: p.gain,
    dcOffset: 0.2 * p.dcOffset,
    onsetPadSec: 0.3,
    seed: p.seed,
    // v12 contour: no net trend by default (a profile is a steady-mood hum unless the
    // temporal battery overrides these on the controls). Zero ⇒ byte-identical synth.
    energyShift: 0,
    pitchShiftSemis: 0,
    shiftCenter: 0.5,
    shiftSharpness: 8,
  };
}
