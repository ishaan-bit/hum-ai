import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilPow2, isPowerOfTwo, magnitudeSpectrum } from "@hum-ai/audio-features";

test("isPowerOfTwo / ceilPow2 basics", () => {
  assert.equal(isPowerOfTwo(1), true);
  assert.equal(isPowerOfTwo(1024), true);
  assert.equal(isPowerOfTwo(1000), false);
  assert.equal(ceilPow2(1000), 1024);
  assert.equal(ceilPow2(1024), 1024);
  assert.equal(ceilPow2(1), 1);
});

test("magnitudeSpectrum of a pure sinusoid peaks at the right bin", () => {
  const N = 1024;
  const sr = 16000;
  const binHz = sr / N;
  const targetBin = 64; // 64 * 15.625 Hz = 1000 Hz
  const freq = targetBin * binHz;
  const frame = new Float64Array(N);
  for (let i = 0; i < N; i++) frame[i] = Math.sin((2 * Math.PI * freq * i) / sr);

  const mags = magnitudeSpectrum(frame);
  assert.equal(mags.length, N / 2 + 1);

  let peakBin = 0;
  let peak = -1;
  for (let k = 0; k < mags.length; k++) {
    const m = mags[k] as number;
    if (m > peak) {
      peak = m;
      peakBin = k;
    }
  }
  assert.equal(peakBin, targetBin, "spectral peak lands on the synthesized bin");
});

test("magnitudeSpectrum zero-pads non-power-of-two frames without throwing", () => {
  const frame = new Float64Array(1000).map((_, i) => Math.sin(i));
  const mags = magnitudeSpectrum(frame);
  // padded up to 1024 → 513 one-sided bins.
  assert.equal(mags.length, 1024 / 2 + 1);
  for (const m of mags) assert.ok(Number.isFinite(m));
});

test("DC signal has all spectral energy in bin 0", () => {
  const frame = new Float64Array(256).fill(0.5);
  const mags = magnitudeSpectrum(frame);
  let rest = 0;
  for (let k = 1; k < mags.length; k++) rest += mags[k] as number;
  assert.ok((mags[0] as number) > 0);
  assert.ok(rest < 1e-6, "no AC energy in a constant signal");
});
