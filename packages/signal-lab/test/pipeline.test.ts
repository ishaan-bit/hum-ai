import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline";

test("pipeline on an empty data dir does not fake a model — readiness only", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-pipe-"));
  try {
    const res = runPipeline({ env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv, write: false });
    // Availability still computed; nothing usable; no model fabricated.
    assert.ok(res.availability.summary.total >= 6);
    assert.equal(res.availability.summary.usable, 0);
    assert.equal(res.trained, false);
    assert.equal(res.model, null);
    assert.equal(res.evaluation, null);
    assert.equal(res.labeledSampleCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pipeline never throws when a dataset is incomplete", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-pipe-2-"));
  try {
    assert.doesNotThrow(() => runPipeline({ env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv, write: false }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
