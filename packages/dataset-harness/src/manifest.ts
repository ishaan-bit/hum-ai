import { existsSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  rawDatasetPath,
  manifestOutputDir,
  manifestPathFor,
  assertOutsideRepo,
  type RawDatasetDir,
} from "./paths";
import { parseRavdessFilename, RAVDESS_DATASET_ID, type RavdessEmotion } from "./ravdess";

/** Audio extensions we recognize when scanning a dataset folder. */
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".opus"]);

/** One row of a dataset manifest. */
export interface ManifestEntry {
  readonly datasetId: string;
  /** Path relative to the dataset's raw folder, POSIX-style. */
  readonly relPath: string;
  readonly emotion: RavdessEmotion | "unknown";
  readonly actor: number | null;
  readonly gender: "male" | "female" | null;
  readonly split?: string;
}

export type ManifestStatus = "ok" | "missing_directory" | "empty";

/** A typed manifest plus a human-readable status. */
export interface Manifest {
  readonly datasetId: string;
  readonly datasetDir: string;
  readonly status: ManifestStatus;
  readonly scanned: number;
  readonly parsed: number;
  readonly skipped: number;
  readonly entries: readonly ManifestEntry[];
  /** ISO timestamp of when the manifest was built. */
  readonly generatedAt: string;
}

/** Recursively collect audio file paths under `dir`. */
function collectAudioFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full);
        continue;
      }
      const lower = name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const ext = dot >= 0 ? lower.slice(dot) : "";
      if (AUDIO_EXTENSIONS.has(ext)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Convert an OS path to a POSIX-style relative path. */
function toPosixRel(from: string, to: string): string {
  return relative(from, to).split(/[\\/]/).join("/");
}

/**
 * Scan a single dataset directory and build a typed manifest. Pure scanning +
 * parsing — never writes anything. A missing directory yields an empty manifest
 * with status `missing_directory` (not an error). Only RAVDESS parsing is wired
 * this pass; other datasets scan but carry `emotion: "unknown"`.
 */
export function buildManifest(
  dataset: RawDatasetDir = RAVDESS_DATASET_ID,
  env: NodeJS.ProcessEnv = process.env,
): Manifest {
  const datasetDir = rawDatasetPath(dataset, env);
  const generatedAt = new Date().toISOString();

  if (!existsSync(datasetDir)) {
    return {
      datasetId: dataset,
      datasetDir,
      status: "missing_directory",
      scanned: 0,
      parsed: 0,
      skipped: 0,
      entries: [],
      generatedAt,
    };
  }

  const files = collectAudioFiles(datasetDir);
  const entries: ManifestEntry[] = [];
  let parsed = 0;
  let skipped = 0;

  for (const file of files) {
    const relPath = toPosixRel(datasetDir, file);
    if (dataset === RAVDESS_DATASET_ID) {
      const result = parseRavdessFilename(file);
      if (result.ok) {
        parsed++;
        entries.push({
          datasetId: dataset,
          relPath,
          emotion: result.record.emotion,
          actor: result.record.actor,
          gender: result.record.gender,
        });
      } else {
        skipped++;
      }
    } else {
      // Other datasets: scaffolded scan only, no parser wired yet.
      skipped++;
      entries.push({
        datasetId: dataset,
        relPath,
        emotion: "unknown",
        actor: null,
        gender: null,
      });
    }
  }

  return {
    datasetId: dataset,
    datasetDir,
    status: files.length === 0 ? "empty" : "ok",
    scanned: files.length,
    parsed,
    skipped,
    entries,
    generatedAt,
  };
}

/** Result of writing a manifest to disk. */
export interface ManifestWriteResult {
  readonly outputPath: string;
  readonly bytesWritten: number;
}

/**
 * Write a manifest to the SAFE output dir (outside the repo tree). Refuses, via
 * `assertOutsideRepo`, to ever write inside git. Creates the output dir if
 * needed.
 */
export function writeManifest(
  manifest: Manifest,
  env: NodeJS.ProcessEnv = process.env,
): ManifestWriteResult {
  const outputPath = manifestPathFor(manifest.datasetId, env);
  assertOutsideRepo(manifestOutputDir(env));
  assertOutsideRepo(outputPath);
  mkdirSync(manifestOutputDir(env), { recursive: true });
  const json = JSON.stringify(manifest, null, 2);
  writeFileSync(outputPath, json, "utf8");
  return { outputPath, bytesWritten: Buffer.byteLength(json, "utf8") };
}

/** Build then write a manifest in one step. */
export function buildAndWriteManifest(
  dataset: RawDatasetDir = RAVDESS_DATASET_ID,
  env: NodeJS.ProcessEnv = process.env,
): { manifest: Manifest; write: ManifestWriteResult } {
  const manifest = buildManifest(dataset, env);
  const write = writeManifest(manifest, env);
  return { manifest, write };
}

/** Tally manifest entries by emotion label (for reporting). */
export function countByEmotion(manifest: Manifest): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of manifest.entries) {
    counts[e.emotion] = (counts[e.emotion] ?? 0) + 1;
  }
  return counts;
}
