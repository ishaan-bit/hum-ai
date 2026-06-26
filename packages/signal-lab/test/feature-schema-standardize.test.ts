import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRobustStats, zDelta } from "@hum-ai/shared-types";
import { isTimbreFeature, type AcousticFeatures } from "@hum-ai/audio-features";
import {
  toFeatureVector,
  standardizeTimbre,
  featureVectorNames,
  NUMERIC_FEATURE_KEYS,
  TIMBRE_STANDARDIZE_WINSOR_Z,
  type FeatureBaseline,
} from "../src/feature-schema";

/** A complete, clean derived-feature fixture (a moderate, well-voiced hum). NOT real audio. */
const REFERENCE_HUM: AcousticFeatures = {
  featureMode: "hum-state-v2",
  sampleRate: 48000,
  durationSec: 12,
  inputRms: 0.06,
  meanRms: 0.06,
  medianRms: 0.06,
  rmsEnergy: 0.06,
  peakAmplitude: 0.45,
  activeFrameRatio: 0.7,
  quietFrameRatio: 0.2,
  clippedFrameRatio: 0,
  silenceRatio: 0.12,
  noiseFloorRms: 0.006,
  signalToNoiseProxy: 12,
  zeroCrossingRate: 0.05,
  pitchMeanHz: 175,
  pitchVariance: 6,
  pitchRangeSemitones: 2.5,
  pitchStability: 0.8,
  jitter: 0.012,
  pitchDrift: 0.06,
  pitchCoverage: 0.7,
  longestStableSegmentSec: 5,
  spectralCentroidHz: 1000,
  spectralBandwidthHz: 1200,
  spectralRolloffHz: 2200,
  spectralFlatness: 0.2,
  spectralFlux: 0.1,
  breakCount: 1,
  pauseCount: 1,
  avgPauseLengthSec: 0.2,
  microBreakRatio: 0.05,
  onsetDelaySec: 0.2,
  voicingContinuityCoverage: 0.82,
  clarityScore: 0.75,
  breathinessProxy: 0.2,
  shimmerProxy: 0.12,
  amplitudeStability: 0.78,
  smoothnessScore: 0.7,
  musicalityScore: 0.3,
  controlledExpressionScore: 0.65,
  residualInstabilityScore: 0.25,
  residualPitchInstability: 0.2,
  residualAmplitudeInstability: 0.2,
  vibratoRegularity: 0.6,
  attackConsistency: 0.6,
  isSilent: false,
  isTooFaint: false,
};

/** A within-person baseline whose timbre centers sit BELOW this hum's values (so z-deltas are positive). */
function baselineBelow(): FeatureBaseline {
  const b: FeatureBaseline = {};
  for (const k of NUMERIC_FEATURE_KEYS) {
    if (!isTimbreFeature(k)) continue;
    const v = (REFERENCE_HUM as unknown as Record<string, number>)[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      // 8 samples spread below the current value → median below it, finite spread.
      const samples = [v * 0.6, v * 0.65, v * 0.7, v * 0.72, v * 0.75, v * 0.78, v * 0.8, v * 0.85];
      b[k] = computeRobustStats(samples);
    }
  }
  return b;
}

test("toFeatureVector with NO baseline is byte-identical to the absolute vector (backward-compatible)", () => {
  const a = toFeatureVector(REFERENCE_HUM);
  const b = toFeatureVector(REFERENCE_HUM, undefined);
  assert.deepEqual(a, b);
  // The vector length never changes when a baseline is supplied (same model contract).
  assert.equal(toFeatureVector(REFERENCE_HUM, baselineBelow()).length, a.length);
  assert.equal(a.length, featureVectorNames().length);
});

test("a baseline standardizes ONLY timbre features (state/fidelity stay absolute)", () => {
  const baseline = baselineBelow();
  const abs = toFeatureVector(REFERENCE_HUM);
  const std = toFeatureVector(REFERENCE_HUM, baseline);
  const names = featureVectorNames();
  let timbreChanged = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    if (name.endsWith("__present")) continue;
    if (isTimbreFeature(name) && baseline[name]) {
      // Timbre features become their z-delta (this hum sits above its below-baseline → positive z).
      assert.notEqual(std[i], abs[i], `${name} (timbre) should be standardized`);
      timbreChanged++;
    } else {
      // Everything else is untouched.
      assert.equal(std[i], abs[i], `${name} (non-timbre) must stay absolute`);
    }
  }
  assert.ok(timbreChanged >= 5, "several timbre features should have been standardized");
});

test("standardizeTimbre emits the z-delta for a timbre feature and is winsorized against a degenerate baseline", () => {
  const stats = computeRobustStats([100, 101, 99, 100, 102, 98, 100, 101]);
  // meanRms is timbre → z-delta (a modest deviation stays within the winsor cap, so it equals zDelta);
  // pitchRangeSemitones is state → passthrough (never standardized).
  assert.ok(Math.abs(zDelta(102, stats)) < TIMBRE_STANDARDIZE_WINSOR_Z); // precondition: within the cap
  assert.equal(standardizeTimbre("meanRms", 102, { meanRms: stats }), zDelta(102, stats));
  assert.equal(standardizeTimbre("pitchRangeSemitones", 130, { pitchRangeSemitones: stats }), 130);

  // A near-constant (degenerate) baseline must not explode the read — winsorized to the cap.
  const degenerate = computeRobustStats([0.06, 0.06, 0.06, 0.06]);
  const z = standardizeTimbre("meanRms", 5, { meanRms: degenerate });
  assert.ok(Math.abs(z) <= TIMBRE_STANDARDIZE_WINSOR_Z + 1e-9, `winsorized, got ${z}`);
});

test("no baseline stat for a timbre feature ⇒ that feature falls back to absolute (no NaN)", () => {
  // Baseline present but missing meanRms → meanRms stays absolute, other timbre features standardize.
  const partial: FeatureBaseline = { pitchMeanHz: computeRobustStats([150, 155, 160, 152, 158, 151, 159, 153]) };
  assert.equal(standardizeTimbre("meanRms", 0.06, partial), 0.06);
  const v = toFeatureVector(REFERENCE_HUM, partial);
  assert.ok(v.every((x) => Number.isFinite(x)), "every column finite");
});
