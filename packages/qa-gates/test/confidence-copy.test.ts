import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceCopyGate } from "@hum-ai/qa-gates";
import { isConfidenceCopySafe } from "@hum-ai/safety-language";

test("confidence-copy gate passes on the real user-facing confidence path", () => {
  const result = confidenceCopyGate(process.cwd());
  assert.deepEqual(
    result.violations,
    [],
    `Raw confidence leaked into copy:\n${result.violations.map((v) => `  ${v.where}: ${v.token}`).join("\n")}`,
  );
});

test("isConfidenceCopySafe flags a synthetic regression that embeds a percentage", () => {
  // Sanity: the underlying guard the gate relies on does reject a percent string.
  assert.equal(isConfidenceCopySafe("Signal clarity: 87% sure"), false);
  assert.equal(isConfidenceCopySafe("Signal clarity: High evidence · Based on 12 clean hums"), true);
});
