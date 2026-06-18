import { test } from "node:test";
import assert from "node:assert/strict";
import { FaceEmotionExpert } from "@hum-ai/expert-fer";

test("face modality is absent by default for a hum session", async () => {
  const out = await new FaceEmotionExpert().predict(null, { modality: "face", captureQuality: 0 });
  assert.equal(out.available, false);
});

test("a provided face frame yields a low-confidence available output", async () => {
  const out = await new FaceEmotionExpert().predict({ frame: "..." }, { modality: "face", captureQuality: 0.7 });
  assert.equal(out.available, true);
  assert.ok(out.selfConfidence <= 0.3);
});
