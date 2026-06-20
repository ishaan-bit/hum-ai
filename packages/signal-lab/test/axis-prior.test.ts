import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures, synthHum } from "@hum-ai/audio-features";
import { buildAffectAxisPrior } from "../src/axis-prior";
import { featureVectorNames, toFeatureVector } from "../src/feature-schema";
import type { LogRegParams } from "../src/model";

/**
 * The axis priors are far-domain (acted speech). On a hum — which sits well outside
 * that training distribution — they MUST abstain (`inDomain=false`) rather than emit a
 * confident, saturated value (ADR-0005). These tests pin that OOD gating using a model
 * whose standardizer is either mean-matched to the input (in-domain) or zero-centred
 * (the input is then far from the mean → OOD).
 */
function zeroWeightParams(mean: number[], std: number[]): LogRegParams {
  const d = mean.length;
  return {
    version: "test-axis/0.1.0",
    featureNames: featureVectorNames(),
    labels: ["low_arousal", "high_arousal"],
    standardizer: { mean, std },
    weights: [new Array(d).fill(0), new Array(d).fill(0)],
    bias: [0, 0],
    l2: 0,
    iterations: 0,
    learningRate: 0,
    trainCount: 0,
    classWeighted: false,
  };
}

test("a hum is OUT of the far-domain axis prior's training distribution → it abstains", () => {
  const features = computeFeatures(synthHum({ seed: 7, f0: 150 }));
  const d = featureVectorNames().length;
  const ood = buildAffectAxisPrior(zeroWeightParams(new Array(d).fill(0), new Array(d).fill(1)), {
    axis: "arousal",
    balancedAccuracy: 0.83,
    passedGate: true,
  });
  const pred = ood.predict(features);
  assert.equal(pred.inDomain, false, "a hum is far from the acted-speech mean → out of domain");
  assert.equal(pred.confidence, 0, "an out-of-domain prior contributes no confidence");
});

test("when the input sits on the prior's training mean it reads in-domain", () => {
  const features = computeFeatures(synthHum({ seed: 7, f0: 150 }));
  const vec = toFeatureVector(features);
  const inDomain = buildAffectAxisPrior(zeroWeightParams([...vec], new Array(vec.length).fill(1)), {
    axis: "arousal",
    balancedAccuracy: 0.83,
    passedGate: true,
  });
  const pred = inDomain.predict(features);
  assert.equal(pred.inDomain, true);
  assert.ok(pred.ood < 0.2, `mean-matched input should read low OOD, got ${pred.ood}`);
});
