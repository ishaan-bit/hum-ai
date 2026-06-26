import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures, type AcousticFeatures, type AudioInput, type HumSegment, type TemporalAnalysis } from "@hum-ai/audio-features";
import { validateUserFacingText } from "@hum-ai/safety-language";
import { computeTemporalRead } from "../src/temporal-read";

/**
 * Synthesize a realistic steady tone → real features via the production extractor.
 * Includes silent lead/tail pads + a faint noise floor so the noise-floor / SNR proxy
 * is healthy — a PURE tone has no quiet window, which collapses SNR and trips the read's
 * fidelity fade (the same realism the hum-sim synth provides).
 */
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
    out[i] = body + 0.0006 * rnd(); // faint, realistic noise floor everywhere
  }
  const audio: AudioInput = { sampleRate, samples: out };
  return computeFeatures(audio);
}

/** Wrap an ordered list of chunk features into a TemporalAnalysis. */
function makeTA(featuresList: readonly AcousticFeatures[]): TemporalAnalysis {
  const per = 12 / Math.max(1, featuresList.length);
  const segments: HumSegment[] = featuresList.map((features, i) => ({
    index: i,
    startFrame: Math.round((i * per) / 0.08),
    endFrame: Math.round(((i + 1) * per) / 0.08),
    startSec: i * per,
    endSec: (i + 1) * per,
    features,
  }));
  return {
    temporalMode: "hum-temporal-v1",
    durationSec: 12,
    hopSec: 0.08,
    segmentCount: segments.length,
    segments,
    boundarySec: segments.slice(1).map((s) => s.startSec),
    changeMean: 0,
    changePeak: 0,
    energyContour: [],
  };
}

test("null / empty analysis → null read (caller omits the layer)", () => {
  assert.equal(computeTemporalRead(null), null);
  assert.equal(computeTemporalRead(undefined), null);
  assert.equal(computeTemporalRead(makeTA([])), null);
});

test("NOT-SKEWED: identical chunks read steady with arc ≈ 0", () => {
  const f = toneFeatures(0.12);
  const r = computeTemporalRead(makeTA([f, f, f]));
  assert.ok(r);
  assert.equal(r!.shape, "steady");
  assert.ok(Math.abs(r!.valenceArc) < 1e-6, "no manufactured valence arc");
  assert.ok(Math.abs(r!.arousalArc) < 1e-6, "no manufactured arousal arc");
});

test("a single chunk reads steady (no chunk-to-chunk variation exists)", () => {
  const r = computeTemporalRead(makeTA([toneFeatures(0.1)]));
  assert.ok(r);
  assert.equal(r!.segmentCount, 1);
  assert.equal(r!.shape, "steady");
});

test("rising loudness across chunks reads as winding up / rising arousal", () => {
  const r = computeTemporalRead(makeTA([toneFeatures(0.03), toneFeatures(0.08), toneFeatures(0.16)]));
  assert.ok(r);
  assert.ok(r!.arousalArc > 0.08, `arousal climbs (got ${r!.arousalArc.toFixed(2)})`);
  assert.ok(r!.energyArc > 0.1, "energy climbs");
  assert.equal(r!.shape, "winding_up");
});

test("draining loudness across chunks reads as fading / settling with a negative energy arc", () => {
  const r = computeTemporalRead(makeTA([toneFeatures(0.16), toneFeatures(0.07), toneFeatures(0.025)]));
  assert.ok(r);
  assert.ok(r!.energyArc < -0.1, `energy drains (got ${r!.energyArc.toFixed(2)})`);
  assert.ok(r!.shape === "fading" || r!.shape === "settling", `shape=${r!.shape}`);
});

test("every surfaced trajectory string passes the safety screen", () => {
  for (const chunks of [
    [toneFeatures(0.12), toneFeatures(0.12)],
    [toneFeatures(0.03), toneFeatures(0.16)],
    [toneFeatures(0.16), toneFeatures(0.03)],
  ]) {
    const r = computeTemporalRead(makeTA(chunks));
    assert.ok(r);
    for (const s of [r!.headline, r!.detail]) {
      assert.equal(validateUserFacingText(s).ok, true, `unsafe copy: "${s}"`);
    }
  }
});
