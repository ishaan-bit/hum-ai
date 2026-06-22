import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum, synthSpeechLike, synthSilence, synthInterruptedHum, computeFeatures } from "@hum-ai/audio-features";
import { assessCapture } from "../src/capture-gate";

/**
 * STAGE ① gate: accept a clear hum (continuous OR burst-voiced with breath pauses);
 * reject silence/speech-like (→ "hum again") with a SPECIFIC reason. The CV-validated
 * reference is the Python gate (capture_gate.json); this asserts the TS-native runtime
 * gate honours the accept/reject contract + pause tolerance (Brocal/DALI) on synthetics.
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

test("rejects silence with a hum-again action and a specific reason", () => {
  const d = assessCapture(computeFeatures(synthSilence()));
  assert.equal(d.accepted, false);
  assert.equal(d.action, "ask_user_to_hum_again");
  assert.equal(d.reasonCode, "too_quiet");
});

test("rejects most speech-like captures (strict) as sounded_like_speech", () => {
  let rejected = 0;
  for (let s = 1; s <= 6; s++) {
    const d = assessCapture(computeFeatures(synthSpeechLike({ seed: s })));
    if (!d.accepted) {
      rejected++;
      assert.equal(d.reasonCode, "sounded_like_speech", `seed ${s} reason`);
    }
  }
  assert.ok(rejected >= 3, `expected speech mostly rejected, got ${rejected}/6 rejected`);
});

// PAUSE TOLERANCE (Brocal/DALI): a hum done in bursts separated by breath pauses is a
// VALID hum — what matters is the voiced content, not the gaps. A clip that is at least
// ~half voiced humming must be accepted (this was the reported false-rejection).
test("accepts burst-voiced hums with breath pauses (≥ ~50% voiced)", () => {
  for (const [onSec, offSec] of [
    [1.5, 0.5],
    [1.2, 0.6],
    [1.0, 0.8],
    [0.8, 0.8],
  ] as const) {
    const d = assessCapture(computeFeatures(synthInterruptedHum({ onSec, offSec })));
    assert.equal(d.accepted, true, `paused hum ${onSec}on/${offSec}off should be accepted (L=${d.humLikeness.toFixed(2)})`);
  }
});

// …but a clip that is MOSTLY silence with only brief fragments of tone is still rejected at
// Stage ①, and says so specifically (so the user knows to keep the hum more continuous). The
// Stage-① gate is deliberately lenient (it rejects only clear non-hums); a merely choppy clip
// can pass it and is then caught by the downstream quality gate — so we assert on a clearly
// over-fragmented take (~14% voiced) for the Stage-① floor.
test("rejects a mostly-silent over-fragmented capture with a specific reason", () => {
  const d = assessCapture(computeFeatures(synthInterruptedHum({ onSec: 0.2, offSec: 1.2 })));
  assert.equal(d.accepted, false);
  assert.ok(
    d.reasonCode === "too_choppy" || d.reasonCode === "not_voiced" || d.reasonCode === "too_quiet" || d.reasonCode === "too_noisy",
    `expected a fragment/voicing reason, got "${d.reasonCode}"`,
  );
});

// The accepted decision must carry no rejection reason; the contract the UI relies on.
test("an accepted hum carries an empty reasonCode and action", () => {
  const d = assessCapture(computeFeatures(synthHum()));
  assert.equal(d.accepted, true);
  assert.equal(d.reasonCode, "");
  assert.equal(d.action, "");
});
