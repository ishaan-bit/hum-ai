import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asIsoTimestamp, asModelVersion, defaultConsent, findRawAudioFields } from "@hum-ai/shared-types";
import { synthHum, computeFeatures } from "@hum-ai/audio-features";
import { assertNoClinicalLeak, type FusionLabel } from "@hum-ai/affect-model-contracts";
import { featureVectorNames, toFeatureVector } from "../src/feature-schema";
import { serializeModel, trainLogReg, type LogRegParams } from "../src/model";
import type { NeuralFeatureModel } from "../src/neural-feature-model";
import { loadLearnedAffectPrior, orchestrateHumWithLearnedPrior } from "../src/runtime-bridge";

const now = asIsoTimestamp("2026-06-20T12:00:00.000Z");
const modelVersion = asModelVersion("runtime-bridge-manifest-test-v1");
const consent = defaultConsent(now);

// Mature personal history so the spine commits past the early-baseline cap and the
// far-domain prior cap is the salient bound (mirrors runtime-bridge.test.ts).
const matureHistory = {
  eligibleSamplesByFeature: { meanRms: Array.from({ length: 30 }, (_, i) => 0.09 + ((i % 5) - 2) * 0.002) },
  priorEligibleCount: 30,
};

function tinyModel(): LogRegParams {
  const X: number[][] = [];
  const y: FusionLabel[] = [];
  for (let s = 1; s <= 6; s++) {
    X.push(toFeatureVector(computeFeatures(synthHum({ seed: s, f0: 150 }))));
    y.push("calm_regulated");
    X.push(toFeatureVector(computeFeatures(synthHum({ seed: s + 50, f0: 320, vibratoDepth: 0.05, targetPeak: 0.8 }))));
    y.push("high_arousal_negative");
  }
  return trainLogReg(X, y, {
    labels: ["calm_regulated", "high_arousal_negative"],
    featureNames: featureVectorNames(),
    iterations: 150,
  });
}

/** A valid feature-space op-graph that `parseNeuralFeatureModel` accepts (58-d contract). */
function tinyNeuralModel(): NeuralFeatureModel {
  const names = featureVectorNames();
  const d = names.length;
  return {
    version: "neural-test/0.1.0",
    kind: "feature_mlp_opgraph",
    target: "arousal_binary",
    family: "feature_mlp",
    labels: ["low_arousal", "high_arousal"],
    featureNames: names,
    standardizer: { mean: new Array(d).fill(0), std: new Array(d).fill(1) },
    ops: [{ op: "linear", W: [new Array(d).fill(0.01), new Array(d).fill(-0.01)], b: [0.1, -0.1] }],
    evidence: { balancedAccuracy: 0.831, ece: 0.03, pValue: 0.006, classicalBaseline: 0.75, validation: "grouped-cv" },
    governance: "far-domain acted-speech prior; penalty 0.45 (ADR-0005)",
  };
}

const MANIFEST = {
  version: "signal-lab-model-manifest/0.1.0",
  gate: { status: "EXPERIMENTAL", metric: "balanced_accuracy", threshold: 0.8, eceCap: 0.15, maxPValue: 0.01 },
  datasets: { supervised: ["ravdess"], domainOod: ["ravdess", "vocalset", "vocalsound"] },
  priorAffectModel: {
    name: "signal-lab-logreg",
    target: "affect_fusion_label",
    balancedAccuracy: 0.479,
    passedGate: false,
    role: "population_prior — KEPT (far-domain acted speech, penalty 0.45; ADR-0005)",
  },
  promoted: { targetId: "arousal_binary", balancedAccuracy: 0.831, artifact: "model.arousal_binary.json" },
  inferenceImpact: "6-class affect head + interventions UNCHANGED; arousal_binary surfaced as an aux prior only.",
};

/** Write model.json (+optionally manifest + neural aux) into an OS temp dir (NEVER the repo). */
function writeArtifacts(opts: { manifest?: boolean; neural?: boolean }): { modelPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hum-bridge-manifest-"));
  const modelPath = join(dir, "model.json");
  writeFileSync(modelPath, serializeModel(tinyModel()), "utf8");
  if (opts.manifest) writeFileSync(join(dir, "model_manifest.json"), JSON.stringify(MANIFEST, null, 2), "utf8");
  if (opts.neural) {
    mkdirSync(join(dir, "neural"), { recursive: true });
    writeFileSync(join(dir, "neural", "model.neural.arousal_binary.json"), JSON.stringify(tinyNeuralModel()), "utf8");
  }
  return { modelPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("loadLearnedAffectPrior reads a co-located manifest into honest gate status (did NOT pass)", () => {
  const { modelPath, cleanup } = writeArtifacts({ manifest: true });
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: modelPath });
    assert.ok(prior);
    assert.ok(prior.promotion, "manifest must be loaded into a promotion block");
    assert.equal(prior.promotion!.evaluated, true);
    assert.equal(prior.promotion!.affectPassedGate, false);
    assert.equal(prior.promotion!.promotedAuxTarget, "arousal_binary");
    // Orchestrator-facing honesty metadata is derived from the manifest.
    assert.equal(prior.gatePassed, false);
    assert.match(prior.gateNote ?? "", /did NOT pass/);
  } finally {
    cleanup();
  }
});

