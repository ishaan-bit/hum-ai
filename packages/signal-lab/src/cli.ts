import { existsSync, readFileSync } from "node:fs";
import { synthHum, synthSpeechLike } from "@hum-ai/audio-features";
import { buildAvailabilityReport } from "./datasets";
import { runPipeline } from "./pipeline";
import { runExperiment } from "./experiment";
import { runNeuralExport } from "./export-neural";
import { deserializeModel, type LogRegParams } from "./model";
import { inferFromHum, type InferencePromotion } from "./inference";
import { parseNeuralFeatureModel, type NeuralFeatureModel } from "./neural-feature-model";
import { artifactPath } from "./paths";
import {
  buildAvailabilityMarkdown,
  buildInferenceMarkdown,
  ensureArtifactsDir,
  writeArtifactJson,
  writeArtifactText,
} from "./report";

/**
 * @hum-ai/signal-lab CLI. Subcommands (wired as root `signal:*` npm scripts):
 *   availability  — reconcile dataset manifests + on-disk reality (honest status)
 *   extract       — zip-direct feature extraction → git-ignored feature tables
 *   train         — extract + train baseline + evaluate (calibration + significance)
 *   infer         — run a new hum through the learned (or fallback) pipeline
 *   all           — train then infer
 */

const out = (s = "") => process.stdout.write(s + "\n");

function loadModel(env?: NodeJS.ProcessEnv): { model: LogRegParams | null; path: string | null } {
  const p = artifactPath("model.json", env);
  if (existsSync(p)) {
    try {
      return { model: deserializeModel(readFileSync(p, "utf8")), path: p };
    } catch (e) {
      out(`warning: failed to load model at ${p}: ${(e as Error).message}`);
    }
  }
  return { model: null, path: null };
}

/** Load the experiment's gate manifest (if present) into an honest promotion block. */
function loadPromotion(env?: NodeJS.ProcessEnv): InferencePromotion | undefined {
  const p = artifactPath("model_manifest.json", env);
  if (!existsSync(p)) return undefined;
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    return {
      evaluated: true,
      gateMetric: m.gate?.metric ?? "balanced_accuracy",
      gateThreshold: m.gate?.threshold ?? 0.8,
      affectTargetId: m.priorAffectModel?.target ?? "affect_fusion_label",
      affectBalancedAccuracy: m.priorAffectModel?.balancedAccuracy ?? null,
      affectPassedGate: m.priorAffectModel?.passedGate ?? false,
      affectModelRole: m.priorAffectModel?.role ?? "population prior",
      promotedAuxTarget: m.promoted?.targetId ?? null,
      promotedAuxBalancedAccuracy: m.promoted?.balancedAccuracy ?? null,
      datasetsUsed: m.datasets?.supervised ?? [],
      note: m.inferenceImpact ?? "",
    };
  } catch {
    return undefined;
  }
}

/**
 * Load a promoted feature-space NEURAL model (gate-passed coarse prior) if its
 * git-ignored artifact exists. Pure-TS op-graph — no Python/ONNX/GPU at runtime.
 * Returns null (and the runtime keeps its classical/fallback behavior) when the
 * artifact is absent or the feature contract has drifted.
 */
function loadNeuralAux(env?: NodeJS.ProcessEnv): { model: NeuralFeatureModel | null; path: string | null } {
  for (const name of ["neural/model.neural.arousal_binary.json", "neural/model.neural.valence_binary.json"]) {
    const p = artifactPath(name, env);
    if (existsSync(p)) {
      try {
        return { model: parseNeuralFeatureModel(readFileSync(p, "utf8")), path: p };
      } catch (e) {
        out(`warning: neural aux model at ${p} not loadable: ${(e as Error).message}`);
      }
    }
  }
  return { model: null, path: null };
}

