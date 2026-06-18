import { test } from "node:test";
import assert from "node:assert/strict";
import { TextEmotionExpert } from "@hum-ai/expert-ter";

const meta = { modality: "text" as const, captureQuality: 1 };

test("empty text is a missing modality", async () => {
  const out = await new TextEmotionExpert().predict({ text: "   " }, meta);
  assert.equal(out.available, false);
});

test("anxious words tilt toward tense_anxious", async () => {
  const out = await new TextEmotionExpert().predict({ text: "feeling anxious and stressed" }, meta);
  assert.equal(out.available, true);
  assert.ok((out.probabilities.tense_anxious ?? 0) > (out.probabilities.calm_regulated ?? 0));
  assert.ok(out.selfConfidence <= 0.5);
});
