import { clamp, clamp01, mean, normalize, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * THE DIMENSIONAL AXIS READ — valence + arousal, from the FIRST hum.
 *
 * Direction (ADR-0003/0005, redo): the read LEADS with two coarse affect axes —
 * valence (subdued ↔ pleasant) and arousal (settled ↔ activated) — and they are
 * available immediately, not gated behind a multi-hum calibration. There is no
 * hum-validated affect model in existence, so the axes are produced two ways and
 * combined honestly:
 *
 *  1. A TRANSPARENT, on-domain ACOUSTIC mapping (`acousticAffectAxes`). Every value
 *     is a deterministic function of the hum's own DSP features (energy, brightness,
 *     pitch, clarity, stability). It is always meaningful on real audio and is the
 *     same honesty class as the existing `HumAcousticExpert` — a reflection of the
 *     hum's acoustic qualities, NOT a clinical or ground-truth affect label.
 *
 *  2. An optional TRAINED axis PRIOR per axis (`AffectAxisPrior`, e.g. signal-lab's
 *     gate-relevant valence/arousal LogRegs). These are far-domain (acted speech)
 *     and SATURATE on out-of-domain input, so each prior carries an OOD distance and
 *     ABSTAINS when the hum is outside its training domain (the common case). When it
 *     IS in-domain it nudges the acoustic axis toward its lean, weighted by its honest
 *     balanced accuracy. It never overrides the on-domain read — it refines it.
 *
 * The personal baseline later re-references this axis read toward the user's own
 * usual (silent progressive refinement) — see `applyPersonalization`.
 */

/** A trained axis prior's prediction for one hum (already OOD-aware). */
export interface AxisPrediction {
  /** Signed axis value in [-1,1] (negative = low/subdued pole, positive = high pole). */
  readonly value: number;
  /** OOD distance [0,1]: 0 = squarely in the training domain, 1 = far outside it. */
  readonly ood: UnitInterval;
  /** Whether the input is close enough to the training domain to be trusted at all. */
  readonly inDomain: boolean;
  /** Honest model self-confidence for THIS hum (margin × in-domain), [0,1]. */
  readonly confidence: UnitInterval;
}

/**
 * A trained coarse-axis PRIOR, injected through this contract so the orchestrator
 * never depends on signal-lab. The implementation (signal-lab `buildAffectAxisPrior`)
 * owns the model + standardizer and computes the OOD distance internally.
 */
export interface AffectAxisPrior {
  readonly axis: "valence" | "arousal";
  /** Honest balanced accuracy on the validation set — provenance only. */
  readonly balancedAccuracy: number;
  /** Whether this axis cleared its promotion gate (ADR-0005 far-domain, or ADR-0011 native). */
  readonly passedGate: boolean;
  /**
   * Whether this prior was trained on NATIVE hums (ADR-0011) rather than far-domain acted
   * speech. A native, in-domain prior is allowed a LARGER (but still bounded) nudge on the
   * read than a far-domain one — it is on-domain hum truth, not a penalized cold-start prior.
   * Omitted/false ⇒ far-domain (the conservative 0.5 cap applies).
   */
  readonly nativeDomain?: boolean;
  predict(features: AcousticFeatures): AxisPrediction;
}

export interface AffectAxisPriors {
  readonly valence?: AffectAxisPrior;
  readonly arousal?: AffectAxisPrior;
}

/** How a single axis value was arrived at (internal transparency; never synced raw). */
export interface AxisResolution {
  readonly axis: "valence" | "arousal";
  /** Final signed value in [-1,1] used in the read. */
  readonly value: number;
  /** The transparent acoustic-only value before any trained nudge. */
  readonly acousticValue: number;
  /** Honest confidence for this axis [0,1] (drives the qualitative band). */
  readonly confidence: UnitInterval;
  /**
   * Whether a trained prior contributed (in-domain + gate-passed), abstained (OOD),
   * was HELD because it failed/lacks its promotion gate (v3 — recorded for audit but
   * never steers the value or confidence), or was absent.
   */
  readonly trainedContribution: "in_domain" | "abstained_ood" | "held_failed_gate" | "absent";
  /** The trained prior's raw lean (provenance), when present. */
  readonly trainedValue: number | null;
  readonly trainedBalancedAccuracy: number | null;
  readonly trainedPassedGate: boolean | null;
  /**
   * Continuous OOD distance [0,1] of the trained prior for THIS hum (0 = squarely in its
   * training domain, 1 = far outside). `null` when no prior fired. Exposed for transparency
   * and to drive the evidence-proportional nudge fade — a near-boundary prior degrades
   * smoothly instead of an all-or-nothing cliff.
   */
  readonly oodDistance: number | null;
}

