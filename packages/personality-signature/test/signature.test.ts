import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUserFacingText } from "@hum-ai/safety-language";
import {
  assessPersonalitySignature,
  personalitySignatureStrings,
  BIG_FIVE_KEYS,
  EMERGING_HUMS,
  TENTATIVE_HUMS,
} from "../src/index";

/** Build feature windows by repeating one value per key `n` times. */
const win = (vals: Record<string, number>, n: number): Record<string, number[]> => {
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(vals)) out[k] = Array.from({ length: n }, () => v);
  return out;
};

// A loud, varied, expressive profile.
const EXPRESSIVE = {
  meanRms: 0.24, peakAmplitude: 0.68, activeFrameRatio: 0.92, spectralCentroidHz: 1300,
  pitchRangeSemitones: 3.6, musicalityScore: 0.8, vibratoRegularity: 0.7,
  controlledExpressionScore: 0.4, amplitudeStability: 0.6, pitchStability: 0.7, residualInstabilityScore: 0.4,
  smoothnessScore: 0.4, breathinessProxy: 0.5, jitter: 0.03, shimmerProxy: 0.3, residualPitchInstability: 0.4,
};
// A quiet, even, controlled profile.
const STEADY = {
  meanRms: 0.06, peakAmplitude: 0.2, activeFrameRatio: 0.5, spectralCentroidHz: 720,
  pitchRangeSemitones: 0.4, musicalityScore: 0.3, vibratoRegularity: 0.2,
  controlledExpressionScore: 0.9, amplitudeStability: 0.97, pitchStability: 0.98, residualInstabilityScore: 0.12,
  smoothnessScore: 0.9, breathinessProxy: 0.15, jitter: 0.006, shimmerProxy: 0.06, residualPitchInstability: 0.06,
};

test("forming below the emerging gate — no primary read yet", () => {
  const sig = assessPersonalitySignature(win(STEADY, EMERGING_HUMS - 1), EMERGING_HUMS - 1);
  assert.equal(sig.status, "forming");
  assert.equal(sig.primaryTraits.length, 0);
  assert.equal(sig.lean.dominant, null);
  assert.equal(sig.traits.length, 5);
});

test("zero hums still returns a safe forming signature", () => {
  const sig = assessPersonalitySignature({}, 0);
  assert.equal(sig.status, "forming");
  assert.equal(sig.humCount, 0);
});

test("emerging once enough hums exist; tentative when mature; never beyond tentative", () => {
  assert.equal(assessPersonalitySignature(win(STEADY, EMERGING_HUMS), EMERGING_HUMS).status, "emerging");
  const mature = assessPersonalitySignature(win(STEADY, TENTATIVE_HUMS + 50), TENTATIVE_HUMS + 50);
  assert.equal(mature.status, "tentative");
});

test("a steady profile reads high on emotional steadiness + conscientiousness", () => {
  const sig = assessPersonalitySignature(win(STEADY, TENTATIVE_HUMS), TENTATIVE_HUMS);
  const steadiness = sig.traits.find((t) => t.key === "emotional_stability")!;
  const consc = sig.traits.find((t) => t.key === "conscientiousness")!;
  assert.equal(steadiness.lean, "high");
  assert.equal(consc.lean, "high");
});

test("the surface foregrounds Openness + Conscientiousness (the two primary OCEAN traits)", () => {
  const sig = assessPersonalitySignature(win(STEADY, TENTATIVE_HUMS), TENTATIVE_HUMS);
  // Traits are ordered with the two foregrounded traits first.
  assert.deepEqual(sig.traits.slice(0, 2).map((t) => t.key), ["openness", "conscientiousness"]);
  // primaryTraits surfaces exactly those two, flagged primary, with human-readable labels.
  assert.deepEqual(sig.primaryTraits.map((t) => t.key), ["openness", "conscientiousness"]);
  assert.ok(sig.primaryTraits.every((t) => t.primary));
  assert.deepEqual(sig.primaryTraits.map((t) => t.label), ["Openness", "Conscientiousness"]);
  // The headline leads with the OCEAN framing.
  assert.match(sig.headline, /OCEAN/);
});

test("no Myers-Briggs / 4-letter type leaks into any surfaced string", () => {
  const mbti = /\b[EI][NS][FT][JP]\b/; // ENFP, INTJ, ...
  for (const profile of [EXPRESSIVE, STEADY]) {
    for (const n of [0, EMERGING_HUMS, TENTATIVE_HUMS, TENTATIVE_HUMS + 40]) {
      const sig = assessPersonalitySignature(win(profile, n), n);
      // The shape carries no type field at all.
      assert.ok(!("type" in sig), "signature should not carry a 4-letter type field");
      for (const s of personalitySignatureStrings(sig)) {
        assert.ok(!mbti.test(s), `MBTI-like code leaked: "${s}"`);
        assert.ok(!/myers|briggs|mbti/i.test(s), `MBTI term leaked: "${s}"`);
      }
    }
  }
});

test("an expressive profile reads more outgoing than a steady one", () => {
  const exp = assessPersonalitySignature(win(EXPRESSIVE, TENTATIVE_HUMS), TENTATIVE_HUMS);
  const stl = assessPersonalitySignature(win(STEADY, TENTATIVE_HUMS), TENTATIVE_HUMS);
  const e1 = exp.traits.find((t) => t.key === "extraversion")!.value;
  const e2 = stl.traits.find((t) => t.key === "extraversion")!.value;
  assert.ok(e1 > e2, `expressive extraversion (${e1.toFixed(2)}) should exceed steady (${e2.toFixed(2)})`);
});

test("all five Big-Five axes are present", () => {
  const sig = assessPersonalitySignature(win(EXPRESSIVE, TENTATIVE_HUMS), TENTATIVE_HUMS);
  const keys = sig.traits.map((t) => t.key).sort();
  assert.deepEqual(keys, [...BIG_FIVE_KEYS].sort());
});

test("every surfaced string passes the safety-language screen (non-clinical, no numbers)", () => {
  for (const profile of [EXPRESSIVE, STEADY]) {
    for (const n of [0, EMERGING_HUMS, TENTATIVE_HUMS, TENTATIVE_HUMS + 40]) {
      const sig = assessPersonalitySignature(win(profile, n), n);
      for (const s of personalitySignatureStrings(sig)) {
        const r = validateUserFacingText(s);
        assert.ok(r.ok, `unsafe copy: "${s}" → ${JSON.stringify(r.violations)}`);
      }
    }
  }
});
