import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { buildAvailabilityReport, type DatasetAvailability } from "./datasets";
import { extractDataset, type SignalRow } from "./extract";
import { featureVectorNames, toFeatureVector, featureSchemaSnapshot } from "./feature-schema";
import {
  EXPERIMENT_TARGETS,
  targetSnapshot,
  AROUSAL_BINARY_TARGET,
  VALENCE_BINARY_TARGET,
  AFFECT_FUSION_TARGET,
  type TargetDef,
} from "./targets";
import { artifactPath, assertGitIgnoredArtifactPath, rawDatasetDir } from "./paths";

/**
 * Export bridge for the NEURAL training harness (`research/training/`, Python).
 *
 * The neural cohort must train on the EXACT same labels, actor groups, target
 * derivations, and engineered-feature vectors as the classical cohort — otherwise
 * a "neural beats classical" claim would be comparing two different problems. So
 * TS stays the single source of truth: this command runs the REAL extractor over
 * RAVDESS (the only affect-labelled corpus), then writes a git-ignored JSONL where
 * each row carries:
 *   - `sourceSampleId`  — the WAV entry path inside the RAVDESS zip, so Python can
 *     load the SAME audio (for mel-spectrogram / waveform models) by name;
 *   - `group`           — the RAVDESS actor id, for leakage-safe grouped CV;
 *   - `fusionLabel`     — the harmonized FUSION_LABEL (label mapping owned by TS);
 *   - per-target class  — arousal_binary / valence_binary / affect_fusion_label,
 *     computed by `targets.ts` (Python re-derives nothing, so it cannot drift);
 *   - `features`        — the 58-d `toFeatureVector` representation, so the feature
 *     -space neural models (MLP/hybrid) and the classical baseline share one input.
 *
 * Artifacts are git-ignored (under `data/processed/signal-lab/neural/`); no audio,
 * weights, or tensors are ever written to a tracked path.
 */

export interface NeuralExportRow {
  readonly signalId: string;
  /** WAV entry path inside the RAVDESS zip(s) — Python loads audio by this name. */
  readonly sourceSampleId: string;
  /** RAVDESS actor id, e.g. "actor_07" — the CV grouping key. */
  readonly group: string;
  readonly fusionLabel: FusionLabel;
  /** Per-target class assignment (or null = excluded for that target). */
  readonly targets: Readonly<Record<string, string | null>>;
  /** The 58-d engineered feature vector (matches `featureVectorNames()` order). */
  readonly features: readonly number[];
}

export interface NeuralExportMeta {
  readonly version: string;
  readonly generatedBy: string;
  readonly datasetId: string;
  /** Absolute zip paths Python should open to read audio by `sourceSampleId`. */
  readonly audioArchives: readonly string[];
  readonly featureNames: readonly string[];
  readonly featureVectorLength: number;
  readonly featureSchema: ReturnType<typeof featureSchemaSnapshot>;
  readonly targets: ReturnType<typeof targetSnapshot>[];
  readonly gate: {
    readonly metric: "balanced_accuracy";
    readonly threshold: number;
    readonly eceCap: number;
    readonly maxPValue: number;
    readonly validation: string;
    readonly rationale: string;
  };
  readonly classicalBaseline: Readonly<Record<string, number>>;
  readonly rowCount: number;
  readonly groupCount: number;
  readonly perTargetClassCounts: Readonly<Record<string, Record<string, number>>>;
  readonly governance: string;
}

const TARGET_BY_ID: Record<string, TargetDef> = {
  [AROUSAL_BINARY_TARGET.id]: AROUSAL_BINARY_TARGET,
  [VALENCE_BINARY_TARGET.id]: VALENCE_BINARY_TARGET,
  [AFFECT_FUSION_TARGET.id]: AFFECT_FUSION_TARGET,
};

function rowToExport(r: SignalRow): NeuralExportRow | null {
  if (!r.fusionLabel) return null;
  const label = r.fusionLabel as FusionLabel;
  const targets: Record<string, string | null> = {};
  for (const t of EXPERIMENT_TARGETS) targets[t.id] = TARGET_BY_ID[t.id]!.classOf(label);
  return {
    signalId: r.signalId,
    sourceSampleId: r.sourceSampleId,
    group: r.group ?? "nogroup",
    fusionLabel: label,
    targets,
    features: toFeatureVector(r.features),
  };
}

export interface NeuralExportResult {
  readonly meta: NeuralExportMeta;
  readonly rowsPath: string;
  readonly metaPath: string;
  readonly rowCount: number;
}