test("loadLearnedAffectPrior with no manifest reports unknown gate status (no false validation)", () => {
  const { modelPath, cleanup } = writeArtifacts({ manifest: false });
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: modelPath });
    assert.ok(prior);
    assert.equal(prior.promotion, undefined);
    assert.equal(prior.gatePassed, undefined);
    assert.equal(prior.neuralAux.model, null, "no neural artifact ⇒ no aux model");
  } finally {
    cleanup();
  }
});

test("full-spine read carries honest gate status from the manifest, and nothing clinical leaks", async () => {
  const { modelPath, cleanup } = writeArtifacts({ manifest: true });
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: modelPath });
    const { read, priorUsed, promotion } = await orchestrateHumWithLearnedPrior({
      audio: synthHum({ seed: 7 }),
      consent,
      modelVersion,
      now,
      history: matureHistory,
      prior,
    });
    assert.equal(priorUsed, true);
    assert.equal(promotion.evaluated, true);
    assert.equal(promotion.affectPassedGate, false);
    // The gate status reached the end-to-end internal read (model metadata / manifest).
    assert.equal(read.internal.modelProvenance.gatePassed, false);
    assert.match(read.internal.modelProvenance.gateNote ?? "", /did NOT pass/);
    // Safety unchanged.
    assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
    assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
    assert.deepEqual(findRawAudioFields(read), []);
  } finally {
    cleanup();
  }
});

test("no manifest ⇒ promotion is reported not-evaluated and provenance gate status is null", async () => {
  const { modelPath, cleanup } = writeArtifacts({ manifest: false });
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: modelPath });
    const { promotion, read } = await orchestrateHumWithLearnedPrior({
      audio: synthHum({ seed: 7 }),
      consent,
      modelVersion,
      now,
      history: matureHistory,
      prior,
    });
    assert.equal(promotion.evaluated, false);
    assert.equal(read.internal.modelProvenance.gatePassed, null);
    assert.equal(read.internal.modelProvenance.gateNote, null);
  } finally {
    cleanup();
  }
});

test("forced heuristic fallback ⇒ honest not-evaluated promotion and no aux, never a model claim", async () => {
  const { promotion, neuralAuxiliary, read, priorUsed } = await orchestrateHumWithLearnedPrior({
    audio: synthHum({ seed: 9 }),
    consent,
    modelVersion,
    now,
    history: matureHistory,
    prior: null, // force the fallback even if a repo artifact exists
  });
  assert.equal(priorUsed, false);
  assert.equal(promotion.evaluated, false);
  assert.equal(promotion.datasetsUsed.length, 0);
  assert.equal(neuralAuxiliary, null);
  assert.equal(read.internal.modelProvenance.kind, "heuristic_ensemble");
  assert.equal(read.internal.modelProvenance.gatePassed, null);
});

test("a promoted NEURAL aux prior is surfaced for transparency but does NOT steer the read", async () => {
  const { modelPath, cleanup } = writeArtifacts({ manifest: true, neural: true });
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: modelPath });
    assert.ok(prior?.neuralAux.model, "the co-located neural artifact must auto-load via the adapter boundary");

    const common = { audio: synthHum({ seed: 7 }), consent, modelVersion, now, history: matureHistory, prior };
    const withAux = await orchestrateHumWithLearnedPrior(common);
    const withoutAux = await orchestrateHumWithLearnedPrior({ ...common, neuralAux: { model: null } });

    // Surfaced honestly when present...
    assert.ok(withAux.neuralAuxiliary, "promoted neural aux must be surfaced");
    assert.equal(withAux.neuralAuxiliary!.target, "arousal_binary");
    assert.match(withAux.neuralAuxiliary!.note, /does NOT drive|transparency/i);
    // ...and absent when forced off.
    assert.equal(withoutAux.neuralAuxiliary, null);

    // CRUCIAL: the aux is NEVER fused — the affect read is byte-identical with or without it.
    assert.deepEqual(withAux.read.internal.inference, withoutAux.read.internal.inference);
    assert.deepEqual(withAux.read.userFacing, withoutAux.read.userFacing);
    assert.deepEqual(withAux.read.recommendationView, withoutAux.read.recommendationView);

    // The aux surfacing adds no raw-audio-like key and nothing clinical leaks.
    assert.deepEqual(findRawAudioFields(withAux.read), []);
    assert.doesNotThrow(() => assertNoClinicalLeak(withAux.read.userFacing));
  } finally {
    cleanup();
  }
});
