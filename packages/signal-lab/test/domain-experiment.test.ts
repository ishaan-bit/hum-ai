import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum, computeFeatures, type AcousticFeatures } from "@hum-ai/audio-features";
import { featureVectorLength, featureVectorNames, toFeatureVector } from "../src/feature-schema";
import { buildDomainSamples, ablateFeatures, RATE_SENSITIVE_FEATURES } from "../src/domain-experiment";
import type { SignalRow } from "../src/extract";
import type { CohortSample } from "../src/cohort-eval";

function row(dataset: string, group: string, features: AcousticFeatures): SignalRow {
  return {
    signalId: `${dataset}:${group}`, sourceDataset: dataset, sourceSampleId: `${group}.wav`,
    audioDomain: "unknown", taskFamily: "x", labelFamily: "none", sourceLabel: null,
    fusionLabel: null, mappingStrength: null, group, domainGap: "near", domainPenalty: 0.9,
    modelSource: "hum_dsp_extractor", features,
  };
}

test("buildDomainSamples maps each corpus to its DomainClass and keeps speaker groups", () => {
  const f = computeFeatures(synthHum({ seed: 1 }));
  const rowsByDataset = {
    ravdess: [row("ravdess", "actor_01", f)],
    vocalset: [row("vocalset", "singer_female1", f)],
    vocalsound: [row("vocalsound", "spk_f1000", f)],
  };
  const samples = buildDomainSamples(rowsByDataset);
  const byLabel = new Map(samples.map((s) => [s.label, s.group]));
  assert.equal(byLabel.get("speech"), "actor_01");
  assert.equal(byLabel.get("singing"), "singer_female1");
  assert.equal(byLabel.get("vocal_burst"), "spk_f1000");
});

test("ablateFeatures removes the rate-sensitive spectral columns (corpus-confound check)", () => {
  const sample: CohortSample = { vector: new Array(featureVectorLength()).fill(1), label: "speech", group: "g" };
  const { samples, featureNames } = ablateFeatures([sample], RATE_SENSITIVE_FEATURES);
  // none of the dropped feature names survive
  for (const dropped of RATE_SENSITIVE_FEATURES) assert.ok(!featureNames.includes(dropped), `${dropped} should be gone`);
  // all 6 dropped features are numeric (no mask channels) ⇒ exactly 6 columns removed
  assert.equal(featureNames.length, featureVectorNames().length - RATE_SENSITIVE_FEATURES.length);
  assert.equal(samples[0]!.vector.length, featureNames.length);
});

test("ablation keeps non-spectral feature columns intact", () => {
  const full = toFeatureVector(computeFeatures(synthHum({ seed: 2 })));
  const { featureNames } = ablateFeatures([{ vector: full, label: "speech", group: "g" }], RATE_SENSITIVE_FEATURES);
  assert.ok(featureNames.includes("pitchCoverage"));
  assert.ok(featureNames.includes("voicingContinuityCoverage"));
  assert.ok(featureNames.includes("meanRms"));
});