async function runInfer(env?: NodeJS.ProcessEnv, kind: "hum" | "speech" = "hum"): Promise<void> {
  const { model, path } = loadModel(env);
  const promotion = loadPromotion(env);
  const neural = loadNeuralAux(env);
  const audio = kind === "speech" ? synthSpeechLike({ seed: 11 }) : synthHum({ seed: 7 });
  out(`\ninfer: demo capture = synthetic ${kind} (deterministic; no audio committed). Model: ${model ? "trained" : "FALLBACK (none found)"}${neural.model ? `; +neural aux '${neural.model.target}'` : ""}`);
  const report = await inferFromHum({
    audio,
    model,
    modelArtifactPath: path,
    promotion,
    neuralAuxModel: neural.model,
    neuralAuxArtifactPath: neural.path,
  });
  out(buildInferenceMarkdown(report));
  ensureArtifactsDir(env);
  writeArtifactJson(`inference_demo.${kind}.json`, report, env);
  writeArtifactText(`INFERENCE_DEMO.${kind}.md`, buildInferenceMarkdown(report), env);
}

async function main(argv: readonly string[]): Promise<number> {
  const cmd = argv[2] ?? "help";
  const env = process.env;

  switch (cmd) {
    case "availability": {
      const report = buildAvailabilityReport(env);
      out(buildAvailabilityMarkdown(report));
      ensureArtifactsDir(env);
      writeArtifactJson("dataset_availability.json", report, env);
      writeArtifactText("DATASET_AVAILABILITY.md", buildAvailabilityMarkdown(report), env);
      return 0;
    }
    case "extract": {
      // Extract ALL usable datasets (bounded) for feature-distribution artifacts.
      const res = runPipeline({ env, onLog: out, write: true, maxPerDataset: 500, minLabeled: Number.MAX_SAFE_INTEGER });
      out(`\nExtracted ${res.extractions.reduce((s, e) => s + e.featureRows, 0)} rows. Artifacts:`);
      for (const a of res.artifacts) out(`  ${a}`);
      return 0;
    }
    case "train":
    case "eval": {
      // Train on the only locally-labeled affect dataset (RAVDESS).
      const res = runPipeline({ env, onLog: out, write: true, datasets: ["ravdess"] });
      out(`\nTrained: ${res.trained}. Artifacts written:`);
      for (const a of res.artifacts) out(`  ${a}`);
      return 0;
    }
    case "infer": {
      await runInfer(env, argv[3] === "speech" ? "speech" : "hum");
      return 0;
    }
    case "experiment": {
      // Multi-dataset modeling experiment: model cohort × targets + 80% gate +
      // cross-corpus domain/OOD. `otherCap` bounds the big singing/burst corpora.
      const res = await runExperiment({ env, onLog: out, write: true, otherCap: 800 });
      out(`\nGate outcome: ${res.anyTargetPassedGate ? `PROMOTED ${res.promoted!.targetId} (${res.promoted!.model}, ${(res.promoted!.balancedAccuracy * 100).toFixed(1)}%)` : "no target reached 80%."}`);
      out("Artifacts written:");
      for (const a of res.artifacts) out(`  ${a}`);
      return 0;
    }
    case "export-neural": {
      // Dump the labelled RAVDESS training set (features + label + actor group +
      // per-target classes) to a git-ignored JSONL for the Python neural harness.
      const res = runNeuralExport({ env, onLog: out });
      out(`\nExported ${res.rowCount} labelled rows over ${res.meta.groupCount} actor groups.`);
      out(`  rows: ${res.rowsPath}`);
      out(`  meta: ${res.metaPath}`);
      return 0;
    }
    case "all": {
      const res = runPipeline({ env, onLog: out, write: true });
      out(`\nTrained: ${res.trained}.`);
      await runInfer(env, "hum");
      return 0;
    }
    default:
      out("Usage: signal-lab <availability|extract|train|eval|infer|all>");
      out("  availability  reconcile dataset manifests + on-disk reality");
      out("  extract       zip-direct feature extraction → git-ignored feature tables");
      out("  train | eval  extract + train baseline + evaluate (calibration + significance)");
      out("  infer [speech] run a synthetic new hum through the learned (or fallback) pipeline");
      out("  experiment    multi-dataset model cohort × targets + 80% gate + cross-corpus domain/OOD");
      out("  all           train then infer");
      return cmd === "help" ? 0 : 1;
  }
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`signal-lab failed: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
