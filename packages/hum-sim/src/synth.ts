/**
 * THE HUM SYNTHESIZER — a deterministic, parameterized DSP "function generator"
 * that renders realistic hum WAVEFORMS rich enough to exercise the real extractor.
 *
 * Why a new synthesizer (vs `@hum-ai/audio-features` `synthHum`): the existing
 * generators produce CLEAN STEADY tones (and gate-failing degenerate variants). A
 * steady tone pins exactly the mood-variable features the affect read leans on —
 * `pitchRangeSemitones ≈ 0`, `spectralFlux ≈ 0`, `jitter ≈ 0`, `smoothnessScore ≈ 1` —
 * so it can never drive valence to its low pole or arousal via "animation". To
 * VALIDATE the pipeline's reachable range we need audio that can independently vary
 * melodic contour, timbral change, micro-instability, vibrato evenness, brightness,
 * energy, voicing continuity and recording fidelity. That is what this module adds.
 *
 * Honesty contract (same posture as the existing synth): these are SYNTHETIC signals,
 * not real or validated audio and not a dataset. Each is raw PCM `AudioInput`, exactly
 * the shape a microphone hands the extractor. All randomness is a seeded PRNG, so every
 * waveform is byte-for-byte reproducible.
 *
 * Signal model (per the documented latent→control mapping in `latent.ts`):
 *   harmonic tone with f0 = register × 2^(slow melodic contour) × (1+vibrato) × (1+jitter),
 *   harmonic roll-off swept slowly for timbral change, amplitude shaped by an envelope
 *   with tremolo + shimmer + voicing gaps, then device low-pass, room reverb, background
 *   noise, DC bias, gain and optional hard-clipping.
 */
import { makeRng } from "@hum-ai/shared-types";
import type { AudioInput } from "@hum-ai/audio-features";
import { latentToControls, type LatentHumProfile, type SynthControls } from "./latent";

const TAU = Math.PI * 2;

/** Raised-cosine fade weight for sample `i` of a region `len` long, `fade` samples. */
function fadeWeight(i: number, len: number, fade: number): number {
  if (fade <= 0 || len <= 1) return 1;
  if (i < fade) return 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  if (i > len - 1 - fade) {
    const j = len - 1 - i;
    return 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, j)) / fade);
  }
  return 1;
}

/**
 * PINK (1/f) background noise of length `n`, normalized to unit RMS. Real room/mic
 * noise is pink/brown, not white — its energy concentrates at low frequencies. This
 * matters for fidelity: WHITE noise (flat to Nyquist) has thousands of high-frequency
 * bins that swamp a tonal hum's few harmonic bins and decouple `spectralCentroidHz`
 * from the actual timbre. Pink noise keeps the noise floor realistic so brightness is
 * tone-driven (Paul Kellet's economical pink filter).
 */
function pinkNoise(n: number, rng: () => number): Float64Array {
  const out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    out[i] = p;
    sum += p * p;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms > 1e-12) for (let i = 0; i < n; i++) out[i] = (out[i] as number) / rms;
  return out;
}

/** A bounded random walk in [-1,1] at a fixed control rate (deterministic from `rng`). */
function randomWalk(steps: number, rng: () => number, stepSize: number): Float64Array {
  const w = new Float64Array(Math.max(1, steps));
  let v = 0;
  for (let k = 0; k < w.length; k++) {
    v += (rng() * 2 - 1) * stepSize;
    if (v > 1) v = 1 - (v - 1) * 0.5;
    if (v < -1) v = -1 - (v + 1) * 0.5;
    w[k] = v;
  }
  return w;
}

/** One-pole low-pass (device bandwidth). In place. */
function lowpass(x: Float64Array, sampleRate: number, cutoffHz: number): void {
  const fc = Math.min(cutoffHz, sampleRate * 0.49);
  const alpha = 1 - Math.exp((-TAU * fc) / sampleRate);
  if (alpha >= 0.999) return; // effectively transparent
  let y = x[0] as number;
  for (let i = 0; i < x.length; i++) {
    y += alpha * ((x[i] as number) - y);
    x[i] = y;
  }
}

