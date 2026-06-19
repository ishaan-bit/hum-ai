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

test("isConfidenceCopySafe also rejects a raw probability piped into copy", () => {
  // The gate reuses this guard, so a regression interpolating the 0..1 confidence
  // value (e.g. 0.87) into user copy must be caught too, not just a literal '%'.
  assert.equal(isConfidenceCopySafe("Signal clarity: 0.87 confidence"), false);
  assert.equal(isConfidenceCopySafe("Signal clarity: High evidence · Based on 5 clean hums"), true);
});
