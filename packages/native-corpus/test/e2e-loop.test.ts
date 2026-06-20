import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion, defaultConsent } from "@hum-ai/shared-types";
import { orchestrateHumRead } from "@hum-ai/orchestrator";
import { buildHumNativeArtifact, axisPriorsFromArtifact } from "../src/manifest";
import { learnableArousalCorpus, BASE } from "./fixtures";

const NOW = asIsoTimestamp("2026-06-20T12:00:00.000Z");
const MV = asModelVersion("hum-web@0.1.0");

/**
 * THE LOOP CLOSES: a corpus of confirmed hums → a promoted hum-native model →
 * `AffectAxisPriors` → fed straight into the orchestrator read. The native prior is
 * IN-DOMAIN for a hum (it contributes), unlike the far-domain prior which abstains —
 * this is the whole point of the HiTL retraining loop (ADR-0011).
 */
test("a retrained hum-native model feeds the orchestrator and contributes in-domain", async () => {
  const corpus = learnableArousalCorpus(40);
  const artifact = buildHumNativeArtifact(corpus, NOW);
  assert.equal(artifact.manifest.arousal.decision, "promote");

  const axisPriors = axisPriorsFromArtifact(artifact);
  assert.ok(axisPriors.arousal !== undefined);

  const read = await orchestrateHumRead({
    features: { ...BASE, jitter: 0.06, shimmerProxy: 0.08 },
    consent: defaultConsent(NOW),
    modelVersion: MV,
    now: NOW,
    axisPriors,
  });

  // The native arousal prior contributed (it did NOT abstain OOD like a far-domain prior would).
  assert.equal(read.internal.axis.arousal.trainedContribution, "in_domain");
  assert.equal(read.internal.axis.arousal.trainedPassedGate, true);
  // The dimensional read stays bounded and the spine still produced a safe read.
  assert.ok(read.internal.axis.dimensional.arousal >= -1 && read.internal.axis.dimensional.arousal <= 1);
  assert.equal(read.userFacing.abstained, false);
});

test("with no promoted model, the read falls back cleanly (no native prior, no error)", async () => {
  const read = await orchestrateHumRead({
    features: BASE,
    consent: defaultConsent(NOW),
    modelVersion: MV,
    now: NOW,
    axisPriors: axisPriorsFromArtifact(null),
  });
  assert.equal(read.internal.axis.arousal.trainedContribution, "absent");
});
