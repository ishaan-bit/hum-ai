import { test } from "node:test";
import assert from "node:assert/strict";
import { blendSalience } from "@hum-ai/personalization-engine";
import { appendExample, emptyCorpus } from "../src/corpus";
import { personalFeatureImportance, combinedFeatureImportance, IMPORTANCE_MIN_EXAMPLES } from "../src/feature-importance";
import { makeExample } from "./fixtures";

test("importance is empty below the minimum sample size", () => {
  let c = emptyCorpus();
  for (let i = 0; i < IMPORTANCE_MIN_EXAMPLES - 1; i++) {
    c = appendExample(c, makeExample({ id: `e${i}`, features: { meanRms: 0.05 + i * 0.001 }, label: { valence: 0.3, arousal: i % 2 ? 0.5 : -0.5 } }));
  }
  assert.deepEqual(personalFeatureImportance(c, "arousal"), {});
});

test("a feature that tracks the reported axis scores high importance; an unrelated one low", () => {
  // arousal label is driven by spectralCentroidHz; meanRms is held ~constant (unrelated).
  let c = emptyCorpus();
  for (let i = 0; i < 24; i++) {
    const high = i % 2 === 0;
    c = appendExample(
      c,
      makeExample({
        id: `e${i}`,
        features: { spectralCentroidHz: high ? 1800 + (i % 3) * 20 : 500 + (i % 3) * 20, meanRms: 0.05 },
        label: { valence: 0.2, arousal: high ? 0.6 : -0.6 },
      }),
    );
  }
  const imp = personalFeatureImportance(c, "arousal");
  assert.ok((imp.spectralCentroidHz ?? 0) > 0.8, `centroid tracks arousal: ${imp.spectralCentroidHz}`);
  // meanRms is constant → ~0 correlation → absent or tiny.
  assert.ok((imp.meanRms ?? 0) < 0.5, `constant feature is not important: ${imp.meanRms}`);
  // Max-normalized.
  assert.ok(Math.max(...Object.values(imp)) <= 1.0000001);
  // combined covers both axes.
  assert.ok((combinedFeatureImportance(c).spectralCentroidHz ?? 0) > 0.8);
});

test("blendSalience amplifies predictive features and is a no-op without a hint", () => {
  const base = { spectralCentroidHz: 0.5, meanRms: 0.5 };
  const blended = blendSalience(base, { spectralCentroidHz: 1.0 }, 0.4);
  assert.ok(blended, "a hint yields a blended map");
  assert.ok(blended!.spectralCentroidHz! > base.spectralCentroidHz, "predictive feature amplified");
  assert.equal(blended!.meanRms, base.meanRms, "untouched feature unchanged");
  // No hint → returns the base VERBATIM (preserves undefined → true no-op for personalization).
  assert.equal(blendSalience(base, {}, 0.4), base);
  assert.equal(blendSalience(base, undefined, 0.4), base);
  assert.equal(blendSalience(undefined, {}, 0.4), undefined);
  // A feature with no base salience still gains a small floor from a strong hint.
  assert.ok((blendSalience({}, { jitter: 1 }, 0.4)?.jitter ?? 0) > 0);
});
