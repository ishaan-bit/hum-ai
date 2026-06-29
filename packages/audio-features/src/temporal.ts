/**
 * WITHIN-HUM TEMPORAL DYNAMICS — live per-frame tracking of the FULL feature set +
 * an UNSUPERVISED segmentation of one hum into meaningful chunks (Stable Build v13).
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
 *   - Utterance-FINAL segments are disproportionately informative to listeners.
 *
 * Design (v13). We TRACK the FULL mood-variable parameter set live on the native 80 ms
 * frame grid (energy, pitch, brightness/centroid, bandwidth, rolloff, spectral flux,
 * zero-crossing rate, and the frame-to-frame pitch/amplitude perturbation) — the
 * "entire feature set through each hum" the design brief calls for. We then z-score every
 * channel WITHIN this hum and let an UNSUPERVISED segmenter decide how many chunks the hum
 * holds and where they fall.
 *
 * The segmenter (v13). The chunking is unsupervised least-squares change-point detection
 * by DYNAMIC PROGRAMMING with PENALIZED model selection — i.e. for every candidate chunk
 * count K it finds the GLOBALLY optimal partition that minimizes within-segment variance
 * (the k-segments / PELT-family objective), then a complexity penalty selects K. No label,
 * no target, no threshold tuned per-hum: the data's own variability decides the number of
 * chunks and their boundaries. Because the cost compares WHOLE segments it fires on BOTH an
 * abrupt step AND a gradual monotonic ramp (a step detector misses ramps), and a steady hum
 * whose bounded oscillation never clears the penalty stays ONE chunk — a meaningful "steady
 * throughout", not a forced split. The number of chunks is itself a signal (a restless hum
 * fragments, a settled one stays whole). The chunks — and the CHUNK-TO-CHUNK variation — are
 * what the read reasons over (see `@hum-ai/orchestrator` `temporal-read.ts`).
 *
 * Local-only. The dense per-frame track is computed on-device and is NEVER returned on the
 * analysis object, never persisted, never synced — only the small derived chunks leave this
 * module (the design's "live tracking … processed locally … only the chunks need be saved").
 *
 * Trait-decoupling (v11 contract, preserved). Every channel is z-scored WITHIN this hum
 * before change detection, and every per-segment quantity the read compares is within-hum,
 * so the segmentation and the trajectory are inherently within-person / within-hum — a
 * husky vs bright VOICE cannot manufacture a trajectory.
 *
 * Honesty contract (same posture as the rest of `audio-features`). This is deterministic
 * signal processing, NOT a trained or clinically-validated model. The segmenter is an
 * unsupervised least-squares optimum; the per-segment features are produced by the EXACT
 * production extractor (`computeFeatures`) on the segment's samples, so a segment feature
 * means exactly what a whole-hum feature means.
 */
import { clamp01, mean } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "./features";
import type { AudioInput } from "./extract";
import { computeFeatures } from "./hum-extractor";
import { DSP_PARAMS, EPS } from "./dsp/params";
import { frameRmsSeries, removeDcOffset, std, toFloat64 } from "./dsp/signal";
import { trackPitch } from "./dsp/pitch";
import { ceilPow2, magnitudeSpectrum } from "./dsp/fft";

