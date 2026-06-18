import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  defaultAudioExperts,
  HumAcousticExpert,
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
