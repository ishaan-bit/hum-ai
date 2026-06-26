/**
 * WITHIN-HUM TEMPORAL DYNAMICS — live per-frame parameter tracking + a rule-based
 * CHANGE-POINT segmentation of one hum (Stable Build v12).
 *
 * Motivation (research-grounded). A hum is not a single static state — it is a short
 * trajectory. The literature on vocal emotion is explicit that the LOCAL/DYNAMIC
 * structure of an utterance carries affect that whole-utterance averages destroy:
 *
 *   - "Local prosodic features represent the temporal dynamics in prosody … the
 *     dynamics of speech, or how features change over time, greatly matters to
 *     listeners" (Rao & Koolagudi, global+local prosody for SER).
 *   - A DECLINING vocal-energy contour across an utterance is a marker of fatigue /
 *     malaise / low mood; a sustained or rising one signals vitality / engagement.
 *   - RISING F0 across an utterance tracks rising arousal/activation; a FALLING
 *     contour tracks settling/calming (calm & sadness both fall).
 *   - Pitch and intensity FLUCTUATE MORE in high-arousal segments — so a GROWING
 *     fluctuation across the hum is building agitation, a SETTLING one is
 *     self-regulation (the vagal/soothing function humming is used for).
 *   - Utterance-FINAL segments are disproportionately informative to listeners — the
 *     end of the hum is weighted.
 *
 * Design (v12, revised). Rather than chop the hum into arbitrary clock-time thirds,
 * we TRACK the mood-variable parameters live on the native 80 ms frame grid, then let
 * a transparent rule-based CHANGE-POINT layer find where the hum actually SHIFTS. The
 * resulting chunks are MEANINGFUL (a phrase, a swell, a settle) and variable-length;
 * the number of them is itself a signal (a restless hum fragments, a settled one stays
 * whole). The CHUNK-TO-CHUNK VARIATIONS are what the read reasons over (see
 * `@hum-ai/orchestrator` `temporal-read.ts`).
 *
 * Trait-decoupling (v11 contract, preserved). Every channel is z-scored WITHIN this
 * hum before change detection, and every per-segment feature is a within-hum quantity,
 * so the segmentation and the trajectory are inherently within-person / within-hum — a
 * husky vs bright VOICE cannot manufacture a trajectory. The temporal layer is built
 * entirely from `FEATURE_KIND === "state"` dynamics; it never reads absolute timbre.
 *
 * Honesty contract (same posture as the rest of `audio-features`). This is
 * deterministic signal processing, NOT a trained or clinically-validated model. The
 * change-point rule is a documented heuristic; the per-segment features are produced
 * by the EXACT production extractor (`computeFeatures`) on the segment's samples, so
 * a segment feature means exactly what a whole-hum feature means.
 */
import { clamp01, mean, normalize } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "./features";
import type { AudioInput } from "./extract";
import { computeFeatures } from "./hum-extractor";
import { DSP_PARAMS, EPS } from "./dsp/params";
import { frameRmsSeries, removeDcOffset, std, toFloat64 } from "./dsp/signal";
import { trackPitch } from "./dsp/pitch";
import { ceilPow2, magnitudeSpectrum } from "./dsp/fft";

/** Tunable constants for the change-point segmentation (one discoverable home). */
export const TEMPORAL_PARAMS = {
  /** Schema tag stamped onto every temporal analysis. */
  temporalMode: "hum-temporal-v1",
  /** Minimum length of any derived chunk (s). Keeps each chunk feature-stable. */
  minSegmentSec: 2.5,
  /** Hard cap on the number of chunks (so a noisy hum can't shatter into dozens). */
  maxSegments: 5,
  /** Moving-average smoothing applied to each channel before segmentation (frames). */
  smoothFrames: 3,
  /**
   * Minimum normalized between-segment separation GAIN for a split to be accepted (the
   * binary-segmentation threshold). The gain `(nL·nR/N)·Δμ²` is summed over the four
   * within-hum z-scored channels and divided by the segment length, so it is a scale-free
   * "robust σ² of separation per frame." A steady hum's bounded oscillation produces a
   * best-split gain ≈0.3–0.5 from sampling noise alone; a decisive, sustained shift (a
   * real swell / glide, even a GRADUAL one) clears ≈0.8+. The threshold sits in that
   * measured gap — validated by the hum-sim temporal gate (flat ≈0.4, contoured ≈1.0+).
   */
  splitGain: 0.62,
  /** Points in the compact energy contour exposed for visualization. */
  contourPoints: 24,
} as const;

