import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures, type AcousticFeatures, type AudioInput, type HumSegment, type TemporalAnalysis } from "@hum-ai/audio-features";
import { computeRangeStats } from "@hum-ai/shared-types";
import { validateUserFacingText } from "@hum-ai/safety-language";
import { computeTemporalRead } from "../src/temporal-read";

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
  return computeFeatures({ sampleRate, samples: out } as AudioInput);
}

const chunk = (base: AcousticFeatures, over: Partial<AcousticFeatures>): AcousticFeatures => ({ ...base, ...over });

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
    temporalMode: "hum-temporal-v2",
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

test("identical chunks → variation steady, every chunk opening/steady (no manufactured kind)", () => {
  const f = toneFeatures(0.12);
  const r = computeTemporalRead(makeTA([f, f, f]));
  assert.ok(r);
  assert.equal(r!.variationMode, "steady");
  assert.ok(r!.segments.every((s) => s.kind === "opening" || s.kind === "steady"));
  assert.equal(r!.rangeNote, "", "no range supplied ⇒ no range note");
  assert.ok(r!.segments.every((s) => s.energyInRange === null));
});

test("MUSICAL variation: melody + brightness move, feeling held → variationMode musical", () => {
  const base = toneFeatures(0.1);
  const r = computeTemporalRead(
    makeTA([
      chunk(base, { meanRms: 0.08, spectralCentroidHz: 1100, pitchRangeSemitones: 1, musicalityScore: 0.4, residualInstabilityScore: 0.3 }),
      chunk(base, { meanRms: 0.08, spectralCentroidHz: 1700, pitchRangeSemitones: 3.5, musicalityScore: 0.6, residualInstabilityScore: 0.3 }),
      chunk(base, { meanRms: 0.08, spectralCentroidHz: 2300, pitchRangeSemitones: 6, musicalityScore: 0.8, residualInstabilityScore: 0.3 }),
    ]),
  );
  assert.ok(r);
  assert.equal(r!.variationMode, "musical");
  assert.ok(r!.segments.some((s) => s.kind === "musical"), "at least one chunk reads as a musical difference");
  // The diagnostic contract: a MUSICAL difference must NOT move the inner-state read.
  assert.ok(Math.abs(r!.valenceArc) < 0.05, `musical wander leaves valence arc ≈ 0 (got ${r!.valenceArc.toFixed(3)})`);
  assert.ok(Math.abs(r!.arousalArc) < 0.05, `musical wander leaves arousal arc ≈ 0 (got ${r!.arousalArc.toFixed(3)})`);
  assert.equal(r!.shape, "steady", "a melodic-only wander reads steady, not a mood shift");
});

test("INNER-STATE shift: energy + steadiness move, melody held → variationMode inner_state", () => {
  const base = toneFeatures(0.1);
  const r = computeTemporalRead(
    makeTA([
      chunk(base, { meanRms: 0.03, residualInstabilityScore: 0.2, spectralCentroidHz: 1500, pitchRangeSemitones: 3, musicalityScore: 0.5, activeFrameRatio: 0.55 }),
      chunk(base, { meanRms: 0.06, residualInstabilityScore: 0.4, spectralCentroidHz: 1500, pitchRangeSemitones: 3, musicalityScore: 0.5, activeFrameRatio: 0.7 }),
      chunk(base, { meanRms: 0.11, residualInstabilityScore: 0.6, spectralCentroidHz: 1500, pitchRangeSemitones: 3, musicalityScore: 0.5, activeFrameRatio: 0.85 }),
    ]),
  );
  assert.ok(r);
  assert.equal(r!.variationMode, "inner_state");
  assert.ok(r!.segments.some((s) => s.kind === "state"), "at least one chunk reads as an inner-state shift");
});

test("a supplied vocal range places each chunk in the user's own span + adds a screened range note", () => {
  const base = toneFeatures(0.1);
  const range = { meanRms: computeRangeStats(Array.from({ length: 30 }, (_, i) => 0.02 + (0.12 * i) / 29)) };
  const r = computeTemporalRead(
    makeTA([chunk(base, { meanRms: 0.03 }), chunk(base, { meanRms: 0.12 })]),
    { range },
  );
  assert.ok(r);
  assert.ok(r!.segments[0]!.energyInRange !== null && r!.segments[0]!.energyInRange! < 0.3, "quiet chunk sits low in range");
  assert.ok(r!.segments[1]!.energyInRange !== null && r!.segments[1]!.energyInRange! > 0.7, "loud chunk sits high in range");
  assert.ok(r!.rangeNote.length > 0, "a range note is surfaced once the range is live");
  assert.equal(validateUserFacingText(r!.rangeNote).ok, true);
  assert.equal(validateUserFacingText(r!.variationNote).ok, true);
});
