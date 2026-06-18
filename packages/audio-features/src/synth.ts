/**
 * Deterministic synthetic test-signal generators — a software "function
 * generator" for the hum pipeline.
 *
 * IMPORTANT (honesty): these are SYNTHETIC signals, not real or validated audio
 * and not a dataset. They exist so the REAL extractor (`computeFeatures`) can be
 * exercised deterministically in unit tests and the local demo, with no audio
 * files committed to git (the forbidden-files QA gate blocks tracked .wav/.mp3).
 * Each generator returns raw PCM `AudioInput`, exactly the shape a microphone
 * would hand the extractor.
 *
 * All randomness is a seeded PRNG, so every signal is byte-for-byte reproducible.
 */
import type { AudioInput } from "./extract";

const TAU = Math.PI * 2;

/** mulberry32 — tiny deterministic PRNG returning [0, 1). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised-cosine fade weight for sample `i` of a region `len` long, `fade` samples. */
function fadeWeight(i: number, len: number, fade: number): number {
  if (fade <= 0) return 1;
  if (i < fade) return 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  if (i > len - 1 - fade) {
    const j = len - 1 - i;
    return 0.5 - 0.5 * Math.cos((Math.PI * j) / fade);
  }
  return 1;
}

export interface HumOptions {
  readonly sampleRate?: number;
  readonly durationSec?: number;
  /** Fundamental frequency, Hz. */
  readonly f0?: number;
  /** Relative harmonic amplitudes (index 0 = fundamental). Hum = low, decaying. */
  readonly harmonics?: readonly number[];
  /** Fractional vibrato depth (e.g. 0.01 = ±1%). */
  readonly vibratoDepth?: number;
  /** Vibrato rate, Hz. */
  readonly vibratoRate?: number;
  /** Peak amplitude of the tone body in [0,1]. */
  readonly targetPeak?: number;
  /** Background noise RMS. */
  readonly noiseRms?: number;
  /** Near-silent (noise-only) pad at each end, seconds. */
  readonly padSec?: number;
  readonly seed?: number;
}

/**
 * A clean sustained hum: low decaying harmonics (dark timbre), gentle vibrato,
 * steady amplitude, brief noise-only pads. Grades "good" through the quality gate
 * and classifies as "hum".
 */
export function synthHum(opts: HumOptions = {}): AudioInput {
  const sampleRate = opts.sampleRate ?? 48000;
  const durationSec = opts.durationSec ?? 12;
  const f0 = opts.f0 ?? 160;
  const harmonics = opts.harmonics ?? [1, 0.5, 0.25, 0.12];
  const vibratoDepth = opts.vibratoDepth ?? 0.01;
  const vibratoRate = opts.vibratoRate ?? 5;
  const targetPeak = opts.targetPeak ?? 0.5;
  const noiseRms = opts.noiseRms ?? 0.0015;
  const padSec = opts.padSec ?? 0.3;
  const rng = makeRng(opts.seed ?? 1);

  const n = Math.round(durationSec * sampleRate);
  const buf = new Float32Array(n);
  const start = Math.min(Math.round(padSec * sampleRate), Math.floor(n / 2));
  const end = Math.max(start, n - start);
  const regionLen = end - start;
  const fade = Math.round(0.05 * sampleRate);

  const tone = new Float64Array(regionLen);
  let phase = 0;
  let peak = 0;
  for (let i = 0; i < regionLen; i++) {
    const t = i / sampleRate;
    const fInst = f0 * (1 + vibratoDepth * Math.sin(TAU * vibratoRate * t));
    phase += (TAU * fInst) / sampleRate;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) s += (harmonics[h] as number) * Math.sin((h + 1) * phase);
    s *= fadeWeight(i, regionLen, fade);
    tone[i] = s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? targetPeak / peak : 0;
  for (let i = 0; i < regionLen; i++) buf[start + i] = (tone[i] as number) * scale;

  // Background noise everywhere (including pads → a true noise floor reference).
  for (let i = 0; i < n; i++) {
    const noise = (rng() * 2 - 1) * noiseRms * Math.SQRT2; // ~unit-variance scaled to RMS
    buf[i] = (buf[i] as number) + noise;
  }
  return { sampleRate, samples: buf };
}

