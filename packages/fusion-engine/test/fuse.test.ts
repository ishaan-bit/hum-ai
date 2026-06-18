import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion } from "@hum-ai/shared-types";
import {
  missingExpertOutput,
  type ExpertOutput,
  type ConfidenceCaps,
} from "@hum-ai/affect-model-contracts";
import { FusionEngine, expertWeight } from "@hum-ai/fusion-engine";

const engine = new FusionEngine();
const caps: ConfidenceCaps = { cap: 0.88, capReason: "stage cap", abstainBelow: 0.45 };

const ctx = {
  modelVersion: asModelVersion("fusion-v1"),
  captureQuality: 0.85,
  domainMatch: 0.85,
  caps,
  calibrationMaturity: 0.8,
  longitudinalTrendStrength: 0.5,
};

const audioExpert = (over: Partial<ExpertOutput> = {}): ExpertOutput => ({
  expertId: "expert-ser:hum-acoustic",
  modality: "audio",
  available: true,
  probabilities: { calm_regulated: 0.7, neutral_close_to_usual: 0.3 },
  selfConfidence: 0.3,
  domainMatch: 0.9,
  oodScore: 0.2,
  ...over,
});

test("all modalities missing → abstain (missing-modality handling)", () => {
  const out = engine.fuse(
    [missingExpertOutput("expert-ser:hum-acoustic", "audio"), missingExpertOutput("expert-fer:vit", "face")],
    ctx,
  );
  assert.equal(out.abstained, true);
  assert.equal(out.abstainReason, "poor_capture_quality");
});

test("fusion ignores unavailable experts and still produces a result", () => {
  const out = engine.fuse([audioExpert(), missingExpertOutput("expert-ter:distilroberta", "text")], ctx);
  assert.equal(out.modelVersion, "fusion-v1");
  // calm_regulated should dominate the state heads
  assert.ok(out.states.calm_regulated > out.states.sadness_low_mood);
  const total = Object.values(out.states).reduce((a, b) => a + b, 0);
  assert.ok(total > 0);
});

test("an off-domain expert is down-weighted relative to a hum-native one", () => {
  const hum = audioExpert({ domainMatch: 0.9 });
  const speech = audioExpert({ expertId: "expert-ser:speech-clinical", domainMatch: 0.3 });
  assert.ok(expertWeight(hum) > expertWeight(speech));
});

test("single-modality fusion still works but caps cross-modal agreement", () => {
  const out = engine.fuse([audioExpert({ probabilities: { calm_regulated: 1 } })], ctx);
  // With one modality, agreement is capped → confidence can't run away.
  assert.ok(out.confidence.confidence <= ctx.caps.cap + 1e-9);
});

test("dimensional output stays within [-1, 1]", () => {
  const out = engine.fuse([audioExpert()], ctx);
  assert.ok(out.dimensional.valence >= -1 && out.dimensional.valence <= 1);
  assert.ok(out.dimensional.arousal >= -1 && out.dimensional.arousal <= 1);
});
