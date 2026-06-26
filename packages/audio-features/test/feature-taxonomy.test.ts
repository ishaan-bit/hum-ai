import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_KIND,
  TIMBRE_FEATURE_KEYS,
  STATE_FEATURE_KEYS,
  FIDELITY_FEATURE_KEYS,
  featureKind,
  isTimbreFeature,
} from "../src/feature-taxonomy";

test("the IDENTITY-bearing register cues are classified timbre (the v11 cross-person contract)", () => {
  // Pitch register, loudness, and brightness register are the speaker+mic identity cues that
  // must be standardized within-person, not read as mood at their absolute level.
  for (const k of ["pitchMeanHz", "meanRms", "medianRms", "rmsEnergy", "peakAmplitude", "spectralCentroidHz", "spectralRolloffHz"]) {
    assert.equal(featureKind(k), "timbre", `${k} should be timbre`);
    assert.ok(isTimbreFeature(k), `${k} should be a timbre feature`);
  }
});

test("within-hum dynamics are state — honest mood cues from the first hum (never standardized away)", () => {
  for (const k of ["pitchRangeSemitones", "spectralFlux", "amplitudeStability", "smoothnessScore", "vibratoRegularity", "residualInstabilityScore", "jitter"]) {
    assert.equal(featureKind(k), "state", `${k} should be state`);
    assert.ok(!isTimbreFeature(k), `${k} must NOT be standardized as identity`);
  }
});

test("mic/room artefacts are fidelity — never affect, never standardized", () => {
  for (const k of ["signalToNoiseProxy", "noiseFloorRms", "clarityScore", "spectralFlatness", "breathinessProxy"]) {
    assert.equal(featureKind(k), "fidelity", `${k} should be fidelity`);
    assert.ok(!isTimbreFeature(k));
  }
});

test("the three kinds are disjoint, non-empty, and an unknown feature defaults to state (used as-is)", () => {
  const timbre = new Set(TIMBRE_FEATURE_KEYS);
  const state = new Set(STATE_FEATURE_KEYS);
  const fidelity = new Set(FIDELITY_FEATURE_KEYS);
  assert.ok(timbre.size > 0 && state.size > 0 && fidelity.size > 0);
  for (const k of timbre) assert.ok(!state.has(k) && !fidelity.has(k), `${k} in two kinds`);
  for (const k of state) assert.ok(!fidelity.has(k), `${k} in two kinds`);
  // A name not in the schema is treated as state (used directly), never silently standardized.
  assert.equal(featureKind("some_future_feature"), "state");
  assert.ok(!isTimbreFeature("some_future_feature"));
});

test("every classified key maps to a valid kind (no typos in the table)", () => {
  for (const [k, kind] of Object.entries(FEATURE_KIND)) {
    assert.ok(["timbre", "state", "fidelity", "structural"].includes(kind), `${k} has invalid kind ${kind}`);
  }
});