/**
 * The LIVE per-frame parameter track — the mood-variable parameters sampled on the
 * native 80 ms frame grid, aligned one-to-one. This is the raw material the
 * change-point layer differentiates. Derived (not raw audio); safe to inspect.
 */
export interface FrameTrack {
  readonly hopSec: number;
  readonly frameCount: number;
  /** Frame start times, seconds. */
  readonly timeSec: readonly number[];
  /** Per-frame RMS energy. */
  readonly energy: readonly number[];
  /** Per-frame F0 (Hz) or null when unvoiced. */
  readonly f0Hz: readonly (number | null)[];
  /** Per-frame spectral centroid (Hz); 0 for sub-active frames. */
  readonly centroidHz: readonly number[];
  /** Per-frame positive spectral flux vs the previous active frame; 0 at breaks. */
  readonly flux: readonly number[];
  /** Per-frame "loud enough to analyze" flag (RMS ≥ quiet floor). */
  readonly active: readonly boolean[];
}

/** One CHANGE-POINT-derived chunk of the hum, with the full features of its span. */
export interface HumSegment {
  readonly index: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly startFrame: number;
  readonly endFrame: number;
  /** Features of THIS chunk, from the production extractor on the chunk's samples. */
  readonly features: AcousticFeatures;
}

/** The full within-hum temporal analysis: chunks + how much/where the hum moved. */
export interface TemporalAnalysis {
  readonly temporalMode: string;
  readonly durationSec: number;
  readonly hopSec: number;
  /** Number of meaningful chunks (1 = the hum never decisively shifted). */
  readonly segmentCount: number;
  readonly segments: readonly HumSegment[];
  /** Internal change-point times (seconds; excludes the 0 and end edges). */
  readonly boundarySec: readonly number[];
  /** Mean of the within-hum novelty curve — overall internal movement. */
  readonly changeMean: number;
  /** Peak of the novelty curve — the sharpest single shift. */
  readonly changePeak: number;
  /** Compact, self-normalized [0,1] energy contour for visualization (≤ contourPoints). */
  readonly energyContour: readonly number[];
}

/** Hann window of length `n` (local; mirrors the spectral extractor). */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * Compute the live per-frame parameter track for one hum. Mirrors the framing of
 * `computeFeatures` exactly (80 ms windows, non-overlapping) so the track aligns with
 * the production feature grid.
 */
export function computeFrameTrack(input: AudioInput): FrameTrack {
  const sampleRate = input.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`computeFrameTrack: invalid sampleRate ${sampleRate}`);
  }
  const x0 = toFloat64(input.samples);
  const n = x0.length;
  if (n === 0) {
    return { hopSec: 0, frameCount: 0, timeSec: [], energy: [], f0Hz: [], centroidHz: [], flux: [], active: [] };
  }
  const x = removeDcOffset(x0);

  let frameLen = Math.max(1, Math.round((DSP_PARAMS.rmsWindowMs / 1000) * sampleRate));
  let hop = Math.max(1, Math.round((DSP_PARAMS.rmsHopMs / 1000) * sampleRate));
  frameLen = Math.min(frameLen, n);
  hop = Math.min(hop, frameLen);
  const hopSec = hop / sampleRate;

  const frameRms = frameRmsSeries(x, frameLen, hop);
  const nf = frameRms.length;
  const energy = Array.from(frameRms);
  const active: boolean[] = new Array(nf);
  const loudEnough: boolean[] = new Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = (energy[f] as number) >= DSP_PARAMS.quietFrameRms;
    active[f] = a;
    loudEnough[f] = a;
  }

  // Pitch on the same grid (decimated autocorrelation inside trackPitch).
  const pitch = trackPitch(x, sampleRate, frameLen, hop, nf, loudEnough);

  // Per-frame spectral centroid + positive flux (Hann-windowed FFT per 80 ms frame).
  const nfft = ceilPow2(frameLen);
  const freqPerBin = sampleRate / nfft;
  const bins = (nfft >> 1) + 1;
  const win = hann(frameLen);
  const framed = new Float64Array(frameLen);
  const centroidHz = new Array<number>(nf).fill(0);
  const flux = new Array<number>(nf).fill(0);
  let prevMag: Float64Array | null = null;
  for (let f = 0; f < nf; f++) {
    if (!active[f]) {
      prevMag = null; // a sub-active frame breaks the flux continuity
      continue;
    }
    const start = f * hop;
    for (let i = 0; i < frameLen; i++) framed[i] = (x[start + i] as number) * (win[i] as number);
    const mag = magnitudeSpectrum(framed);
    let magSum = 0;
    let centroid = 0;
    for (let k = 1; k < bins; k++) {
      const m = mag[k] as number;
      magSum += m;
      centroid += k * freqPerBin * m;
    }
    if (magSum < EPS) {
      prevMag = null;
      continue;
    }
    centroidHz[f] = centroid / magSum;
    if (prevMag) {
      let up = 0;
      let cur = 0;
      for (let k = 1; k < bins; k++) {
        const m = mag[k] as number;
        const diff = m - (prevMag[k] as number);
        if (diff > 0) up += diff;
        cur += m;
      }
      flux[f] = cur > EPS ? up / cur : 0;
    }
    prevMag = Float64Array.from(mag);
  }

  const timeSec = new Array<number>(nf);
  for (let f = 0; f < nf; f++) timeSec[f] = f * hopSec;

  return { hopSec, frameCount: nf, timeSec, energy, f0Hz: pitch.f0Hz, centroidHz, flux, active };
}

