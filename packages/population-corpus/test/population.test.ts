import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp, asModelVersion } from "@hum-ai/shared-types";
import {
  assertValidPopulationContribution,
  InvalidPopulationContributionError,
  type NativeHumExample,
  type PopulationContribution,
} from "@hum-ai/affect-model-contracts";
import { refHum, stubAxisPrior } from "@hum-ai/sim-lab";
import {
  poolContributions,
  computePopulationOceanNorms,
  trainPopulationArtifact,
  hasPromotedPopulationModel,
  populationAxisPriors,
  selectAxisPriors,
  serializePopulationArtifact,
  parsePopulationArtifact,
  buildPopulationContribution,
  contributorPseudonym,
  POPULATION_MIN_CONTRIBUTORS,
} from "../src/index";

const now = asIsoTimestamp("2026-06-24T00:00:00.000Z");
const mv = asModelVersion("hum-test@0.1.0");

/** A deterministic, feature-varied native example (varied so OCEAN windows are non-degenerate). */
function example(contributorKey: string, i: number): NativeHumExample {
  const t = (i % 10) / 10;
  const high = i % 2 === 0;
  return {
    id: `${contributorKey}-${i}`,
    capturedAt: now,
    modelVersion: mv,
    features: refHum({
      pitchRangeSemitones: 1 + t * 4,
      amplitudeStability: 0.6 + t * 0.35,
      pitchStability: 0.6 + t * 0.35,
      meanRms: 0.04 + t * 0.1,
      peakAmplitude: 0.2 + t * 0.5,
      spectralCentroidHz: 700 + t * 800,
      jitter: 0.006 + t * 0.03,
      shimmerProxy: 0.05 + t * 0.3,
      breathinessProxy: 0.1 + t * 0.5,
      residualPitchInstability: 0.05 + t * 0.4,
      residualInstabilityScore: 0.1 + t * 0.4,
      musicalityScore: 0.2 + t * 0.5,
      activeFrameRatio: 0.5 + t * 0.4,
    }),
    predicted: { valence: 0, arousal: 0 },
    predictedConfidence: 0.5,
    label: { valence: high ? 0.6 : -0.6, arousal: high ? 0.5 : -0.5 },
    source: "self_report_adjust",
    agreedWithRead: false,
    captureQualityScore: 0.8,
    eligible: true,
    provenance: "in_app_hitl_self_report",
    featureSchemaVersion: "hum-state-v2",
  };
}

function contribution(contributorKey: string, i: number): PopulationContribution {
  return {
    contributionId: `c-${contributorKey}-${i}`,
    contributorKey,
    example: example(contributorKey, i),
    consentVersion: "population-consent-v1",
    contributedAt: now,
  };
}

/** Build `users` contributors × `each` hums each. */
function pool(users: number, each: number): PopulationContribution[] {
  const out: PopulationContribution[] = [];
  for (let u = 0; u < users; u++) for (let i = 0; i < each; i++) out.push(contribution(`person-${u}`, i));
  return out;
}

test("assertValidPopulationContribution rejects an identifying contributor key", () => {
  const c = contribution("kumar@example.com", 0);
  assert.throws(() => assertValidPopulationContribution(c), InvalidPopulationContributionError);
});

test("assertValidPopulationContribution accepts a pseudonymous, benign, derived-only row", () => {
  assert.doesNotThrow(() => assertValidPopulationContribution(contribution("person-1", 0)));
});

test("poolContributions dedupes by id, counts distinct contributors, and groups CV by contributor", () => {
  const contribs = [...pool(3, 4), contribution("person-0", 0)]; // duplicate id person-0-0
  const pooled = poolContributions(contribs);
  assert.equal(pooled.contributorCount, 3);
  assert.equal(pooled.corpus.examples.length, 12); // 3×4 unique ids (dup folded)
  // The fold key returns the contributor pseudonym, so a person's hums share a CV fold.
  const ex = pooled.corpus.examples.find((e) => e.id === "person-1-2")!;
  assert.equal(pooled.foldKey(ex), "person-1");
});

test("poolContributions drops unsafe contributions instead of throwing", () => {
  const bad = contribution("has@email", 0);
  const pooled = poolContributions([...pool(2, 3), bad]);
  assert.equal(pooled.contributorCount, 2); // the email-keyed row was dropped
});

test("computePopulationOceanNorms emits data-grounded windows for well-sampled cues", () => {
  const pooled = poolContributions(pool(10, 5)); // 50 examples → above MIN_SAMPLES
  const { norms, support, skipped } = computePopulationOceanNorms(pooled.corpus.examples);
  // The defining openness cue should get a data window (lo < hi), backed by all examples.
  const ow = norms["openness.pitchRangeSemitones"];
  assert.ok(ow && ow.hi > ow.lo, "openness pitch-range window should be recomputed from data");
  assert.equal(support["openness.pitchRangeSemitones"], 50);
  assert.ok(!skipped.includes("openness.pitchRangeSemitones"));
});

