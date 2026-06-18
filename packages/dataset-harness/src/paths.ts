import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";

/**
 * Local-only path conventions for working with public voice datasets.
 *
 * PRIVACY POSTURE: raw audio and any generated manifests live OUTSIDE the git
 * tree. By default everything lives under a sibling folder of the repo root
 * (`../hum-ai-data`); the `HUM_DATA_DIR` env var overrides it. Nothing in this
 * module ever writes into the repo, and `assertOutsideRepo` is the hard guard
 * that refuses any path inside the repo tree.
 */

/** Raw dataset subfolder names we scaffold for. RAVDESS is wired this pass. */
export const RAW_DATASET_DIRS = ["ravdess", "crema-d", "tess", "savee", "emodb"] as const;
export type RawDatasetDir = (typeof RAW_DATASET_DIRS)[number];

/** The default external data dir, relative to the repo root. */
export const DEFAULT_DATA_DIR_REL = "../hum-ai-data";

/** Name of the manifest output subfolder under the data dir (ignored / external). */
export const MANIFEST_DIRNAME = ".manifests";

/**
 * Resolve the repo root from this source file's location.
 * This file lives at <repo>/packages/dataset-harness/src/paths.ts, so the repo
 * root is four levels up.
 */
export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <repo>/packages/dataset-harness/src
  return resolve(here, "..", "..", "..");
}

/**
 * Resolve the local data directory.
 * Order: `HUM_DATA_DIR` env (absolute or relative to cwd) → `../hum-ai-data`
 * resolved from the repo root.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.HUM_DATA_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  return resolve(repoRoot(), DEFAULT_DATA_DIR_REL);
}

/** Resolve the raw folder for a given dataset (e.g. <dataDir>/ravdess). */
export function rawDatasetPath(dataset: RawDatasetDir, env?: NodeJS.ProcessEnv): string {
  return join(resolveDataDir(env), dataset);
}

/** Resolve the SAFE manifest output dir (<dataDir>/.manifests), outside the repo. */
export function manifestOutputDir(env?: NodeJS.ProcessEnv): string {
  return join(resolveDataDir(env), MANIFEST_DIRNAME);
}

/** Resolve the manifest file path for a given dataset id. */
export function manifestPathFor(datasetId: string, env?: NodeJS.ProcessEnv): string {
  return join(manifestOutputDir(env), `${datasetId}.manifest.json`);
}

/**
 * Returns true if `candidate` is inside the repo tree (including the root
 * itself). Uses path containment, not string prefix, so siblings like
 * `<repo>-data` are not falsely flagged.
 */
export function isInsideRepo(candidate: string, root: string = repoRoot()): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true; // the repo root itself
  // Outside if the relative path climbs out (..) or is absolute (different drive).
  return !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Error thrown when a manifest write target lands inside the git tree. */
export class UnsafeManifestPathError extends Error {
  constructor(public readonly targetPath: string) {
    super(
      `Refusing to write a manifest inside the repo tree: ${targetPath}. ` +
        `Manifests and datasets must stay outside git (set HUM_DATA_DIR or use ${DEFAULT_DATA_DIR_REL}).`,
    );
    this.name = "UnsafeManifestPathError";
  }
}

/**
 * Hard guard: throw unless `targetPath` is OUTSIDE the repo tree. Call this
 * before every manifest write.
 */
export function assertOutsideRepo(targetPath: string, root: string = repoRoot()): void {
  if (isInsideRepo(targetPath, root)) {
    throw new UnsafeManifestPathError(targetPath);
  }
}