/** Fill invalid entries by linear interpolation between nearest valid neighbours. */
function fillGaps(values: readonly (number | null)[], valid: readonly boolean[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (valid[i] && values[i] !== null && Number.isFinite(values[i] as number)) idx.push(i);
  if (idx.length === 0) return out;
  // edges: hold the nearest valid value.
  for (let i = 0; i < (idx[0] as number); i++) out[i] = values[idx[0] as number] as number;
  const last = idx[idx.length - 1] as number;
  for (let i = last + 1; i < n; i++) out[i] = values[last] as number;
  for (let s = 0; s < idx.length; s++) {
    const a = idx[s] as number;
    out[a] = values[a] as number;
    if (s + 1 < idx.length) {
      const b = idx[s + 1] as number;
      const va = values[a] as number;
      const vb = values[b] as number;
      for (let i = a + 1; i < b; i++) out[i] = va + ((vb - va) * (i - a)) / (b - a);
    }
  }
  return out;
}

/** Within-hum z-score of a series; a flat series (std≈0) contributes nothing. */
function zScore(values: readonly number[]): number[] {
  const m = mean(values);
  const s = std(values);
  if (s < 1e-6) return values.map(() => 0);
  return values.map((v) => (v - m) / s);
}

/** Centered moving-average smoother over `w` frames (odd half-window). */
function smooth(values: readonly number[], w: number): number[] {
  const n = values.length;
  if (w <= 1 || n === 0) return values.slice();
  const half = Math.floor(w / 2);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      acc += values[j] as number;
      cnt++;
    }
    out[i] = cnt > 0 ? acc / cnt : 0;
  }
  return out;
}

/** Mean of a sub-window [lo,hi) of a series. */
function windowMean(values: readonly number[], lo: number, hi: number): number {
  let acc = 0;
  let cnt = 0;
  for (let i = lo; i < hi; i++) {
    acc += values[i] as number;
    cnt++;
  }
  return cnt > 0 ? acc / cnt : 0;
}

/** Prefix sums of a series so any sub-range mean is O(1): mean(a,b)=(P[b]-P[a])/(b-a). */
function prefixSums(values: readonly number[]): Float64Array {
  const n = values.length;
  const p = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) p[i + 1] = (p[i] as number) + (values[i] as number);
  return p;
}

/**
 * Best split of channels over the frame range [a,b): the t that maximizes the summed
 * between-segment separation gain, normalized by the segment length. The gain for one
 * channel splitting [a,b) at t is `(nL·nR/N)·(meanL−meanR)²` — the standard variance-
 * reduction (CUSUM) statistic — summed across channels. Unlike a local step detector,
 * this fires on BOTH an abrupt step AND a gradual monotonic ramp (whose best split is
 * its midpoint), because it compares the FULL segments, not a sliding window.
 */