export interface AxisRead {
  readonly dimensional: ValenceArousal;
  readonly valence: AxisResolution;
  readonly arousal: AxisResolution;
  /**
   * How much real, clear signal this hum carried [0,1] — drives the overall read
   * confidence and abstention (a near-silent / unclear hum has ~0 signal strength).
   */
  readonly signalStrength: UnitInterval;
}

/** Max nudge weight for a far-domain (acted-speech) prior — refines, never overrides (ADR-0005). */
export const FAR_DOMAIN_AXIS_NUDGE_CAP = 0.5;
/** Max nudge weight for a NATIVE in-domain prior (ADR-0011) — leads more, still bounded < 1. */
export const NATIVE_AXIS_NUDGE_CAP = 0.75;
/** Decay rate of the evidence-proportional OOD nudge fade (exp(−λ·ood)); ≈50% fade at ood≈0.46. */
export const OOD_FADE_LAMBDA = 1.5;

/** Map a possibly-null feature to a unit value, using `fallback` when not computable. */
function unit(value: number | null | undefined, low: number, high: number, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return normalize(value, low, high);
}

/**
 * TRANSPARENT acoustic → (valence, arousal). Deterministic, on-domain, always
 * meaningful on real audio. Not a trained or clinical model — a reflection of the
 * hum's acoustic qualities (the same posture as `HumAcousticExpert`).
 *
 *  - Arousal rises with energy, voiced activity, spectral brightness, and pitch height.
 *  - Valence rises with steadiness, smoothness, melodic warmth and an easy vibrato; falls
 *    with expressive instability. It is intentionally INDEPENDENT of capture fidelity
 *    (clarity / SNR / flatness / breathiness) — those reflect the mic and room, not the
 *    mood, and belong to signal strength + confidence, not to the affect read.
 */
