import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum, computeFeatures } from "@hum-ai/audio-features";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { featureVectorNames, toFeatureVector } from "../src/feature-schema";
import { trainLogReg, type LogRegParams } from "../src/model";
import { inferFromHum, type InferencePromotion } from "../src/inference";

function tinyModel(): LogRegParams {
  const X: number[][] = [];
  const y: FusionLabel[] = [];
  for (let s = 1; s <= 6; s++) {
    X.push(toFeatureVector(computeFeatures(synthHum({ seed: s }))));
    y.push("calm_regulated");
    X.push(toFeatureVector(computeFeatures(synthHum({ seed: s + 50 }))).map((v) => v * 0.9));
    y.push("high_arousal_negative");
  }
  return trainLogReg(X, y, { labels: ["calm_regulated", "high_arousal_negative"], featureNames: featureVectorNames(), iterations: 150 });
}

const promotion: InferencePromotion = {
  evaluated: true,
  gateMetric: "balanced_accuracy",
  gateThreshold: 0.8,
  affectTargetId: "affect_fusion_label",
  affectBalancedAccuracy: 0.479,
  affectPassedGate: false,
  affectModelRole: "population prior",
  promotedAuxTarget: "arousal_binary",
  promotedAuxBalancedAccuracy: 0.831,
  datasetsUsed: ["ravdess"],
  note: "affect head unchanged",
};

test("inference echoes the promotion gate and warns honestly when affect did not pass", async () => {
  const report = await inferFromHum({ audio: synthHum({ seed: 3 }), model: tinyModel(), promotion });
  assert.equal(report.promotion.evaluated, true);
  assert.equal(report.promotion.affectPassedGate, false);
  assert.equal(report.promotion.promotedAuxTarget, "arousal_binary");
  assert.ok(report.warnings.some((w) => w.includes("did NOT pass the 80% promotion gate")), "warns affect did not pass");
  assert.ok(
    report.warnings.some((w) => w.includes("arousal_binary") && w.toLowerCase().includes("not used to drive")),
    "flags aux not driving the read",
  );
});

test("without a manifest, promotion is reported as not-evaluated (no false validation claim)", async () => {
  const report = await inferFromHum({ audio: synthHum({ seed: 4 }), model: tinyModel() });
  assert.equal(report.promotion.evaluated, false);
  assert.equal(report.promotion.affectPassedGate, false);
  assert.equal(report.promotion.promotedAuxTarget, null);
});

test("fallback mode (no model) still reports an honest, not-evaluated promotion block", async () => {
  const report = await inferFromHum({ audio: synthHum({ seed: 5 }) });
  assert.equal(report.fallbackUsed, true);
  assert.equal(report.promotion.evaluated, false);
  assert.ok(report.promotion.datasetsUsed.length === 0);
});
