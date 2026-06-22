import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import { computeFeatures, type AudioInput, type AcousticFeatures } from "@hum-ai/audio-features";
import { buildGad7Response, buildPhq9Response, type ClinicalHumExample } from "@hum-ai/affect-model-contracts";
import {
  appendClinicalExample,
  clinicalCorpusStats,
  dropParticipant,
  emptyClinicalCorpus,
  parseClinicalCorpus,
} from "../src/corpus";

function humFeatures(freq = 180): AcousticFeatures {
  const sampleRate = 16000;
  const n = sampleRate * 12;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  const input: AudioInput = { sampleRate, samples };
  return computeFeatures(input);
}

const NOW = asIsoTimestamp("2026-06-22T10:00:00.000Z");

function ex(over: Partial<ClinicalHumExample> = {}): ClinicalHumExample {
  return {
    id: "c-1",
    participantPseudonym: "p-1",
    studyId: "study-1",
    capturedAt: NOW,
    features: humFeatures(),
    phq: buildPhq9Response([1, 1, 1, 1, 1, 1, 1, 1, 0], NOW), // total 8 → negative
    gad: buildGad7Response([1, 1, 1, 1, 1, 1, 1], NOW), // total 7 → negative
    captureQualityScore: 0.8,
    eligible: true,
    deviceClass: "ios_safari",
    featureSchemaVersion: "hum-acoustic-v2",
    ...over,
  };
}

test("append validates, replaces by id, and round-trips through JSON", () => {
  let c = emptyClinicalCorpus();
  c = appendClinicalExample(c, ex({ id: "a" }));
  c = appendClinicalExample(c, ex({ id: "b", participantPseudonym: "p-2" }));
  c = appendClinicalExample(c, ex({ id: "a", captureQualityScore: 0.9 })); // replace, not duplicate
  assert.equal(c.examples.length, 2);
  const round = parseClinicalCorpus(JSON.stringify(c));
  assert.equal(round.examples.length, 2);
});

test("parse drops a single malformed row but keeps the valid ones", () => {
  const good = ex({ id: "good" });
  const bad = { ...ex({ id: "bad" }), audioBlob: [1, 2, 3] };
  const json = JSON.stringify({ version: "clinical-corpus-v1", examples: [good, bad] });
  const parsed = parseClinicalCorpus(json);
  assert.equal(parsed.examples.length, 1);
  assert.equal(parsed.examples[0]?.id, "good");
});

test("stats report screening class balance, participants, device coverage, and item-9 endorsement", () => {
  let c = emptyClinicalCorpus();
  // p-1: depression positive (PHQ total 12), item 9 endorsed
  c = appendClinicalExample(c, ex({ id: "1", participantPseudonym: "p-1", phq: buildPhq9Response([2, 2, 2, 1, 1, 1, 1, 1, 1], NOW), deviceClass: "ios_safari" }));
  // p-2: depression negative (PHQ total 4)
  c = appendClinicalExample(c, ex({ id: "2", participantPseudonym: "p-2", phq: buildPhq9Response([1, 1, 1, 1, 0, 0, 0, 0, 0], NOW), deviceClass: "android_chrome" }));
  // p-2 second capture, not eligible → excluded from coverage/balance
  c = appendClinicalExample(c, ex({ id: "3", participantPseudonym: "p-2", eligible: false }));

  const stats = clinicalCorpusStats(c);
  assert.equal(stats.total, 3);
  assert.equal(stats.eligible, 2);
  assert.equal(stats.participants, 2);
  assert.equal(stats.depression.positive, 1);
  assert.equal(stats.depression.negative, 1);
  assert.equal(stats.depression.prevalence, 0.5);
  assert.equal(stats.deviceCoverage["ios_safari"], 1);
  assert.equal(stats.deviceCoverage["android_chrome"], 1);
  assert.equal(stats.item9Endorsed, 1);
});

test("dropParticipant removes every row for a withdrawn participant", () => {
  let c = emptyClinicalCorpus();
  c = appendClinicalExample(c, ex({ id: "1", participantPseudonym: "p-1" }));
  c = appendClinicalExample(c, ex({ id: "2", participantPseudonym: "p-2" }));
  c = dropParticipant(c, "p-1");
  assert.equal(c.examples.length, 1);
  assert.equal(c.examples[0]?.participantPseudonym, "p-2");
});
