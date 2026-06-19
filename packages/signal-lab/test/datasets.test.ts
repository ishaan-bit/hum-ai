import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavPcm16 } from "../src/wav";
import { buildAvailabilityReport } from "../src/datasets";
import { makeStoredZip } from "./zip-fixture";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "signal-data-"));
}

test("empty data dir → all datasets reported missing, nothing usable, no throw", () => {
  const dir = tmpDataDir();
  try {
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    assert.equal(report.summary.usable, 0);
    assert.ok(report.summary.total >= 6);
    const ravdess = report.datasets.find((d) => d.datasetId === "ravdess")!;
    assert.equal(ravdess.status, "missing");
    assert.equal(ravdess.usableForFeatureExtraction, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a present readable audio archive → ravdess becomes usable with correct governance", () => {
  const dir = tmpDataDir();
  try {
    const ravdessRaw = join(dir, "raw", "ravdess");
    mkdirSync(ravdessRaw, { recursive: true });
    const wav = encodeWavPcm16(new Float32Array(400).fill(0.05), 16000);
    const zip = makeStoredZip([{ name: "Actor_01/03-01-03-01-01-01-02.wav", data: wav }]);
    writeFileSync(join(ravdessRaw, "Audio_Speech_Actors_01-24.zip"), zip);

    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const ravdess = report.datasets.find((d) => d.datasetId === "ravdess")!;
    assert.equal(ravdess.status, "audio_available");
    assert.equal(ravdess.usableForFeatureExtraction, true);
    assert.equal(ravdess.audioDomain, "acted_speech_emotion");
    assert.equal(ravdess.domainGap, "far");
    assert.equal(ravdess.domainPenalty, 0.45);
    // ADR-0005 governance for acted speech.
    for (const u of ["clinical_prior", "hum_finetune", "personalization", "relapse_tracking"]) {
      assert.ok(ravdess.governanceForbiddenUse.includes(u as never), `expected ${u} forbidden`);
      assert.ok(ravdess.prohibitedModelUse.includes(u as never), `expected ${u} prohibited`);
    }
    assert.ok(report.summary.usableIds.includes("ravdess"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an authored manifest is reconciled (license surfaced) without overriding governance", () => {
  const dir = tmpDataDir();
  try {
    mkdirSync(join(dir, "manifests"), { recursive: true });
    writeFileSync(
      join(dir, "manifests", "ravdess.manifest.json"),
      JSON.stringify({
        license: "CC BY-NC-SA 4.0",
        allowed_model_use: ["affect_prior", "pretraining", "evaluation", "hum_finetune"], // hum_finetune is forbidden for the domain
        prohibited_model_use: ["commercial_use"],
        domain: "acted_speech_emotion",
      }),
    );
    const report = buildAvailabilityReport({ HUM_DATA_DIR: dir } as NodeJS.ProcessEnv);
    const ravdess = report.datasets.find((d) => d.datasetId === "ravdess")!;
    assert.equal(ravdess.manifestPresent, true);
    assert.equal(ravdess.license, "CC BY-NC-SA 4.0");
    // Governance still wins: a manifest cannot grant a domain-forbidden use.
    assert.ok(!ravdess.allowedModelUse.includes("hum_finetune" as never));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
