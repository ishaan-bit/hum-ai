import { test } from "node:test";
import assert from "node:assert/strict";
import { findRawAudioFields } from "@hum-ai/shared-types";
import { assertNoClinicalLeak, type HumLabel } from "@hum-ai/affect-model-contracts";
import { acousticAffectAxes } from "@hum-ai/orchestrator";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { appendExample, emptyCorpus, type NativeCorpus } from "../src/corpus";
import { assessPersonalizationBenefit, BENEFIT_MIN_EXAMPLES } from "../src/benefit";
import { makeExample, BASE } from "./fixtures";

// The fixtures' BASE features (a 12 s 180 Hz sine) have a FIXED acoustic backbone. We derive
// it from the same `acousticAffectAxes` the benefit metric uses — rather than hardcoding a
// magic constant — so this test stays correct across axis-read calibration changes. Every
// example reuses BASE, so the backbone prediction is constant and we can place the self-report
// + the personalized prediction relative to it to drive each verdict deterministically.
const BACKBONE = acousticAffectAxes(BASE);
const ON_BACKBONE = { valence: BACKBONE.valence, arousal: BACKBONE.arousal };
// A CLEAR, trusted hum: loud + bright + higher-register with a realistic SNR, so its backbone
// read sits clearly OUTSIDE the calibration dead-zone on both axes. The bare BASE fixture is a
// pure 180 Hz sine that the extractor rates at SNR ≈ 1.0; the v9 read correctly fades such a
// low-fidelity capture to neutral (0, 0), which lands in the dead-zone — fine for a real hum, but
// it leaves the "worsening" test (which needs the label to sit on a SCORED backbone) no evidence.
// This override gives that test a trusted, non-ambiguous anchor, derived (not hardcoded) from the
// same read the benefit metric uses, so it stays correct across future calibration changes.
const CLEAR_FEATURES = {
  pitchMeanHz: 245, meanRms: 0.07, medianRms: 0.07, rmsEnergy: 0.07, signalToNoiseProxy: 14,
  noiseFloorRms: 0.004, spectralCentroidHz: 1500, spectralFlux: 0.14, pitchRangeSemitones: 4.5,
  activeFrameRatio: 0.9, amplitudeStability: 0.85, smoothnessScore: 0.8,
} as const;
const CLEAR_BACKBONE = acousticAffectAxes({ ...BASE, ...CLEAR_FEATURES });
const ON_CLEAR_BACKBONE = { valence: CLEAR_BACKBONE.valence, arousal: CLEAR_BACKBONE.arousal };
function corpusOf(predicted: HumLabel, label: HumLabel, count: number, features?: Partial<AcousticFeatures>): NativeCorpus {
  let c = emptyCorpus();
  for (let i = 0; i < count; i++) {
    c = appendExample(c, makeExample({ id: `b-${i}`, predicted, label, features, at: `2026-06-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z` }));
  }
  return c;
}

test("below threshold returns insufficient_evidence (abstain, no verdict)", () => {
  // 5 examples × 2 axes = 10 non-ambiguous comparisons < BENEFIT_MIN_EXAMPLES (12).
  const c = corpusOf({ valence: -0.6, arousal: -0.6 }, { valence: -0.6, arousal: -0.6 }, 5);
  const r = assessPersonalizationBenefit(c);
  assert.equal(r.status, "insufficient_evidence");
  assert.ok(r.n < BENEFIT_MIN_EXAMPLES);
  assert.equal(r.backboneMae, null);
  assert.equal(r.personalizedMae, null);
});

test("personalized predictions beating the backbone returns personalization_helping", () => {
  // Self-report is far from the backbone; the personalized read nails it.
  const c = corpusOf({ valence: -0.6, arousal: -0.6 }, { valence: -0.6, arousal: -0.6 }, 10);
  const r = assessPersonalizationBenefit(c);
  assert.equal(r.status, "personalization_helping");
  assert.ok(r.improvement !== null && r.improvement > 0);
  assert.ok(r.personalizedMae !== null && r.backboneMae !== null && r.personalizedMae < r.backboneMae);
});

test("personalized predictions worse than the backbone returns personalization_worsening", () => {
  // Self-report sits right on the (clear, trusted) backbone; the personalized read is far off.
  // Using CLEAR_FEATURES so both axes sit OUTSIDE the dead-zone and are scored — 14 examples × 2
  // axes = 28 comparisons clear BENEFIT_MIN_EXAMPLES (12), and the personalized read is worse.
  const c = corpusOf({ valence: -0.6, arousal: -0.6 }, ON_CLEAR_BACKBONE, 14, CLEAR_FEATURES);
  const r = assessPersonalizationBenefit(c);
  assert.equal(r.status, "personalization_worsening");
  assert.ok(r.improvement !== null && r.improvement < 0);
});

test("a small/equal difference returns neutral_or_unclear", () => {
  // Personalized prediction == backbone ⇒ identical error ⇒ improvement 0 ⇒ unclear.
  const c = corpusOf(ON_BACKBONE, { valence: -0.5, arousal: 0.5 }, 10);
  const r = assessPersonalizationBenefit(c);
  assert.equal(r.status, "neutral_or_unclear");
  assert.ok(r.improvement !== null && Math.abs(r.improvement) <= 0.03 + 1e-9);
});

test("only benign valence/arousal labels are used — no clinical label is read or required, and guards pass", () => {
  const c = corpusOf({ valence: -0.6, arousal: -0.6 }, { valence: -0.6, arousal: -0.6 }, 14);
  const r = assessPersonalizationBenefit(c);
  // The verdict is produced purely from the benign HumLabel (valence/arousal) — the type
  // contract has no clinical field, and the assessment output carries none either.
  assert.doesNotThrow(() => assertNoClinicalLeak(r));
  assert.deepEqual(findRawAudioFields(r), []);
  // It is a coarse category, never a raw accuracy/clinical claim.
  assert.ok(["insufficient_evidence", "personalization_helping", "neutral_or_unclear", "personalization_worsening"].includes(r.status));
});

test("ambiguous (near-zero) self-reports are not scored — they cannot manufacture a verdict", () => {
  // Both axes inside the calibration dead-zone ⇒ nothing scored ⇒ insufficient regardless of count.
  const c = corpusOf({ valence: -0.6, arousal: -0.6 }, { valence: 0.0, arousal: 0.0 }, 30);
  const r = assessPersonalizationBenefit(c);
  assert.equal(r.status, "insufficient_evidence");
  assert.equal(r.n, 0);
});
