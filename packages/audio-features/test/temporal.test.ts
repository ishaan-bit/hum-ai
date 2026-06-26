import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTemporalDynamics,
  computeFrameTrack,
  detectChangePoints,
  TEMPORAL_PARAMS,
  type AudioInput,
} from "../src/index";

/** Synthesize a mono tone with time-varying frequency + amplitude (no deps). */
function tone(
  sampleRate: number,
  seconds: number,
  freqAt: (t: number) => number,
  ampAt: (t: number) => number,
): AudioInput {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * freqAt(t)) / sampleRate;
    // a touch of harmonic content so the spectral track is meaningful
    out[i] = ampAt(t) * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
  }
  return { sampleRate, samples: out };
}

const SR = 16000;

test("computeFrameTrack aligns per-frame tracks and recovers a steady pitch", () => {
  const audio = tone(SR, 12, () => 180, () => 0.2);
  const tr = computeFrameTrack(audio);
  assert.ok(tr.frameCount > 100, "12 s @ 80 ms hops → ~150 frames");
  assert.equal(tr.energy.length, tr.frameCount);
  assert.equal(tr.f0Hz.length, tr.frameCount);
  assert.equal(tr.centroidHz.length, tr.frameCount);
  const voiced = tr.f0Hz.filter((v): v is number => v !== null);
  assert.ok(voiced.length > tr.frameCount * 0.6, "a clean tone is mostly voiced");
  const meanF0 = voiced.reduce((s, v) => s + v, 0) / voiced.length;
  assert.ok(Math.abs(meanF0 - 180) < 25, `tracked F0 ≈ 180 Hz (got ${meanF0.toFixed(0)})`);
});

test("a STEADY hum stays one chunk (no manufactured trajectory)", () => {
  const ta = analyzeTemporalDynamics(tone(SR, 12, () => 180, () => 0.2));
  assert.equal(ta.segmentCount, 1, "a flat tone has no change-point");
  assert.equal(ta.boundarySec.length, 0);
  assert.ok(ta.changePeak < TEMPORAL_PARAMS.splitGain, "best-split gain stays below threshold");
});

test("an ENERGY STEP is chunked with a boundary near the step", () => {
  // quiet first half, loud second half (step at 6 s).
  const audio = tone(SR, 12, () => 180, (t) => (t < 6 ? 0.05 : 0.2));
  const ta = analyzeTemporalDynamics(audio);
  assert.ok(ta.segmentCount >= 2, `energy step → ≥2 chunks (got ${ta.segmentCount})`);
  const nearMid = ta.boundarySec.some((b) => Math.abs(b - 6) <= 2.0);
  assert.ok(nearMid, `a boundary lands within 2 s of the 6 s step (got [${ta.boundarySec.map((b) => b.toFixed(1)).join(",")}])`);
  // the loud chunk's measured energy exceeds the quiet chunk's.
  const first = ta.segments[0]!.features.meanRms;
  const last = ta.segments[ta.segments.length - 1]!.features.meanRms;
  assert.ok(last > first, "the later chunk is louder");
});

test("a gradual PITCH RAMP is detected (binary segmentation, not a step detector)", () => {
  // f0 glides 140 → 240 Hz across the hum at constant loudness.
  const audio = tone(SR, 12, (t) => 140 + (100 * t) / 12, () => 0.18);
  const ta = analyzeTemporalDynamics(audio);
  assert.ok(ta.segmentCount >= 2, `a gradual ramp is chunked (got ${ta.segmentCount})`);
  const first = ta.segments[0]!.features.pitchMeanHz ?? 0;
  const last = ta.segments[ta.segments.length - 1]!.features.pitchMeanHz ?? 0;
  assert.ok(last - first > 25, `chunks track the rising pitch (Δ=${(last - first).toFixed(0)} Hz)`);
});

test("detectChangePoints respects the chunk cap and min length", () => {
  const tr = computeFrameTrack(tone(SR, 12, () => 180, (t) => 0.05 + 0.05 * Math.floor(t / 2)));
  const { boundaries } = detectChangePoints(tr, { maxSegments: 3 });
  assert.ok(boundaries.length <= 2, "≤ maxSegments-1 boundaries");
  const hop = tr.hopSec;
  const minFrames = Math.round(TEMPORAL_PARAMS.minSegmentSec / hop);
  const edges = [0, ...boundaries, tr.frameCount];
  for (let i = 1; i < edges.length; i++) {
    assert.ok((edges[i] as number) - (edges[i - 1] as number) >= minFrames, "every chunk meets the min length");
  }
});

test("degenerate (empty / silent) audio yields a single safe chunk, never throws", () => {
  const empty = analyzeTemporalDynamics({ sampleRate: SR, samples: new Float32Array(0) });
  assert.equal(empty.segmentCount, 0);
  const silent = analyzeTemporalDynamics({ sampleRate: SR, samples: new Float32Array(SR * 3) });
  assert.ok(silent.segmentCount <= 1, "pure silence is not fragmented");
});
