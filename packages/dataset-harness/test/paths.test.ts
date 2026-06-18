import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  repoRoot,
  resolveDataDir,
  manifestOutputDir,
  isInsideRepo,
  assertOutsideRepo,
  UnsafeManifestPathError,
  RAW_DATASET_DIRS,
  DEFAULT_DATA_DIR_REL,
} from "@hum-ai/dataset-harness";

test("default data dir resolves to ../hum-ai-data outside the repo", () => {
  const dir = resolveDataDir({});
  assert.equal(isInsideRepo(dir), false, "default data dir must be outside the repo");
  assert.match(dir.replace(/\\/g, "/"), /hum-ai-data$/);
});

test("HUM_DATA_DIR env overrides the default", () => {
  const custom = join(repoRoot(), "..", "some-other-data-dir");
  const dir = resolveDataDir({ HUM_DATA_DIR: custom });
  assert.equal(dir, resolve(custom));
  assert.equal(isInsideRepo(dir), false);
});

test("manifest output dir is .manifests under the data dir and outside the repo", () => {
  const out = manifestOutputDir({});
  assert.match(out.replace(/\\/g, "/"), /hum-ai-data\/\.manifests$/);
  assert.equal(isInsideRepo(out), false);
});

test("isInsideRepo flags paths within the repo tree", () => {
  assert.equal(isInsideRepo(repoRoot()), true);
  assert.equal(isInsideRepo(join(repoRoot(), "packages", "dataset-harness")), true);
  assert.equal(isInsideRepo(join(repoRoot(), "..", "hum-ai-data")), false);
});

test("assertOutsideRepo throws for an in-repo target, passes for external", () => {
  assert.throws(
    () => assertOutsideRepo(join(repoRoot(), ".manifests", "ravdess.manifest.json")),
    UnsafeManifestPathError,
  );
  assert.doesNotThrow(() =>
    assertOutsideRepo(join(repoRoot(), "..", "hum-ai-data", ".manifests", "ravdess.manifest.json")),
  );
});

test("known raw dataset dirs include the five scaffolded datasets", () => {
  assert.deepEqual([...RAW_DATASET_DIRS], ["ravdess", "crema-d", "tess", "savee", "emodb"]);
  assert.equal(DEFAULT_DATA_DIR_REL, "../hum-ai-data");
});
