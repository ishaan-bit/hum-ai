import { existsSync, readFileSync } from "node:fs";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { synthHum, synthSpeechLike } from "@hum-ai/audio-features";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { buildAvailabilityReport } from "./datasets";
import { runPipeline } from "./pipeline";
import { runExperiment } from "./experiment";
import { runNeuralExport } from "./export-neural";
import { deserializeModel, serializeModel, trainLogReg, type LogRegParams } from "./model";
import { featureVectorNames, toFeatureVector } from "./feature-schema";
import { AROUSAL_BINARY_TARGET, VALENCE_BINARY_TARGET, type TargetDef } from "./targets";
import { inferFromHum } from "./inference";
import { loadNeuralAuxModel, loadPromotionManifest } from "./manifest";
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

async function runInfer(env?: NodeJS.ProcessEnv, kind: "hum" | "speech" = "hum"): Promise<void> {
  const { model, path } = loadModel(env);
  const promotion = loadPromotionManifest({ env });
  const neural = loadNeuralAuxModel({ env, onWarn: (m) => out(`warning: ${m}`) });
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

/** A persisted RAVDESS feature row (subset we need): the derived features + its fusion label. */
interface PersistedFeatureRow {
  readonly fusionLabel?: string | null;
  readonly features: AcousticFeatures;
}

/** Read `features.ravdess.jsonl` into rows (only those carrying a fusion label). */
function loadLabelledFeatureRows(env?: NodeJS.ProcessEnv): PersistedFeatureRow[] {
  const p = artifactPath("features.ravdess.jsonl", env);
  if (!existsSync(p)) return [];
  const rows: PersistedFeatureRow[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as PersistedFeatureRow;
      if (r.fusionLabel && r.features) rows.push(r);
    } catch {
      // Skip a partway-written line; never throw on a malformed row.
    }
  }
  return rows;
}

/**
 * Train + persist the browser-runnable COARSE AXIS priors (valence + arousal binary
 * LogReg over `AcousticFeatures`). These are the gate-relevant axes the runtime LEADS
 * with from the first hum (arousal cleared the 80% gate; valence is a developing,
 * below-gate prior). Same deterministic recipe as the experiment's promoted artifact;
 * honest accuracy + gate status come from the co-located `model_manifest.json`.
 */
function runAxes(env?: NodeJS.ProcessEnv, log: (s: string) => void = out): number {
  const rows = loadLabelledFeatureRows(env);
  if (rows.length === 0) {
    log(
      "axes: no labelled feature rows found at data/processed/signal-lab/features.ravdess.jsonl — " +
        "run `npm run signal:extract` (or `signal:experiment`) first.",
    );
    return 1;
  }
  const featureNames = featureVectorNames();
  ensureArtifactsDir(env);
  const written: string[] = [];
  for (const target of [AROUSAL_BINARY_TARGET, VALENCE_BINARY_TARGET] as TargetDef[]) {
    const X: number[][] = [];
    const y: string[] = [];
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const cls = target.classOf(r.fusionLabel as FusionLabel);
      if (cls === null) continue;
      X.push(toFeatureVector(r.features));
      y.push(cls);
      counts[cls] = (counts[cls] ?? 0) + 1;
    }
    if (X.length < 60 || new Set(y).size < 2) {
      log(`  ${target.id}: only ${X.length} usable samples / ${new Set(y).size} classes — skipped.`);
      continue;
    }
    const model = trainLogReg(X, y, {
      labels: target.classes.filter((c) => counts[c] !== undefined),
      featureNames,
      version: `signal-lab-${target.id}/0.1.0`,
    });
    const path = writeArtifactText(`model.${target.id}.json`, serializeModel(model), env);
    written.push(path);
    log(`  ${target.id}: trained on ${X.length} samples (${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}) → ${path}`);
  }
  log(`\naxes: wrote ${written.length} axis model artifact(s). Honest accuracy + gate status live in model_manifest.json.`);
  return written.length > 0 ? 0 : 1;
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
    case "axes": {
      // Train + persist the browser-runnable coarse VALENCE + AROUSAL axis priors
      // (the dimensional read the runtime leads with from the first hum).
      return runAxes(env);
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
      out("  axes          train + persist the browser-runnable valence + arousal axis priors");
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
