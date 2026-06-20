import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asIsoTimestamp, asModelVersion, defaultConsent } from "@hum-ai/shared-types";
import { synthHum, computeFeatures } from "@hum-ai/audio-features";
import { assertNoClinicalLeak, type FusionLabel } from "@hum-ai/affect-model-contracts";
import { featureVectorNames, toFeatureVector } from "../src/feature-schema";
import { serializeModel, trainLogReg, type LogRegParams } from "../src/model";
import {
  AFFECT_PRIOR_FAR_DOMAIN_CAP,
  loadLearnedAffectPrior,
  orchestrateHumWithLearnedPrior,
} from "../src/runtime-bridge";

const now = asIsoTimestamp("2026-06-19T12:00:00.000Z");
const modelVersion = asModelVersion("runtime-bridge-test-v1");
const consent = defaultConsent(now);

// A mature personal history so the full spine commits (past early baseline) and
// the far-domain prior cap (not the early-baseline cap) is the salient bound.
const matureHistory = {
  eligibleSamplesByFeature: { meanRms: Array.from({ length: 30 }, (_, i) => 0.09 + ((i % 5) - 2) * 0.002) },
  priorEligibleCount: 30,
};

/** Train a tiny REAL model (hum-leaning vs energetic) — exercises the real path. */
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

/** Write a serialized model to an OS temp dir (NEVER inside the repo / data tree). */
function writeTempModel(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hum-bridge-"));
  const path = join(dir, "model.json");
  writeFileSync(path, serializeModel(tinyModel()), "utf8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("loadLearnedAffectPrior returns null when no artifact exists (honest fallback)", () => {
  const missing = join(tmpdir(), "hum-bridge-does-not-exist", "model.json");
  assert.equal(loadLearnedAffectPrior({ modelArtifactPath: missing }), null);
});

test("loadLearnedAffectPrior wraps a present artifact as an orchestrator-ready prior", () => {
  const { path, cleanup } = writeTempModel();
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: path });
    assert.ok(prior, "a present artifact must load");
    assert.equal(prior.confidenceCap, AFFECT_PRIOR_FAR_DOMAIN_CAP);
    assert.match(prior.capReason, /far-domain|ADR-0005/);
    assert.equal(prior.artifact, path);
    assert.equal(prior.expert.expertId, "signal-lab:learned-affect-prior");
    assert.ok(prior.model.labels.length > 0);
  } finally {
    cleanup();
  }
});

test("orchestrateHumWithLearnedPrior runs the FULL spine with the trained prior", async () => {
  const { path, cleanup } = writeTempModel();
  try {
    const prior = loadLearnedAffectPrior({ modelArtifactPath: path });
    const { read, priorUsed, provenance } = await orchestrateHumWithLearnedPrior({
      audio: synthHum({ seed: 7 }),
      consent,
      modelVersion,
      now,
      history: matureHistory,
      prior,
    });

    assert.equal(priorUsed, true);
    assert.match(provenance, /learned affect prior/);
    // The trained prior was fused into the real orchestrator spine (not inferFromHum).
    assert.equal(read.internal.modelProvenance.kind, "learned_affect_prior");
    assert.equal(read.internal.modelProvenance.expertId, "signal-lab:learned-affect-prior");
    // Full spine present: personalization + longitudinal-diagnostic stages ran.
    assert.ok("longitudinal" in read.internal);
    assert.equal(read.internal.longitudinal.isDiagnostic, false);
    // Far-domain prior cap binds (ADR-0005), and nothing clinical leaks.
    assert.ok(read.internal.inference.confidence.appliedCap <= AFFECT_PRIOR_FAR_DOMAIN_CAP + 1e-9);
    assert.doesNotThrow(() => assertNoClinicalLeak(read.userFacing));
    assert.doesNotThrow(() => assertNoClinicalLeak(read.recommendationView));
  } finally {
    cleanup();
  }
});

test("orchestrateHumWithLearnedPrior falls back to heuristic experts when no prior", async () => {
  const { read, priorUsed, provenance } = await orchestrateHumWithLearnedPrior({
    audio: synthHum({ seed: 9 }),
    consent,
    modelVersion,
    now,
    history: matureHistory,
    prior: null, // force the fallback even if an artifact existed
  });
  assert.equal(priorUsed, false);
  assert.match(provenance, /heuristic fallback/);
  assert.equal(read.internal.modelProvenance.kind, "heuristic_ensemble");
  assert.equal(read.internal.modelProvenance.expertId, null);
});
