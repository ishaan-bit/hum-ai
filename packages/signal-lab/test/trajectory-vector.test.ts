import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures, type AcousticFeatures, type AudioInput } from "@hum-ai/audio-features";
import { computeRangeStats } from "@hum-ai/shared-types";
import {
  toTrajectoryVector,
  trajectoryVectorLength,
  trajectoryVectorNames,
  rangeStandardize,
  type FeatureRange,
} from "../src/feature-schema";

function toneFeatures(amp: number, freq = 180): AcousticFeatures {
  const sampleRate = 16000;
  const n = sampleRate * 4;
  const lead = Math.round(0.4 * sampleRate);
  const tail = Math.round(0.3 * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * freq) / sampleRate;
    const voiced = i >= lead && i < n - tail;
    const body = voiced ? amp * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) : 0;
    out[i] = body + 0.0006 * rnd();
  }
  const audio: AudioInput = { sampleRate, samples: out };
  return computeFeatures(audio);
}

test("toTrajectoryVector is fixed-length and names line up", () => {
  const v = toTrajectoryVector([toneFeatures(0.1), toneFeatures(0.12)]);
  assert.equal(v.length, trajectoryVectorLength());
  assert.equal(trajectoryVectorNames().length, trajectoryVectorLength());
});

test("a single chunk or identical chunks yield the zero trajectory (no manufactured movement)", () => {
  const f = toneFeatures(0.1);
  const single = toTrajectoryVector([f]);
  assert.ok(single.every((x) => x === 0), "one chunk → all zeros");
  const identical = toTrajectoryVector([f, f, f]);
  // chunkCountNorm (index 0) is non-zero for 3 chunks; the per-feature summaries must be zero.
  assert.ok(identical.slice(1).every((x) => Math.abs(x) < 1e-9), "identical chunks → zero per-feature movement");
});

test("a rising-loudness chunk sequence yields a positive within-hum meanRms arc", () => {
  const names = trajectoryVectorNames();
  const v = toTrajectoryVector([toneFeatures(0.03), toneFeatures(0.08), toneFeatures(0.16)]);
  const arcIdx = names.indexOf("meanRms__arc");
  const rangeIdx = names.indexOf("meanRms__range");
  assert.ok(arcIdx > 0 && v[arcIdx]! > 0.5, `rising loudness → positive arc (got ${v[arcIdx]})`);
  assert.ok(v[rangeIdx]! > 0.5, "the within-hum range column is non-trivial");
});

test("rangeStandardize centres an identity feature in the user's own range, passes others through", () => {
  const range: FeatureRange = { meanRms: computeRangeStats(Array.from({ length: 30 }, (_, i) => 0.02 + (0.12 * i) / 29)) };
  // meanRms is a timbre/identity feature → range-standardized to [-1,1].
  assert.ok(rangeStandardize("meanRms", 0.02, range) < -0.6, "bottom of range → near −1");
  assert.ok(rangeStandardize("meanRms", 0.14, range) > 0.6, "top of range → near +1");
  // a state feature (already relative) is returned unchanged.
  assert.equal(rangeStandardize("spectralFlux", 0.42, range), 0.42);
  // no range for the feature ⇒ unchanged.
  assert.equal(rangeStandardize("pitchMeanHz", 165, range), 165);
});
