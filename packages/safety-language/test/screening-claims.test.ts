import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TERMS, assertSafeUserFacingText, validateUserFacingText } from "../src/phrases";
import { INTERNAL_TO_USER_FACING, isInternalOnly, userFacingLabel } from "../src/labels";

test("premature screening claims are forbidden in normal mode", () => {
  for (const bad of ["This screens for depression.", "It detects anxiety.", "Hum screens you for anxiety.", "92% sensitivity"]) {
    assert.equal(validateUserFacingText(bad).ok, false, `should reject: ${bad}`);
  }
});

test("validatedRegulatoryMode is the only way the screening register unlocks", () => {
  assert.equal(validateUserFacingText("screens for depression", { validatedRegulatoryMode: true }).ok, true);
});

test("the investigational register is sanctioned and passes the matcher", () => {
  assert.ok(ALLOWED_TERMS.includes("investigational screening signal"));
  assert.ok(ALLOWED_TERMS.includes("for research use only"));
  assert.doesNotThrow(() =>
    assertSafeUserFacingText("This is investigational and for research use only, as part of a research study."),
  );
});

test("screening internal labels map to investigational copy and are surfaceable post-validation", () => {
  assert.ok("phq_screening_signal" in INTERNAL_TO_USER_FACING);
  assert.ok("gad_screening_signal" in INTERNAL_TO_USER_FACING);
  assert.equal(isInternalOnly("phq_screening_signal"), false);
  const copy = userFacingLabel("phq_screening_signal");
  assert.match(copy, /investigational/i);
  assert.doesNotThrow(() => assertSafeUserFacingText(copy)); // the mapped copy is itself safe
});