/** Near silence: only a faint noise floor, well below the silence threshold. */
export function synthSilence(opts: { sampleRate?: number; durationSec?: number; noiseRms?: number; seed?: number } = {}): AudioInput {
  const sampleRate = opts.sampleRate ?? 48000;
  const durationSec = opts.durationSec ?? 12;
  const noiseRms = opts.noiseRms ?? 0.0008;
  const rng = makeRng(opts.seed ?? 2);
  const n = Math.round(durationSec * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = (rng() * 2 - 1) * noiseRms * Math.SQRT2;
  return { sampleRate, samples: buf };
}

/** A hum driven well past full-scale and hard-clipped to [-1, 1] (heavy clipping). */
export function synthClippedHum(opts: HumOptions = {}): AudioInput {
  const base = synthHum({ targetPeak: 1.6, ...opts, seed: opts.seed ?? 3 });
  const samples = base.samples as Float32Array;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i] as number));
  return { sampleRate: base.sampleRate, samples: out };
}

export interface InterruptedOptions extends HumOptions {
  /** Voiced segment length, seconds. */
  readonly onSec?: number;
  /** Silent gap length, seconds. */
  readonly offSec?: number;
}

/**
 * A hum chopped into on/off segments. With the defaults the silent fraction is
 * high enough that the quality gate rejects it as "too_interrupted"; pass larger
 * `onSec` / smaller `offSec` for a merely choppy-but-usable capture.
 */
export function synthInterruptedHum(opts: InterruptedOptions = {}): AudioInput {
  const onSec = opts.onSec ?? 0.3;
  const offSec = opts.offSec ?? 1.0;
  const base = synthHum({ ...opts, padSec: opts.padSec ?? 0.1, seed: opts.seed ?? 4 });
  const sampleRate = base.sampleRate;
  const samples = base.samples as Float32Array;
  const onN = Math.round(onSec * sampleRate);
  const offN = Math.round(offSec * sampleRate);
  const period = onN + offN;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const phase = i % period;
    // Keep the on-segments; mute the off-segments to a near-silent floor.
    out[i] = phase < onN ? (samples[i] as number) : (samples[i] as number) * 0.004;
  }
  return { sampleRate, samples: out };
}

/** A hum buried in strong broadband noise (low SNR, still above the silence floor). */
export function synthNoisyHum(opts: HumOptions = {}): AudioInput {
  return synthHum({ targetPeak: 0.3, noiseRms: 0.06, padSec: 0.3, seed: opts.seed ?? 5, ...opts });
}

/** A quiet-but-clean hum: low amplitude, grades "usable" (not rejected) through the gate. */
export function synthSoftHum(opts: HumOptions = {}): AudioInput {
  return synthHum({ targetPeak: 0.06, noiseRms: 0.0008, seed: opts.seed ?? 6, ...opts });
}

export interface SpeechOptions {
  readonly sampleRate?: number;
  readonly durationSec?: number;
  readonly noiseRms?: number;
  readonly seed?: number;
}

/**
 * A crude speech-LIKE approximation: short voiced "syllables" of varying pitch
 * and brighter timbre, separated by gaps. Not real speech — enough structure
 * (wide pitch range, pauses, high flux/ZCR) to NOT read as a sustained hum.
 */
