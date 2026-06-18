import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNaming, assertNaming } from "@hum-ai/naming-check";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");

test("root package.json name is hum-ai", () => {
  const violations = checkNaming(REPO_ROOT);
  const rootNameFail = violations.filter((v) => v.rule === "root-name");
  assert.deepEqual(rootNameFail, [], `Root name violation: ${rootNameFail.map((v) => v.detail).join(", ")}`);
});

test("all packages/* use @hum-ai/ scope", () => {
  const violations = checkNaming(REPO_ROOT);
  const scopeFails = violations.filter((v) => v.rule === "package-scope");
  assert.deepEqual(scopeFails, [], `Scope violations:\n${scopeFails.map((v) => `  ${v.file}: ${v.detail}`).join("\n")}`);
});

test("README.md h1 contains 'Hum AI'", () => {
  const violations = checkNaming(REPO_ROOT);
  const titleFails = violations.filter((v) => v.rule === "readme-title" || v.rule === "readme-exists");
  assert.deepEqual(titleFails, [], `README title violation: ${titleFails.map((v) => v.detail).join(", ")}`);
});

test("no package.json in packages/ uses legacy @hum/ scope", () => {
  const violations = checkNaming(REPO_ROOT);
  const legacyFails = violations.filter((v) => v.rule === "no-legacy-scope");
  assert.deepEqual(legacyFails, [], `Legacy scope:\n${legacyFails.map((v) => `  ${v.file}: ${v.detail}`).join("\n")}`);
});

test("root package.json name is not bare 'hum'", () => {
  const violations = checkNaming(REPO_ROOT);
  const bareFails = violations.filter((v) => v.rule === "no-bare-hum");
  assert.deepEqual(bareFails, [], "Root name is bare 'hum' instead of 'hum-ai'");
});

test("assertNaming passes on current repo (all naming rules satisfied)", () => {
  assert.doesNotThrow(() => assertNaming(REPO_ROOT));
});
