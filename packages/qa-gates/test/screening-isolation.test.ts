import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  screeningIsolationGate,
  isForbiddenScreeningSpecifier,
  isConsumerReadPath,
  scanSourceForScreeningImports,
} from "@hum-ai/qa-gates";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");

test("screening-isolation gate passes on the real (clean) tree — screening head is blinded", () => {
  const result = screeningIsolationGate(REPO_ROOT);
  assert.deepEqual(
    result.violations,
    [],
    `Screening head leaked into a consumer read/render path:\n${result.violations
      .map((v) => `  ${v.where}: ${v.token}`)
      .join("\n")}`,
  );
});

test("forbidden specifiers: screening-model (exact + subpath) and evaluate-binary subpath", () => {
  for (const spec of [
    "@hum-ai/screening-model",
    "@hum-ai/screening-model/promote",
    "@hum-ai/signal-lab/evaluate-binary",
  ]) {
    assert.ok(isForbiddenScreeningSpecifier(spec), `expected "${spec}" to be forbidden`);
  }
});

test("forbidden specifiers do NOT flag the broad signal-lab barrel or unrelated subpaths", () => {
  for (const spec of [
    "@hum-ai/signal-lab", // broad barrel is allowed — consumer uses /capture-gate etc.
    "@hum-ai/signal-lab/capture-gate",
    "@hum-ai/signal-lab/model",
    "@hum-ai/signal-lab/axis-prior",
    "@hum-ai/clinical-corpus",
    "@hum-ai/affect-model-contracts",
  ]) {
    assert.ok(!isForbiddenScreeningSpecifier(spec), `did not expect "${spec}" to be forbidden`);
  }
});

test("isConsumerReadPath covers apps/web/src, orchestrator, safety-language; excludes others", () => {
  assert.ok(isConsumerReadPath("apps/web/src/app/render.ts"));
  assert.ok(isConsumerReadPath("packages/orchestrator/src/axis-read.ts"));
  assert.ok(isConsumerReadPath("packages/safety-language/src/labels.ts"));
  // Out of scope: the study side and non-source files.
  assert.ok(!isConsumerReadPath("packages/screening-model/src/screening.ts"));
  assert.ok(!isConsumerReadPath("apps/web/demo/full-spine-demo.ts"));
  assert.ok(!isConsumerReadPath("packages/signal-lab/src/evaluate-binary.ts"));
  assert.ok(!isConsumerReadPath("apps/web/src/app/styles.css"), "non-.ts files are out of scope");
});

test("scanSourceForScreeningImports flags forbidden imports in a synthetic consumer file", () => {
  const leaky = [
    `import { runScreening } from "@hum-ai/screening-model";`,
    `import type { BinaryEvalResult } from "@hum-ai/signal-lab/evaluate-binary";`,
    `import { assessCapture } from "@hum-ai/signal-lab/capture-gate";`, // allowed
    `export * from "@hum-ai/screening-model/promote";`, // forbidden via export-from
  ].join("\n");
  const violations = scanSourceForScreeningImports(leaky, "apps/web/src/app/render.ts");
  const tokens = violations.map((v) => v.token);
  assert.ok(tokens.some((t) => t.includes("@hum-ai/screening-model\"")), "should flag screening-model import");
  assert.ok(tokens.some((t) => t.includes("evaluate-binary")), "should flag evaluate-binary import");
  assert.ok(tokens.some((t) => t.includes("@hum-ai/screening-model/promote")), "should flag screening-model subpath export");
  assert.equal(violations.length, 3, "the capture-gate import must NOT be flagged");
  for (const v of violations) {
    assert.equal(v.gate, "no-screening-in-read-path");
    assert.ok(/blinded/i.test(v.fix), "fix should reference the blinding policy");
  }
});

test("scanSourceForScreeningImports passes a clean consumer file", () => {
  const clean = [
    `import { assessCapture } from "@hum-ai/signal-lab/capture-gate";`,
    `import { axisRead } from "@hum-ai/orchestrator";`,
    `import * as lab from "@hum-ai/signal-lab";`, // broad barrel allowed
  ].join("\n");
  assert.deepEqual(scanSourceForScreeningImports(clean, "apps/web/src/app/cycle.ts"), []);
});
