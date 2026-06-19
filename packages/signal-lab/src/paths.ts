import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative, isAbsolute, sep } from "node:path";

/**
 * Local-only path conventions for the offline signal lab.
 *
 * PRIVACY POSTURE (mirrors `@hum-ai/dataset-harness/src/paths.ts` and ADR-0005):
 * raw audio, feature tables, and trained-model artifacts are LOCAL ONLY and must
 * never be tracked. Unlike the dataset-harness (which writes manifests OUTSIDE the
 * repo under `../hum-ai-data`), the public datasets in this repo were prepared
 * in-tree under the git-ignored `data/` folder, and the existing research artifact
 * already lives at `data/processed/model-signal-lab/`. We therefore default the
 * data root to the in-repo `data/` directory (which `.gitignore` excludes in full),
 * and write all generated artifacts under `data/processed/signal-lab/`.
 *
 * `HUM_DATA_DIR` overrides the data root (absolute or cwd-relative), matching the
 * dataset-harness env convention, so an external data dir works unchanged.
 */

/** Resolve the repo root from this file: <repo>/packages/signal-lab/src/paths.ts. */
export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

/** The in-repo, git-ignored data directory (override with HUM_DATA_DIR). */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.HUM_DATA_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  return join(repoRoot(), "data");
}

/** Raw dataset folder, e.g. <dataDir>/raw/ravdess. */
export function rawDatasetDir(datasetId: string, env?: NodeJS.ProcessEnv): string {
  return join(resolveDataDir(env), "raw", datasetId);
}

/** Hand-authored dataset metadata manifests live here (git-ignored, *.manifest.json). */
export function manifestsDir(env?: NodeJS.ProcessEnv): string {
  return join(resolveDataDir(env), "manifests");
}

/** All signal-lab generated artifacts live here (git-ignored, reproducible). */
export function artifactsDir(env?: NodeJS.ProcessEnv): string {
  return join(resolveDataDir(env), "processed", "signal-lab");
}

/** Resolve a named artifact path inside the artifacts dir. */
export function artifactPath(name: string, env?: NodeJS.ProcessEnv): string {
  return join(artifactsDir(env), name);
}

/**
 * True if `candidate` resolves inside the repo tree (containment, not prefix).
 */
export function isInsideRepo(candidate: string, root: string = repoRoot()): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true;
  return !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Guard before writing artifacts: an artifact target is safe only if it is OUTSIDE
 * the repo, OR inside the git-ignored `data/` tree. This is the signal-lab analogue
 * of dataset-harness `assertOutsideRepo` — it permits the in-repo `data/processed`
 * convention while still refusing to write a generated artifact anywhere git tracks.
 */
export class UnsafeArtifactPathError extends Error {
  constructor(public readonly targetPath: string) {
    super(
      `Refusing to write a signal-lab artifact to a tracked path: ${targetPath}. ` +
        `Artifacts must live under the git-ignored data/ tree (data/processed/signal-lab/) ` +
        `or outside the repo (set HUM_DATA_DIR).`,
    );
    this.name = "UnsafeArtifactPathError";
  }
}

export function assertGitIgnoredArtifactPath(targetPath: string, env?: NodeJS.ProcessEnv): void {
  const dataDir = resolveDataDir(env);
  const resolved = resolve(targetPath);
  // Safe if outside the repo entirely.
  if (!isInsideRepo(resolved)) return;
  // Safe if inside the (git-ignored) data dir.
  const rel = relative(resolve(dataDir), resolved);
  const insideData = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!insideData) throw new UnsafeArtifactPathError(targetPath);
}
