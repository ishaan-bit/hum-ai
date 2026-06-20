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
  /** Honest balanced accuracy on the (far-domain) validation set — provenance only. */
  readonly balancedAccuracy: number;
  /** Whether this axis cleared the experimental promotion gate (ADR-0005). */
  readonly passedGate: boolean;
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
  /** Whether a trained prior contributed (in-domain) or abstained (OOD) / was absent. */
  readonly trainedContribution: "in_domain" | "abstained_ood" | "absent";
  /** The trained prior's raw lean (provenance), when present. */
  readonly trainedValue: number | null;
  readonly trainedBalancedAccuracy: number | null;
  readonly trainedPassedGate: boolean | null;
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
 *  - Valence rises with clarity, smoothness, and steadiness; falls with roughness /
 *    instability / breathiness.
 */
export function acousticAffectAxes(f: AcousticFeatures): {
  valence: number;
  arousal: number;
  signalStrength: UnitInterval;
} {
  // --- arousal: activation level ---
  const energyN = unit(f.meanRms, 0.006, 0.06, 0); // near-silence → strong
  const activeN = clamp01(f.activeFrameRatio);
  const brightN = unit(f.spectralCentroidHz, 250, 2600, 0.3);
  const pitchN = unit(f.pitchMeanHz, 95, 260, 0.5);
  const arousal01 = clamp01(0.34 * energyN + 0.26 * activeN + 0.2 * brightN + 0.2 * pitchN);

  // --- valence: pleasant / settled vs subdued / rough ---
  const clarityN = clamp01(f.clarityScore);
  const smoothN = f.smoothnessScore === null ? 0.5 : clamp01(f.smoothnessScore);
  const stabilityN = clamp01(0.5 * f.amplitudeStability + 0.5 * (f.pitchStability ?? 0.5));
  const roughN = clamp01(0.6 * f.residualInstabilityScore + 0.4 * f.breathinessProxy);
  const valence01 = clamp01(0.32 * clarityN + 0.24 * smoothN + 0.24 * stabilityN + 0.2 * (1 - roughN));

  // --- signal strength: how much clear, voiced, loud-enough audio we actually had ---
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

  if (prior) {
    const pred = prior.predict(features);
    trainedValue = pred.value;
    trainedBalancedAccuracy = prior.balancedAccuracy;
    trainedPassedGate = prior.passedGate;
    if (pred.inDomain) {
      trainedContribution = "in_domain";
      // Weight the nudge by the prior's self-confidence and its honest accuracy,
      // capped at 0.5 so the far-domain prior refines, never overrides (ADR-0005).
      const w = clamp01(pred.confidence * clamp01(prior.balancedAccuracy)) * 0.5;
      value = clamp(acousticValue * (1 - w) + pred.value * w, -1, 1);
      // A gate-passing in-domain agreement modestly lifts confidence.
      const agree = 1 - Math.abs(acousticValue - pred.value) / 2;
      confidence = clamp01(confidence + (prior.passedGate ? 0.15 : 0.08) * pred.confidence * agree);
    } else {
      trainedContribution = "abstained_ood";
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
