import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures } from "@hum-ai/audio-features";
import { renderHum, makeLatent, latentToControls, type LatentHumProfile } from "@hum-ai/hum-sim";

/**
 * SYNTHESIS-CONTROL TESTS — assert the deterministic synthesizer and that the REAL
 * extractor recovers each latent control in the right direction. These are properties
 * of the synth + DSP (independent of any read-math fix), so they pin the simulator's
 * fairness: if a control stopped moving its feature, the whole reachability analysis
 * would be invalid.
 */

// Fast render: 8 s at 16 kHz keeps tests quick; recovery DIRECTIONS are sample-rate-robust.
const fast = (over: Partial<LatentHumProfile>): LatentHumProfile =>
  makeLatent({ durationSec: 8, sampleRate: 16000, ...over });

const feat = (over: Partial<LatentHumProfile>) => computeFeatures(renderHum(fast(over)));

test("synth is deterministic — same latent → byte-identical audio", () => {
  const a = renderHum(fast({ seed: 42 }));
  const b = renderHum(fast({ seed: 42 }));
  assert.equal(a.samples.length, b.samples.length);
  for (let i = 0; i < a.samples.length; i += 997) {
    assert.equal(a.samples[i], b.samples[i], `sample ${i} differs`);
  }
});

test("different seeds → different waveforms (noise + walks reseed)", () => {
  const a = renderHum(fast({ seed: 1 }));
  const b = renderHum(fast({ seed: 2 }));
  let diff = 0;
  for (let i = 0; i < a.samples.length; i += 101) if (a.samples[i] !== b.samples[i]) diff++;
  assert.ok(diff > 0, "expected different waveforms for different seeds");
});

test("latentToControls is a transparent monotone projection", () => {
  assert.ok(latentToControls(makeLatent({ pitchHeight: 0.9 })).f0Hz > latentToControls(makeLatent({ pitchHeight: 0.1 })).f0Hz);
  assert.ok(latentToControls(makeLatent({ energy: 0.9 })).targetRms > latentToControls(makeLatent({ energy: 0.1 })).targetRms);
  assert.ok(latentToControls(makeLatent({ brightness: 0.9 })).harmonicDecay < latentToControls(makeLatent({ brightness: 0.1 })).harmonicDecay);
});

test("extractor recovers ENERGY → meanRms (↑)", () => {
  assert.ok(feat({ energy: 0.85 }).meanRms > feat({ energy: 0.15 }).meanRms * 1.5);
});

test("extractor recovers PITCH HEIGHT → pitchMeanHz (↑)", () => {
  const lo = feat({ pitchHeight: 0.1 }).pitchMeanHz!;
  const hi = feat({ pitchHeight: 0.9 }).pitchMeanHz!;
  assert.ok(hi > lo + 50, `expected hi(${hi}) ≫ lo(${lo})`);
});

test("extractor recovers MELODIC MOVEMENT → pitchRangeSemitones (↑) — disproves H8 as an extractor bug", () => {
  const lo = feat({ melodicMovement: 0.0 }).pitchRangeSemitones!;
  const hi = feat({ melodicMovement: 1.0 }).pitchRangeSemitones!;
  assert.ok(lo < 1.5, `steady tone should have small range, got ${lo}`);
  assert.ok(hi > 4, `melodic hum should exceed 4 semitones, got ${hi}`);
});

test("extractor recovers BRIGHTNESS → spectralCentroidHz (↑, not inverted)", () => {
  const lo = feat({ brightness: 0.1 }).spectralCentroidHz;
  const hi = feat({ brightness: 0.95 }).spectralCentroidHz;
  assert.ok(hi > lo, `brightness must raise centroid (lo=${lo} hi=${hi})`);
});

test("extractor recovers PITCH INSTABILITY → jitter (↑) and lowers pitchStability", () => {
  const lo = feat({ pitchInstability: 0.0 });
  const hi = feat({ pitchInstability: 1.0 });
  assert.ok((hi.jitter ?? 0) > (lo.jitter ?? 0), "jitter should rise");
  assert.ok((hi.pitchStability ?? 1) <= (lo.pitchStability ?? 1) + 1e-6, "pitchStability should not rise");
});

test("extractor recovers AMPLITUDE INSTABILITY → shimmer (↑) and lowers amplitudeStability", () => {
  const lo = feat({ amplitudeInstability: 0.0 });
  const hi = feat({ amplitudeInstability: 1.0 });
  assert.ok(hi.shimmerProxy > lo.shimmerProxy, "shimmer should rise");
  assert.ok(hi.amplitudeStability < lo.amplitudeStability, "amplitudeStability should fall");
});

test("NOISE is a fidelity factor → lowers SNR proxy (↑ noise ⇒ ↓ SNR)", () => {
  const clean = feat({ noiseLevel: 0.0 }).signalToNoiseProxy;
  const noisy = feat({ noiseLevel: 0.9 }).signalToNoiseProxy;
  assert.ok(noisy < clean, `noise should lower SNR (clean=${clean} noisy=${noisy})`);
});
