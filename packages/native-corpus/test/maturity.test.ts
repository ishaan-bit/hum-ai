import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, findRawAudioFields } from "@hum-ai/shared-types";
import { assertNoClinicalLeak } from "@hum-ai/affect-model-contracts";
import { emptyCorpus } from "../src/corpus";
import { buildHumNativeArtifact } from "../src/manifest";
import { buildNativeMaturityView } from "../src/maturity";
import { learnableArousalCorpus } from "./fixtures";

const now = asIsoTimestamp("2026-06-21T10:00:00.000Z");

test("a fresh/empty corpus reads as training on both axes, nothing promoted, honest summary", () => {
  const v = buildNativeMaturityView({ corpus: emptyCorpus(), artifact: null, eligibleHumCount: 0 });
  assert.equal(v.labelledExamples, 0);
  assert.equal(v.trainableExamples, 0);
  assert.equal(v.valenceModel, "training");
  assert.equal(v.arousalModel, "training");
  assert.equal(v.anyPromoted, false);
  assert.equal(v.personalizationBenefit, "insufficient_evidence");
  assert.match(v.summary, /getting started/i);
});

test("the view truthfully reflects counts and a PROMOTED hum-native model", () => {
  const corpus = learnableArousalCorpus(40);
  const artifact = buildHumNativeArtifact(corpus, now);
  const v = buildNativeMaturityView({ corpus, artifact, eligibleHumCount: 30 });

  // Counts are faithful to the corpus + the caller's eligible-hum count.
  assert.equal(v.eligibleHumCount, 30);
  assert.equal(v.labelledExamples, corpus.examples.length);
  assert.equal(v.trainableExamples, corpus.examples.filter((e) => e.eligible).length);
  assert.ok(v.quadrantsCovered >= 1 && v.quadrantsCovered <= 4);

  // The learnable-arousal fixture promotes the arousal axis (it beats the backbone).
  assert.equal(v.arousalModel, "promoted");
  assert.equal(v.anyPromoted, true);
  // The promoted-model summary leads with the hum-native steering line, no accuracy %.
  assert.match(v.summary, /hum-native model/i);
  assert.equal(/\d+%/.test(v.summary), false, "no raw percentage in the rendered summary");
});

test("the maturity view never carries a clinical label or raw-audio-like field", () => {
  const corpus = learnableArousalCorpus(40);
  const artifact = buildHumNativeArtifact(corpus, now);
  const v = buildNativeMaturityView({ corpus, artifact, eligibleHumCount: 30 });
  assert.doesNotThrow(() => assertNoClinicalLeak(v));
  assert.deepEqual(findRawAudioFields(v), []);
  // The benefit + trend are coarse enums, never a number rendered as confidence.
  assert.ok(["insufficient_evidence", "personalization_helping", "neutral_or_unclear", "personalization_worsening"].includes(v.personalizationBenefit));
  for (const dir of [v.calibrationTrend.valence, v.calibrationTrend.arousal]) {
    assert.ok(["improving", "steady", "worsening", "insufficient"].includes(dir));
  }
});
