import { test } from "node:test";
import assert from "node:assert/strict";
import { acousticAffectAxes } from "@hum-ai/orchestrator";
import { cleanHumFeatures } from "./fixtures";

/**
 * v11 TRAIT-DECOUPLING — the FIRST-hum cross-person contract. Two people who FEEL THE SAME but
 * have different natural voices (a heavier/huskier low+dark voice vs a brighter high voice) must
 * read ALIKE on the cold read: voice identity is not mood. The full separation is only earned once
 * a personal baseline forms (the within-user display re-reference + models retrained on within-
 * person deviations); on the first hum the residual cross-voice spread must stay bounded.
 */

/** A fixed, neutral mood expressed through the STATE cues (identical across voices). */
const NEUTRAL_MOOD = {
  meanRms: 0.05, medianRms: 0.05, rmsEnergy: 0.05, activeFrameRatio: 0.7, spectralFlux: 0.1,
  pitchRangeSemitones: 2.5, smoothnessScore: 0.7, amplitudeStability: 0.78, pitchStability: 0.8,
  residualInstabilityScore: 0.25, vibratoRegularity: 0.6, signalToNoiseProxy: 12,
} as const;

test("cross-voice: a husky low voice and a bright high voice feeling the same read alike (cold)", () => {
  const husky = acousticAffectAxes(cleanHumFeatures({ ...NEUTRAL_MOOD, pitchMeanHz: 110, spectralCentroidHz: 650 }));
  const bright = acousticAffectAxes(cleanHumFeatures({ ...NEUTRAL_MOOD, pitchMeanHz: 245, spectralCentroidHz: 1650 }));

  // The surfaced reads must sit close — voice identity does not pin a mood pole on the first hum.
  assert.ok(Math.abs(husky.valence - bright.valence) <= 0.45, `cross-voice valence gap ${Math.abs(husky.valence - bright.valence).toFixed(2)} must be ≤ 0.45`);
  assert.ok(Math.abs(husky.arousal - bright.arousal) <= 0.3, `cross-voice arousal gap ${Math.abs(husky.arousal - bright.arousal).toFixed(2)} must be ≤ 0.3`);
});

test("cross-voice: neither extreme voice is pinned to a strong pole purely by its timbre", () => {
  for (const [pitch, centroid] of [[110, 650], [245, 1650]] as const) {
    const r = acousticAffectAxes(cleanHumFeatures({ ...NEUTRAL_MOOD, pitchMeanHz: pitch, spectralCentroidHz: centroid }));
    // A neutral mood on any voice must not read as a strong emotional pole from identity alone.
    assert.ok(Math.abs(r.valence) < 0.5, `voice ${pitch}Hz neutral-mood valence ${r.valence.toFixed(2)} too extreme`);
    assert.ok(Math.abs(r.arousal) < 0.5, `voice ${pitch}Hz neutral-mood arousal ${r.arousal.toFixed(2)} too extreme`);
  }
});

test("cross-voice: the read STILL responds to mood within a fixed voice (decoupling did not go dead)", () => {
  // Same voice, two genuinely different moods (the STATE cues move) — the read must separate.
  const voice = { pitchMeanHz: 150, spectralCentroidHz: 900 } as const;
  const lively = acousticAffectAxes(cleanHumFeatures({
    ...voice, meanRms: 0.12, rmsEnergy: 0.12, activeFrameRatio: 0.95, spectralFlux: 0.22,
    pitchRangeSemitones: 5.5, smoothnessScore: 0.85, amplitudeStability: 0.9, residualInstabilityScore: 0.1,
  }));
  const flat = acousticAffectAxes(cleanHumFeatures({
    ...voice, meanRms: 0.014, rmsEnergy: 0.014, activeFrameRatio: 0.45, spectralFlux: 0.03,
    pitchRangeSemitones: 0.8, smoothnessScore: 0.45, amplitudeStability: 0.6, residualInstabilityScore: 0.5,
  }));
  assert.ok(lively.arousal - flat.arousal > 0.5, `same voice, mood must move arousal (got ${(lively.arousal - flat.arousal).toFixed(2)})`);
  assert.ok(lively.valence > flat.valence, "same voice, mood must move valence");
});
