import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum, synthSpeechLike, synthSilence, computeFeatures } from "@hum-ai/audio-features";
import { assessCapture } from "../src/capture-gate";

/**
 * STAGE ① gate: accept a clear hum; reject silence/speech-like (→ "hum again").
 * The CV-validated reference is the Python gate (capture_gate.json); this asserts the
 * TS-native runtime gate honours the accept/reject contract on synthetic signals.
 */
test("accepts a clear sustained hum", () => {
  let accepted = 0;
  for (let s = 1; s <= 6; s++) {
    const d = assessCapture(computeFeatures(synthHum({ seed: s })));
    if (d.accepted) accepted++;
    assert.ok(d.humLikeness >= 0 && d.humLikeness <= 1);
  }
  assert.ok(accepted >= 4, `expected most hums accepted, got ${accepted}/6`);
});

test("rejects silence with a hum-again action", () => {
  const d = assessCapture(computeFeatures(synthSilence()));
  assert.equal(d.accepted, false);
  assert.equal(d.action, "ask_user_to_hum_again");
});

test("rejects most speech-like captures (strict)", () => {
  let rejected = 0;
  for (let s = 1; s <= 6; s++) {
    if (!assessCapture(computeFeatures(synthSpeechLike({ seed: s }))).accepted) rejected++;
  }
  assert.ok(rejected >= 3, `expected speech mostly rejected, got ${rejected}/6 rejected`);
});
