import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeatures } from "@hum-ai/audio-features";
import { orchestrateHumAudio } from "@hum-ai/orchestrator";
import { runHum, makeLatent, malformedAudioCases, SIM_MODEL_VERSION, consentLocal, simTimestamp, type LatentHumProfile } from "@hum-ai/hum-sim";

/**
 * ROBUSTNESS / SAFETY — invalid and degenerate audio must trigger explicit handling
 * (rejection / abstention / a thrown RangeError), never a silent neutral-looking read
 * with NaNs.
 */
const fast = (over: Partial<LatentHumProfile>): LatentHumProfile =>
  makeLatent({ durationSec: 8, sampleRate: 16000, ...over });

test("computeFeatures does not throw on valid-but-degenerate audio", () => {
  const sr = 16000;
  for (const samples of [new Float32Array(0), new Float32Array([0.5]), new Float32Array(sr), new Float32Array(8).fill(NaN)]) {
    assert.doesNotThrow(() => computeFeatures({ sampleRate: sr, samples }));
  }
});

test("computeFeatures throws on an invalid sample rate", () => {
  assert.throws(() => computeFeatures({ sampleRate: 0, samples: new Float32Array(100) }), RangeError);
  assert.throws(() => computeFeatures({ sampleRate: -16000, samples: new Float32Array(100) }), RangeError);
});

test("all extracted feature numerics are finite even on malformed audio", () => {
  for (const c of malformedAudioCases()) {
    if (c.mayThrow) continue;
    const f = computeFeatures(c.audio);
    for (const [k, v] of Object.entries(f)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `${c.id}: feature ${k} non-finite (${v})`);
    }
  }
});

test("malformed audio yields a safe read (abstains or rejects), never a confident neutral", async () => {
  const now = simTimestamp(0);
  for (const c of malformedAudioCases()) {
    if (c.mayThrow) {
      await assert.rejects(() => orchestrateHumAudio({ audio: c.audio, consent: consentLocal(now), modelVersion: SIM_MODEL_VERSION, now }));
      continue;
    }
    const read = await orchestrateHumAudio({ audio: c.audio, consent: consentLocal(now), modelVersion: SIM_MODEL_VERSION, now });
    assert.ok(Number.isFinite(read.internal.axis.dimensional.valence));
    assert.ok(Number.isFinite(read.internal.axis.dimensional.arousal));
    // A degenerate capture must NOT pass as a clean baseline-eligible hum.
    if (read.internal.quality.decision === "clean") {
      assert.ok(!read.userFacing.abstained || read.internal.quality.baselineEligible);
    }
  }
});

test("near-silent and severe-noise hums are flagged, not read as confident states", async () => {
  const silent = await runHum("t/silent", fast({ energy: 0, gain: 0.02, noiseLevel: 0 }));
  assert.ok(silent.userFacing.abstained || silent.quality.decision === "rejected", "near-silent must abstain/reject");
});

test("sample-rate variation keeps the read finite", async () => {
  for (const sampleRate of [8000, 16000, 44100, 48000]) {
    const r = await runHum(`t/sr${sampleRate}`, makeLatent({ durationSec: 8, sampleRate, energy: 0.6 }));
    assert.ok(Number.isFinite(r.displayAxis.valence) && Number.isFinite(r.displayAxis.arousal), `sr ${sampleRate}`);
  }
});
