import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRavdessFilename, parseRavdessOrNull } from "@hum-ai/dataset-harness";

test("parses a canonical RAVDESS filename (audio-only, fearful, male actor 12)", () => {
  const r = parseRavdessFilename("03-01-06-01-02-01-12.wav");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.record.datasetId, "ravdess");
    assert.equal(r.record.modality, "audio_only");
    assert.equal(r.record.vocalChannel, "speech");
    assert.equal(r.record.emotion, "fearful");
    assert.equal(r.record.intensity, "normal"); // 4th field is 01 = normal
    assert.equal(r.record.statement, 2);
    assert.equal(r.record.repetition, 1);
    assert.equal(r.record.actor, 12);
    assert.equal(r.record.gender, "female"); // 12 is even
  }
});

test("maps all eight emotion codes to normalized labels", () => {
  const expected: Record<string, string> = {
    "01": "neutral",
    "02": "calm",
    "03": "happy",
    "04": "sad",
    "05": "angry",
    "06": "fearful",
    "07": "disgust",
    "08": "surprised",
  };
  for (const [code, label] of Object.entries(expected)) {
    const r = parseRavdessFilename(`03-01-${code}-01-01-01-01.wav`);
    assert.equal(r.ok, true, `code ${code} should parse`);
    if (r.ok) assert.equal(r.record.emotion, label);
  }
});

test("derives gender from actor parity (odd=male, even=female)", () => {
  const male = parseRavdessOrNull("03-01-01-01-01-01-01.wav");
  const female = parseRavdessOrNull("03-01-01-01-01-01-02.wav");
  assert.equal(male?.gender, "male");
  assert.equal(female?.gender, "female");
});

test("tolerates a path prefix and any audio extension", () => {
  assert.equal(parseRavdessOrNull("Actor_07/03-01-03-02-01-02-07.wav")?.actor, 7);
  assert.equal(parseRavdessOrNull("03-01-03-02-01-02-07.flac")?.emotion, "happy");
  assert.equal(parseRavdessOrNull("03-01-03-02-01-02-07")?.emotion, "happy");
});

test("rejects wrong field count", () => {
  const r = parseRavdessFilename("03-01-06-01-02.wav");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "bad_field_count");
});

test("rejects non-numeric fields", () => {
  const r = parseRavdessFilename("03-01-xx-01-02-01-12.wav");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "non_numeric_field");
});

test("rejects an unknown emotion code", () => {
  const r = parseRavdessFilename("03-01-09-01-02-01-12.wav");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unknown_emotion");
});

test("rejects an actor out of range", () => {
  const r = parseRavdessFilename("03-01-06-01-02-01-99.wav");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "actor_out_of_range");
});

test("rejects an empty name and returns null via parseRavdessOrNull", () => {
  const r = parseRavdessFilename("   .wav");
  assert.equal(r.ok, false);
  assert.equal(parseRavdessOrNull("not-a-ravdess-file.wav"), null);
});