function bestSplit(
  prefixes: readonly Float64Array[],
  a: number,
  b: number,
  minSegFrames: number,
): { t: number; gain: number } {
  const N = b - a;
  let bestT = -1;
  let bestGain = 0;
  const tLo = a + minSegFrames;
  const tHi = b - minSegFrames;
  for (let t = tLo; t <= tHi; t++) {
    const nL = t - a;
    const nR = b - t;
    let g = 0;
    for (const P of prefixes) {
      const meanL = ((P[t] as number) - (P[a] as number)) / nL;
      const meanR = ((P[b] as number) - (P[t] as number)) / nR;
      const d = meanL - meanR;
      g += ((nL * nR) / N) * d * d;
    }
    if (g > bestGain) {
      bestGain = g;
      bestT = t;
    }
  }
  // Normalize by segment length so the threshold is a per-frame, scale-free quantity.
  return { t: bestT, gain: bestT < 0 ? 0 : bestGain / N };
}

/**
 * The rule-based change-point detector (BINARY SEGMENTATION). Builds the within-hum
 * z-scored channels (log-energy, pitch in semitones, log-brightness, flux), then
 * recursively splits at the point of greatest between-segment separation while that
 * separation clears a scale-free gain threshold and the chunks stay above the minimum
 * length, up to a hard chunk cap. Because the statistic compares whole segments it
 * detects both abrupt STEPS and gradual monotonic TRENDS — a pure step detector misses
 * the latter (a linear ramp has no local peak). Returns the internal boundary FRAME
 * indices (sorted ascending; empty ⇒ one chunk).
 */
export function detectChangePoints(
  track: FrameTrack,
  opts: { minSegmentSec?: number; maxSegments?: number } = {},
): { boundaries: number[]; novelty: number[]; changeMean: number; changePeak: number } {
  const nf = track.frameCount;
  const hopSec = track.hopSec || DSP_PARAMS.rmsHopMs / 1000;
  const minSegFrames = Math.max(2, Math.round((opts.minSegmentSec ?? TEMPORAL_PARAMS.minSegmentSec) / hopSec));
  const maxSegments = Math.max(1, opts.maxSegments ?? TEMPORAL_PARAMS.maxSegments);

  const novelty = new Array<number>(nf).fill(0);
  if (nf < 2 * minSegFrames) return { boundaries: [], novelty, changeMean: 0, changePeak: 0 };

  // Channels (within-hum z-scored, gap-filled, smoothed).
  const energyLog = track.energy.map((e) => Math.log(Math.max(e, 1e-5)));
  const f0Valid = track.f0Hz.map((v) => v !== null && Number.isFinite(v as number));
  const f0Semi = fillGaps(
    track.f0Hz.map((v) => (v !== null && (v as number) > 0 ? 12 * Math.log2(v as number) : null)),
    f0Valid,
  );
  const centroidLog = fillGaps(
    track.centroidHz.map((c, i) => (track.active[i] && c > 0 ? Math.log(c) : null)),
    track.active,
  );
  const fluxFilled = fillGaps(
    track.flux.map((c, i) => (track.active[i] ? c : null)),
    track.active,
  );

  const sf = TEMPORAL_PARAMS.smoothFrames;
  const channels = [
    smooth(zScore(energyLog), sf),
    smooth(zScore(f0Semi), sf),
    smooth(zScore(centroidLog), sf),
    smooth(zScore(fluxFilled), sf),
  ];
  const prefixes = channels.map(prefixSums);

  const threshold = TEMPORAL_PARAMS.splitGain;
  const maxBoundaries = maxSegments - 1;
  const accepted: number[] = [];
  let peak = 0;

  // Greedy binary segmentation: recursively split the strongest separations first.
  const recurse = (a: number, b: number): void => {
    if (accepted.length >= maxBoundaries) return;
    if (b - a < 2 * minSegFrames) return;
    const { t, gain } = bestSplit(prefixes, a, b, minSegFrames);
    if (t < 0) return;
    if (a === 0 && b === nf) peak = gain; // top-level separation (reported as changePeak)
    if (gain < threshold) return;
    accepted.push(t);
    recurse(a, t);
    recurse(t, b);
  };
  recurse(0, nf);
  accepted.sort((a, b) => a - b);

  // Record the per-frame top-level gain curve for visualization/diagnostics.
  const top = bestSplitCurve(prefixes, 0, nf, minSegFrames, novelty);
  return { boundaries: accepted, novelty, changeMean: top.mean, changePeak: Math.max(peak, top.peak) };
}

