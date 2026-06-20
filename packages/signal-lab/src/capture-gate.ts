import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * STAGE ① — Capture acceptance gate (TS-native, STRICT).
 *
 * The product captures ~12 s expecting a hum, but the input can be anything: speech,
 * whistle, sigh, breath, throat-clear, background noise, or silence. This gate decides,
 * BEFORE any affect inference, whether the capture is a usable, clear, sustained voiced
 * HUM. If not → the caller asks the user to hum again, and affect is NEVER computed
 * (no over-claiming on noise/sigh/breath in a sensitive product).
 *
 * It scores hum-likeness from the SAME `AcousticFeatures` the runtime already extracts
 * (voicing, harmonicity/clarity, SNR, amplitude stability vs. silence, spectral flatness,
 * ZCR, breathiness, brightness). This is the runtime heuristic; the CV-VALIDATED reference
 * (97.6% balanced accuracy, source/speaker-grouped) is the trained Python gate in
 * `research/training` (`capture_gate.json`) — keep the two aligned, and for an exact
 * decision call that gate or port its 15-feature DSP.
 */
export interface CaptureGateDecision {
  /** True only for a clear, sustained, voiced hum. */
  readonly accepted: boolean;
  /** Hum-likeness in [0,1]. */
  readonly humLikeness: number;
  readonly threshold: number;
  readonly reason: string;
  /** "" when accepted; "ask_user_to_hum_again" when rejected. */
  readonly action: "" | "ask_user_to_hum_again";
}

export interface CaptureGateOptions {
  /** STRICT accept threshold on hum-likeness (default 0.5). Raise to reject more. */
  readonly threshold?: number;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Assess whether a capture is a usable hum (STRICT). */
export function assessCapture(f: AcousticFeatures, opts: CaptureGateOptions = {}): CaptureGateDecision {
  const threshold = opts.threshold ?? 0.5;

  // Pro-hum cues: a hum is voiced, harmonic, audible, and steady. (Weights calibrated so a
  // sustained voiced hum scores high while articulated speech — higher ZCR/silence/brightness
  // — falls below threshold; the CV-validated reference is the Python gate.)
  const voiced = clamp01(f.voicingContinuityCoverage);
  const clarity = clamp01(f.clarityScore);
  const snr = clamp01(f.signalToNoiseProxy / 50); // proxy is an unbounded ratio, not [0,1]
  const steady = clamp01(f.amplitudeStability);
  // Anti-hum cues: silence, noise (flat spectrum / high ZCR), breath, or a bright whistle.
  const silence = clamp01(f.silenceRatio);
  const flat = clamp01(f.spectralFlatness);
  const zcr = clamp01(f.zeroCrossingRate);
  const breath = clamp01(f.breathinessProxy);
  const bright = clamp01(f.spectralCentroidHz / 4000); // whistle/noise/consonants sit high

  const score =
    1.5 * voiced + 1.5 * clarity + 1.0 * snr + 0.8 * steady -
    2.5 * silence - 2.5 * zcr - 1.6 * flat - 1.5 * bright - 0.8 * breath - 1.0;
  const humLikeness = 1 / (1 + Math.exp(-score));

  if (humLikeness >= threshold) {
    return {
      accepted: true,
      humLikeness,
      threshold,
      reason: `clear sustained hum (hum-likeness ${humLikeness.toFixed(2)} ≥ ${threshold})`,
      action: "",
    };
  }
  return {
    accepted: false,
    humLikeness,
    threshold,
    reason: `not a clear hum (hum-likeness ${humLikeness.toFixed(2)} < ${threshold}) — likely noise/silence/speech/sigh/whistle`,
    action: "ask_user_to_hum_again",
  };
}

/** Convenience: the user-facing message for a rejected capture. */
export const HUM_AGAIN_MESSAGE = "Didn't catch a clear hum — please hum again.";
