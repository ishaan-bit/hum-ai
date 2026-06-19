/**
 * Real, deterministic, pure-TypeScript DSP feature extractor for the 12-second
 * hum. Produces the full `AcousticFeatures` object from raw PCM `AudioInput`,
 * replacing the `NotImplementedExtractor` stub for actual local use.
 *
 * Honesty contract:
 *  - This is deterministic signal processing, NOT a trained or clinically
 *    validated model. Every value is a transparent function of the samples.
 *  - Jitter / shimmer / breathiness / clarity / musicality are PROXIES derived
 *    from time- and frequency-domain measurements; they are named `*Proxy` /
 *    `*Score` to signal that. They are not clinical perturbation measures.
 *  - No heavy DSP/ML dependency is used (DEPENDENCY_POLICY): the only frequency-
 *    domain step uses the small local radix-2 FFT in `dsp/fft.ts`.
 *
 * Pipeline: normalize → 80 ms RMS frames → energy/noise-floor/SNR → autocorrelation
 * pitch → voicing continuity → spectral (local FFT) → expression proxies → flags.
 */
import { clamp01, mean, median, percentile, type UnitInterval } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "./features";
import type { AudioInput, FeatureExtractor } from "./extract";
import { DSP_PARAMS, EPS } from "./dsp/params";
import {
  coefficientOfVariation,
  frameRmsSeries,
  linregSlope,
  longestRun,
  meanRelativeStep,
  overallRms,
  peakAbs,
  removeDcOffset,
  runs,
  silentSampleRatio,
  toFloat64,
  variance,
  zeroCrossingRate,
} from "./dsp/signal";
import { trackPitch } from "./dsp/pitch";
import { spectralFeatures } from "./dsp/spectral";

/** Keep a numeric finite or fall back. */
const finite = (x: number, fallback = 0): number => (Number.isFinite(x) ? x : fallback);
/** Keep a nullable numeric finite, or null. */
const finiteOrNull = (x: number | null): number | null =>
  x !== null && Number.isFinite(x) ? x : null;

/** Normalized autocorrelation peak of a contour in lag band [minLag,maxLag], in [0,1]. */
function autocorrPeak(values: readonly number[], minLag: number, maxLag: number): number {
  const n = values.length;
  if (n < minLag + 2) return 0;
  let m = 0;
  for (const v of values) m += v;
  m /= n;
  let r0 = 0;
  for (const v of values) r0 += (v - m) * (v - m);
  if (r0 < EPS) return 0;
  let best = 0;
  const hi = Math.min(maxLag, n - 1);
  for (let lag = minLag; lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i < n - lag; i++) {
      acc += ((values[i] as number) - m) * ((values[i + lag] as number) - m);
    }
    const r = acc / r0;
    if (r > best) best = r;
  }
  return clamp01(best);
}

/** All-quiet feature object for empty/degenerate input. */
function silentResult(sampleRate: number, durationSec: number): AcousticFeatures {
  return {
    featureMode: DSP_PARAMS.featureMode,
    sampleRate,
    durationSec,
    inputRms: 0,
    meanRms: 0,
    medianRms: 0,
    rmsEnergy: 0,
    peakAmplitude: 0,
    activeFrameRatio: 0,
    quietFrameRatio: 1,
    clippedFrameRatio: 0,
    silenceRatio: 1,
    noiseFloorRms: 0,
    signalToNoiseProxy: 0,
    zeroCrossingRate: 0,
    pitchMeanHz: null,
    pitchVariance: null,
    pitchRangeSemitones: null,
    pitchStability: null,
    jitter: null,
    pitchDrift: null,
    pitchCoverage: 0,
    longestStableSegmentSec: null,
    spectralCentroidHz: 0,
    spectralBandwidthHz: 0,
    spectralRolloffHz: 0,
    spectralFlatness: 0,
    spectralFlux: 0,
    breakCount: 0,
    pauseCount: 0,
    avgPauseLengthSec: 0,
    microBreakRatio: 0,
    onsetDelaySec: null,
    voicingContinuityCoverage: 0,
    clarityScore: 0,
    breathinessProxy: 0,
    shimmerProxy: 0,
    amplitudeStability: 0,
    smoothnessScore: null,
    musicalityScore: 0,
    controlledExpressionScore: 0,
    residualInstabilityScore: 0,
    residualPitchInstability: 0,
    residualAmplitudeInstability: 0,
    vibratoRegularity: null,
    attackConsistency: null,
    isSilent: true,
    isTooFaint: true,
  };
}

