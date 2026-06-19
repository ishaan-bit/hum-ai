import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum } from "@hum-ai/audio-features";
import { featureVectorNames, featureVectorLength } from "../src/feature-schema";
import { inferFromHum } from "../src/inference";
import type { NeuralFeatureModel } from "../src/neural-feature-model";

function auxArousalModel(): NeuralFeatureModel {
  const F = featureVectorLength();
  return {
    version: "signal-lab-neural-arousal_binary/0.1.0",
    kind: "feature_mlp_opgraph",
    target: "arousal_binary",
    family: "mlp",
    labels: ["low_arousal", "high_arousal"],
    featureNames: featureVectorNames(),
    standardizer: { mean: new Array(F).fill(0), std: new Array(F).fill(1) },
    ops: [{ op: "linear", W: [new Array(F).fill(0.01), new Array(F).fill(-0.01)], b: [0, 0] }],
    evidence: { balancedAccuracy: 0.86, ece: 0.1, pValue: 0.001, classicalBaseline: 0.831, validation: "test" },
    governance: "acted-speech far-domain prior",
  };
}

test("without a neural aux model, the report is unchanged (no aux prior, fallback intact)", async () => {
  const report = await inferFromHum({ audio: synthHum({ seed: 7 }) });
  assert.equal(report.neuralAuxiliaryPrior, null);
  assert.equal(report.fallbackUsed, true);
});

test("a supplied neural aux model is surfaced but does NOT steer state/intervention", async () => {
  const audio = synthHum({ seed: 7 });
  const base = await inferFromHum({ audio });
  const withAux = await inferFromHum({ audio, neuralAuxModel: auxArousalModel(), neuralAuxArtifactPath: "x.json" });

  // aux prior present + honest
  assert.ok(withAux.neuralAuxiliaryPrior);
  assert.equal(withAux.neuralAuxiliaryPrior!.target, "arousal_binary");
  assert.ok(["low_arousal", "high_arousal"].includes(withAux.neuralAuxiliaryPrior!.topLabel));
  assert.ok(withAux.warnings.some((w) => w.includes("Auxiliary NEURAL prior") && w.includes("not steering")));

  // the affect read + intervention are IDENTICAL with or without the aux prior
  assert.deepEqual(withAux.inferredState, base.inferredState);
  assert.deepEqual(withAux.intervention, base.intervention);
  assert.equal(withAux.confidence.internal.confidencePercent, base.confidence.internal.confidencePercent);
});
