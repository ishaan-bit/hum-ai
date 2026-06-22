import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_GATES, runAllGates, totalViolations, formatViolation } from "@hum-ai/qa-gates";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");

test("all gates pass on the real (clean) tree — qa is green", () => {
  const results = runAllGates(REPO_ROOT);
  const total = totalViolations(results);
  const detail = results
    .flatMap((r) => r.violations.map((v) => `  ${r.gate}: ${v.where} -> ${v.token}`))
    .join("\n");
  assert.equal(total, 0, `Expected a clean tree, found ${total} violation(s):\n${detail}`);
});

test("the registry wires every gate (5 gates) and each result has a description", () => {
  assert.equal(ALL_GATES.length, 5);
  const results = runAllGates(REPO_ROOT);
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.ok(r.gate.length > 0, "gate id missing");
    assert.ok(r.description.length > 0, "gate description missing");
  }
});

test("formatViolation renders an actionable, multi-line block", () => {
  const block = formatViolation({
    gate: "demo",
    where: "apps/web/package.json",
    token: 'dependencies["face-api.js"]',
    detail: "camera package not allowed",
    fix: "remove it",
  });
  assert.match(block, /\[demo\]/);
  assert.match(block, /offending:/);
  assert.match(block, /problem:/);
  assert.match(block, /fix:/);
});
