import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acousticAffectAxes,
  resolveAxisRead,
  axisReadConfidence,
  type AffectAxisPrior,
  type AxisPrediction,
} from "@hum-ai/orchestrator";
import { cleanHumFeatures, silentFeatures } from "./fixtures";

/** A stub axis prior with a fixed prediction (for in-domain / OOD behavior). */
function stubPrior(axis: "valence" | "arousal", pred: AxisPrediction, opts: { balancedAccuracy?: number; passedGate?: boolean } = {}): AffectAxisPrior {
  return {
    axis,
    balancedAccuracy: opts.balancedAccuracy ?? 0.83,
    passedGate: opts.passedGate ?? true,
    predict: () => pred,
  };
}

test("the acoustic axis read responds to the hum (varies, on-domain) and is bounded", () => {
  const energetic = acousticAffectAxes(cleanHumFeatures({ meanRms: 0.06, activeFrameRatio: 0.9, spectralCentroidHz: 2200, pitchMeanHz: 250 }));
  const subdued = acousticAffectAxes(cleanHumFeatures({ meanRms: 0.012, activeFrameRatio: 0.3, spectralCentroidHz: 350, pitchMeanHz: 100 }));
  assert.ok(energetic.arousal > subdued.arousal, "louder/brighter/higher-pitch reads as more activated");
  for (const v of [energetic.valence, energetic.arousal, subdued.valence, subdued.arousal]) {
    assert.ok(v >= -1 && v <= 1, "axis values stay in [-1,1]");
  }
});

test("a near-silent hum has ~zero signal strength (the read will abstain)", () => {
  const r = resolveAxisRead(silentFeatures());
  assert.ok(r.signalStrength < 0.1, `silence signal strength should be ~0, got ${r.signalStrength}`);
});

test("an in-domain trained prior REFINES the axis read and lifts confidence; an OOD prior abstains", () => {
  // A genuinely energetic hum (loud, bright, melodic, high-flux) so its acoustic arousal is clearly
  // positive — i.e. a high-arousal in-domain prior actually AGREES with it (the precondition for the
  // confidence lift). A neutral/gappy hum reads mildly-calm and would (correctly) disagree with a 0.9
  // prior, which is a property of the read, not a regression.
  const features = cleanHumFeatures({
    meanRms: 0.11,
    activeFrameRatio: 0.92,
    spectralCentroidHz: 1900,
    spectralFlux: 0.26,
    pitchMeanHz: 240,
    pitchRangeSemitones: 5,
  });
  const acoustic = resolveAxisRead(features);

  const inDomain = resolveAxisRead(features, {
    arousal: stubPrior("arousal", { value: 0.9, ood: 0.1, inDomain: true, confidence: 0.8 }),
  });
  assert.equal(inDomain.arousal.trainedContribution, "in_domain");
  // The value is nudged toward the prior's lean, but never fully overridden.
  assert.ok(inDomain.arousal.value > acoustic.arousal.value, "in-domain prior nudges the value");
  assert.ok(inDomain.arousal.value < 0.9, "the far-domain prior refines, never dominates");
  assert.ok(inDomain.arousal.confidence >= acoustic.arousal.confidence, "agreement may lift confidence");

  const ood = resolveAxisRead(features, {
    arousal: stubPrior("arousal", { value: 0.9, ood: 1, inDomain: false, confidence: 0 }),
  });
  assert.equal(ood.arousal.trainedContribution, "abstained_ood");
  assert.equal(ood.arousal.value, acoustic.arousal.value, "an OOD prior leaves the acoustic read unchanged");
});

test("the nudge fades smoothly as the prior's OOD distance rises; oodDistance is surfaced", () => {
  const features = cleanHumFeatures();
  const acoustic = resolveAxisRead(features).arousal.value;
  const near = resolveAxisRead(features, { arousal: stubPrior("arousal", { value: 0.95, ood: 0.1, inDomain: true, confidence: 0.8 }) });
  const far = resolveAxisRead(features, { arousal: stubPrior("arousal", { value: 0.95, ood: 0.8, inDomain: true, confidence: 0.8 }) });

  // Both nudge upward, but the near-boundary (higher-ood) prior nudges LESS.
  assert.ok(near.arousal.value > acoustic && far.arousal.value > acoustic);
  assert.ok(near.arousal.value > far.arousal.value, "higher OOD ⇒ smaller nudge (evidence fade)");
  // The continuous OOD distance is surfaced for transparency; null with no prior.
  assert.equal(near.arousal.oodDistance, 0.1);
  assert.equal(far.arousal.oodDistance, 0.8);
  assert.equal(resolveAxisRead(features).arousal.oodDistance, null);
});

