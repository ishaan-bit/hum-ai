import { existsSync } from "node:fs";
import { rawDatasetPath, type RawDatasetDir } from "./paths";
import { buildManifest, countByEmotion, type Manifest } from "./manifest";

/** Outcome of validating a single dataset directory. */
export interface ValidationReport {
  readonly datasetId: string;
  readonly datasetDir: string;
  readonly present: boolean;
  readonly scanned: number;
  readonly parsed: number;
  readonly skipped: number;
  readonly countsByEmotion: Record<string, number>;
  readonly countsBySplit: Record<string, number>;
  /** Human-readable status line. */
  readonly message: string;
}

/** Tally a manifest's entries by split (when present). */
function countBySplit(manifest: Manifest): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of manifest.entries) {
    const key = e.split ?? "unsplit";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Validate a dataset directory: check it exists, build a manifest in-memory, and
 * report counts. A missing dataset is handled gracefully (clear message, no
 * throw) — callers/CLI should treat it as a non-error.
 */
export function validateDataset(
  dataset: RawDatasetDir,
  env: NodeJS.ProcessEnv = process.env,
): ValidationReport {
  const datasetDir = rawDatasetPath(dataset, env);
  const present = existsSync(datasetDir);

  if (!present) {
    return {
      datasetId: dataset,
      datasetDir,
      present: false,
      scanned: 0,
      parsed: 0,
      skipped: 0,
      countsByEmotion: {},
      countsBySplit: {},
      message: `dataset "${dataset}" not found at ${datasetDir} — skipping (place data here or set HUM_DATA_DIR).`,
    };
  }

  const manifest = buildManifest(dataset, env);
  const countsByEmotion = countByEmotion(manifest);
  const countsBySplit = countBySplit(manifest);

  const message =
    manifest.status === "empty"
      ? `dataset "${dataset}" found at ${datasetDir} but contains no audio files.`
      : `dataset "${dataset}" OK: scanned ${manifest.scanned}, parsed ${manifest.parsed}, skipped ${manifest.skipped}.`;

  return {
    datasetId: dataset,
    datasetDir,
    present: true,
    scanned: manifest.scanned,
    parsed: manifest.parsed,
    skipped: manifest.skipped,
    countsByEmotion,
    countsBySplit,
    message,
  };
}

/** Render a validation report as a human-readable, actionable block. */
export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(report.message);
  if (report.present && report.scanned > 0) {
    const emotions = Object.entries(report.countsByEmotion)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `    ${k}: ${v}`);
    if (emotions.length > 0) {
      lines.push("  by emotion label:");
      lines.push(...emotions);
    }
    const splits = Object.entries(report.countsBySplit);
    const hasRealSplits = splits.some(([k]) => k !== "unsplit");
    if (hasRealSplits) {
      lines.push("  by split:");
      for (const [k, v] of splits.sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`    ${k}: ${v}`);
      }
    }
  }
  return lines.join("\n");
}
