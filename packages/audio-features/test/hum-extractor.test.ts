import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFeatures,
  humDspExtractor,
  DSP_PARAMS,
  synthHum,
  synthSilence,
  synthClippedHum,
  synthInterruptedHum,
  synthNoisyHum,
  synthSoftHum,
  type AcousticFeatures,
} from "@hum-ai/audio-features";

/** Every numeric field is finite (or null where nullable); ratios stay in [0,1]. */
function assertWellFormed(f: AcousticFeatures): void {
  const ratios: (keyof AcousticFeatures)[] = [
    "activeFrameRatio",
    "quietFrameRatio",
    "clippedFrameRatio",
    "silenceRatio",
    "microBreakRatio",
    "voicingContinuityCoverage",
    "clarityScore",
    "breathinessProxy",
    "shimmerProxy",
    "amplitudeStability",
    "musicalityScore",
    "controlledExpressionScore",
    "residualInstabilityScore",
    "residualPitchInstability",
    "residualAmplitudeInstability",
  ];
  for (const k of ratios) {
    const v = f[k] as number;
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${String(k)} must be a [0,1] number, got ${v}`);
  }
  const pc = f.pitchCoverage;
  assert.ok(pc === null || (Number.isFinite(pc) && pc >= 0 && pc <= 1));
  for (const [k, v] of Object.entries(f)) {
    if (v === null) continue;
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} is not finite: ${v}`);
  }
  assert.equal(f.featureMode, DSP_PARAMS.featureMode);
}

test("clean hum: well-formed, voiced, narrow-range, strong, high SNR", () => {
  const f = computeFeatures(synthHum());
  assertWellFormed(f);

  assert.ok(Math.abs(f.durationSec - 12) < 0.05);
  assert.equal(f.isSilent, false);
  assert.equal(f.isTooFaint, false);
  assert.ok(f.rmsEnergy > DSP_PARAMS.strongRms, "clean hum is a strong capture");
  assert.ok(f.peakAmplitude > 0 && f.peakAmplitude <= 1);
  assert.equal(f.clippedFrameRatio, 0, "a clean hum does not clip");
  assert.ok(f.activeFrameRatio > 0.7);
  assert.ok((f.pitchCoverage ?? 0) > 0.6, "a sustained hum is well-voiced");
  assert.ok(f.pitchMeanHz !== null && f.pitchMeanHz > 140 && f.pitchMeanHz < 185, `f0 ~160Hz, got ${f.pitchMeanHz}`);
  assert.ok(f.pitchRangeSemitones !== null && f.pitchRangeSemitones < 5, "narrow pitch range");
  assert.ok(f.signalToNoiseProxy > 5, "clean capture has high SNR proxy");
  assert.ok(f.spectralCentroidHz > 0);
  assert.ok((f.smoothnessScore ?? 0) > 0.5, "a clean hum is smooth");
});

test("extraction is deterministic (same seed → identical features)", () => {
  assert.deepEqual(computeFeatures(synthHum()), computeFeatures(synthHum()));
});

test("sample-rate-aware: 16 kHz and 48 kHz hums both track ~160 Hz", async () => {
  const lo = computeFeatures(synthHum({ sampleRate: 16000 }));
  const hi = computeFeatures(synthHum({ sampleRate: 48000 }));
  assert.equal(lo.sampleRate, 16000);
  assert.equal(hi.sampleRate, 48000);
  for (const f of [lo, hi]) {
    assert.ok(f.pitchMeanHz !== null && Math.abs(f.pitchMeanHz - 160) < 25);
    assert.ok((f.pitchCoverage ?? 0) > 0.5);
  }
  // The async class wrapper returns the same object as the sync core.
  const viaClass = await humDspExtractor.extract(synthHum());
  assert.deepEqual(viaClass, computeFeatures(synthHum()));
});

test("silence: flagged silent, unvoiced, no active frames", () => {
  const f = computeFeatures(synthSilence());
  assertWellFormed(f);
  assert.equal(f.isSilent, true);
  assert.ok(f.meanRms <= DSP_PARAMS.nearSilenceMeanRms);
  assert.equal(f.pitchMeanHz, null);
  assert.equal(f.pitchCoverage, 0);
  assert.equal(f.activeFrameRatio, 0);
});

