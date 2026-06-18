import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManifest,
  buildAndWriteManifest,
  writeManifest,
  countByEmotion,
  validateDataset,
  isInsideRepo,
  manifestOutputDir,
  UnsafeManifestPathError,
  type Manifest,
} from "@hum-ai/dataset-harness";

/** Temp dirs created during the suite, cleaned up afterEach. */
const created: string[] = [];

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hum-harness-"));
  created.push(dir);
  return dir;
}

/** Lay down tiny 0-byte fake .wav files with valid RAVDESS-style names. */
function seedRavdess(dataDir: string, names: readonly string[]): void {
  const ravdessDir = join(dataDir, "ravdess");
  mkdirSync(ravdessDir, { recursive: true });
  for (const n of names) {
    writeFileSync(join(ravdessDir, n), ""); // 0-byte placeholder, never real audio
  }
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test("buildManifest parses seeded RAVDESS fixtures and tallies emotions", () => {
  const dataDir = makeDataDir();
  seedRavdess(dataDir, [
    "03-01-01-01-01-01-01.wav", // neutral, male
    "03-01-03-01-01-01-02.wav", // happy, female
    "03-01-03-02-01-01-04.wav", // happy, female
    "03-01-05-02-01-01-03.wav", // angry, male
    "not-a-ravdess-file.wav", // malformed -> skipped
  ]);
  const env = { HUM_DATA_DIR: dataDir };

  const manifest: Manifest = buildManifest("ravdess", env);
  assert.equal(manifest.status, "ok");
  assert.equal(manifest.scanned, 5);
  assert.equal(manifest.parsed, 4);
  assert.equal(manifest.skipped, 1);

  const counts = countByEmotion(manifest);
  assert.equal(counts.happy, 2);
  assert.equal(counts.neutral, 1);
  assert.equal(counts.angry, 1);

  const genders = manifest.entries.map((e) => e.gender);
  assert.ok(genders.includes("male"));
  assert.ok(genders.includes("female"));
});

test("buildManifest returns missing_directory status (not an error) when absent", () => {
  const dataDir = makeDataDir(); // exists, but no ravdess subfolder
  const manifest = buildManifest("ravdess", { HUM_DATA_DIR: dataDir });
  assert.equal(manifest.status, "missing_directory");
  assert.equal(manifest.scanned, 0);
  assert.equal(manifest.entries.length, 0);
});

test("buildManifest returns empty status when the folder has no audio", () => {
  const dataDir = makeDataDir();
  mkdirSync(join(dataDir, "ravdess"), { recursive: true });
  writeFileSync(join(dataDir, "ravdess", "README.txt"), "notes");
  const manifest = buildManifest("ravdess", { HUM_DATA_DIR: dataDir });
  assert.equal(manifest.status, "empty");
  assert.equal(manifest.scanned, 0);
});

test("writeManifest writes JSON OUTSIDE the repo tree, into <dataDir>/.manifests", () => {
  const dataDir = makeDataDir();
  seedRavdess(dataDir, ["03-01-06-01-02-01-12.wav"]);
  const env = { HUM_DATA_DIR: dataDir };

  const { manifest, write } = buildAndWriteManifest("ravdess", env);
  assert.equal(manifest.parsed, 1);

  // Output exists, is under the data dir's .manifests, and is OUTSIDE the repo.
  assert.equal(existsSync(write.outputPath), true);
  assert.equal(write.outputPath.startsWith(manifestOutputDir(env)), true);
  assert.equal(isInsideRepo(write.outputPath), false, "manifest must land outside the repo tree");
  assert.equal(isInsideRepo(manifestOutputDir(env)), false);

  // The written JSON round-trips to the same shape.
  const parsed = JSON.parse(readFileSync(write.outputPath, "utf8"));
  assert.equal(parsed.datasetId, "ravdess");
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].emotion, "fearful");
});

test("writeManifest refuses a manifest whose output dir is inside the repo", () => {
  // Point HUM_DATA_DIR at the repo itself so .manifests would land in-repo.
  const insideRepoDataDir = join(process.cwd());
  assert.throws(
    () => writeManifest(buildManifest("ravdess", { HUM_DATA_DIR: insideRepoDataDir }), {
      HUM_DATA_DIR: insideRepoDataDir,
    }),
    UnsafeManifestPathError,
  );
});

test("validateDataset reports counts for present data and handles missing gracefully", () => {
  const dataDir = makeDataDir();
  seedRavdess(dataDir, [
    "03-01-04-01-01-01-05.wav", // sad
    "03-01-04-02-01-01-06.wav", // sad
  ]);
  const present = validateDataset("ravdess", { HUM_DATA_DIR: dataDir });
  assert.equal(present.present, true);
  assert.equal(present.scanned, 2);
  assert.equal(present.countsByEmotion.sad, 2);

  const emptyDataDir = makeDataDir();
  const missing = validateDataset("crema-d", { HUM_DATA_DIR: emptyDataDir });
  assert.equal(missing.present, false);
  assert.match(missing.message, /not found/);
});

test("scaffolded non-RAVDESS dataset scans but does not parse emotions yet", () => {
  const dataDir = makeDataDir();
  const cremaDir = join(dataDir, "crema-d");
  mkdirSync(cremaDir, { recursive: true });
  writeFileSync(join(cremaDir, "1001_DFA_ANG_XX.wav"), "");
  const manifest = buildManifest("crema-d", { HUM_DATA_DIR: dataDir });
  assert.equal(manifest.status, "ok");
  assert.equal(manifest.scanned, 1);
  assert.equal(manifest.parsed, 0);
  assert.equal(manifest.entries[0]?.emotion, "unknown");
});
