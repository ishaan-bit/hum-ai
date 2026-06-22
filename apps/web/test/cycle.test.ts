/**
 * PER-HUM CYCLE GUARANTEES (Stable Build v3, Part B — governance at the app seam).
 *
 * `runHumCycle` is the deployed per-hum loop. Two invariants matter most for honesty +
 * privacy and are asserted here against the REAL cycle (run by tsx; outside both tsconfig
 * include sets — see render-safety.test.ts):
 *   1. A REJECTED capture (Stage ①) is never read for affect, never advances the baseline,
 *      and produces no sync payload.
 *   2. An ACCEPTED capture advances the ladder and yields a derived-only, guard-checked
 *      sync payload (no raw audio, no clinical-risk label).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asModelVersion, asUserId, defaultConsent, asIsoTimestamp, findRawAudioFields } from "@hum-ai/shared-types";
import { synthHum, synthSilence } from "@hum-ai/audio-features";
import { assertNoClinicalLeak } from "@hum-ai/affect-model-contracts";
import { newPersonalizationState } from "@hum-ai/personalization-engine";
import { runHumCycle } from "../src/app/cycle";

const now = asIsoTimestamp("2026-06-21T12:00:00.000Z");
const modelVersion = asModelVersion("cycle-test-v1");
const consent = defaultConsent(now);

function freshState() {
  return newPersonalizationState(asUserId("cycle-test"), now, modelVersion);
}

test("a REJECTED capture never advances the baseline and produces no sync payload", async () => {
  const state = freshState();
  const result = await runHumCycle({
    audio: synthSilence({ seed: 1 }),
    state,
    consent,
    modelVersion,
    prior: null,
  });
  assert.equal(result.accepted, false);
  if (result.accepted === false) {
    // State is returned UNCHANGED — a non-hum never advances the ladder…
    assert.equal(result.nextState, state, "rejected capture must return the same state object (no advance)");
    assert.equal(result.nextState.eligibleHumCount, state.eligibleHumCount);
    // …and there is NO sync payload on the rejected branch (nothing leaves the device).
    assert.equal("syncPayload" in result, false, "a rejected capture must not produce a sync payload");
  }
});

test("an ACCEPTED capture yields a derived-only, guard-clean sync payload (no raw audio, no clinical leak)", async () => {
  const state = freshState();
  const result = await runHumCycle({
    audio: synthHum({ seed: 2, f0: 160 }),
    state,
    consent,
    modelVersion,
    prior: null,
  });
  assert.equal(result.accepted, true);
  if (result.accepted === true) {
    // The sync payload carries derived features + abstracted summaries only.
    assert.deepEqual(findRawAudioFields(result.syncPayload), [], "sync payload must carry no raw-audio-like field");
    assert.doesNotThrow(() => assertNoClinicalLeak(result.syncPayload), "sync payload must carry no clinical label");
    // No raw-audio field anywhere in the full read object either.
    assert.deepEqual(findRawAudioFields(result.read), []);
    // The read is live and the user-facing surface is clinical-leak-free.
    assert.doesNotThrow(() => assertNoClinicalLeak(result.read.userFacing));
  }
});