test("a NATIVE in-domain prior nudges the read more than a far-domain one with the same lean (ADR-0011)", () => {
  const features = cleanHumFeatures();
  const acoustic = resolveAxisRead(features).arousal.value;
  const pred = { value: 0.95, ood: 0.05, inDomain: true, confidence: 0.9 } as const;

  const far = resolveAxisRead(features, { arousal: { ...stubPrior("arousal", pred), nativeDomain: false } });
  const native = resolveAxisRead(features, { arousal: { ...stubPrior("arousal", pred), nativeDomain: true } });

  assert.ok(native.arousal.value > far.arousal.value, "native prior earns a larger nudge");
  // Both still bounded below the prior's raw lean — the acoustic read remains the backbone.
  assert.ok(native.arousal.value < pred.value, "even a native prior never fully overrides the acoustic read");
  assert.ok(far.arousal.value > acoustic, "the far-domain prior still refines");
});

test("v3: a gate-FAILED in-domain axis prior is HELD — no nudge, no confidence change, recorded for audit", () => {
  const features = cleanHumFeatures();
  const acoustic = resolveAxisRead(features).arousal;

  // A confident, in-domain, but gate-FAILED prior leaning hard high. It must NOT move the read.
  const held = resolveAxisRead(features, {
    arousal: stubPrior("arousal", { value: 0.95, ood: 0.05, inDomain: true, confidence: 0.9 }, { passedGate: false }),
  }).arousal;

  assert.equal(held.trainedContribution, "held_failed_gate");
  assert.equal(held.value, acoustic.value, "a gate-failed prior must not nudge the axis value");
  assert.equal(held.confidence, acoustic.confidence, "a gate-failed prior must not change confidence");
  // …but its lean + OOD distance are still recorded for provenance/audit.
  assert.equal(held.trainedValue, 0.95);
  assert.equal(held.trainedPassedGate, false);
  assert.equal(held.oodDistance, 0.05);
});

test("v3: missing gate metadata is conservative — a passedGate=false prior (loader default) does not steer", () => {
  // The prior loaders degrade a missing/old manifest to passedGate=false; that prior must
  // be held exactly like an explicitly gate-failed one (never silently trusted to steer).
  const features = cleanHumFeatures();
  const acoustic = resolveAxisRead(features).valence;
  const conservative = resolveAxisRead(features, {
    valence: stubPrior("valence", { value: -0.9, ood: 0.1, inDomain: true, confidence: 0.8 }, { passedGate: false }),
  }).valence;
  assert.equal(conservative.trainedContribution, "held_failed_gate");
  assert.equal(conservative.value, acoustic.value, "unverified (missing-manifest) prior must not steer the read");
});

test("an in-domain prior that strongly DISAGREES with the backbone LOWERS confidence (conflicting evidence)", () => {
  // Use a hum with a CLEAR arousal lean (loud, bright, lively) so an opposite-pole prior is a
  // genuine strong disagreement. A plain "clean hum" now reads ~neutral arousal by design (the
  // recalibration that stopped every typical hum reading "restless"), which would make a ±0.95
  // prior only a borderline split — not the conflicting-evidence case this test asserts on.
  const features = cleanHumFeatures({
    meanRms: 0.13, medianRms: 0.13, rmsEnergy: 0.13, activeFrameRatio: 0.95,
    spectralCentroidHz: 1800, spectralFlux: 0.25, pitchMeanHz: 230,
  });
  const acoustic = resolveAxisRead(features).arousal;

  // A confident, gate-passed, in-domain prior pointing to the OPPOSITE pole of the
  // acoustic backbone — the read is genuinely more ambiguous, so confidence must drop.
  const opposite = acoustic.value >= 0 ? -0.95 : 0.95;
  const disagreeing = resolveAxisRead(features, {
    arousal: stubPrior("arousal", { value: opposite, ood: 0.05, inDomain: true, confidence: 0.9 }, { passedGate: true }),
  }).arousal;

  assert.equal(disagreeing.trainedContribution, "in_domain");
  assert.ok(
    disagreeing.confidence < acoustic.confidence,
    `disagreement should lower confidence: ${disagreeing.confidence} !< ${acoustic.confidence}`,
  );
  // And it stays a valid, bounded confidence (never negative).
  assert.ok(disagreeing.confidence >= 0 && disagreeing.confidence <= 1);
});

// ── v9 calibration regressions (Hum Simulator–driven) ─────────────────────────────
// These lock in the v9 fixes for the "center collapse / arousal compressed entirely below 0 /
// valence positive-biased" findings. Each FAILS against the v8 read math.

test("v9: a MODERATE neutral hum reads ~0 on both axes (arousal zero-point is correctly located)", () => {
  // The v8 read normalized loudness LINEARLY, so a moderate hum (meanRms ≈ 0.04) read as
  // near-silent and the whole arousal axis carried a large negative offset — the neutral
  // reference hum read arousal ≈ −0.33. v9 normalizes loudness perceptually (log), placing a
  // moderate hum near the cue midpoint. A genuinely neutral hum must now read near the origin.
  const neutral = acousticAffectAxes(
    cleanHumFeatures({
      meanRms: 0.04, medianRms: 0.04, rmsEnergy: 0.04, activeFrameRatio: 0.7,
      spectralCentroidHz: 1000, pitchMeanHz: 175, spectralFlux: 0.1, pitchRangeSemitones: 2.5,
      signalToNoiseProxy: 12,
    }),
  );
  assert.ok(Math.abs(neutral.arousal) < 0.2, `neutral arousal should sit near 0, got ${neutral.arousal.toFixed(3)}`);
  assert.ok(Math.abs(neutral.valence) < 0.2, `neutral valence should sit near 0, got ${neutral.valence.toFixed(3)}`);
});