export interface NeuralExportOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly onLog?: (m: string) => void;
  /** Cap RAVDESS rows extracted (default: all). */
  readonly cap?: number;
  /** Known classical-baseline balanced accuracies to record for the "beat it" check. */
  readonly classicalBaseline?: Readonly<Record<string, number>>;
  readonly gateThreshold?: number;
}

function writeArtifact(relName: string, content: string, env?: NodeJS.ProcessEnv): string {
  const path = artifactPath(relName, env);
  assertGitIgnoredArtifactPath(path, env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

export function runNeuralExport(opts: NeuralExportOptions = {}): NeuralExportResult {
  const log = opts.onLog ?? (() => {});
  const env = opts.env;
  const gateThreshold = opts.gateThreshold ?? 0.8;

  const availability = buildAvailabilityReport(env);
  const ravdess = availability.datasets.find((d) => d.datasetId === "ravdess");
  if (!ravdess || !ravdess.usableForFeatureExtraction) {
    throw new Error("export-neural: RAVDESS audio not usable on disk; cannot export the labelled training set.");
  }

  log(`Extracting RAVDESS (real extractor)${opts.cap ? ` cap ${opts.cap}` : ""}…`);
  const { rows, summary } = extractDataset(ravdess as DatasetAvailability, { maxPerDataset: opts.cap, env });
  log(`  ${summary.featureRows} rows, ${summary.labeledRows} labeled, decode-fail ${summary.decodeFailures}.`);

  const exportRows: NeuralExportRow[] = [];
  for (const r of rows) {
    const er = rowToExport(r);
    if (er) exportRows.push(er);
  }

  const groups = new Set(exportRows.map((r) => r.group));
  const perTargetClassCounts: Record<string, Record<string, number>> = {};
  for (const t of EXPERIMENT_TARGETS) {
    const counts: Record<string, number> = {};
    for (const r of exportRows) {
      const cls = r.targets[t.id];
      if (cls === null || cls === undefined) continue;
      counts[cls] = (counts[cls] ?? 0) + 1;
    }
    perTargetClassCounts[t.id] = counts;
  }

  const audioArchives = ravdess.archives.filter((a) => a.readable).map((a) => a.path);

  const meta: NeuralExportMeta = {
    version: "signal-lab-neural-export/0.1.0",
    generatedBy: "@hum-ai/signal-lab runNeuralExport",
    datasetId: "ravdess",
    audioArchives,
    featureNames: featureVectorNames(),
    featureVectorLength: featureVectorNames().length,
    featureSchema: featureSchemaSnapshot(),
    targets: EXPERIMENT_TARGETS.map((t) => targetSnapshot(t)),
    gate: {
      metric: "balanced_accuracy",
      threshold: gateThreshold,
      eceCap: 0.15,
      maxPValue: 0.01,
      validation: "speaker/actor-grouped 5-fold CV + label-permutation significance + top-class ECE",
      rationale:
        "Identical gate to the classical cohort (cohort-eval.ts promotionGate). Balanced accuracy so a skewed prior cannot inflate the score.",
    },
    classicalBaseline: opts.classicalBaseline ?? {
      // Prior classical-cohort results under the same grouped CV (see signal-lab-multidataset memory).
      arousal_binary: 0.831,
      valence_binary: 0.694,
      affect_fusion_label: 0.479,
    },
    rowCount: exportRows.length,
    groupCount: groups.size,
    perTargetClassCounts,
    governance:
      "RAVDESS = acted_speech_emotion, far domain (penalty 0.45). Public dataset = PRIOR only, never hum truth, never clinical (ADR-0005). " +
      "Coarse arousal/valence targets only change the QUESTION, not the governance.",
  };

  const rowsJsonl = exportRows.map((r) => JSON.stringify(r)).join("\n") + (exportRows.length ? "\n" : "");
  const rowsPath = writeArtifact("neural/labelled_rows.jsonl", rowsJsonl, env);
  const metaPath = writeArtifact("neural/neural_export_meta.json", JSON.stringify(meta, null, 2), env);

  log(`  wrote ${exportRows.length} rows over ${groups.size} actor groups.`);
  for (const t of EXPERIMENT_TARGETS) {
    log(`    ${t.id}: ${Object.entries(perTargetClassCounts[t.id]!).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
  }

  return { meta, rowsPath, metaPath, rowCount: exportRows.length };
}
