import { clamp01, normalize, inverseNormalize, mean, type UnitInterval } from "@hum-ai/shared-types";
import type { CaptureMetrics } from "@hum-ai/audio-features";
import { HUM_THRESHOLDS as T, CAPTURE_QUALITY_CONFIDENCE_CAP } from "./thresholds";

/** Gate verdict (`hum_spec` §8). */
export type QualityDecision = "clean" | "borderline" | "rejected";
export type CaptureQuality = "good" | "usable" | "soft_usable" | "poor" | "rejected";

export interface QualityResult {
  readonly decision: QualityDecision;
  readonly captureQuality: CaptureQuality;
  /** Continuous capture-quality score [0,1] for the confidence model. */
  readonly captureQualityScore: UnitInterval;
  /** Suggested confidence cap from capture quality alone [0,1]. */
  readonly confidenceCap: UnitInterval;
  /** Whether this capture is eligible to contribute to the rolling baseline. */
  readonly baselineEligible: boolean;
  readonly reasons: readonly string[];
}

const decisionFor = (q: CaptureQuality): QualityDecision => {
  if (q === "rejected" || q === "poor") return "rejected";
  if (q === "soft_usable") return "borderline";
  return "clean";
};

/**
 * Continuous capture-quality score, blending the spec's "Capture quality"
 * dimension ingredients (§9): duration adequacy, SNR, pitch coverage, active
 * ratio, low silence/quiet, low clipping, peak.
 */
function captureQualityScore(m: CaptureMetrics): UnitInterval {
  const parts = [
    normalize(m.durationSec, T.minDurationSec, T.targetDurationSec),
    normalize(m.signalToNoiseProxy, T.minSnrProxy, T.goodSnrProxy),
    m.pitchCoverage === null ? 0.5 : normalize(m.pitchCoverage, T.minPitchCoverage, T.goodPitchCoverage),
    normalize(m.activeFrameRatio, T.minActiveFrameRatio, 0.7),
    inverseNormalize(m.silenceRatio, 0.2, T.maxSilenceRatio),
    inverseNormalize(m.quietFrameRatio, 0.3, T.maxQuietFrameRatio),
    inverseNormalize(m.clippedFrameRatio, 0, T.maxClippedFrameRatio),
    normalize(m.peakAmplitude, T.basicallySilentPeak, 0.82),
  ];
  return clamp01(mean(parts));
}

/**
 * Evaluate the quality gate. Hard rejections short-circuit; otherwise the
 * capture is graded good / usable / soft_usable. Mirrors `hum_spec` §8.
 */
export function evaluateQuality(m: CaptureMetrics): QualityResult {
  const reasons: string[] = [];
  const score = captureQualityScore(m);

  // --- hard rejections ---
  const rejectIf = (cond: boolean, reason: string): boolean => {
    if (cond) reasons.push(reason);
    return cond;
  };

  const softBaselineRelief =
    m.baselineRmsRatio !== null && m.baselineRmsRatio >= T.softBaselineRatio && m.meanRms > T.nearSilenceMeanRms;

  const rejected =
    rejectIf(m.durationSec < T.minDurationSec, `too_short (<${T.minDurationSec}s)`) ||
    rejectIf(m.isSilent || m.meanRms <= T.nearSilenceMeanRms, "near_silent") ||
    rejectIf(m.clippedFrameRatio > T.maxClippedFrameRatio, "clipped") ||
    rejectIf(m.silenceRatio > T.maxSilenceRatio, "too_interrupted") ||
    rejectIf(m.quietFrameRatio > T.maxQuietFrameRatio && !softBaselineRelief, "mostly_quiet") ||
    rejectIf(m.activeFrameRatio < T.minActiveFrameRatio, "too_little_active_audio") ||
    rejectIf(m.pitchCoverage !== null && m.pitchCoverage < T.minPitchCoverage, "poor_voicing") ||
    rejectIf(m.signalToNoiseProxy < T.minSnrProxy && m.peakAmplitude < 0.05, "poor_snr");

  if (rejected) {
    return {
      decision: "rejected",
      captureQuality: "rejected",
      captureQualityScore: Math.min(score, 0.3),
      confidenceCap: CAPTURE_QUALITY_CONFIDENCE_CAP.rejected,
      baselineEligible: false,
      reasons,
    };
  }

  // --- soft but usable ---
  const faint = m.decisionRms < T.softRms;
  const belowBaseline = m.baselineRmsRatio !== null && m.baselineRmsRatio < T.softBaselineRatio;
  if (faint || belowBaseline) {
    if (faint) reasons.push("faint_soft_usable");
    if (belowBaseline) reasons.push("below_70pct_baseline_rms");
    return {
      decision: "borderline",
      captureQuality: "soft_usable",
      captureQualityScore: clamp01(Math.min(score, 0.7)),
      confidenceCap: CAPTURE_QUALITY_CONFIDENCE_CAP.soft_usable,
      baselineEligible: false,
      reasons,
    };
  }

  // --- good vs usable ---
  const isGood =
    m.decisionRms >= T.strongRms &&
    m.activeFrameRatio >= T.borderlineActiveFrameRatio &&
    (m.pitchCoverage === null || m.pitchCoverage >= T.goodPitchCoverage) &&
    m.silenceRatio <= 0.4 &&
    m.clippedFrameRatio <= 0.02 &&
    m.signalToNoiseProxy >= T.goodSnrProxy;

  const captureQuality: CaptureQuality = isGood ? "good" : "usable";
  if (!isGood) reasons.push("usable_not_good");
  return {
    decision: "clean",
    captureQuality,
    captureQualityScore: score,
    confidenceCap: CAPTURE_QUALITY_CONFIDENCE_CAP[captureQuality],
    baselineEligible: true,
    reasons,
  };
}
