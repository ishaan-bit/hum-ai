import type { AcousticFeatures } from "@hum-ai/audio-features";
import { clamp01 } from "@hum-ai/shared-types";

/**
 * STAGE ① — Capture acceptance gate (TS-native, STRICT but pause-tolerant).
 *
 * The product captures ~12 s expecting a hum, but the input can be anything: speech,
 * whistle, sigh, breath, throat-clear, background noise, or silence. This gate decides,
 * BEFORE any affect inference, whether the capture is a usable, clear, VOICED hum. If not
 * → the caller asks the user to hum again (with a SPECIFIC reason), and affect is NEVER
 * computed (no over-claiming on noise/sigh/breath in a sensitive product).
 *
 * It scores hum-likeness from the SAME `AcousticFeatures` the runtime already extracts
 * (voicing, harmonicity/clarity, SNR, amplitude stability vs. silence, spectral flatness,
 * ZCR, breathiness, brightness). This is the runtime heuristic; the CV-VALIDATED reference
 * (97.6% balanced accuracy, source/speaker-grouped) is the trained Python gate in
 * `research/training` (`capture_gate.json`) — keep the two aligned, and for an exact
 * decision call that gate or port its 15-feature DSP.
 *
 * ── PAUSE TOLERANCE (Brocal/DALI, `singing_voice_detection_dataset`) ──────────────────
 * A real hum is rarely one unbroken tone — people hum in SHORT BURSTS separated by breath
 * pauses. Meseguer-Brocal et al. (DALI, ISMIR 2018) frame singing detection as a per-frame
 * singing-voice PROBABILITY p(t)∈[0,1] and judge a track on its VOICED content, not on the
 * presence of gaps. We adopt that lens: rather than penalising silence flatly (which
 * rejected legitimate paused hums), we DISCOUNT the silence penalty by how strong the
 * voiced-tone evidence is (voicing coverage + harmonic clarity + a held stable segment).
 * Pauses between clearly-voiced bursts are forgiven; a clip that is mostly silence with no
 * real tone, or that is noise/speech/whistle, still fails (those cues are independent of
 * the gaps: ZCR, spectral flatness, brightness, breathiness).
 */

/**
 * Why a capture was rejected — a SPECIFIC, machine-stable cause so the UI can tell the user
 * exactly what to change (the friendly copy lives in the web layer's `humAgainReasonText`).
 * `""` when accepted.
 */
export type CaptureRejectReason =
  | ""
  | "too_short"
  | "too_quiet"
  | "too_noisy"
  | "sounded_like_speech"
  | "not_voiced"
  | "too_choppy"
  | "unclear";

export interface CaptureGateDecision {
  /** True only for a clear, sustained or burst-voiced hum. */
  readonly accepted: boolean;
  /** Hum-likeness in [0,1]. */
  readonly humLikeness: number;
  readonly threshold: number;
  /** Technical one-liner for logs/eval (never shown verbatim to the user). */
  readonly reason: string;
  /** Specific, user-mappable rejection cause (`""` when accepted). */
  readonly reasonCode: CaptureRejectReason;
  /** "" when accepted; "ask_user_to_hum_again" when rejected. */
  readonly action: "" | "ask_user_to_hum_again";
}

export interface CaptureGateOptions {
  /** STRICT accept threshold on hum-likeness (default 0.5). Raise to reject more. */
  readonly threshold?: number;
}

/** Shortest capture we will even score (s). Below this we reject as `too_short`. */
const MIN_DURATION_SEC = 8;

/**
 * Choose the single most informative rejection cause from the sub-cues, so the user gets a
 * concrete "do this instead" rather than a generic "hum again".
 */
function pickRejectReason(f: AcousticFeatures, c: {
  readonly voiced: number;
  readonly clarity: number;
  readonly silence: number;
  readonly zcr: number;
  readonly flat: number;
  readonly bright: number;
  readonly snr: number;
  readonly voicedEvidence: number;
  readonly melodicRange: number;
}): CaptureRejectReason {
  // Almost nothing came through.
  if (f.isSilent || f.peakAmplitude < 0.02 || f.meanRms < 0.006) return "too_quiet";
  // Melodic pitch movement OR a bright/edgy timbre → speech or a tune, not a held hum.
  if (c.melodicRange > 0.4 || c.bright > 0.45 || c.zcr > 0.5) return "sounded_like_speech";
  // Buried in noise / very flat spectrum with poor SNR.
  if (c.flat > 0.5 || c.snr < 0.1) return "too_noisy";
  // There IS some voiced tone, but it's broken into too little across the clip.
  if (c.voicedEvidence >= 0.2 && c.silence > 0.7) return "too_choppy";
  // Audible, but no steady pitched tone was found (sigh/breath/mumble).
  if (c.voiced < 0.3 && c.clarity < 0.4) return "not_voiced";
  return "unclear";
}

