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
  const features = cleanHumFeatures();
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
