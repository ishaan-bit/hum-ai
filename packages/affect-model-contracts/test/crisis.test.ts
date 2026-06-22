import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import { assessCrisisFromPhq, buildPhq9Response, crisisResources } from "../src/index";

const NOW = asIsoTimestamp("2026-06-22T10:00:00.000Z");
const phqWithItem9 = (item9: number) => buildPhq9Response([1, 1, 1, 1, 1, 1, 1, 1, item9], NOW);

test("item 9 = 0 → no crisis pathway", () => {
  const a = assessCrisisFromPhq(phqWithItem9(0));
  assert.equal(a.level, "none");
  assert.equal(a.requiresInterstitial, false);
  assert.equal(a.auditEvent, null);
});

test("item 9 = 1 → elevated, non-dismissable, audited", () => {
  const a = assessCrisisFromPhq(phqWithItem9(1));
  assert.equal(a.level, "elevated");
  assert.equal(a.requiresInterstitial, true);
  assert.equal(a.auditEvent, "phq9_item9_endorsed");
  assert.ok(a.message.length > 0);
});

test("item 9 ≥ 2 → active interstitial", () => {
  for (const v of [2, 3]) {
    const a = assessCrisisFromPhq(phqWithItem9(v));
    assert.equal(a.level, "active");
    assert.equal(a.requiresInterstitial, true);
    assert.equal(a.auditEvent, "phq9_item9_endorsed");
  }
});

test("PHQ-8 has no item 9, so it never triggers the pathway", () => {
  const phq8 = buildPhq9Response([3, 3, 3, 3, 3, 3, 3, 3], NOW, "PHQ-8");
  const a = assessCrisisFromPhq(phq8);
  assert.equal(a.level, "none");
});

test("crisisResources is region-aware and falls back to the international directory", () => {
  assert.equal(crisisResources("US")[0]?.call, "988");
  assert.equal(crisisResources("ZZ")[0]?.region, "INTL");
});