/** Tunable constants for the unsupervised within-hum segmentation (one discoverable home). */
export const TEMPORAL_PARAMS = {
  /** Schema tag stamped onto every temporal analysis. */
  temporalMode: "hum-temporal-v2",
  /** Minimum length of any derived chunk (s). Keeps each chunk feature-stable. */
  minSegmentSec: 2.5,
  /** Hard cap on the number of chunks (so a noisy hum can't shatter into dozens). */
  maxSegments: 5,
  /** Moving-average smoothing applied to each channel before segmentation (frames). */
  smoothFrames: 3,
  /**
   * UNSUPERVISED model-selection PENALTY — the per-frame, per-channel between-segment
   * separation a split must add to be worth one extra chunk. The DP minimizes the average
   * within-segment variance across the within-hum z-scored channels; an additional segment is
   * accepted only when it reduces that average by more than `splitGain` per frame. Because the
   * channels are z-scored (unit variance), this is a scale-free "robust σ² of separation per
   * frame, per channel": a steady hum's bounded oscillation produces a best gain ≈0.04–0.08 from
   * sampling noise alone; a decisive, sustained shift (a swell / glide, even a GRADUAL one) clears
   * ≈0.15+. The threshold sits in that measured gap — validated by the hum-sim temporal gate.
   * (Named `splitGain` for continuity; it is now the penalized-K acceptance gain, not a binary-seg
   * threshold.) Calibrated on the gate's fixed deterministic seeds: flat hums peak ≤0.124, the
   * weakest contour (a falling pitch glide) peaks ≥0.154 — `0.139` sits symmetrically in the gap.
   */
  splitGain: 0.139,
  /** Points in the compact energy contour exposed for visualization. */
  contourPoints: 24,
} as const;

/** The within-hum channels the unsupervised segmenter differentiates (display/diagnostic order). */
export const TEMPORAL_CHANNELS = [
  "energy",
  "pitch",
  "brightness",
  "flux",
  "bandwidth",
  "rolloff",
  "zcr",
  "pitchPerturbation",
  "ampPerturbation",
] as const;
export type TemporalChannel = (typeof TEMPORAL_CHANNELS)[number];

/**
 * Per-channel weights in the segmentation cost, aligned to `TEMPORAL_CHANNELS`. The four
 * PRIMARY affect carriers (energy, pitch, brightness, spectral flux) — the channels the v12
 * change-point statistic was validated on — carry full weight; the AUXILIARY channels
 * (bandwidth, rolloff, zcr, and the frame-to-frame pitch/amplitude perturbation) add refinement
 * at reduced weight so the full feature set informs the chunking WITHOUT a single-channel shift
 * (e.g. a pure energy swell) being diluted below the penalty by the auxiliary channels' noise.
 * The cost is a WEIGHTED AVERAGE (normalized by Σ weights), so the penalty stays scale-free.
 */
export const TEMPORAL_CHANNEL_WEIGHTS: Readonly<Record<TemporalChannel, number>> = {
  energy: 1,
  pitch: 1,
  brightness: 1,
  flux: 1,
  bandwidth: 0.35,
  rolloff: 0.35,
  zcr: 0.35,
  pitchPerturbation: 0.5,
  ampPerturbation: 0.5,
};
const WEIGHTS: readonly number[] = TEMPORAL_CHANNELS.map((c) => TEMPORAL_CHANNEL_WEIGHTS[c]);
const WEIGHT_SUM: number = WEIGHTS.reduce((s, w) => s + w, 0);

/**
 * The LIVE per-frame parameter track — the FULL mood-variable parameter set sampled on the
 * native 80 ms frame grid, aligned one-to-one. This is the raw material the unsupervised
 * segmenter differentiates. Derived (not raw audio) and LOCAL-ONLY: it is never placed on
 * `TemporalAnalysis`, never persisted, never synced.
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
  /** Per-frame spectral bandwidth (Hz spread around the centroid); 0 at breaks. */
  readonly bandwidthHz: readonly number[];
  /** Per-frame spectral rolloff (Hz below which 85% of energy lies); 0 at breaks. */
  readonly rolloffHz: readonly number[];
  /** Per-frame positive spectral flux vs the previous active frame; 0 at breaks. */
  readonly flux: readonly number[];
  /** Per-frame zero-crossing rate (fraction of sign changes); 0 at breaks. */
  readonly zcr: readonly number[];
  /** Per-frame "loud enough to analyze" flag (RMS ≥ quiet floor). */
  readonly active: readonly boolean[];
}

/** One unsupervised chunk of the hum, with the full features of its span. */
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
  /** Peak of the novelty curve — the sharpest single shift (per-frame, per-channel gain). */
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
 * the production feature grid. The richer spectral channels (bandwidth, rolloff, zcr) are
 * computed in the SAME FFT pass that produces the centroid, so the full track is one cheap
 * sweep of the signal.
 */
