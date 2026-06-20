import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  defaultAudioExperts,
  HumAcousticExpert,
  HumEmbeddingExpert,
  VocalBurstExpressionExpert,
  SpeechEmotionExpert,
  SpeechClinicalExpert,
} from "@hum-ai/expert-ser";

const features = (over: Partial<AcousticFeatures> = {}): AcousticFeatures =>
  ({
    featureMode: "hum-state-v2",
    sampleRate: 16000,
    rmsEnergy: 0.09,
    activeFrameRatio: 0.6,
    spectralCentroidHz: 900,
    clarityScore: 0.8,
    residualInstabilityScore: 0.1,
    vibratoRegularity: 0.6,
    smoothnessScore: 0.85,
    isSilent: false,
    ...over,
  }) as AcousticFeatures;

const meta = { modality: "audio" as const, captureQuality: 0.8 };

test("the audio stream is an ensemble of six conceptual experts", () => {
  assert.equal(defaultAudioExperts().length, 6);
});

test("an audio expert produces a normalized distribution and stays low-confidence", async () => {
  const out = await new HumAcousticExpert().predict(features(), meta);
  assert.equal(out.available, true);
  const total = Object.values(out.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(out.selfConfidence <= 0.35, "untrained stub must not be confident");
});

test("silent / zero-quality input yields a missing-modality output", async () => {
  const out = await new HumAcousticExpert().predict(features({ isSilent: true }), meta);
  assert.equal(out.available, false);
  const out2 = await new HumAcousticExpert().predict(features(), { modality: "audio", captureQuality: 0 });
  assert.equal(out2.available, false);
});

test("the clinical-speech expert is the most off-domain for a hum", async () => {
  const clinical = await new SpeechClinicalExpert().predict(features(), meta);
  const hum = await new HumAcousticExpert().predict(features(), meta);
  assert.ok(clinical.domainMatch < hum.domainMatch);
  assert.ok(clinical.domainMatch <= 0.4);
});

test("the hum-acoustic expert tilts toward low-energy/low-mood when energy is low", async () => {
  const lowEnergy = await new HumAcousticExpert().predict(
    features({ rmsEnergy: 0.005, activeFrameRatio: 0.25, clarityScore: 0.3, spectralCentroidHz: 400 }),
    meta,
  );
  const p = lowEnergy.probabilities;
  assert.ok((p.low_mood ?? 0) + (p.fatigued ?? 0) > (p.positive_activation ?? 0));
});

test("the previously-neutral experts now express real, non-uniform tilts from the hum", async () => {
  // A bright, energetic, clear hum vs a quiet, rough one — each expert should MOVE,
  // not return a flat neutral distribution.
  const lively = features({ rmsEnergy: 0.12, activeFrameRatio: 0.85, clarityScore: 0.85, spectralCentroidHz: 1600, pitchRangeSemitones: 6, spectralFlux: 0.2 });
  const flat = features({ rmsEnergy: 0.006, activeFrameRatio: 0.25, clarityScore: 0.25, residualInstabilityScore: 0.6, pitchRangeSemitones: 0.5, breathinessProxy: 0.6, jitter: 0.03 });

  for (const Expert of [HumEmbeddingExpert, VocalBurstExpressionExpert, SpeechEmotionExpert, SpeechClinicalExpert]) {
    const out = await new Expert().predict(lively, meta);
    const vals = Object.values(out.probabilities);
    const total = vals.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${Expert.name} distribution normalizes`);
    const uniform = 1 / vals.length;
    assert.ok(vals.some((v) => Math.abs(v - uniform) > 0.05), `${Expert.name} is not flat-neutral`);
    assert.ok(out.selfConfidence <= 0.35, `${Expert.name} stays low-confidence (untrained)`);
  }

  // HumEmbedding: a lively, clear hum leans toward activation, not low mood.
  const livelyEmb = await new HumEmbeddingExpert().predict(lively, meta);
  assert.ok((livelyEmb.probabilities.positive_activation ?? 0) > (livelyEmb.probabilities.low_mood ?? 0));
  // SpeechClinical: a flat, breathy, rough hum leans toward low-mood/fatigue/tension over neutral mass share.
  const flatClin = await new SpeechClinicalExpert().predict(flat, meta);
  const risk = (flatClin.probabilities.low_mood ?? 0) + (flatClin.probabilities.fatigued ?? 0) + (flatClin.probabilities.tense_anxious ?? 0);
  assert.ok(risk > (flatClin.probabilities.neutral_close_to_usual ?? 0), "risk-leaning labels exceed neutral on a flat/rough hum");
});