/** Fill `out[t]` with the normalized top-level split gain at each t (for viz/debug). */
function bestSplitCurve(
  prefixes: readonly Float64Array[],
  a: number,
  b: number,
  minSegFrames: number,
  out: number[],
): { mean: number; peak: number } {
  const N = b - a;
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (let t = a + minSegFrames; t <= b - minSegFrames; t++) {
    const nL = t - a;
    const nR = b - t;
    let g = 0;
    for (const P of prefixes) {
      const meanL = ((P[t] as number) - (P[a] as number)) / nL;
      const meanR = ((P[b] as number) - (P[t] as number)) / nR;
      const d = meanL - meanR;
      g += ((nL * nR) / N) * d * d;
    }
    const ng = g / N;
    out[t] = ng;
    sum += ng;
    count++;
    if (ng > peak) peak = ng;
  }
  return { mean: count > 0 ? sum / count : 0, peak };
}

/** Downsample a series to ≤ `points` and self-normalize to [0,1] (min→0, max→1). */
function contour(values: readonly number[], points: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  const k = Math.min(points, n);
  const out = new Array<number>(k).fill(0);
  for (let p = 0; p < k; p++) {
    const lo = Math.floor((p * n) / k);
    const hi = Math.max(lo + 1, Math.floor(((p + 1) * n) / k));
    out[p] = windowMean(values, lo, hi);
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of out) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (!Number.isFinite(span) || span < EPS) return out.map(() => 0.5);
  return out.map((v) => clamp01((v - min) / span));
}

/**
 * FULL within-hum temporal analysis: live-track → change-point chunks → per-chunk
 * production features. Each chunk's features come from re-running `computeFeatures`
 * on the chunk's own samples, so a chunk feature means exactly what a whole-hum
 * feature means. A hum that never decisively shifts yields ONE chunk (the whole hum) —
 * a meaningful "steady throughout" outcome, not a forced split.
 */
export function analyzeTemporalDynamics(
  input: AudioInput,
  opts: { minSegmentSec?: number; maxSegments?: number } = {},
): TemporalAnalysis {
  const x = toFloat64(input.samples);
  const n = x.length;
  const sampleRate = input.sampleRate;
  const durationSec = n > 0 && sampleRate > 0 ? n / sampleRate : 0;

  const track = computeFrameTrack(input);
  const hopSec = track.hopSec || DSP_PARAMS.rmsHopMs / 1000;
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const frameLen = Math.min(Math.max(1, Math.round((DSP_PARAMS.rmsWindowMs / 1000) * sampleRate)), Math.max(1, n));

  const { boundaries, changeMean, changePeak } = detectChangePoints(track, opts);
  const energyContour = contour(track.energy, TEMPORAL_PARAMS.contourPoints);

  // Frame boundaries → segment frame spans → sample spans → per-chunk features.
  const frameEdges = [0, ...boundaries, track.frameCount];
  const segments: HumSegment[] = [];
  for (let s = 0; s < frameEdges.length - 1; s++) {
    const fa = frameEdges[s] as number;
    const fb = frameEdges[s + 1] as number;
    if (fb <= fa) continue;
    const sampleStart = Math.min(n, fa * hop);
    // Last chunk runs to the end of the signal; interior chunks include their frame body.
    const sampleEnd = s === frameEdges.length - 2 ? n : Math.min(n, (fb - 1) * hop + frameLen);
    const slice = x.subarray(sampleStart, Math.max(sampleStart + 1, sampleEnd));
    // computeFeatures takes Float32 PCM / number[]; copy the Float64 slice to Float32
    // (the capture buffer was Float32 to begin with — no meaningful precision loss).
    const features = computeFeatures({ sampleRate, samples: Float32Array.from(slice) });
    segments.push({
      index: s,
      startFrame: fa,
      endFrame: fb,
      startSec: fa * hopSec,
      endSec: Math.min(durationSec, fb * hopSec),
      features,
    });
  }

  return {
    temporalMode: TEMPORAL_PARAMS.temporalMode,
    durationSec,
    hopSec,
    segmentCount: segments.length,
    segments,
    boundarySec: boundaries.map((b) => b * hopSec),
    changeMean,
    changePeak,
    energyContour,
  };
}
