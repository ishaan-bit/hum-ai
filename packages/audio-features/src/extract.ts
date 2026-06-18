import type { AcousticFeatures } from "./features";

/**
 * Raw, in-memory audio handed to the extractor. This object is EPHEMERAL: it
 * lives only on-device for the duration of extraction and must never be
 * persisted or synced. Downstream code only ever sees `AcousticFeatures`.
 */
export interface AudioInput {
  readonly sampleRate: number;
  /** Mono PCM samples in [-1, 1] (channel 0). */
  readonly samples: Float32Array | readonly number[];
}

/**
 * Feature extractor contract. The real implementation will port the
 * `hum_spec` §4 DSP pipeline (preprocessing, RMS windows, autocorrelation
 * pitch, FFT spectral). v1 is a stub — heavy DSP is deferred (see next-step
 * tasks in the README). The small pure helpers below are real and tested, so
 * the package is exercised even before the full extractor lands.
 */
export interface FeatureExtractor {
  extract(input: AudioInput): Promise<AcousticFeatures>;
}

export class NotImplementedExtractor implements FeatureExtractor {
  extract(_input: AudioInput): Promise<AcousticFeatures> {
    return Promise.reject(
      new Error(
        "FeatureExtractor not implemented in this pass. Port hum_spec §4 DSP " +
          "(preprocessing → RMS windows → autocorrelation pitch → FFT spectral).",
      ),
    );
  }
}

const toArray = (s: AudioInput["samples"]): readonly number[] =>
  s instanceof Float32Array ? Array.from(s) : s;

/** Root-mean-square of the signal (`hum_spec` rms = sqrt(mean(x^2))). */
export function rms(samples: AudioInput["samples"]): number {
  const xs = toArray(samples);
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x * x;
  return Math.sqrt(sum / xs.length);
}

/** Peak absolute amplitude. */
export function peakAmplitude(samples: AudioInput["samples"]): number {
  const xs = toArray(samples);
  let peak = 0;
  for (const x of xs) {
    const a = Math.abs(x);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Fraction of samples below the silence threshold (spec: |x| < 0.02). */
export function silenceRatio(samples: AudioInput["samples"], threshold = 0.02): number {
  const xs = toArray(samples);
  if (xs.length === 0) return 1;
  let quiet = 0;
  for (const x of xs) if (Math.abs(x) < threshold) quiet++;
  return quiet / xs.length;
}

/** Zero-crossing rate: sign changes / sample transitions. */
export function zeroCrossingRate(samples: AudioInput["samples"]): number {
  const xs = toArray(samples);
  if (xs.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1] as number;
    const cur = xs[i] as number;
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
  }
  return crossings / (xs.length - 1);
}
