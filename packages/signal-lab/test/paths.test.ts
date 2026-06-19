import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  repoRoot,
  resolveDataDir,
  artifactsDir,
  artifactPath,
  isInsideRepo,
  assertGitIgnoredArtifactPath,
  UnsafeArtifactPathError,
} from "../src/paths";

test("HUM_DATA_DIR overrides the data root", () => {
  const dir = resolveDataDir({ HUM_DATA_DIR: "C:/tmp/hum-data" } as NodeJS.ProcessEnv);
  assert.ok(dir.replace(/\\/g, "/").endsWith("tmp/hum-data"));
});

test("default data root is the in-repo git-ignored data/ dir", () => {
  const dir = resolveDataDir({} as NodeJS.ProcessEnv);
  assert.equal(dir, join(repoRoot(), "data"));
  assert.ok(artifactsDir({} as NodeJS.ProcessEnv).includes(join("data", "processed", "signal-lab")));
});

test("artifact paths under the git-ignored data/ tree are allowed", () => {
  // Default artifacts dir is inside data/ which .gitignore excludes — must NOT throw.
  assert.doesNotThrow(() => assertGitIgnoredArtifactPath(artifactPath("model.json")));
  assert.doesNotThrow(() => assertGitIgnoredArtifactPath(artifactsDir()));
});

test("writing to a tracked path is refused", () => {
  const tracked = join(repoRoot(), "packages", "signal-lab", "leaked.json");
  assert.throws(() => assertGitIgnoredArtifactPath(tracked), UnsafeArtifactPathError);
});

test("isInsideRepo distinguishes repo paths from siblings", () => {
  assert.equal(isInsideRepo(repoRoot()), true);
  assert.equal(isInsideRepo(join(repoRoot(), "packages")), true);
  assert.equal(isInsideRepo(join(repoRoot(), "..", "hum-ai-data")), false);
});
