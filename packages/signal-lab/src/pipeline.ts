import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { buildAvailabilityReport, type AvailabilityReport, type DatasetAvailability } from "./datasets";
import { extractDataset, type ExtractionSummary, type SignalRow } from "./extract";
import { featureVectorNames, toFeatureVector, featureSchemaSnapshot } from "./feature-schema";
import { labelMappingSnapshot, supportedFusionLabels } from "./labels";
import { trainLogReg, type LogRegParams } from "./model";
import { evaluate, type EvalResult, type LabeledSample } from "./evaluate";
import {
  ensureArtifactsDir,
  writeArtifactJson,
  writeArtifactText,
  writeArtifactJsonl,
  buildAvailabilityMarkdown,
  buildEvaluationMarkdown,
  buildModelCardMarkdown,
  buildReadinessMarkdown,
} from "./report";

/**
 * High-level orchestration of the offline pipeline so the CLI and tests share one
 * code path. Each stage degrades gracefully: a dataset with no decodable audio is
 * skipped (not fatal), and if there are too few labeled samples to learn from, the
 * pipeline emits feature/availability/readiness artifacts WITHOUT fabricating a
 * model (per the task: produce a readiness report instead of pretending).
 */

export interface PipelineOptions {
  /** Which datasets to extract (default: all usable). */
  readonly datasets?: readonly string[];
  readonly maxPerDataset?: number;
  readonly folds?: number;
  readonly iterations?: number;
  readonly permutations?: number;
  readonly permIterations?: number;
  /** Minimum labeled samples required before training a model (default 60). */
  readonly minLabeled?: number;
  /** Write artifacts to the git-ignored artifacts dir (default true). */
  readonly write?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly onProgress?: (datasetId: string, done: number, total: number) => void;
  readonly onLog?: (message: string) => void;
}

export interface PipelineResult {
  readonly availability: AvailabilityReport;
  readonly extractions: readonly ExtractionSummary[];
  readonly labeledSampleCount: number;
  readonly model: LogRegParams | null;
  readonly evaluation: EvalResult | null;
  readonly artifactsDir: string | null;
  readonly artifacts: readonly string[];
  readonly trained: boolean;
}

/** Vectorize labeled rows into CV samples (only rows with a fusionLabel + group). */
export function vectorizeLabeled(rows: readonly SignalRow[]): LabeledSample[] {
  const out: LabeledSample[] = [];
  for (const r of rows) {
    if (!r.fusionLabel) continue;
    out.push({
      vector: toFeatureVector(r.features),
      label: r.fusionLabel as FusionLabel,
      group: r.group ?? `${r.sourceDataset}:nogroup`,
    });
  }
  return out;
}

export function runPipeline(opts: PipelineOptions = {}): PipelineResult {
  const env = opts.env;
  const log = opts.onLog ?? (() => {});
  const write = opts.write ?? true;
  const minLabeled = opts.minLabeled ?? 60;

  const availability = buildAvailabilityReport(env);
  log(`Availability: ${availability.summary.usable}/${availability.summary.total} usable (${availability.summary.usableIds.join(", ") || "none"}).`);

  const usable: DatasetAvailability[] = availability.datasets.filter((d) => {
    if (!d.usableForFeatureExtraction) return false;
    if (opts.datasets && !opts.datasets.includes(d.datasetId)) return false;
    return true;
  });

  const extractions: ExtractionSummary[] = [];
  const labeledRows: SignalRow[] = [];
  const artifacts: string[] = [];

  let artDir: string | null = null;
  if (write) {
    artDir = ensureArtifactsDir(env);
    artifacts.push(writeArtifactJson("dataset_availability.json", availability, env));
    artifacts.push(writeArtifactText("DATASET_AVAILABILITY.md", buildAvailabilityMarkdown(availability), env));
    artifacts.push(writeArtifactJson("feature_schema.json", featureSchemaSnapshot(), env));
    artifacts.push(writeArtifactJson("label_mapping.json", labelMappingSnapshot(), env));
  }

  for (const d of usable) {
    log(`Extracting ${d.datasetId}…`);
    const { rows, summary } = extractDataset(d, {
      maxPerDataset: opts.maxPerDataset,
      env,
      onProgress: opts.onProgress,
    });
    extractions.push(summary);
    log(`  ${d.datasetId}: ${summary.featureRows} rows (${summary.labeledRows} labeled, decode-fail ${summary.decodeFailures}).`);
    if (write && rows.length > 0) {
      artifacts.push(writeArtifactJsonl(`features.${d.datasetId}.jsonl`, rows, env));
    }
    for (const r of rows) if (r.fusionLabel) labeledRows.push(r);
  }

  if (write) {
    artifacts.push(writeArtifactJson("feature_extraction_summary.json", extractions, env));
  }

  const samples = vectorizeLabeled(labeledRows);
  const labels = supportedFusionLabels();
  const distinctLabels = new Set(samples.map((s) => s.label));
  const featureNames = featureVectorNames();

  let model: LogRegParams | null = null;
  let evaluation: EvalResult | null = null;

  const canTrain = samples.length >= minLabeled && distinctLabels.size >= 2;
  if (canTrain) {
    log(`Training baseline LogReg on ${samples.length} labeled samples over ${distinctLabels.size} classes…`);
    const trainLabels = labels.filter((l) => distinctLabels.has(l));
    model = trainLogReg(
      samples.map((s) => s.vector),
      samples.map((s) => s.label),
      { labels: trainLabels, featureNames, iterations: opts.iterations },
    );
    log("Evaluating (actor-grouped CV + permutation significance)…");
    evaluation = evaluate(samples, {
      labels: trainLabels,
      featureNames,
      folds: opts.folds,
      iterations: opts.iterations,
      permutations: opts.permutations,
      permIterations: opts.permIterations,
    });
    log(`  accuracy ${(evaluation.accuracy * 100).toFixed(1)}% vs chance ${(evaluation.chance.majorityClassAccuracy * 100).toFixed(1)}%, p=${evaluation.significance.pValue.toFixed(3)}, tier ${evaluation.evidence.tier}.`);
  } else {
    log(`Not enough labeled audio to train (have ${samples.length}, need ≥${minLabeled}, classes ${distinctLabels.size}). Emitting readiness only.`);
  }

  if (write && artDir) {
    if (model) artifacts.push(writeArtifactText("model.json", JSON.stringify(model, null, 2), env));
    if (evaluation) {
      artifacts.push(writeArtifactJson("evaluation_report.json", evaluation, env));
      artifacts.push(writeArtifactText("EVALUATION_REPORT.md", buildEvaluationMarkdown(evaluation), env));
    }
    if (model) {
      const trainDataset = usable.find((d) => d.taskFamily === "affect_prior")?.datasetId ?? "ravdess";
      artifacts.push(writeArtifactText("MODEL_CARD.md", buildModelCardMarkdown(model, evaluation, trainDataset), env));
    }
    artifacts.push(
      writeArtifactText(
        "MODEL_READINESS_REPORT.md",
        buildReadinessMarkdown({
          availability,
          extractions,
          evaluation,
          modelTrained: model !== null,
          artifactsDir: artDir,
        }),
        env,
      ),
    );
  }

  return {
    availability,
    extractions,
    labeledSampleCount: samples.length,
    model,
    evaluation,
    artifactsDir: artDir,
    artifacts,
    trained: model !== null,
  };
}