export function acousticAffectAxes(f: AcousticFeatures): {
  valence: number;
  arousal: number;
  signalStrength: UnitInterval;
} {
  // --- arousal: activation level ---
  // Energy, voiced activity, brightness and pitch height set the level; pitch MOVEMENT
  // (melodic range) and spectral FLUX (how much the timbre changes) add the "animation"
  // an activated hum carries beyond raw loudness. Weights sum to 1; all on-domain.
  // Energy window WIDENED to a realistic sustained-hum RMS span (0.01–0.14). The old 0.006–0.06
  // window saturated at any audible hum — a normal "mmm" pinned energyN at 1.0, which is what made
  // every typical hum read "restless and activated" (high arousal, mid valence). Now a soft hum
  // sits low, a comfortable hum (~0.08) mid, only a genuinely loud/intense one saturates.
  // Validated by sim-lab `fifty-hums` (the distribution un-pins). The synth generator is also
  // brought down to a realistic level so the demo path no longer feeds an RMS-0.28 outlier.
  const energyN = unit(f.meanRms, 0.01, 0.14, 0); // near-silence → strong
  // A sustained hum is ALWAYS mostly-active (activeFrameRatio ~0.9), so raw activeN was a large
  // near-constant push on arousal (the same fixed-offset failure mode as the pitch pin). Gently
  // centre it on a typical hum so only an UNUSUALLY continuous/sparse hum moves arousal here.
  const activeN = clamp01((f.activeFrameRatio - 0.3) / 0.6);
  const brightN = unit(f.spectralCentroidHz, 250, 2600, 0.3);
  const pitchN = unit(f.pitchMeanHz, 95, 260, 0.5);
  const pitchMoveN = unit(f.pitchRangeSemitones, 0.5, 8, 0.3); // more melodic movement → more activated
  const fluxN = unit(f.spectralFlux, 0.01, 0.3, 0.2); // more spectral change → more activated
  const arousal01 = clamp01(
    0.3 * energyN + 0.22 * activeN + 0.16 * brightN + 0.14 * pitchN + 0.1 * pitchMoveN + 0.08 * fluxN,
  );

  // --- valence: subdued / downbeat ↔ bright / pleasant ---
  // Valence MUST move with how the person actually hums this time, not with fixed qualities of
  // their voice or microphone. Two corrections live here:
  //
  //   (1) It deliberately does NOT key off capture FIDELITY (clarity, SNR, spectral flatness,
  //       breathiness): those measure the mic and room, not the mood. Folding them in made a
  //       clean mic always read "pleasant" and a noisy one "subdued" (a recording-condition
  //       OFFSET). Fidelity earns its keep in `signalStrength` + confidence below.
  //
  //   (2) It can no longer be built ONLY from voice-quality/timbre features (stability,
  //       smoothness, vibrato regularity, agitation). Those are ~CONSTANT for a given
  //       person+mic, so a valence made only of them was pinned: the SAME person landed in one
  //       zone every hum no matter how they hummed (the "tense and wound-up every time" bug).
  //       So valence now also rides on MOOD-VARIABLE prosody the person controls hum-to-hum —
  //       pitch HEIGHT and melodic MOVEMENT (a higher, more melodic hum reads brighter; a low,
  //       flat one reads more subdued) — classic affective-prosody correlates. Voice-quality
  //       still contributes a "settled/in-control" component, but no longer dominates.
  //
  // Weights sum to 1; all on-domain, never a clinical label.
  const smoothN = f.smoothnessScore === null ? 0.5 : clamp01(f.smoothnessScore);
  const stabilityN = clamp01(0.5 * f.amplitudeStability + 0.5 * (f.pitchStability ?? 0.5));
  const vibratoN = f.vibratoRegularity === null ? 0.5 : clamp01(f.vibratoRegularity);
  const agitationN = clamp01(f.residualInstabilityScore);
  const pitchHeightN = unit(f.pitchMeanHz, 95, 260, 0.5); // mood-variable: higher → brighter affect
  const melodyN = unit(f.pitchRangeSemitones, 0.5, 8, 0.3); // mood-variable: melodic movement → expressive/positive
  const valence01 = clamp01(
    // settled / in-control (voice-quality; person-ish, kept moderate so it can't pin the axis)
    0.22 * stabilityN + 0.16 * smoothN + 0.1 * vibratoN + 0.1 * (1 - agitationN) +
    // mood-variable prosody (what the person changes hum-to-hum) — 0.42 of the weight
    0.24 * pitchHeightN + 0.18 * melodyN,
  );

  // --- signal strength: how much clear, voiced, loud-enough audio we actually had ---
  const clarityN = clamp01(f.clarityScore);
  const loudN = unit(f.rmsEnergy, 0.006, 0.05, 0);
  const voicedN = clamp01(f.pitchCoverage ?? 0);
  const signalStrength = f.isSilent
    ? 0
    : clamp01(0.45 * loudN + 0.35 * voicedN + 0.2 * clarityN);

  return { valence: arousal01ToSigned(valence01), arousal: arousal01ToSigned(arousal01), signalStrength };
}

/** [0,1] → [-1,1]. */
function arousal01ToSigned(x: UnitInterval): number {
  return clamp(x * 2 - 1, -1, 1);
}

/**
 * Resolve ONE axis: start from the transparent acoustic value, then nudge toward a
 * trained prior's lean ONLY when that prior is in-domain. The nudge weight is the
 * prior's confidence × its honest balanced accuracy, and is bounded so the trained
 * far-domain prior can refine but never dominate the on-domain read.
 */