export function synthSpeechLike(opts: SpeechOptions = {}): AudioInput {
  const sampleRate = opts.sampleRate ?? 48000;
  const durationSec = opts.durationSec ?? 12;
  const noiseRms = opts.noiseRms ?? 0.004;
  const rng = makeRng(opts.seed ?? 7);
  const n = Math.round(durationSec * sampleRate);
  const buf = new Float32Array(n);

  // Brighter, speech-like harmonic stack (more high-frequency energy).
  const harmonics = [1, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4];
  let i = 0;
  while (i < n) {
    const sylSec = 0.16 + rng() * 0.18;
    const gapSec = 0.05 + rng() * 0.1;
    const sylN = Math.round(sylSec * sampleRate);
    const gapN = Math.round(gapSec * sampleRate);
    const f0 = 110 + rng() * 140; // 110–250 Hz, wide spread across syllables (clearly not a sustained hum)
    const glide = (rng() * 2 - 1) * 40; // intra-syllable pitch glide
    const peak = 0.25 + rng() * 0.2;
    const fade = Math.round(0.02 * sampleRate);
    // Consonant-like broadband noise burst at the syllable onset (raises ZCR).
    const consN = Math.round((0.02 + rng() * 0.03) * sampleRate);
    let phase = 0;
    for (let k = 0; k < sylN && i + k < n; k++) {
      const t = k / sampleRate;
      const fInst = f0 + glide * (k / Math.max(1, sylN));
      phase += (TAU * fInst) / sampleRate;
      let s = 0;
      for (let h = 0; h < harmonics.length; h++) s += (harmonics[h] as number) * Math.sin((h + 1) * phase);
      // syllable amplitude envelope (formant-like tremolo)
      const trem = 0.8 + 0.2 * Math.sin(TAU * 6 * t);
      s *= fadeWeight(k, sylN, fade) * trem;
      if (k < consN) s += (rng() * 2 - 1) * 1.1 * (1 - k / consN); // decaying consonant noise
      buf[i + k] = s;
    }
    // normalize this syllable to its peak
    let p = 0;
    for (let k = 0; k < sylN && i + k < n; k++) p = Math.max(p, Math.abs(buf[i + k] as number));
    if (p > 0) {
      const sc = peak / p;
      for (let k = 0; k < sylN && i + k < n; k++) buf[i + k] = (buf[i + k] as number) * sc;
    }
    i += sylN + gapN;
  }
  for (let k = 0; k < n; k++) buf[k] = (buf[k] as number) + (rng() * 2 - 1) * noiseRms * Math.SQRT2;
  return { sampleRate, samples: buf };
}

export interface MusicOptions {
  readonly sampleRate?: number;
  readonly durationSec?: number;
  /** Detuned chord frequencies, Hz (deliberately slightly inharmonic). */
  readonly freqs?: readonly number[];
  readonly noiseRms?: number;
  readonly targetPeak?: number;
  readonly seed?: number;
}

/**
 * A music-LIKE approximation: several simultaneous, slightly detuned/inharmonic
 * tones with bright timbre, tremolo and broadband noise. The mixture has no
 * single clear period, so the pitch tracker reports low voicing — it does not
 * read as a hum.
 */
export function synthMusicLike(opts: MusicOptions = {}): AudioInput {
  const sampleRate = opts.sampleRate ?? 48000;
  const durationSec = opts.durationSec ?? 12;
  const freqs = opts.freqs ?? [233.1, 291.4, 349.7, 524.3];
  const noiseRms = opts.noiseRms ?? 0.02;
  const targetPeak = opts.targetPeak ?? 0.55;
  const rng = makeRng(opts.seed ?? 8);
  const n = Math.round(durationSec * sampleRate);
  const buf = new Float64Array(n);

  // Per-voice detune + tremolo so the mixture is inharmonic and unstable.
  const detune = freqs.map(() => 1 + (rng() * 2 - 1) * 0.006);
  const tremRate = freqs.map(() => 3 + rng() * 4);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let v = 0; v < freqs.length; v++) {
      const f = (freqs[v] as number) * (detune[v] as number);
      const trem = 0.7 + 0.3 * Math.sin(TAU * (tremRate[v] as number) * t);
      // a couple of partials per voice → bright, broadband
      s += trem * (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * 2 * f * t) + 0.3 * Math.sin(TAU * 3 * f * t));
    }
    buf[i] = s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? targetPeak / peak : 0;
  const out = new Float32Array(n);
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < n; i++) {
    out[i] = (buf[i] as number) * scale * fadeWeight(i, n, fade) + (rng() * 2 - 1) * noiseRms * Math.SQRT2;
  }
  return { sampleRate, samples: out };
}