test("clipped: high clipped-frame ratio and full-scale peak", () => {
  const f = computeFeatures(synthClippedHum());
  assertWellFormed(f);
  assert.ok(f.clippedFrameRatio > 0.08, `clipped ratio should exceed gate threshold, got ${f.clippedFrameRatio}`);
  assert.ok(f.peakAmplitude >= 0.99, "hard-clipped to full scale");
});

test("interrupted: high silence ratio, internal breaks, low voicing continuity", () => {
  const f = computeFeatures(synthInterruptedHum());
  assertWellFormed(f);
  assert.ok(f.silenceRatio > 0.72, `interrupted capture is mostly silent, got ${f.silenceRatio}`);
  assert.ok(f.breakCount > 0, "internal voiced→unvoiced breaks are counted");
  const clean = computeFeatures(synthHum());
  assert.ok(f.voicingContinuityCoverage < clean.voicingContinuityCoverage);
});

test("noisy hum: present but low SNR, elevated noise floor", () => {
  const f = computeFeatures(synthNoisyHum());
  assertWellFormed(f);
  assert.equal(f.isSilent, false);
  assert.ok(f.signalToNoiseProxy > 0 && f.signalToNoiseProxy < DSP_PARAMS.maxSnrProxy);
  const clean = computeFeatures(synthHum());
  assert.ok(f.signalToNoiseProxy < clean.signalToNoiseProxy, "noisy capture has lower SNR than clean");
  assert.ok(f.noiseFloorRms > clean.noiseFloorRms, "noisy capture has a higher noise floor");
});

test("soft hum: quiet but present and well-formed (not silent)", () => {
  const f = computeFeatures(synthSoftHum());
  assertWellFormed(f);
  assert.equal(f.isSilent, false);
  assert.ok(f.rmsEnergy < DSP_PARAMS.strongRms, "a soft hum is below the strong-capture level");
  assert.ok((f.pitchCoverage ?? 0) > 0.4, "still voiced enough to track pitch");
});

test("mono normalization removes a DC offset (energy reflects the AC signal)", () => {
  const base = synthHum();
  const samples = base.samples as Float32Array;
  const shifted = Float32Array.from(samples, (v) => v + 0.3); // add a large DC offset
  const a = computeFeatures(base);
  const b = computeFeatures({ sampleRate: base.sampleRate, samples: shifted });
  assert.ok(Math.abs(a.rmsEnergy - b.rmsEnergy) < 0.01, "DC offset must not inflate RMS energy");
  assert.ok(b.peakAmplitude <= 1.01);
});

test("non-finite input samples are sanitized, not allowed to poison the capture", () => {
  // A clean hum with a few stray NaN/Infinity samples must still read as a voiced,
  // non-silent capture — the bad samples become 0, they do not poison the whole buffer.
  const base = synthHum();
  const samples = Float32Array.from(base.samples as Float32Array);
  samples[1000] = NaN;
  samples[2000] = Infinity;
  samples[3000] = -Infinity;
  const f = computeFeatures({ sampleRate: base.sampleRate, samples });
  assertWellFormed(f);
  assert.equal(f.isSilent, false, "a few bad samples must not flag a clean hum as silent");
  assert.ok(f.pitchMeanHz !== null && f.pitchMeanHz > 140 && f.pitchMeanHz < 185);
  assert.ok(f.rmsEnergy > DSP_PARAMS.strongRms);

  // An entirely non-finite buffer collapses to silence — flags AGREE with the data.
  const allBad = computeFeatures({ sampleRate: 48000, samples: Float32Array.from({ length: 48000 }, () => Infinity) });
  assertWellFormed(allBad);
  assert.equal(allBad.isSilent, true);
  assert.equal(allBad.inputRms, 0);
  assert.equal(allBad.peakAmplitude, 0);
  assert.equal(allBad.pitchMeanHz, null);
});

test("degenerate inputs are handled safely", () => {
  const empty = computeFeatures({ sampleRate: 48000, samples: [] });
  assert.equal(empty.isSilent, true);
  assert.equal(empty.durationSec, 0);
  // A very short signal must not throw and must stay well-formed.
  const short = computeFeatures({ sampleRate: 48000, samples: new Float32Array(64) });
  assertWellFormed(short);
  // An invalid sample rate is a programming error and is rejected loudly.
  assert.throws(() => computeFeatures({ sampleRate: 0, samples: [0.1, -0.1] }));
});