test("computePopulationOceanNorms skips cues with too few samples (keeps protocol default)", () => {
  const pooled = poolContributions(pool(2, 3)); // 6 examples < MIN_SAMPLES (30)
  const { norms, skipped } = computePopulationOceanNorms(pooled.corpus.examples);
  assert.equal(Object.keys(norms).length, 0);
  assert.ok(skipped.includes("openness.pitchRangeSemitones"));
});

test("trainPopulationArtifact withholds axis priors below the contributor-diversity floor", () => {
  const artifact = trainPopulationArtifact(pool(POPULATION_MIN_CONTRIBUTORS - 1, 6), now);
  assert.equal(artifact.eligibleForPromotion, false);
  assert.equal(hasPromotedPopulationModel(artifact), false);
  // No axis prior may steer a read when the corpus is contributor-thin, even if axes "promoted".
  assert.deepEqual(populationAxisPriors(artifact), {});
});

test("trainPopulationArtifact runs the grouped-CV gate and serializes round-trip", () => {
  const artifact = trainPopulationArtifact(pool(12, 6), now); // 72 examples, 12 contributors
  assert.equal(artifact.version, "population-artifact-v1");
  assert.equal(artifact.contributorCount, 12);
  assert.equal(artifact.exampleCount, 72);
  assert.equal(artifact.eligibleForPromotion, true);
  assert.equal(artifact.provenance.groupedCV, true);
  // Both axes ran the honest gate (decision is a valid verdict either way — promotion is not forced).
  for (const axis of [artifact.axes.manifest.valence, artifact.axes.manifest.arousal]) {
    assert.ok(["promote", "hold"].includes(axis.decision));
  }
  // OCEAN norms were computed (72 ≥ MIN_SAMPLES).
  assert.ok(Object.keys(artifact.oceanNorms).length > 0);
  // Round-trips losslessly through JSON.
  const parsed = parsePopulationArtifact(serializePopulationArtifact(artifact));
  assert.ok(parsed);
  assert.equal(parsed!.contributorCount, 12);
});

test("selectAxisPriors prefers personal > population > far-domain per axis", () => {
  const far = { valence: stubAxisPrior("valence", { value: 0.1, ood: 0.1, inDomain: true, passedGate: true }), arousal: stubAxisPrior("arousal", { value: 0.1, ood: 0.1, inDomain: true, passedGate: true }) };
  const population = { valence: stubAxisPrior("valence", { value: 0.5, ood: 0.1, inDomain: true, passedGate: true, nativeDomain: true }) };
  const personal = { arousal: stubAxisPrior("arousal", { value: 0.9, ood: 0.05, inDomain: true, passedGate: true, nativeDomain: true }) };

  const chosen = selectAxisPriors({ personal, population, farDomain: far });
  // valence: no personal → population wins over far-domain.
  assert.equal(chosen.valence, population.valence);
  // arousal: personal wins over far-domain (population had none for arousal).
  assert.equal(chosen.arousal, personal.arousal);
});

test("selectAxisPriors falls back to far-domain when no native tiers exist", () => {
  const far = { valence: stubAxisPrior("valence", { value: 0.1, ood: 0.1, inDomain: true, passedGate: true }) };
  const chosen = selectAxisPriors({ farDomain: far });
  assert.equal(chosen.valence, far.valence);
  assert.equal(chosen.arousal, undefined);
});

test("contributorPseudonym is stable, non-identifying, and seed-distinct", () => {
  const a = contributorPseudonym("local-device-1");
  assert.equal(a, contributorPseudonym("local-device-1")); // stable
  assert.notEqual(a, contributorPseudonym("local-device-2")); // seed-distinct
  assert.ok(!a.includes("@"), "pseudonym must not look like an email/uid");
  assert.match(a, /^contrib-[0-9a-f]{8}$/);
});

test("buildPopulationContribution mints a guard-valid, globally-unique pooled row", () => {
  const ex = example("person-3", 2);
  const c = buildPopulationContribution({
    example: ex,
    contributorKey: contributorPseudonym("device-x"),
    consentVersion: "population-consent-v1",
    contributedAt: now,
  });
  assert.doesNotThrow(() => assertValidPopulationContribution(c));
  // contributionId is contributor-scoped so two devices can't collide on the same hum id.
  assert.ok(c.contributionId.startsWith(c.contributorKey + ":"));
  assert.equal(c.example, ex);
});