test("v9: a genuinely subdued hum REACHES the low valence pole (low pole no longer unreachable)", () => {
  // v8's valence was dominated (0.58 weight) by a near-constant voice-quality floor (incl. the
  // near-dead pitchStability), so the most-downbeat hum bottomed at only ≈ −0.14 and the low pole
  // was out of reach. v9 leads valence with mood-variable prosody, so a low, flat, agitated hum
  // reads clearly subdued.
  const subdued = acousticAffectAxes(
    cleanHumFeatures({
      meanRms: 0.014, medianRms: 0.014, rmsEnergy: 0.014, activeFrameRatio: 0.5,
      spectralCentroidHz: 600, pitchMeanHz: 105, spectralFlux: 0.04, pitchRangeSemitones: 1.0,
      smoothnessScore: 0.45, amplitudeStability: 0.6, pitchStability: 0.62,
      residualInstabilityScore: 0.45, vibratoRegularity: 0.4, signalToNoiseProxy: 12,
    }),
  );
  assert.ok(subdued.valence < -0.2, `subdued hum should reach the low valence pole, got ${subdued.valence.toFixed(3)}`);
  assert.ok(subdued.arousal < -0.2, `subdued hum should also read low arousal, got ${subdued.arousal.toFixed(3)}`);
});

test("v9: a genuinely energetic hum REACHES the high arousal pole (arousal no longer compressed)", () => {
  const energetic = acousticAffectAxes(
    cleanHumFeatures({
      meanRms: 0.12, medianRms: 0.12, rmsEnergy: 0.12, activeFrameRatio: 0.95,
      spectralCentroidHz: 1900, pitchMeanHz: 235, spectralFlux: 0.2, pitchRangeSemitones: 5.5,
      signalToNoiseProxy: 14,
    }),
  );
  assert.ok(energetic.arousal > 0.4, `energetic hum should reach the high arousal pole, got ${energetic.arousal.toFixed(3)}`);
  assert.ok(energetic.valence > 0.2, `bright energetic hum should read positive valence, got ${energetic.valence.toFixed(3)}`);
});

test("v9: low capture fidelity only FADES the read toward neutral — never past it to the wrong pole", () => {
  // The v9 fidelity contract: as SNR drops, the WHOLE acoustic read decays monotonically toward
  // neutral and can never cross to or past a pole. This is what stops recording noise alone from
  // manufacturing or inverting affect. (Same energetic mood, three capture fidelities.)
  const mood = {
    meanRms: 0.12, medianRms: 0.12, rmsEnergy: 0.12, activeFrameRatio: 0.95,
    spectralCentroidHz: 1900, pitchMeanHz: 235, spectralFlux: 0.2, pitchRangeSemitones: 5.5,
  } as const;
  const clean = acousticAffectAxes(cleanHumFeatures({ ...mood, signalToNoiseProxy: 14 }));
  const mid = acousticAffectAxes(cleanHumFeatures({ ...mood, signalToNoiseProxy: 5 }));
  const noisy = acousticAffectAxes(cleanHumFeatures({ ...mood, signalToNoiseProxy: 2 }));

  assert.ok(clean.arousal > 0.4, "the clean capture is clearly aroused");
  // Monotone fade toward neutral: clean ≥ mid ≥ noisy ≥ 0, and never below 0 (no pole crossing).
  assert.ok(clean.arousal >= mid.arousal - 1e-9 && mid.arousal >= noisy.arousal - 1e-9, `fade should be monotone: ${clean.arousal.toFixed(3)} → ${mid.arousal.toFixed(3)} → ${noisy.arousal.toFixed(3)}`);
  assert.ok(noisy.arousal >= -1e-9, "a degraded capture never crosses to the opposite (low) pole");
  assert.ok(Math.abs(noisy.arousal) < Math.abs(clean.arousal), "a degraded capture reads LESS extreme than the clean one");
});

test("a clear signal alone earns at most Medium; only in-domain trained agreement reaches High", () => {
  const features = cleanHumFeatures();
  const acousticConf = axisReadConfidence(resolveAxisRead(features));
  assert.ok(acousticConf < 0.72, "acoustic-only confidence stays below the High band");

  const withAgreement = resolveAxisRead(features, {
    valence: stubPrior("valence", { value: resolveAxisRead(features).valence.value, ood: 0.05, inDomain: true, confidence: 0.9 }),
    arousal: stubPrior("arousal", { value: resolveAxisRead(features).arousal.value, ood: 0.05, inDomain: true, confidence: 0.9 }),
  });
  assert.ok(axisReadConfidence(withAgreement) > acousticConf, "in-domain agreement lifts confidence above acoustic-only");
});
