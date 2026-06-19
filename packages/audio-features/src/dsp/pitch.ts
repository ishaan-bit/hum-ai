/**
 * Autocorrelation-based F0 (pitch) tracking, pure TypeScript.
 *
 * For speed the signal is anti-alias decimated to ~8 kHz before analysis (F0 <=
 * 500 Hz needs only ~1 kHz of bandwidth), which shrinks the autocorrelation lag
 * search by the decimation factor. Pitch frames are computed on the SAME frame
 * grid as the energy frames, so the returned `voiced` / `f0Hz` arrays line up
 * one-to-one with the per-frame RMS series the extractor already has.
 */
import { DSP_PARAMS, EPS } from "./params";

export interface PitchFrameResult {
  /** Voiced flag per frame (aligned with the energy frame grid). */
  readonly voiced: boolean[];
  /** F0 in Hz per frame, or null when unvoiced. */
  readonly f0Hz: (number | null)[];
  /** Normalized-autocorrelation peak strength per frame, in [0,1]. */
  readonly voicingStrength: number[];
  /** Effective sample rate used for analysis (after decimation). */
  readonly analysisRate: number;
}

/** Box-filter anti-alias decimation by integer factor `m` (>=1). */
function decimate(x: Float64Array, m: number): Float64Array {
  if (m <= 1) return x;
  const outLen = Math.floor(x.length / m);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * m;
    for (let k = 0; k < m; k++) sum += x[base + k] as number;
    out[i] = sum / m;
  }
  return out;
}

/**
 * Normalized short-time autocorrelation F0 for one frame `xd[start .. start+len)`.
 * Returns `{ f0, strength }`; `f0` is null when the frame is unvoiced.
 */
function frameF0(
  xd: Float64Array,
  start: number,
  len: number,
  rate: number,
): { f0: number | null; strength: number } {
  const end = Math.min(start + len, xd.length);
  const n = end - start;
  if (n < 8) return { f0: null, strength: 0 };

  // Remove the frame DC component.
  let mean = 0;
  for (let i = start; i < end; i++) mean += xd[i] as number;
  mean /= n;

  // Energy at lag 0.
  let r0 = 0;
  for (let i = start; i < end; i++) {
    const v = (xd[i] as number) - mean;
    r0 += v * v;
  }
  if (r0 < EPS) return { f0: null, strength: 0 };

  const minLag = Math.max(2, Math.floor(rate / DSP_PARAMS.maxPitchHz));
  const maxLag = Math.min(n - 1, Math.ceil(rate / DSP_PARAMS.minPitchHz));
  if (maxLag <= minLag) return { f0: null, strength: 0 };

  let bestLag = -1;
  let bestVal = -Infinity;
  // Normalized autocorrelation; track the best peak in the F0 search band.
  const norm = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = start; i < end - lag; i++) {
      const a = (xd[i] as number) - mean;
      const b = (xd[i + lag] as number) - mean;
      acc += a * b;
    }
    const r = acc / r0;
    norm[lag] = r;
    if (r > bestVal) {
      bestVal = r;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestVal < DSP_PARAMS.voicingThreshold) {
    return { f0: null, strength: Math.max(0, bestVal) };
  }

  // Reject an out-of-band alias: a peak pinned at minLag (the highest searchable
  // frequency) with only moderate strength is the descending shoulder of a tone
  // whose true F0 is below `minPitchHz`, NOT a real ~`maxPitchHz` pitch. A genuine
  // tone at the edge produces a near-unity peak, so gate on `edgePitchMinStrength`.
  if (bestLag === minLag && bestVal < DSP_PARAMS.edgePitchMinStrength) {
    return { f0: null, strength: Math.max(0, bestVal) };
  }

  // Parabolic interpolation around the peak for a sub-sample lag estimate.
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const ym1 = norm[bestLag - 1] as number;
    const y0 = norm[bestLag] as number;
    const yp1 = norm[bestLag + 1] as number;
    const denom = ym1 - 2 * y0 + yp1;
    if (Math.abs(denom) > EPS) {
      const offset = (0.5 * (ym1 - yp1)) / denom;
      if (offset > -1 && offset < 1) refined = bestLag + offset;
    }
  }

  const f0 = rate / refined;
  return { f0, strength: Math.min(1, Math.max(0, bestVal)) };
}

/**
 * Track F0 over the energy frame grid. `frameLen`/`hop` are in ORIGINAL samples;
 * `nFrames` is the energy-frame count, so the result aligns with the RMS series.
 * `loudEnough` gates voicing on per-frame energy (silent frames are never voiced).
 */
export function trackPitch(
  x: Float64Array,
  sampleRate: number,
  frameLen: number,
  hop: number,
  nFrames: number,
  loudEnough: readonly boolean[],
): PitchFrameResult {
  const m = Math.max(1, Math.round(sampleRate / 8000));
  const xd = decimate(x, m);
  const rate = sampleRate / m;
  const frameLenD = Math.max(8, Math.round(frameLen / m));

  const voiced: boolean[] = new Array(nFrames).fill(false);
  const f0Hz: (number | null)[] = new Array(nFrames).fill(null);
  const voicingStrength: number[] = new Array(nFrames).fill(0);

  for (let f = 0; f < nFrames; f++) {
    if (!(loudEnough[f] ?? false)) continue;
    const startD = Math.round((f * hop) / m);
    const { f0, strength } = frameF0(xd, startD, frameLenD, rate);
    voicingStrength[f] = strength;
    if (f0 !== null && f0 >= DSP_PARAMS.minPitchHz && f0 <= DSP_PARAMS.maxPitchHz) {
      voiced[f] = true;
      f0Hz[f] = f0;
    }
  }

  return { voiced, f0Hz, voicingStrength, analysisRate: rate };
}