/** Cheap deterministic room reverb: a few exponentially-decaying taps mixed by `mix`. */
function reverb(x: Float64Array, sampleRate: number, mix: number): void {
  if (mix <= 0) return;
  const taps = [
    { ms: 19, g: 0.6 },
    { ms: 37, g: 0.4 },
    { ms: 61, g: 0.26 },
    { ms: 89, g: 0.16 },
  ];
  const delays = taps.map((t) => ({ d: Math.round((t.ms / 1000) * sampleRate), g: t.g }));
  const dry = Float64Array.from(x);
  for (let i = 0; i < x.length; i++) {
    let wet = 0;
    for (const { d, g } of delays) {
      if (i - d >= 0) wet += g * (dry[i - d] as number);
    }
    x[i] = (1 - mix) * (dry[i] as number) + mix * wet;
  }
}

/** RMS over a slice [start,end). */
function sliceRms(x: Float64Array, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const v = x[i] as number;
    sum += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/**
 * Render a hum waveform from explicit synthesis controls. Pure + deterministic.
 * Returns raw PCM `AudioInput` ready for `computeFeatures`.
 */
export function renderControls(c: SynthControls): AudioInput {
  const sr = c.sampleRate;
  if (!Number.isFinite(sr) || sr <= 0) throw new RangeError(`renderControls: invalid sampleRate ${sr}`);
  const n = Math.max(1, Math.round(c.durationSec * sr));
  const rng = makeRng(c.seed >>> 0);

  const out = new Float32Array(n);
  const endPadN = Math.round(0.2 * sr);
  const bodyStart = Math.min(Math.round(c.onsetPadSec * sr), Math.floor(n / 2));
  const bodyEnd = Math.max(bodyStart + 1, n - endPadN);
  const regionLen = bodyEnd - bodyStart;
  const regionSec = regionLen / sr;

  // Control-rate (100 Hz) random walks for frame-scale micro-instability + vibrato wander.
  const ctrlRate = 100;
  const ctrlSteps = Math.max(2, Math.ceil(regionSec * ctrlRate) + 2);
  const jitterWalk = randomWalk(ctrlSteps, rng, 0.5);
  const shimmerWalk = randomWalk(ctrlSteps, rng, 0.5);
  const vibRateWalk = randomWalk(ctrlSteps, rng, 0.4);
  const ctrlAt = (t: number): number => Math.min(ctrlSteps - 1, Math.floor(t * ctrlRate));

  // Harmonic count: bounded, below Nyquist for the centre f0. Reaches ~16 harmonics so a
  // bright tone has real high-frequency energy that can lift spectralCentroidHz above the
  // (pink) noise floor — otherwise brightness can't move the centroid for a low-f0 hum.
  const nHarm = Math.max(1, Math.min(16, Math.floor((0.45 * sr) / Math.max(60, c.f0Hz))));

  // Slow melodic-contour shape (two slow sinusoids → a roving but smooth pitch line).
  const phi1 = rng() * TAU;
  const phi2 = rng() * TAU;
  const fShape1 = 0.16 + rng() * 0.06; // ~0.16–0.22 Hz
  const fShape2 = 0.05 + rng() * 0.04; // ~0.05–0.09 Hz
  const sweepPhase = rng() * TAU;

  // Voicing duty: a 1.2 s on/off cadence, fully sustained at dutyCycle≈1.
  const cyclePeriod = 1.2;
  const onFrac = c.dutyCycle;

  // Harmonic weight table, refreshed at control rate as the timbre sweep moves the roll-off.
  let weights = new Float64Array(nHarm);
  let weightSum = 1;
  let lastWeightUpdate = -1;
  const refreshWeights = (decay: number): void => {
    let s = 0;
    for (let h = 1; h <= nHarm; h++) {
      const a = Math.pow(h, -decay);
      weights[h - 1] = a;
      s += a;
    }
    weightSum = s > 0 ? s : 1;
  };

  const tone = new Float64Array(regionLen);
  let phase = 0;
  let vibPhase = rng() * TAU;
  const fadeN = Math.round(0.03 * sr);

  // v12 within-hum CONTOUR: a logistic late-vs-early transition at `shiftCenter`. When
  // both shifts are 0 the envelope contributes exactly 1×/+0 (no rng, byte-identical).
  const hasContour = c.energyShift !== 0 || c.pitchShiftSemis !== 0;

  for (let i = 0; i < regionLen; i++) {
    const t = i / sr;
    const k = ctrlAt(t);

    // contour phase: 0 at the start of the body → 1 at the end, switching near shiftCenter.
    let ph01half = 0; // (logistic − 0.5) ∈ [−0.5, +0.5]
    if (hasContour) {
      const frac = regionSec > 0 ? t / regionSec : 0;
      const z = (frac - c.shiftCenter) * c.shiftSharpness;
      ph01half = 1 / (1 + Math.exp(-z)) - 0.5;
    }

    // --- pitch: register × slow contour × vibrato × frame-scale jitter ---
    let shape = 0.62 * Math.sin(TAU * fShape1 * t + phi1) + 0.42 * Math.sin(TAU * fShape2 * t + phi2);
    if (shape > 1) shape = 1;
    if (shape < -1) shape = -1;
    const contourSemis = (c.contourRangeSemitones / 2) * shape + c.pitchShiftSemis * ph01half;
    const vibRate = c.vibratoRateHz * (1 + (1 - c.vibratoRegularity) * 0.6 * (vibRateWalk[k] as number));
    vibPhase += (TAU * vibRate) / sr;
    const vib = c.vibratoFrac * Math.sin(vibPhase);
    const jit = c.jitterFrac * (jitterWalk[k] as number);
    const fInst = c.f0Hz * Math.pow(2, contourSemis / 12) * (1 + vib) * (1 + jit);
    phase += (TAU * fInst) / sr;

    // --- timbre: slowly-swept harmonic roll-off → spectral flux ---
    const decayInst = Math.max(
      0.4,
      Math.min(3.2, c.harmonicDecay + c.timbreSweepDepth * 0.9 * Math.sin(TAU * 0.8 * t + sweepPhase)),
    );
    if (k !== lastWeightUpdate) {
      refreshWeights(decayInst);
      lastWeightUpdate = k;
    }
    let harm = 0;
    for (let h = 1; h <= nHarm; h++) harm += (weights[h - 1] as number) * Math.sin(h * phase);
    harm /= weightSum; // normalize so brightness changes timbre, not loudness

    // --- amplitude: tremolo + shimmer + voicing duty + edge fades ---
    let amp = 1 + c.tremoloDepth * Math.sin(TAU * c.modRateHz * t);
    if (hasContour && c.energyShift !== 0) amp *= Math.max(0.05, 1 + c.energyShift * ph01half);
    amp *= 1 + c.shimmerFrac * (shimmerWalk[k] as number);
    // voicing gaps (continuity): mute "off" portions of each 1.2 s cycle to a near-silent floor.
    if (onFrac < 0.999) {
      const ph = (t % cyclePeriod) / cyclePeriod;
      if (ph > onFrac) amp *= 0.004;
    }
    amp *= fadeWeight(i, regionLen, fadeN);
    tone[i] = harm * amp;
  }

  // Room reverb on the dry tone (the voice reverberates; ambient noise added below).
  reverb(tone, sr, c.reverbMix);

  // Scale the voiced body to the target RMS (measured over the body so quiet duty-gaps
  // don't deflate the level we're aiming for), then place it into the full buffer.
  const bodyRms = sliceRms(tone, 0, regionLen);
  const scale = bodyRms > 1e-9 ? c.targetRms / bodyRms : 0;
  const buf = new Float64Array(n);
  for (let i = 0; i < regionLen; i++) buf[bodyStart + i] = (tone[i] as number) * scale;

  // Background PINK noise everywhere (incl. pads → a true noise-floor reference),
  // normalized to exactly `noiseRms`.
  if (c.noiseRms > 0) {
    const noise = pinkNoise(n, rng);
    for (let i = 0; i < n; i++) buf[i] = (buf[i] as number) + (noise[i] as number) * c.noiseRms;
  }

  // DEVICE BANDWIDTH limits the WHOLE captured signal — tone AND ambient noise. Applying
  // this to the full mix (not just the dry tone) is essential: otherwise noise stays white
  // to Nyquist and dominates spectralCentroidHz, decoupling brightness from timbre.
  lowpass(buf, sr, c.lowpassHz);

  // DC bias, gain, optional clip drive → final PCM.
  for (let i = 0; i < n; i++) {
    let s = ((buf[i] as number) + c.dcOffset) * c.gain;
    if (c.clipDrive > 1) s *= c.clipDrive;
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    out[i] = s;
  }

  return { sampleRate: sr, samples: out };
}

/** Render a hum waveform from a latent profile (the canonical entry point). */
export function renderHum(profile: LatentHumProfile): AudioInput {
  return renderControls(latentToControls(profile));
}
