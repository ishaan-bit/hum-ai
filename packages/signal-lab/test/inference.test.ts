import { test } from "node:test";
import assert from "node:assert/strict";
import { synthHum, synthSpeechLike, synthSilence, computeFeatures } from "@hum-ai/audio-features";
import { isConfidenceCopySafe } from "@hum-ai/safety-language";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { featureVectorNames, toFeatureVector } from "../src/feature-schema";
import { trainLogReg, type LogRegParams } from "../src/model";
import { inferFromHum } from "../src/inference";

/** Train a tiny real model so the learned path is exercised (hum vs speech-like). */
function tinyModel(): LogRegParams {
  const X: number[][] = [];
  const y: FusionLabel[] = [];
  for (let s = 1; s <= 6; s++) {
    X.push(toFeatureVector(computeFeatures(synthHum({ seed: s }))));
    y.push("calm_regulated");
    X.push(toFeatureVector(computeFeatures(synthSpeechLike({ seed: s + 100 }))));
    y.push("high_arousal_negative");
  }
  return trainLogReg(X, y, {
    labels: ["calm_regulated", "high_arousal_negative"],
    featureNames: featureVectorNames(),
    iterations: 200,
  });
}

test("learned-model inference returns a structured, capped, honest report", async () => {
  const model = tinyModel();
  const report = await inferFromHum({ audio: synthHum({ seed: 42 }), model, modelArtifactPath: "mem://model" });

  assert.equal(report.modelUsed.kind, "learned_logreg");
  assert.equal(report.fallbackUsed, false);
  assert.equal(report.artifactUsed, "mem://model");
  assert.ok(report.features.featureMode.length > 0);
  assert.ok(report.features.durationSec > 0);

  // Confidence cap invariants (ADR-0004): percent never exceeds cap×100; first hum ≤ 0.72;
  // far-domain prior penalty (0.45) binds for a learned prior.
  const c = report.confidence.internal;
  assert.ok(c.confidencePercent <= Math.floor(c.appliedCap * 100));
  assert.ok(c.appliedCap <= 0.72);
  assert.ok(c.appliedCap <= 0.45 + 1e-9, `expected far-domain prior cap to bind, got ${c.appliedCap}`);

  // User-facing qualitative copy must carry no raw number (ADR-0008).
  assert.ok(isConfidenceCopySafe(report.confidence.qualitative.summary));
  assert.ok(isConfidenceCopySafe(report.confidence.qualitative.signalClarity));
  assert.ok(isConfidenceCopySafe(report.confidence.qualitative.basedOn));

  // Intervention only when not abstained.
  assert.equal(report.intervention.surfaced, !report.inferredState.abstained && report.intervention.type !== "none");

  // Honest warnings always present.
  assert.ok(report.warnings.length >= 3);
  assert.ok(report.warnings.some((w) => w.toLowerCase().includes("prior")));
});

test("no model → honest fallback mode, clearly flagged", async () => {
  const report = await inferFromHum({ audio: synthHum({ seed: 7 }) });
  assert.equal(report.fallbackUsed, true);
  assert.equal(report.modelUsed.kind, "heuristic_stub_fallback");
  assert.ok(report.warnings.some((w) => w.includes("FALLBACK")));
  assert.equal(report.support.topFeatureContributions.length, 0);
});

test("silence/degenerate capture is represented honestly (abstain / no intervention)", async () => {
  const model = tinyModel();
  const report = await inferFromHum({ audio: synthSilence({ seed: 3 }), model });
  // Either abstains or is quality-rejected; in both cases no intervention is surfaced.
  if (report.inferredState.abstained) {
    assert.equal(report.intervention.surfaced, false);
    assert.notEqual(report.confidence.abstainReason, "none");
  }
  assert.ok(report.warnings.length > 0);
});

test("inference accepts pre-derived features (no raw audio needed)", async () => {
  const model = tinyModel();
  const features = computeFeatures(synthHum({ seed: 9 }));
  const report = await inferFromHum({ features, model });
  assert.equal(report.features.featureMode, features.featureMode);
  assert.ok(report.inferredState.stateCandidates.length >= 1 || report.inferredState.abstained);
});