function resolveAxis(
  axis: "valence" | "arousal",
  acousticValue: number,
  signalStrength: UnitInterval,
  prior: AffectAxisPrior | undefined,
  features: AcousticFeatures,
): AxisResolution {
  // Base confidence: how much clear signal we had (the acoustic read earns confidence
  // from the hum itself, not from a multi-hum calibration count). Capped below the
  // "High evidence" band on its own — a clear signal with NO hum-validated model
  // agreement is honestly "Medium" at best; only an in-domain trained prior that
  // agrees can earn "High".
  let confidence = clamp01(0.2 + 0.48 * signalStrength);
  let value = acousticValue;
  let trainedContribution: AxisResolution["trainedContribution"] = "absent";
  let trainedValue: number | null = null;
  let trainedBalancedAccuracy: number | null = null;
  let trainedPassedGate: boolean | null = null;
  let oodDistance: number | null = null;

  if (prior) {
    const pred = prior.predict(features);
    trainedValue = pred.value;
    trainedBalancedAccuracy = prior.balancedAccuracy;
    trainedPassedGate = prior.passedGate;
    oodDistance = pred.ood;
    if (!pred.inDomain) {
      trainedContribution = "abstained_ood";
    } else if (!prior.passedGate) {
      // v3 GATE ENFORCEMENT: an in-domain prior that did NOT pass its promotion gate may
      // NOT steer the leading dimensional read or raise its confidence. Its lean is kept
      // in provenance (`trainedValue`/`oodDistance`/`trainedPassedGate`) for audit only —
      // the surfaced value stays the transparent acoustic backbone and confidence is
      // unchanged. This is conservative by construction: the prior loaders degrade a
      // missing/old manifest to `passedGate = false`, so an unverified prior lands here too.
      trainedContribution = "held_failed_gate";
    } else {
      trainedContribution = "in_domain";
      // Weight the nudge by the prior's self-confidence and its honest accuracy. A
      // far-domain prior is capped at 0.5 (refines, never overrides — ADR-0005); a
      // NATIVE in-domain prior (ADR-0011) earns a larger cap since it is on-domain hum
      // truth, but is still bounded below 1 so the transparent acoustic read remains the
      // backbone of every read. A smooth OOD FADE (exp(−λ·ood)) softens the nudge as the
      // hum nears the prior's domain boundary — evidence-proportional, not an on/off cliff.
      // The weight uses the prior's LEAN STRENGTH (|value|) × its accuracy × cap × the fade —
      // a SINGLE OOD decay (the fade). `pred.confidence` already folds in an OOD factor, so it
      // is kept OUT of the weight (to avoid double-discounting) and used only for the lift below.
      const cap = prior.nativeDomain ? NATIVE_AXIS_NUDGE_CAP : FAR_DOMAIN_AXIS_NUDGE_CAP;
      const fade = Math.exp(-OOD_FADE_LAMBDA * pred.ood);
      const w = clamp01(Math.abs(pred.value) * clamp01(prior.balancedAccuracy)) * cap * fade;
      value = clamp(acousticValue * (1 - w) + pred.value * w, -1, 1);
      // Signed confidence adjustment: an in-domain prior that AGREES with the acoustic read
      // lifts confidence; one that strongly DISAGREES (conflicting evidence) lowers it — the
      // read is genuinely more ambiguous when the backbone and the prior point apart. `agree`
      // is 1 at identical leans, 0.5 at a full-scale (|Δ|=1) split, 0 at opposite poles.
      const agree = 1 - Math.abs(acousticValue - pred.value) / 2;
      // Only a gate-PASSED, in-domain prior reaches here (v3), so the lift is the full 0.15;
      // disagreement still lowers it (agree − 0.5 < 0), agreement raises it.
      const lift = 0.15;
      confidence = clamp01(confidence + lift * pred.confidence * (agree - 0.5) * 2);
    }
  }

  return {
    axis,
    value,
    acousticValue,
    confidence,
    trainedContribution,
    trainedValue,
    trainedBalancedAccuracy,
    trainedPassedGate,
    oodDistance,
  };
}

/**
 * Produce the full dimensional axis read for one hum: the transparent acoustic
 * valence/arousal, optionally refined by in-domain trained priors, plus the honest
 * signal strength that downstream confidence + abstention use.
 */
export function resolveAxisRead(features: AcousticFeatures, priors?: AffectAxisPriors): AxisRead {
  const ac = acousticAffectAxes(features);
  const valence = resolveAxis("valence", ac.valence, ac.signalStrength, priors?.valence, features);
  const arousal = resolveAxis("arousal", ac.arousal, ac.signalStrength, priors?.arousal, features);
  return {
    dimensional: { valence: valence.value, arousal: arousal.value },
    valence,
    arousal,
    signalStrength: ac.signalStrength,
  };
}

/** Mean of the two axes' honest confidences (the read-level axis confidence). */
export function axisReadConfidence(read: AxisRead): UnitInterval {
  return clamp01(mean([read.valence.confidence, read.arousal.confidence]));
}
