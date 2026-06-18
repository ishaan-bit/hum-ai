import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { forbiddenFilesGate, scanForbiddenPaths } from "@hum-ai/qa-gates";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");

test("forbidden-files gate passes on the real (clean) tree", () => {
  const result = forbiddenFilesGate(REPO_ROOT);
  assert.deepEqual(
    result.violations,
    [],
    `Unexpected forbidden files:\n${result.violations.map((v) => `  ${v.where} (${v.gate})`).join("\n")}`,
  );
});

test("forbidden-files gate flags synthetic violations (binaries/weights/audio/env/keys/creds/datasets/clinical)", () => {
  const leaky = [
    "docs/source/whitepaper.pdf",
    "docs/spec.docx",
    "models/affect.onnx",
    "weights/model.safetensors",
    "samples/hum.wav",
    "config/.env",
    "config/.env.production",
    "secrets/service-account.json",
    "secrets/firebase-adminsdk-abc.json",
    "secrets/gcp-prod.json",
    "keys/private.pem",
    "auth/api.token",
    ".vercel/project.json",
    "datasets/ravdess/train.csv",
    "recordings/session-1.flac",
    "labels/phq9.csv",
    "labels/gad-7.csv",
    "labels/ces-dc.json",
    "labels/clinical_labels.parquet",
  ];
  const violations = scanForbiddenPaths(leaky);
  // Every leaky path should be caught at least once.
  for (const p of leaky) {
    assert.ok(
      violations.some((v) => v.where === p),
      `expected a violation for "${p}"`,
    );
  }
  // Violations must be actionable.
  for (const v of violations) {
    assert.ok(v.fix.length > 0, "violation missing a fix");
    assert.ok(v.token.length > 0, "violation missing a token");
  }
});

test("forbidden-files gate does NOT false-positive on legitimate look-alikes", () => {
  const safe = [
    ".env.example",
    "config/.env.example",
    "packages/foo/serviceAccountHelper.ts",
    "docs/service-account-setup.md",
    "src/gadget.json", // must NOT trip the gad rule
    "assets/badge.csv", // must NOT trip the gad rule
    "datasets/README.md", // README is allowed under datasets/
    "recordings/README.md",
    "docs/source/INDEX.md",
    "docs/source/README.md",
    "src/keyboard.ts", // ".key" must be an extension, not a substring
    "tokenizer.ts", // ".token" must be an extension at a name boundary
    "research/notebooks/README.md",
  ];
  const violations = scanForbiddenPaths(safe);
  assert.deepEqual(
    violations,
    [],
    `False positives:\n${violations.map((v) => `  ${v.where} (${v.gate})`).join("\n")}`,
  );
});
