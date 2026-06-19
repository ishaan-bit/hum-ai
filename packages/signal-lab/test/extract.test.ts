import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavPcm16 } from "../src/wav";
import { buildAvailabilityReport } from "../src/datasets";
import { extractDataset } from "../src/extract";
import { makeStoredZip } from "./zip-fixture";

function ravdessName(emotionCode: string, actor: string): string {
  return `Actor_${actor}/03-01-${emotionCode}-01-01-01-${actor}.wav`;
}

function buildRavdessDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "signal-extract-"));
  const raw = join(dir, "raw", "ravdess");
  mkdirSync(raw, { recursive: true });
  const wav = encodeWavPcm16(new Float32Array(400).fill(0.05), 16000);
  const entries = [
    { name: ravdessName("01", "01"), data: wav }, // neutral
    { name: ravdessName("03", "02"), data: wav }, // happy
    { name: ravdessName("05", "03"), data: wav }, // angry
    { name: ravdessName("07", "04"), data: wav }, // disgust → excluded
    { name: ravdessName("08", "05"), data: wav }, // surprised → excluded
  ];
  writeFileSync(join(raw, "Audio_Speech_Actors_01-24.zip"), makeStoredZip(entries));
  return dir;
}

test("extractDataset maps RAVDESS labels, sets groups, and excludes ambiguous emotions", () => {
  const dir = buildRavdessDir();
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const ravdess = report.datasets.find((d) => d.datasetId === "ravdess")!;
    const { rows, summary } = extractDataset(ravdess, { env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv });

    assert.equal(summary.decodeFailures, 0);
    assert.equal(summary.featureRows, 5);
    assert.equal(summary.labeledRows, 3); // neutral, happy, angry
    assert.equal(summary.excludedByMapping, 2); // disgust, surprised

    const labeled = rows.filter((r) => r.fusionLabel);
    for (const r of labeled) {
      assert.ok(r.group?.startsWith("actor_"));
      assert.equal(r.modelSource, "hum_dsp_extractor");
      assert.equal(r.domainPenalty, 0.45);
      assert.ok(r.features.featureMode.length > 0);
    }
    const neutral = rows.find((r) => r.sourceLabel === "neutral")!;
    assert.equal(neutral.fusionLabel, "neutral_close_to_usual");
    const disgust = rows.find((r) => r.sourceLabel === "disgust")!;
    assert.equal(disgust.fusionLabel, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractDataset skips an unusable dataset gracefully (no throw, empty rows)", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-extract-empty-"));
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const deam = report.datasets.find((d) => d.datasetId === "deam")!; // not usable
    const { rows, summary } = extractDataset(deam, { env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv });
    assert.equal(rows.length, 0);
    assert.equal(summary.featureRows, 0);
    assert.ok(summary.notes.join(" ").includes("skipped"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