export function computeFrameTrack(input: AudioInput): FrameTrack {
  const sampleRate = input.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`computeFrameTrack: invalid sampleRate ${sampleRate}`);
  }
  const x0 = toFloat64(input.samples);
  const n = x0.length;
  if (n === 0) {
    return {
      hopSec: 0, frameCount: 0, timeSec: [], energy: [], f0Hz: [], centroidHz: [],
      bandwidthHz: [], rolloffHz: [], flux: [], zcr: [], active: [],
    };
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

  // Per-frame spectral centroid / bandwidth / rolloff + positive flux (Hann-windowed FFT
  // per 80 ms frame) and zero-crossing rate (time-domain).
  const nfft = ceilPow2(frameLen);
  const freqPerBin = sampleRate / nfft;
  const bins = (nfft >> 1) + 1;
  const win = hann(frameLen);
  const framed = new Float64Array(frameLen);
  const centroidHz = new Array<number>(nf).fill(0);
  const bandwidthHz = new Array<number>(nf).fill(0);
  const rolloffHz = new Array<number>(nf).fill(0);
  const flux = new Array<number>(nf).fill(0);
  const zcr = new Array<number>(nf).fill(0);
  const ROLLOFF_FRAC = 0.85;
  let prevMag: Float64Array | null = null;
  for (let f = 0; f < nf; f++) {
    if (!active[f]) {
      prevMag = null; // a sub-active frame breaks the flux continuity
      continue;
    }
    const start = f * hop;
    // zero-crossing rate from the raw (un-windowed) frame body.
    let crossings = 0;
    let prevSign = 0;
    for (let i = 0; i < frameLen; i++) {
      const v = x[start + i] as number;
      const s = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (s !== 0) {
        if (prevSign !== 0 && s !== prevSign) crossings++;
        prevSign = s;
      }
      framed[i] = v * (win[i] as number);
    }
    zcr[f] = frameLen > 1 ? crossings / (frameLen - 1) : 0;

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
    const cen = centroid / magSum;
    centroidHz[f] = cen;
    // bandwidth = magnitude-weighted RMS spread around the centroid; rolloff = freq below
    // which ROLLOFF_FRAC of the magnitude energy lies.
    let spread = 0;
    let cum = 0;
    const rolloffTarget = ROLLOFF_FRAC * magSum;
    let rolloff = 0;
    let rolloffSet = false;
    for (let k = 1; k < bins; k++) {
      const m = mag[k] as number;
      const fk = k * freqPerBin;
      const d = fk - cen;
      spread += m * d * d;
      cum += m;
      if (!rolloffSet && cum >= rolloffTarget) {
        rolloff = fk;
        rolloffSet = true;
      }
    }
    bandwidthHz[f] = Math.sqrt(spread / magSum);
    rolloffHz[f] = rolloffSet ? rolloff : cen;

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

  return { hopSec, frameCount: nf, timeSec, energy, f0Hz: pitch.f0Hz, centroidHz, bandwidthHz, rolloffHz, flux, zcr, active };
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

/** Absolute first difference of a series (local perturbation), 0 at the first frame. */
function absDiff(values: readonly number[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) out[i] = Math.abs((values[i] as number) - (values[i - 1] as number));
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

/** Prefix sums of a series so any sub-range sum is O(1): sum(a,b)=P[b]-P[a]. */
function prefixSums(values: readonly number[]): Float64Array {
  const n = values.length;
  const p = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) p[i + 1] = (p[i] as number) + (values[i] as number);
  return p;
}

/**
 * Build the within-hum z-scored, smoothed multivariate channel matrix — the FULL feature
 * set tracked through the hum (energy, pitch, brightness, flux, bandwidth, rolloff, zcr, and
 * the frame-to-frame pitch/amplitude perturbation). Each channel is gap-filled, z-scored
 * within THIS hum (so a husky vs bright voice cannot manufacture separation), and smoothed.
 * Returned in `TEMPORAL_CHANNELS` order. Exported for the chunk-relative read + diagnostics.
 */
export function buildTemporalChannels(track: FrameTrack): { channels: number[][]; names: readonly string[] } {
  const sf = TEMPORAL_PARAMS.smoothFrames;
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
  const bandwidthLog = fillGaps(
    track.bandwidthHz.map((c, i) => (track.active[i] && c > 0 ? Math.log(c) : null)),
    track.active,
  );
  const rolloffLog = fillGaps(
    track.rolloffHz.map((c, i) => (track.active[i] && c > 0 ? Math.log(c) : null)),
    track.active,
  );
  const fluxFilled = fillGaps(track.flux.map((c, i) => (track.active[i] ? c : null)), track.active);
  const zcrFilled = fillGaps(track.zcr.map((c, i) => (track.active[i] ? c : null)), track.active);
  const pitchPerturb = absDiff(f0Semi);
  const ampPerturb = absDiff(energyLog);

  const channels = [
    smooth(zScore(energyLog), sf),
    smooth(zScore(f0Semi), sf),
    smooth(zScore(centroidLog), sf),
    smooth(zScore(fluxFilled), sf),
    smooth(zScore(bandwidthLog), sf),
    smooth(zScore(rolloffLog), sf),
    smooth(zScore(zcrFilled), sf),
    smooth(zScore(pitchPerturb), sf),
    smooth(zScore(ampPerturb), sf),
  ];
  return { channels, names: TEMPORAL_CHANNELS };
}

/** O(1) within-segment SSE of channel `c` over [a,b) from its sum/sumSq prefixes. */
function segSSE(P1: Float64Array, P2: Float64Array, a: number, b: number): number {
  const nseg = b - a;
  if (nseg <= 0) return 0;
  const s = (P1[b] as number) - (P1[a] as number);
  const ss = (P2[b] as number) - (P2[a] as number);
  return Math.max(0, ss - (s * s) / nseg);
}

/** Weighted-average (over channels) within-segment SSE of [a,b). */
function avgSegCost(prefix1: readonly Float64Array[], prefix2: readonly Float64Array[], a: number, b: number): number {
  const d = prefix1.length;
  if (d === 0) return 0;
  let acc = 0;
  for (let c = 0; c < d; c++) acc += (WEIGHTS[c] as number) * segSSE(prefix1[c] as Float64Array, prefix2[c] as Float64Array, a, b);
  return acc / WEIGHT_SUM;
}

/**
 * The UNSUPERVISED segmenter (Stable Build v13). Builds the within-hum z-scored multivariate
 * channels, then finds — for every candidate chunk count K — the GLOBALLY optimal partition
 * minimizing the average within-segment variance (k-segments / PELT-family least-squares
 * objective) by DYNAMIC PROGRAMMING, subject to the minimum chunk length. A complexity
 * PENALTY (`splitGain` per added chunk, per frame) then selects K: an extra chunk is kept only
 * when it reduces the average within-segment variance by more than the penalty. No per-hum
 * threshold tuning, no label — the data's own variability decides the chunk count. Because the
 * cost compares whole segments it detects both abrupt STEPS and gradual TRENDS (a step detector
 * misses the latter). Returns the internal boundary FRAME indices (sorted ascending; empty ⇒ one
 * chunk) plus the per-frame novelty curve for visualization.
 */
export function detectChangePoints(
  track: FrameTrack,
  opts: { minSegmentSec?: number; maxSegments?: number } = {},
): { boundaries: number[]; novelty: number[]; changeMean: number; changePeak: number } {
  const nf = track.frameCount;
  const hopSec = track.hopSec || DSP_PARAMS.rmsHopMs / 1000;
  const minSegFrames = Math.max(2, Math.round((opts.minSegmentSec ?? TEMPORAL_PARAMS.minSegmentSec) / hopSec));
  const maxSegments = Math.max(1, opts.maxSegments ?? TEMPORAL_PARAMS.maxSegments);
  const penaltyPerFrame = TEMPORAL_PARAMS.splitGain;

  const novelty = new Array<number>(nf).fill(0);
  if (nf < 2 * minSegFrames) return { boundaries: [], novelty, changeMean: 0, changePeak: 0 };

  const { channels } = buildTemporalChannels(track);
  const prefix1 = channels.map(prefixSums);
  const prefix2 = channels.map((ch) => prefixSums(ch.map((v) => v * v)));

  // Top-level novelty curve (per-frame, per-channel between-segment gain) for viz + changeMean/Peak.
  const wholeCost = avgSegCost(prefix1, prefix2, 0, nf);
  let peak = 0;
  let novSum = 0;
  let novCount = 0;
  for (let t = minSegFrames; t <= nf - minSegFrames; t++) {
    const split = avgSegCost(prefix1, prefix2, 0, t) + avgSegCost(prefix1, prefix2, t, nf);
    const gainPerFrame = (wholeCost - split) / nf;
    novelty[t] = gainPerFrame;
    novSum += gainPerFrame;
    novCount++;
    if (gainPerFrame > peak) peak = gainPerFrame;
  }
  const changeMean = novCount > 0 ? novSum / novCount : 0;
  const changePeak = peak;

  // Largest feasible K under the min-length + cap constraints.
  const maxK = Math.max(1, Math.min(maxSegments, Math.floor(nf / minSegFrames)));
  if (maxK <= 1) return { boundaries: [], novelty, changeMean, changePeak };

  // DP optimal partition for each K: dp[k][j] = min total avg-SSE over [0,j) in k segments,
  // each ≥ minSegFrames; back[k][j] = the split index achieving it.
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: maxK + 1 }, () => new Array<number>(nf + 1).fill(INF));
  const back: number[][] = Array.from({ length: maxK + 1 }, () => new Array<number>(nf + 1).fill(-1));
  for (let j = minSegFrames; j <= nf; j++) dp[1]![j] = avgSegCost(prefix1, prefix2, 0, j);
  for (let k = 2; k <= maxK; k++) {
    const lo = k * minSegFrames;
    for (let j = lo; j <= nf; j++) {
      let best = INF;
      let bestI = -1;
      const iHi = j - minSegFrames;
      for (let i = (k - 1) * minSegFrames; i <= iHi; i++) {
        const prev = dp[k - 1]![i] as number;
        if (prev === INF) continue;
        const cost = prev + avgSegCost(prefix1, prefix2, i, j);
        if (cost < best) {
          best = cost;
          bestI = i;
        }
      }
      dp[k]![j] = best;
      back[k]![j] = bestI;
    }
  }

  // Penalized model selection: choose K minimizing totalSSE(K) + penalty·(K−1) per frame.
  let bestK = 1;
  let bestScore = (dp[1]![nf] as number) + 0;
  for (let k = 2; k <= maxK; k++) {
    const total = dp[k]![nf] as number;
    if (!Number.isFinite(total)) continue;
    const score = total + penaltyPerFrame * nf * (k - 1);
    if (score < bestScore - 1e-12) {
      bestScore = score;
      bestK = k;
    }
  }

  // Backtrack the boundaries for the selected K.
  const boundaries: number[] = [];
  let j = nf;
  for (let k = bestK; k >= 2; k--) {
    const i = back[k]![j] as number;
    if (i <= 0) break;
    boundaries.push(i);
    j = i;
  }
  boundaries.sort((a, b) => a - b);
  return { boundaries, novelty, changeMean, changePeak };
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
 * FULL within-hum temporal analysis: live-track → unsupervised chunks → per-chunk
 * production features. Each chunk's features come from re-running `computeFeatures`
 * on the chunk's own samples, so a chunk feature means exactly what a whole-hum
 * feature means. A hum that never decisively shifts yields ONE chunk (the whole hum) —
 * a meaningful "steady throughout" outcome, not a forced split. The dense `FrameTrack`
 * stays local: it is consumed here and never attached to the returned analysis.
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
