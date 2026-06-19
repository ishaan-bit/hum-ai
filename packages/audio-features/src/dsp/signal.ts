/**
 * Time-domain signal helpers for the hum extractor: normalization, framing,
 * per-frame RMS, simple statistics, and run-length analysis over boolean frame
 * flags. All pure, dependency-free, and deterministic.
 */
import { EPS } from "./params";

/**
 * Coerce any accepted sample container into a dense Float64Array (copy), with
 * NON-FINITE SANITIZATION: any NaN / ±Infinity sample is replaced with 0.
 *
 * Samples are contractually mono PCM in [-1, 1], but real decode/resample/capture
 * paths can emit a stray non-finite sample. Left unhandled, a single NaN/Inf would
 * poison the whole capture (the DC-mean it feeds, then every downstream value).
 * Coercing a bad sample to 0 (silence at that instant) degrades gracefully instead:
 * one glitch lowers energy slightly; an all-bad buffer becomes silence and is
 * rejected — never a valid-looking but wrong feature vector.
 */
export function toFloat64(samples: Float32Array | readonly number[]): Float64Array {
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] as number;
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

/**
 * "Mono normalization": the input is already mono per the `AudioInput` contract,
 * so this only removes any DC offset (subtracts the mean) so RMS/peak/ZCR reflect
 * the AC signal. It deliberately does NOT peak-normalize amplitude — loudness is
 * load-bearing information for the quality gate.
 */
export function removeDcOffset(x: Float64Array): Float64Array {
  if (x.length === 0) return x;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] as number;
  const dc = sum / x.length;
  if (dc === 0) return x;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] as number) - dc;
  return out;
}

/** Number of frames of length `frameLen` stepping by `hop` over `n` samples. */
export function frameCount(n: number, frameLen: number, hop: number): number {
  if (n < frameLen || frameLen <= 0 || hop <= 0) return n >= frameLen ? 1 : 0;
  return 1 + Math.floor((n - frameLen) / hop);
}

/** RMS of `x[start .. start+len)`. */
export function rmsOf(x: Float64Array, start: number, len: number): number {
  if (len <= 0) return 0;
  let sum = 0;
  const end = Math.min(start + len, x.length);
  for (let i = start; i < end; i++) {
    const v = x[i] as number;
    sum += v * v;
  }
  const count = end - start;
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Per-frame RMS array. */
export function frameRmsSeries(x: Float64Array, frameLen: number, hop: number): Float64Array {
  const count = frameCount(x.length, frameLen, hop);
  const out = new Float64Array(count);
  for (let f = 0; f < count; f++) out[f] = rmsOf(x, f * hop, frameLen);
  return out;
}

/** Overall RMS = sqrt(mean(x^2)). */
export function overallRms(x: Float64Array): number {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number;
    sum += v * v;
  }
  return Math.sqrt(sum / x.length);
}

/** Peak absolute amplitude. */
export function peakAbs(x: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i] as number);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Fraction of samples with |x| below `threshold`. */
export function silentSampleRatio(x: Float64Array, threshold: number): number {
  if (x.length === 0) return 1;
  let quiet = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] as number) < threshold) quiet++;
  return quiet / x.length;
}

/** Zero-crossing rate = sign changes / transitions. */
export function zeroCrossingRate(x: Float64Array): number {
  if (x.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < x.length; i++) {
    const prev = x[i - 1] as number;
    const cur = x[i] as number;
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
  }
  return crossings / (x.length - 1);
}

/** Population variance. Returns 0 for <2 values. */
export function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const m = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return acc / values.length;
}

/** Standard deviation. */
export function std(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

/** Coefficient of variation (std/mean), guarded against tiny/zero means. */
export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const m = sum / values.length;
  if (Math.abs(m) < EPS) return 0;
  return std(values) / Math.abs(m);
}

/**
 * Mean relative absolute difference between consecutive values:
 * mean(|v[i] - v[i-1]| / |v[i]|). The basis for the jitter (pitch) and shimmer
 * (amplitude) proxies. Returns 0 for <2 values.
 */
export function meanRelativeStep(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let acc = 0;
  let n = 0;
  for (let i = 1; i < values.length; i++) {
    const cur = values[i] as number;
    const prev = values[i - 1] as number;
    const denom = Math.abs(cur) > EPS ? Math.abs(cur) : EPS;
    acc += Math.abs(cur - prev) / denom;
    n++;
  }
  return n > 0 ? acc / n : 0;
}

/** Least-squares slope of `values` against frame index (units: value per frame). */
export function linregSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const v of values) meanY += v;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * ((values[i] as number) - meanY);
    den += dx * dx;
  }
  return den > EPS ? num / den : 0;
}

export interface Run {
  readonly value: boolean;
  readonly start: number;
  readonly length: number;
}

/** Run-length encode a boolean array. */
export function runs(flags: readonly boolean[]): Run[] {
  const out: Run[] = [];
  let i = 0;
  while (i < flags.length) {
    const value = flags[i] as boolean;
    let j = i + 1;
    while (j < flags.length && flags[j] === value) j++;
    out.push({ value, start: i, length: j - i });
    i = j;
  }
  return out;
}

/** Length of the longest run of `value`. */
export function longestRun(flags: readonly boolean[], value: boolean): number {
  let best = 0;
  for (const r of runs(flags)) if (r.value === value && r.length > best) best = r.length;
  return best;
}