/** Assess whether a capture is a usable hum (STRICT, pause-tolerant). */
export function assessCapture(f: AcousticFeatures, opts: CaptureGateOptions = {}): CaptureGateDecision {
  const threshold = opts.threshold ?? 0.5;

  // A capture that is simply too short to read — give that exact reason up front.
  if (f.durationSec < MIN_DURATION_SEC) {
    return {
      accepted: false,
      humLikeness: 0,
      threshold,
      reason: `too short (${f.durationSec.toFixed(1)}s < ${MIN_DURATION_SEC}s) — not enough to read`,
      reasonCode: "too_short",
      action: "ask_user_to_hum_again",
    };
  }

  // Pro-hum cues: a hum is voiced, harmonic, audible, and holds a steady pitch within its
  // bursts. (Weights calibrated so a sustained OR burst-voiced hum scores high while
  // articulated speech — higher ZCR/brightness/flux — falls below threshold.)
  const voiced = clamp01(f.voicingContinuityCoverage);
  const clarity = clamp01(f.clarityScore);
  const snr = clamp01(f.signalToNoiseProxy / 50); // proxy is an unbounded ratio, not [0,1]
  const steady = clamp01(f.amplitudeStability);
  // Sustained-tone evidence: a hum holds one pitch, so even a PAUSED hum shows a stable
  // pitch and a long held segment within its voiced bursts (Brocal/DALI voiced-content lens).
  const pitchSteady = clamp01(f.pitchStability ?? 0);
  const stableSeg = clamp01((f.longestStableSegmentSec ?? 0) / 2.0); // ≥2 s held tone ⇒ full credit

  // Anti-hum cues: silence, noise (flat spectrum / high ZCR), breath, or a bright whistle.
  const silence = clamp01(f.silenceRatio);
  const flat = clamp01(f.spectralFlatness);
  const zcr = clamp01(f.zeroCrossingRate);
  const breath = clamp01(f.breathinessProxy);
  const bright = clamp01(f.spectralCentroidHz / 4000); // whistle/noise/consonants sit high
  // A hum holds ~one pitch; melodic MOVEMENT across a wide pitch range is speech or a tune,
  // not a hum. Natural hum wobble (≤2 semitones) is free; range beyond that is penalised.
  // This is what separates a PAUSED hum (narrow range) from speech (wide range), so pause
  // tolerance never opens the door to accepting speech. Spectral flux is a softer second cue.
  const melodicRange = clamp01(((f.pitchRangeSemitones ?? 0) - 2) / 5);
  const flux = clamp01((f.spectralFlux - 0.04) / 0.12);

  // Voiced-tone evidence in [0,1]: how confidently this clip contains a real sung tone.
  const voicedEvidence = clamp01(0.5 * voiced + 0.3 * clarity + 0.2 * stableSeg);
  // PAUSE TOLERANCE: forgive the gaps in proportion to the voiced evidence. A clearly-voiced
  // burst hum keeps almost none of its silence penalty; an unvoiced/noisy clip keeps all of it.
  const effectiveSilence = silence * (1 - 0.78 * voicedEvidence);

  const score =
    1.5 * voiced + 1.5 * clarity + 1.0 * snr + 0.55 * steady + 0.6 * pitchSteady + 0.6 * stableSeg -
    1.3 * effectiveSilence - 2.5 * zcr - 1.6 * flat - 1.5 * bright - 0.8 * breath - 2.2 * melodicRange -
    0.6 * flux - 1.0;
  const humLikeness = 1 / (1 + Math.exp(-score));

  if (humLikeness >= threshold) {
    return {
      accepted: true,
      humLikeness,
      threshold,
      reason: `clear voiced hum (hum-likeness ${humLikeness.toFixed(2)} ≥ ${threshold})`,
      reasonCode: "",
      action: "",
    };
  }
  const reasonCode = pickRejectReason(f, { voiced, clarity, silence, zcr, flat, bright, snr, voicedEvidence, melodicRange });
  return {
    accepted: false,
    humLikeness,
    threshold,
    reason: `not a clear hum (hum-likeness ${humLikeness.toFixed(2)} < ${threshold}; cause: ${reasonCode})`,
    reasonCode,
    action: "ask_user_to_hum_again",
  };
}

/** Convenience: the user-facing message for a rejected capture. */
export const HUM_AGAIN_MESSAGE = "Didn't catch a clear hum — please hum again.";
