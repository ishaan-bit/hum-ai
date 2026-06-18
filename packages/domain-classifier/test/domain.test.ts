import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { HeuristicDomainClassifier, HumDomainAdapter } from "@hum-ai/domain-classifier";

// Full AcousticFeatures fixture with neutral defaults; override per test.
const feat = (over: Partial<AcousticFeatures> = {}): AcousticFeatures => ({
  featureMode: "hum-state-v2",
  sampleRate: 16000,
  durationSec: 12,
  inputRms: 0.08,
  meanRms: 0.08,
  medianRms: 0.08,
  rmsEnergy: 0.09,
  peakAmplitude: 0.6,
  activeFrameRatio: 0.6,
  quietFrameRatio: 0.3,
  clippedFrameRatio: 0,
  silenceRatio: 0.2,
  noiseFloorRms: 0.01,
  signalToNoiseProxy: 8,
  zeroCrossingRate: 0.05,
  pitchMeanHz: 180,
  pitchVariance: 4,
  pitchRangeSemitones: 2,
  pitchStability: 0.9,
  jitter: 0.02,
  pitchDrift: 0,
  pitchCoverage: 0.8,
  longestStableSegmentSec: 6,
  spectralCentroidHz: 800,
  spectralBandwidthHz: 1000,
  spectralRolloffHz: 1800,
  spectralFlatness: 0.1,
  spectralFlux: 0.05,
  breakCount: 0,
  pauseCount: 0,
  avgPauseLengthSec: 0,
  microBreakRatio: 0,
  onsetDelaySec: 0.1,
  voicingContinuityCoverage: 0.9,
  clarityScore: 0.8,
  breathinessProxy: 0.1,
  shimmerProxy: 0.05,
  amplitudeStability: 0.9,
  smoothnessScore: 0.85,
  musicalityScore: 0.2,
  controlledExpressionScore: 0.8,
  residualInstabilityScore: 0.1,
  residualPitchInstability: 0.1,
  residualAmplitudeInstability: 0.1,
  vibratoRegularity: 0.5,
  attackConsistency: 0.7,
  isSilent: false,
  isTooFaint: false,
  ...over,
});

// A properly music-like capture: unvoiced, wide/undefined pitch range,
// broadband + high spectral flux, low sustained voicing.
const musicLike = (): AcousticFeatures =>
  feat({
    pitchCoverage: 0.1,
    pitchRangeSemitones: null,
    smoothnessScore: 0.2,
    voicingContinuityCoverage: 0.2,
    musicalityScore: 0.3,
    spectralFlux: 0.9,
    spectralBandwidthHz: 3500,
  });

const clf = new HeuristicDomainClassifier();
const adapter = new HumDomainAdapter();

test("a sustained, narrow-range, smooth vocalization classifies as hum", () => {
  const r = clf.classify(feat());
  assert.equal(r.predicted, "hum");
});

test("silence and broadband-music captures are not classified as hum", () => {
  assert.equal(clf.classify(feat({ isSilent: true, meanRms: 0.001 })).predicted, "silence");
  const music = clf.classify(musicLike());
  assert.notEqual(music.predicted, "hum");
});

test("adaptPrior penalty increases with domain gap (native_hum > singing > clinical_speech)", () => {
  const hum = adapter.adaptPrior("native_hum");
  const singing = adapter.adaptPrior("singing_or_sustained_phonation");
  const clinical = adapter.adaptPrior("clinical_speech");
  const music = adapter.adaptPrior("music_emotion");

  assert.equal(hum.confidencePenalty, 1.0);
  assert.ok(singing.confidencePenalty < hum.confidencePenalty);
  assert.ok(clinical.confidencePenalty < singing.confidencePenalty);
  assert.equal(clinical.gap, "far");
  assert.ok(music.confidencePenalty <= clinical.confidencePenalty);
});

test("scoreCapture: a hum capture matches; a speech/music capture is penalised", () => {
  const humMatch = adapter.scoreCapture(clf.classify(feat()));
  const musicMatch = adapter.scoreCapture(clf.classify(musicLike()));
  assert.ok(humMatch.domainMatch > 0.7);
  assert.ok(humMatch.confidencePenalty > musicMatch.confidencePenalty);
});

test("low classifier confidence lowers the domain match (mismatch reduces confidence)", () => {
  const sure = adapter.scoreCapture({ predicted: "hum", probabilities: {} as never, confidence: 1 });
  const unsure = adapter.scoreCapture({ predicted: "hum", probabilities: {} as never, confidence: 0.2 });
  assert.ok(sure.domainMatch > unsure.domainMatch);
});
