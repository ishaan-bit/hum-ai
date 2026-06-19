import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelManifest, type ExperimentResult, type TargetExperimentResult } from "../src/experiment";
import { promotionGate, type CohortMetrics, type PermutationResult } from "../src/cohort-eval";
import { AROUSAL_BINARY_TARGET, AFFECT_FUSION_TARGET, targetSnapshot } from "../src/targets";

function metrics(model: string, balAcc: number, ece = 0.05): CohortMetrics {
  return {
    model, family: "linear", n: 1000, groupCount: 24, folds: 5, numClasses: 2,
    accuracy: balAcc, balancedAccuracy: balAcc, macroF1: balAcc, perClass: [],
    confusion: { labels: [], matrix: [] }, ece,
    chance: { majorityClassAccuracy: 0.5, balancedChance: 0.5 },
  };
}
const perm = (p: number): PermutationResult => ({ metric: "balanced_accuracy", permutations: 150, observed: 0.85, nullMean: 0.5, nullStd: 0.01, pValue: p });

function targetResult(target: typeof AFFECT_FUSION_TARGET, m: CohortMetrics, p: number): TargetExperimentResult {
  const gate = promotionGate(m, perm(p));
  return {
    target: targetSnapshot(target), n: m.n, groupCount: 24, classCounts: {},
    cohort: [m], best: m, permutation: perm(p), permutationModel: "logreg(150it)",
    gate, tier: "supported", selective: [], featureImportance: { target: target.id, n: m.n, numClasses: 2, strongest: [], weakest: [], method: "anova" },
  };
}

function result(targets: TargetExperimentResult[]): ExperimentResult {
  const passing = targets.filter((t) => t.gate.passed);
  const promoted = passing.length
    ? { targetId: passing[0]!.target.id, model: passing[0]!.best.model, balancedAccuracy: passing[0]!.best.balancedAccuracy }
    : null;
  return {
    availability: { dataRoot: "", datasets: [], summary: { total: 6, usable: 3, usableIds: [], byStatus: {} as never } },
    extractions: [], datasetsUsedForSupervised: ["ravdess"], datasetsUsedForDomainOod: ["ravdess", "vocalset", "vocalsound"],
    labeledCount: 2068, gateThreshold: 0.8, targets, domain: null,
    anyTargetPassedGate: passing.length > 0, promoted, artifactsDir: null, artifacts: [],
  };
}

test("manifest does NOT claim promotion when the affect target misses 80%", () => {
  const affect = targetResult(AFFECT_FUSION_TARGET, metrics("random_forest_15", 0.479, 0.073), 0.007);
  const manifest = buildModelManifest(result([affect]), null);
  assert.equal(manifest.priorAffectModel.passedGate, false);
  assert.equal(manifest.promoted, null);
  assert.equal(manifest.targets[0]!.passedGate, false);
  assert.equal(manifest.targets[0]!.artifact, null, "no artifact for a non-promoted target");
  assert.ok(manifest.inferenceImpact.toLowerCase().includes("no target passed") || manifest.inferenceImpact.toLowerCase().includes("retained"));
});

test("a passing coarse target is promoted, but the 6-class affect prior stays NOT-promoted", () => {
  const affect = targetResult(AFFECT_FUSION_TARGET, metrics("random_forest_15", 0.479), 0.007);
  const arousal = targetResult(AROUSAL_BINARY_TARGET, metrics("logreg", 0.831, 0.032), 0.007);
  const manifest = buildModelManifest(result([affect, arousal]), null);
  assert.equal(manifest.priorAffectModel.passedGate, false, "affect prior never silently promoted");
  assert.ok(manifest.priorAffectModel.role.includes("population_prior"));
  assert.equal(manifest.promoted?.targetId, "arousal_binary");
  assert.equal(manifest.promoted?.artifact, "model.arousal_binary.json");
  assert.ok(manifest.promoted?.note.includes("far-domain"), "promotion is clearly flagged far-domain");
  const arousalRow = manifest.targets.find((t) => t.id === "arousal_binary")!;
  assert.equal(arousalRow.passedGate, true);
  assert.equal(arousalRow.artifact, "model.arousal_binary.json");
});

test("gate metadata is recorded as EXPERIMENTAL balanced-accuracy (not raw accuracy)", () => {
  const manifest = buildModelManifest(result([]), null);
  assert.equal(manifest.gate.status, "EXPERIMENTAL");
  assert.equal(manifest.gate.metric, "balanced_accuracy");
  assert.equal(manifest.gate.threshold, 0.8);
});
