import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavPcm16 } from "../src/wav";
import { buildAvailabilityReport } from "../src/datasets";
import { extractDataset } from "../src/extract";
import { makeStoredZip } from "./zip-fixture";

function dirWithZip(datasetId: string, zipName: string, entries: { name: string; data: Buffer }[]): string {
  const dir = mkdtempSync(join(tmpdir(), `signal-${datasetId}-`));
  const raw = join(dir, "raw", datasetId);
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(raw, zipName), makeStoredZip(entries));
  return dir;
}

const wav = encodeWavPcm16(new Float32Array(8000).fill(0.05), 16000);
const junk = Buffer.from("Mac OS X        resource fork not a RIFF file"); // not a WAV

test("AppleDouble/__MACOSX entries are skipped as junk, NOT counted as decode failures", () => {
  const dir = dirWithZip("vocalsound", "vocalsound_16k.zip", [
    { name: "audio_16k/f1000_0_sigh.wav", data: wav },
    { name: "audio_16k/m2000_0_cough.wav", data: wav },
    { name: "__MACOSX/audio_16k/._f1000_0_sigh.wav", data: junk },
    { name: "audio_16k/._m2000_0_cough.wav", data: junk },
  ]);
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const vs = report.datasets.find((d) => d.datasetId === "vocalsound")!;
    assert.equal(vs.usableForFeatureExtraction, true, "real audio present ⇒ usable");
    const { rows, summary } = extractDataset(vs, { env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv });

    assert.equal(summary.featureRows, 2, "only the two real WAVs become rows");
    assert.equal(summary.decodeFailures, 0, "junk must not inflate decode failures");
    assert.equal(summary.junkEntriesSkipped, 2, "both AppleDouble entries counted as junk");
    assert.equal(summary.labeledRows, 0, "vocalsound has no affect labels");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vocalsound rows carry a within-corpus speaker group (leakage-safe CV)", () => {
  const dir = dirWithZip("vocalsound", "vocalsound_16k.zip", [
    { name: "audio_16k/f1000_0_sigh.wav", data: wav },
    { name: "audio_16k/m2000_0_cough.wav", data: wav },
  ]);
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const vs = report.datasets.find((d) => d.datasetId === "vocalsound")!;
    const { rows } = extractDataset(vs, { env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv });
    const groups = new Set(rows.map((r) => r.group));
    assert.ok(groups.has("spk_f1000"));
    assert.ok(groups.has("spk_m2000"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vocalset rows carry a singer group parsed from the FULL/<singer>/ path", () => {
  const dir = dirWithZip("vocalset", "VocalSet11.zip", [
    { name: "FULL/female1/long_tones/forte/f1_long_forte_a.wav", data: wav },
    { name: "FULL/male3/scales/fast/m3_scales_a.wav", data: wav },
  ]);
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const vs = report.datasets.find((d) => d.datasetId === "vocalset")!;
    const { rows, summary } = extractDataset(vs, { env: { HUM_DATA_DIR: dir } as NodeJS.ProcessEnv });
    assert.equal(summary.labeledRows, 0, "vocalset is unlabeled (domain/OOD only)");
    const groups = new Set(rows.map((r) => r.group));
    assert.ok(groups.has("singer_female1"));
    assert.ok(groups.has("singer_male3"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
