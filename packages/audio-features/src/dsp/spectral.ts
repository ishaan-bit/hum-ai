/**
 * Short-time spectral features via the local radix-2 FFT (no external DSP deps).
 * Centroid / bandwidth / rolloff / flatness / flux, averaged over the frames that
 * carry enough energy to be meaningful (silence frames are skipped). All values
 * are deterministic functions of the input.
 */
import { ceilPow2, magnitudeSpectrum } from "./fft";
import { DSP_PARAMS, EPS } from "./params";

export interface SpectralResult {
  readonly centroidHz: number;
  readonly bandwidthHz: number;
  readonly rolloffHz: number;
  /** Spectral flatness (Wiener entropy): ~0 tonal, ~1 flat/noise-like. */
  readonly flatness: number;
  /** Normalized positive spectral flux between consecutive frames, ~[0,1]. */
  readonly flux: number;
}

const SAFE_DEFAULT: SpectralResult = {
  centroidHz: 0,
  bandwidthHz: 0,
  rolloffHz: 0,
  flatness: 0,
  flux: 0,
};

/** Hann window of length `n`. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function spectralFeatures(x: Float64Array, sampleRate: number): SpectralResult {
  const win = Math.max(16, Math.round((DSP_PARAMS.spectralWindowMs / 1000) * sampleRate));
  const hop = Math.max(1, Math.round((DSP_PARAMS.spectralHopMs / 1000) * sampleRate));
  if (x.length < win) return SAFE_DEFAULT;

  const nfft = ceilPow2(win);
  const window = hann(win);
  const freqPerBin = sampleRate / nfft;
  const bins = (nfft >> 1) + 1;

  let centroidSum = 0;
  let bandwidthSum = 0;
  let rolloffSum = 0;
  let flatnessSum = 0;
  let included = 0;

  let fluxSum = 0;
  let fluxPairs = 0;
  let prevMag: Float64Array | null = null;

  const framed = new Float64Array(win);
  const lastStart = x.length - win;
  for (let start = 0; start <= lastStart; start += hop) {
    // Window the frame and gate on energy.
    let energy = 0;
    for (let i = 0; i < win; i++) {
      const v = (x[start + i] as number) * (window[i] as number);
      framed[i] = v;
      energy += v * v;
    }
    const frameRms = Math.sqrt(energy / win);
    if (frameRms < DSP_PARAMS.quietFrameRms) {
      prevMag = null; // a silent frame breaks the flux continuity
      continue;
    }

    const mag = magnitudeSpectrum(framed);

    let magSum = 0;
    let powSum = 0;
    let logPowSum = 0;
    let centroid = 0;
    for (let k = 1; k < bins; k++) {
      const m = mag[k] as number;
      const f = k * freqPerBin;
      const p = m * m;
      magSum += m;
      powSum += p;
      logPowSum += Math.log(p + EPS);
      centroid += f * m;
    }
    if (magSum < EPS) {
      prevMag = null;
      continue;
    }
    centroid /= magSum;

    let bwAcc = 0;
    let cumPow = 0;
    let rolloff = 0;
    const rolloffTarget = DSP_PARAMS.rolloffFraction * powSum;
    let rolloffFound = false;
    for (let k = 1; k < bins; k++) {
      const m = mag[k] as number;
      const f = k * freqPerBin;
      bwAcc += (f - centroid) * (f - centroid) * m;
      cumPow += m * m;
      if (!rolloffFound && cumPow >= rolloffTarget) {
        rolloff = f;
        rolloffFound = true;
      }
    }
    const bandwidth = Math.sqrt(bwAcc / magSum);
    const geoMean = Math.exp(logPowSum / (bins - 1));
    const arithMean = powSum / (bins - 1);
    const flatness = arithMean > EPS ? Math.min(1, geoMean / arithMean) : 0;

    centroidSum += centroid;
    bandwidthSum += bandwidth;
    rolloffSum += rolloffFound ? rolloff : centroid;
    flatnessSum += flatness;
    included++;

    if (prevMag) {
      let up = 0;
      let cur = 0;
      for (let k = 1; k < bins; k++) {
        const m = mag[k] as number;
        const diff = m - (prevMag[k] as number);
        if (diff > 0) up += diff;
        cur += m;
      }
      if (cur > EPS) {
        fluxSum += up / cur;
        fluxPairs++;
      }
    }
    prevMag = Float64Array.from(mag);
  }

  if (included === 0) return SAFE_DEFAULT;

  return {
    centroidHz: centroidSum / included,
    bandwidthHz: bandwidthSum / included,
    rolloffHz: rolloffSum / included,
    flatness: flatnessSum / included,
    flux: fluxPairs > 0 ? fluxSum / fluxPairs : 0,
  };
}
