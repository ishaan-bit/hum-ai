import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_CLASSES } from "@hum-ai/shared-types";
import {
  computeFeatures,
  synthHum,
  synthSilence,
  synthClippedHum,
  synthInterruptedHum,
  synthNoisyHum,
  synthSpeechLike,
  synthMusicLike,
} from "@hum-ai/audio-features";
import { HeuristicDomainClassifier, HumDomainAdapter } from "@hum-ai/domain-classifier";

const clf = new HeuristicDomainClassifier();
const adapter = new HumDomainAdapter();
const classify = (audio: ReturnType<typeof synthHum>) => clf.classify(computeFeatures(audio));

test("a clean synthetic hum is classified as hum with real confidence", () => {
  const r = classify(synthHum());
  assert.equal(r.predicted, "hum");
  assert.ok(r.confidence > 0.4);
  // probabilities form a valid distribution over the domain classes.
  let sum = 0;
  for (const c of DOMAIN_CLASSES) {
    const p = r.probabilities[c];
    assert.ok(p >= 0 && p <= 1);
    sum += p;
  }
  assert.ok(Math.abs(sum - 1) < 1e-6);
});

test("near silence is classified as silence", () => {
  assert.equal(classify(synthSilence()).predicted, "silence");
});

test("a clipped hum stays a hum-domain capture (clipping is a quality issue, not a domain)", () => {
  const r = classify(synthClippedHum());
  assert.ok(DOMAIN_CLASSES.includes(r.predicted));
  assert.notEqual(r.predicted, "silence");
  assert.notEqual(r.predicted, "invalid");
});

test("an interrupted hum is handled and reads with lower confidence than a clean one", () => {
  const interrupted = classify(synthInterruptedHum());
  const clean = classify(synthHum());
  assert.ok(DOMAIN_CLASSES.includes(interrupted.predicted));
  assert.ok(interrupted.confidence < clean.confidence);
});

test("a speech-like capture is NOT classified as a hum", () => {
  const r = classify(synthSpeechLike());
  assert.notEqual(r.predicted, "hum");
  // it is recognised as a voiced, non-hum signal (speech or singing — the v1
  // heuristic does not separate those, and both are correctly off-domain).
  assert.ok(["speech", "singing", "noisy_unknown"].includes(r.predicted));
});

test("a music-like capture is NOT classified as a hum", () => {
  const r = classify(synthMusicLike());
  assert.notEqual(r.predicted, "hum");
  assert.ok(["music", "noisy_unknown", "speech"].includes(r.predicted));
});

test("ambiguous captures report lower confidence than a clean hum (honest confidence)", () => {
  const clean = classify(synthHum());
  const music = classify(synthMusicLike());
  const speech = classify(synthSpeechLike());
  assert.ok(music.confidence < clean.confidence);
  assert.ok(speech.confidence < clean.confidence);
});

test("HumDomainAdapter: a real hum capture matches; a real music capture is penalised", () => {
  const humMatch = adapter.scoreCapture(classify(synthHum()));
  const musicMatch = adapter.scoreCapture(classify(synthMusicLike()));
  assert.ok(humMatch.domainMatch > 0.6);
  assert.ok(humMatch.confidencePenalty > musicMatch.confidencePenalty, "off-domain capture is down-weighted");
});

test("a noisy hum is still recognised as voiced (hum or noisy_unknown), never silence", () => {
  const r = classify(synthNoisyHum());
  assert.ok(["hum", "noisy_unknown", "singing"].includes(r.predicted));
  assert.notEqual(r.predicted, "silence");
});
