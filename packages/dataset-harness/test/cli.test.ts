import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@hum-ai/dataset-harness";

const created: string[] = [];

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hum-harness-cli-"));
  created.push(dir);
  return dir;
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

test("no command prints usage with a non-zero exit", () => {
  const r = runCli([], {});
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Usage:/);
});

test("unknown command prints usage with a non-zero exit", () => {
  const r = runCli(["frobnicate"], {});
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Unknown command/);
});

test("unknown dataset is rejected with a clear message", () => {
  const r = runCli(["validate", "not-a-dataset"], {});
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Unknown dataset/);
});

test("validate on a missing dataset exits 0 with a graceful message", () => {
  const dataDir = makeDataDir();
  const r = runCli(["validate", "ravdess"], { HUM_DATA_DIR: dataDir });
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /not found/);
});

test("manifest on present data exits 0, reports counts, and points at the external output dir", () => {
  const dataDir = makeDataDir();
  const ravdessDir = join(dataDir, "ravdess");
  mkdirSync(ravdessDir, { recursive: true });
  writeFileSync(join(ravdessDir, "03-01-03-01-01-01-02.wav"), ""); // happy, female
  const r = runCli(["manifest", "ravdess"], { HUM_DATA_DIR: dataDir });
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /scanned 1/);
  assert.match(r.output, /happy: 1/);
  assert.match(r.output, /\.manifests/);
});

test("manifest on a missing dataset exits 0 and writes nothing", () => {
  const dataDir = makeDataDir();
  const r = runCli(["manifest", "tess"], { HUM_DATA_DIR: dataDir });
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /No manifest written/);
});
