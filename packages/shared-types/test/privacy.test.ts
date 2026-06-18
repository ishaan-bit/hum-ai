import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNoRawAudioFields,
  findRawAudioFields,
  isRawAudioFieldName,
  RawAudioFieldError,
  hasConsent,
  defaultConsent,
  asIsoTimestamp,
} from "@hum-ai/shared-types";

const now = asIsoTimestamp("2026-06-18T00:00:00.000Z");

test("exact forbidden field names are blocked", () => {
  for (const f of ["audio", "audioBlob", "rawAudio", "recording", "waveformRaw", "microphoneData"]) {
    assert.equal(isRawAudioFieldName(f), true, `${f} should be blocked`);
  }
});

test("substring token matcher catches variants", () => {
  assert.equal(isRawAudioFieldName("audioChunk"), true);
  assert.equal(isRawAudioFieldName("rawWaveformBuffer"), true);
  assert.equal(isRawAudioFieldName("micBlob"), true);
});

test("derived feature names are allowed", () => {
  for (const f of ["clarity", "pitchCenterHz", "signalConfidence", "qualityDecision", "valence"]) {
    assert.equal(isRawAudioFieldName(f), false, `${f} should be allowed`);
  }
});

test("assertNoRawAudioFields throws on a forbidden top-level field", () => {
  assert.throws(() => assertNoRawAudioFields({ humId: "h1", audioBlob: "..." }), RawAudioFieldError);
});

test("assertNoRawAudioFields throws on nested forbidden fields and lists all offenders", () => {
  const payload = { humId: "h1", meta: { device: "x", recording: "..." }, frames: [{ rawAudio: 1 }] };
  const offenders = findRawAudioFields(payload);
  assert.deepEqual(offenders.sort(), ["rawAudio", "recording"]);
  assert.throws(() => assertNoRawAudioFields(payload), RawAudioFieldError);
});

test("a clean derived payload passes the guard", () => {
  const derived = {
    humId: "h1",
    qualityDecision: "clean",
    signalConfidence: 0.7,
    pitchCenterHz: 180,
    clarity: 0.8,
    valence: 0.2,
    arousal: -0.1,
  };
  assert.doesNotThrow(() => assertNoRawAudioFields(derived));
});

test("consent defaults to local processing only", () => {
  const c = defaultConsent(now);
  assert.equal(hasConsent(c, "local_processing"), true);
  assert.equal(hasConsent(c, "derived_feature_sync"), false);
  assert.equal(hasConsent(c, "research_audio_upload"), false);
  assert.equal(hasConsent(c, "clinical_label_capture"), false);
});