/**
 * Compute the derived acoustic features for one capture. Synchronous and pure —
 * the async `HumDspExtractor.extract` simply wraps this.
 */
export function computeFeatures(input: AudioInput): AcousticFeatures {
  const sampleRate = input.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`computeFeatures: invalid sampleRate ${sampleRate}`);
  }

  const x0 = toFloat64(input.samples);
  const n = x0.length;
  const durationSec = n / sampleRate;
  if (n === 0) return silentResult(sampleRate, 0);

  const x = removeDcOffset(x0);

  // --- framing (80 ms windows; clamp to signal length for very short input) ---
  let frameLen = Math.max(1, Math.round((DSP_PARAMS.rmsWindowMs / 1000) * sampleRate));
  let hop = Math.max(1, Math.round((DSP_PARAMS.rmsHopMs / 1000) * sampleRate));
  frameLen = Math.min(frameLen, n);
  hop = Math.min(hop, frameLen);
  const hopSec = hop / sampleRate;
  const framesPerSec = sampleRate / hop;

  const frameRms = frameRmsSeries(x, frameLen, hop);
  const nf = frameRms.length;
  if (nf === 0) return silentResult(sampleRate, durationSec);
  const frameRmsArr = Array.from(frameRms);

  // --- per-frame energy classification ---
  const quietFlag: boolean[] = new Array(nf);
  const activeFlag: boolean[] = new Array(nf);
  const loudEnough: boolean[] = new Array(nf);
  let quietCount = 0;
  let activeCount = 0;
  for (let f = 0; f < nf; f++) {
    const r = frameRmsArr[f] as number;
    const isQuiet = r < DSP_PARAMS.quietFrameRms;
    const isActive = r >= DSP_PARAMS.activeFrameRms;
    quietFlag[f] = isQuiet;
    activeFlag[f] = isActive;
    loudEnough[f] = r >= DSP_PARAMS.quietFrameRms;
    if (isQuiet) quietCount++;
    if (isActive) activeCount++;
  }

  // --- energy scalars ---
  const inputRms = overallRms(x);
  const meanRms = mean(frameRmsArr);
  const medianRms = median(frameRmsArr);
  const rmsEnergy = inputRms;
  const peakAmplitude = peakAbs(x);
  const silenceRatio = silentSampleRatio(x, DSP_PARAMS.silenceThreshold);
  const zcr = zeroCrossingRate(x);
  const activeFrameRatio = activeCount / nf;
  const quietFrameRatio = quietCount / nf;

  // --- clipping ---
  const clipMinSamples = Math.max(
    DSP_PARAMS.clipFrameMinSamples,
    Math.ceil(DSP_PARAMS.clipFrameSampleFraction * frameLen),
  );
  let clippedFrames = 0;
  for (let f = 0; f < nf; f++) {
    const start = f * hop;
    const end = Math.min(start + frameLen, n);
    let clipped = 0;
    for (let i = start; i < end; i++) {
      // Clipping is a property of the RAW rail-pinned samples (x0), NOT the
      // DC-removed signal (x): removing a DC bias shifts rail-pinned samples
      // below clipSampleLevel and would hide an asymmetrically-clipped capture.
      if (Math.abs(x0[i] as number) >= DSP_PARAMS.clipSampleLevel) clipped++;
    }
    if (clipped >= clipMinSamples) clippedFrames++;
  }
  const clippedFrameRatio = clippedFrames / nf;

  // --- noise floor + SNR proxy ---
  const sortedRms = [...frameRmsArr].sort((a, b) => a - b);
  const kFloor = Math.min(
    nf,
    Math.max(1, Math.round(DSP_PARAMS.noiseFloorWindowMs / DSP_PARAMS.rmsHopMs)),
  );
  let floorSum = 0;
  for (let i = 0; i < kFloor; i++) floorSum += sortedRms[i] as number;
  const noiseFloorRms = floorSum / kFloor;
  const signalLevel = medianRms;
  const signalToNoiseProxy = Math.min(
    DSP_PARAMS.maxSnrProxy,
    signalLevel / Math.max(noiseFloorRms, EPS),
  );

  // --- pitch (autocorrelation) ---
  const pitch = trackPitch(x, sampleRate, frameLen, hop, nf, loudEnough);
  const voiced = pitch.voiced;
  const f0Seq: number[] = [];
  let firstVoicedFrame = -1;
  for (let f = 0; f < nf; f++) {
    const hz = pitch.f0Hz[f];
    if (voiced[f] && hz !== null && hz !== undefined) {
      f0Seq.push(hz);
      if (firstVoicedFrame < 0) firstVoicedFrame = f;
    }
  }
  const voicedCount = f0Seq.length;
  const pitchCoverage: UnitInterval = clamp01(voicedCount / nf);

  let pitchMeanHz: number | null = null;
  let pitchVariance: number | null = null;
  let pitchRangeSemitones: number | null = null;
  let pitchStability: number | null = null;
  let jitter: number | null = null;
  let pitchDrift: number | null = null;
  let longestStableSegmentSec: number | null = null;
  let vibratoRegularity: number | null = null;

  if (voicedCount >= 2) {
    pitchMeanHz = mean(f0Seq);
    pitchVariance = variance(f0Seq);
    const p5 = percentile(f0Seq, 0.05);
    const p95 = percentile(f0Seq, 0.95);
    pitchRangeSemitones = p5 > EPS && p95 > EPS ? Math.abs(12 * Math.log2(p95 / p5)) : null;
    pitchStability = clamp01(1 - coefficientOfVariation(f0Seq));
    jitter = clamp01(meanRelativeStep(f0Seq));
    // Net pitch glide across the voiced span, in semitones.
    const slope = linregSlope(f0Seq);
    const half = (slope * (voicedCount - 1)) / 2;
    const startVal = (pitchMeanHz as number) - half;
    const endVal = (pitchMeanHz as number) + half;
    pitchDrift =
      startVal > EPS && endVal > EPS ? Math.abs(12 * Math.log2(endVal / startVal)) : 0;

    // Longest stable voiced stretch within contiguous voiced runs.
    let bestStableFrames = 0;
    for (const r of runs(voiced)) {
      if (!r.value || r.length < 1) continue;
      let curr = 1;
      let runBest = 1;
      for (let i = r.start + 1; i < r.start + r.length; i++) {
        const a = pitch.f0Hz[i - 1];
        const b = pitch.f0Hz[i];
        const stable =
          a !== null && a !== undefined && b !== null && b !== undefined &&
          Math.abs(b - a) / Math.max(Math.abs(b), EPS) < DSP_PARAMS.stableF0RelStep;
        curr = stable ? curr + 1 : 1;
        if (curr > runBest) runBest = curr;
      }
      if (runBest > bestStableFrames) bestStableFrames = runBest;
    }
    longestStableSegmentSec = bestStableFrames * hopSec;

    if (voicedCount >= 6) {
      // Detrend, then look for a regular oscillation (vibrato) in the contour.
      const slope2 = linregSlope(f0Seq);
      const mu = pitchMeanHz as number;
      const detr = f0Seq.map((v, i) => v - (mu + slope2 * (i - (voicedCount - 1) / 2)));
      vibratoRegularity = autocorrPeak(detr, 2, Math.floor(voicedCount / 2));
    }
  }

  // --- voicing continuity + breaks/pauses ---
  const voicedRuns = runs(voiced);
  let continuityFrames = 0;
  for (const r of voicedRuns) {
    if (r.value && r.length >= DSP_PARAMS.minVoicedRunFrames) continuityFrames += r.length;
  }
  const voicingContinuityCoverage = clamp01(continuityFrames / nf);

  // Internal unvoiced runs = unvoiced runs flanked by voiced runs.
  const firstVoiced = voicedRuns.findIndex((r) => r.value);
  const lastVoiced = (() => {
    for (let i = voicedRuns.length - 1; i >= 0; i--) if (voicedRuns[i]?.value) return i;
    return -1;
  })();
  let breakCount = 0;
  let pauseCount = 0;
  let pauseDurSum = 0;
  let microBreakFrames = 0;
  for (let i = 0; i < voicedRuns.length; i++) {
    const r = voicedRuns[i] as { value: boolean; start: number; length: number };
    if (r.value) continue;
    const internal = firstVoiced >= 0 && i > firstVoiced && i < lastVoiced;
    if (!internal) continue;
    breakCount++;
    const durSec = r.length * hopSec;
    if (durSec >= DSP_PARAMS.pauseMinSec) {
      pauseCount++;
      pauseDurSum += durSec;
    } else {
      microBreakFrames += r.length;
    }
  }
  const avgPauseLengthSec = pauseCount > 0 ? pauseDurSum / pauseCount : 0;
  const microBreakRatio = clamp01(microBreakFrames / nf);
  const onsetDelaySec = firstVoicedFrame >= 0 ? firstVoicedFrame * hopSec : null;

  // --- spectral (local FFT) ---
  const spec = spectralFeatures(x, sampleRate);

  // --- expression proxies ---
  const activeRmsList = frameRmsArr.filter((_, f) => activeFlag[f]);
  const ampList = activeRmsList.length >= 2 ? activeRmsList : frameRmsArr;
  const amplitudeStability = clamp01(1 - coefficientOfVariation(ampList));
  const shimmerProxy = clamp01(meanRelativeStep(ampList));
  const breathinessProxy = clamp01(spec.flatness);

  const snrFactor = clamp01((signalToNoiseProxy - 2.5) / (5 - 2.5));
  const clarityScore = clamp01((1 - spec.flatness) * pitchCoverage * (0.4 + 0.6 * snrFactor));

  const jitterN = jitter === null ? 0 : clamp01(jitter * 20);
  const shimmerN = clamp01(shimmerProxy * 10);
  const fluxN = clamp01(spec.flux * 2);
  const smoothnessScore: number | null =
    voicedCount >= 2 ? clamp01(1 - (jitterN + shimmerN + fluxN) / 3) : null;

  const rangeN = pitchRangeSemitones === null ? 0 : clamp01((pitchRangeSemitones - 2) / (14 - 2));
  const driftN = pitchDrift === null ? 0 : clamp01(pitchDrift / 4);
  // Melodic musicality only means something when the signal is actually voiced:
  // a polyphonic music chord has wide *apparent* pitch range but low voicing, and
  // must not read as melodic singing. Weight by pitch coverage.
  const musicalityScore = clamp01((rangeN * 0.8 + driftN * 0.2) * pitchCoverage);

  const controlledExpressionScore = clamp01(0.5 * (pitchStability ?? 0.5) + 0.5 * amplitudeStability);
  const residualPitchInstability = jitterN;
  const residualAmplitudeInstability = shimmerN;
  const residualInstabilityScore = clamp01(
    0.4 * residualPitchInstability + 0.4 * residualAmplitudeInstability + 0.2 * fluxN,
  );

  // Attack consistency across voiced-run onsets (needs >=2 voiced runs).
  const onsetSlopes: number[] = [];
  for (const r of voicedRuns) {
    if (!r.value || r.length < 2) continue;
    const a = frameRmsArr[r.start] as number;
    const b = frameRmsArr[r.start + 1] as number;
    onsetSlopes.push((b - a) / hopSec);
  }
  const attackConsistency: number | null =
    onsetSlopes.length >= 2 ? clamp01(1 - coefficientOfVariation(onsetSlopes)) : null;

  // --- flags ---
  // Derive from finite-guarded values so the flags can NEVER disagree with the
  // (finite) numeric fields actually returned (defense in depth alongside the
  // non-finite input sanitization in toFloat64).
  const safeInputRms = finite(inputRms);
  const safePeak = finite(peakAmplitude);
  const safeDecisionRms = finite(rmsEnergy);
  const isSilent =
    safeInputRms < DSP_PARAMS.basicallySilentRms || safePeak < DSP_PARAMS.basicallySilentPeak;
  const isTooFaint = !isSilent && safeDecisionRms < DSP_PARAMS.softRms;

  return {
    featureMode: DSP_PARAMS.featureMode,
    sampleRate,

    durationSec: finite(durationSec),
    inputRms: finite(inputRms),
    meanRms: finite(meanRms),
    medianRms: finite(medianRms),
    rmsEnergy: finite(rmsEnergy),
    peakAmplitude: finite(peakAmplitude),
    activeFrameRatio: clamp01(activeFrameRatio),
    quietFrameRatio: clamp01(quietFrameRatio),
    clippedFrameRatio: clamp01(clippedFrameRatio),
    silenceRatio: clamp01(silenceRatio),
    noiseFloorRms: finite(noiseFloorRms),
    signalToNoiseProxy: finite(signalToNoiseProxy),
    zeroCrossingRate: finite(zcr),

    pitchMeanHz: finiteOrNull(pitchMeanHz),
    pitchVariance: finiteOrNull(pitchVariance),
    pitchRangeSemitones: finiteOrNull(pitchRangeSemitones),
    pitchStability: finiteOrNull(pitchStability),
    jitter: finiteOrNull(jitter),
    pitchDrift: finiteOrNull(pitchDrift),
    pitchCoverage,
    longestStableSegmentSec: finiteOrNull(longestStableSegmentSec),

    spectralCentroidHz: finite(spec.centroidHz),
    spectralBandwidthHz: finite(spec.bandwidthHz),
    spectralRolloffHz: finite(spec.rolloffHz),
    spectralFlatness: clamp01(spec.flatness),
    spectralFlux: finite(spec.flux),

    breakCount,
    pauseCount,
    avgPauseLengthSec: finite(avgPauseLengthSec),
    microBreakRatio: clamp01(microBreakRatio),
    onsetDelaySec: finiteOrNull(onsetDelaySec),
    voicingContinuityCoverage: clamp01(voicingContinuityCoverage),

    clarityScore: clamp01(clarityScore),
    breathinessProxy: clamp01(breathinessProxy),
    shimmerProxy: clamp01(shimmerProxy),
    amplitudeStability: clamp01(amplitudeStability),
    smoothnessScore,
    musicalityScore: clamp01(musicalityScore),
    controlledExpressionScore: clamp01(controlledExpressionScore),
    residualInstabilityScore: clamp01(residualInstabilityScore),
    residualPitchInstability: clamp01(residualPitchInstability),
    residualAmplitudeInstability: clamp01(residualAmplitudeInstability),
    vibratoRegularity: finiteOrNull(vibratoRegularity),
    attackConsistency: finiteOrNull(attackConsistency),

    isSilent,
    isTooFaint,
  };
}

/**
 * The real feature extractor. Implements the same `FeatureExtractor` contract as
 * the (retained) `NotImplementedExtractor`, so it slots in wherever a
 * `FeatureExtractor` is expected. Async to match the interface; the work is
 * synchronous and CPU-bound.
 */
export class HumDspExtractor implements FeatureExtractor {
  extract(input: AudioInput): Promise<AcousticFeatures> {
    return Promise.resolve(computeFeatures(input));
  }
}

/** Convenience singleton. */
export const humDspExtractor = new HumDspExtractor();
