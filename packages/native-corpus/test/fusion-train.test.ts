import { test } from "node:test";
import assert from "node:assert/strict";
import { FUSION_LABELS } from "@hum-ai/affect-model-contracts";
import { LogisticRegressionMetaLearner, argmax } from "@hum-ai/fusion-engine";
import { appendExample, emptyCorpus } from "../src/corpus";
import {
  fusionLabelFromVA,
  buildMetaLearnerSamples,
  trainFusionMetaLearner,
  metaLearnerFromParams,
  FUSION_MIN_EXAMPLES,
} from "../src/fusion-train";
import { makeExample } from "./fixtures";

test("fusionLabelFromVA maps quadrants to BENIGN fusion labels (never clinical)", () => {
  assert.equal(fusionLabelFromVA(0.5, 0.5), "positive_activation");
  assert.equal(fusionLabelFromVA(0.5, -0.5), "calm_regulated");
  assert.equal(fusionLabelFromVA(-0.5, 0.5), "tense_anxious");
  assert.equal(fusionLabelFromVA(-0.5, -0.5), "low_mood");
  assert.equal(fusionLabelFromVA(0.05, -0.05), "neutral_close_to_usual");
  // Every emitted label is a real benign FUSION_LABEL.
  for (const [v, a] of [[0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0, 0]] as const) {
    assert.ok(FUSION_LABELS.includes(fusionLabelFromVA(v, a)));
  }
});

/** A corpus whose feature character separates the four affect quadrants. */
function quadrantCorpus(perQuadrant = 9) {
  let c = emptyCorpus();
  const quads = [
    { v: 0.6, a: 0.6, f: { rmsEnergy: 0.12, activeFrameRatio: 0.85, clarityScore: 0.85, spectralCentroidHz: 1700, residualInstabilityScore: 0.1 } },
    { v: 0.6, a: -0.6, f: { rmsEnergy: 0.02, activeFrameRatio: 0.4, clarityScore: 0.85, spectralCentroidHz: 700, residualInstabilityScore: 0.1 } },
    { v: -0.6, a: 0.6, f: { rmsEnergy: 0.12, activeFrameRatio: 0.85, clarityScore: 0.3, spectralCentroidHz: 1700, residualInstabilityScore: 0.6 } },
    { v: -0.6, a: -0.6, f: { rmsEnergy: 0.02, activeFrameRatio: 0.35, clarityScore: 0.3, spectralCentroidHz: 600, residualInstabilityScore: 0.5 } },
  ];
  let id = 0;
  for (let i = 0; i < perQuadrant; i++) {
    for (const q of quads) {
      c = appendExample(c, makeExample({ id: `f${id++}`, features: { ...q.f, jitter: 0.01 + (i % 3) * 0.002 }, label: { valence: q.v, arousal: q.a } }));
    }
  }
  return c;
}

test("buildMetaLearnerSamples runs the experts and labels each hum benignly", async () => {
  const samples = await buildMetaLearnerSamples(quadrantCorpus(2));
  assert.equal(samples.length, 8);
  for (const s of samples) {
    assert.ok(s.experts.length >= 1);
    assert.ok(FUSION_LABELS.includes(s.label));
  }
});

test("trainFusionMetaLearner learns the quadrants and yields a valid promotion decision", async () => {
  const promo = await trainFusionMetaLearner(quadrantCorpus(9));
  assert.equal(promo.n, 36);
  assert.ok(promo.classes >= 4);
  // The trained meta-learner is competitive with the stub and well above 7-way chance.
  assert.ok(promo.challengerAccuracy > 0.4, `challenger ${promo.challengerAccuracy}`);
  assert.ok(["promote", "hold"].includes(promo.decision));
  if (promo.decision === "promote") {
    assert.ok(promo.params !== null);
    const ml = new LogisticRegressionMetaLearner(promo.params!);
    const samples = await buildMetaLearnerSamples(quadrantCorpus(1));
    const dist = ml.combine(samples[0]!.experts);
    assert.ok(Math.abs(FUSION_LABELS.reduce((s, l) => s + dist[l], 0) - 1) < 1e-9, "valid distribution");
    assert.ok(FUSION_LABELS.includes(argmax(dist).label));
  }
});

test("an insufficient corpus HOLDS; metaLearnerFromParams(null) yields the stub fallback", async () => {
  let c = emptyCorpus();
  for (let i = 0; i < FUSION_MIN_EXAMPLES - 5; i++) c = appendExample(c, makeExample({ id: `s${i}`, label: { valence: 0.5, arousal: 0.5 } }));
  const promo = await trainFusionMetaLearner(c);
  assert.equal(promo.decision, "hold");
  assert.equal(promo.params, null);
  assert.equal(metaLearnerFromParams(null), null);
  assert.equal(metaLearnerFromParams(undefined), null);
});
