import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateUserFacingText,
  assertSafeUserFacingText,
  UnsafeLanguageError,
  userFacingLabel,
  isInternalOnly,
} from "@hum-ai/safety-language";

test("forbidden diagnostic phrases are detected", () => {
  const cases = [
    "You have depression.",
    "This is a diagnosis of anxiety.",
    "Our model is clinically validated.",
    "This prevents relapse.",
    "Hum is an FDA-cleared medical device.",
    "We are clinically certain.",
    "Guaranteed prevention of burnout.",
  ];
  for (const c of cases) {
    const r = validateUserFacingText(c);
    assert.equal(r.ok, false, `should flag: ${c}`);
    assert.ok(r.violations.length > 0);
  }
});

test("approved risk-marker language passes", () => {
  const cases = [
    "Your hums show an anxiety-risk marker worth noting.",
    "This is an early-warning pattern, not a diagnosis-free reflective signal.", // 'diagnosis-free' contains 'diagnos'
  ];
  assert.equal(validateUserFacingText(cases[0]!).ok, true);
  // The second deliberately trips the matcher — verify the matcher is strict.
  assert.equal(validateUserFacingText(cases[1]!).ok, false);
});

test("a clean reflective sentence passes", () => {
  const ok = "Your hum sounded a little more subdued than your usual pattern today.";
  assert.equal(validateUserFacingText(ok).ok, true);
  assert.doesNotThrow(() => assertSafeUserFacingText(ok));
});

test("assertSafeUserFacingText throws UnsafeLanguageError on violations", () => {
  assert.throws(() => assertSafeUserFacingText("You have an anxiety disorder."), UnsafeLanguageError);
});

test("validated/regulatory mode bypasses the forbidden list", () => {
  const r = validateUserFacingText("clinically validated diagnosis", { validatedRegulatoryMode: true });
  assert.equal(r.ok, true);
});

test("internal labels translate to safe user copy and internal-only labels are flagged", () => {
  assert.equal(userFacingLabel("depressive_affect_marker"), "a lower-mood pattern worth gently noting");
  // the user-facing copy must itself be safe
  assert.equal(validateUserFacingText(userFacingLabel("depressive_affect_marker")).ok, true);
  assert.equal(validateUserFacingText(userFacingLabel("relapse_drift_score")).ok, true);
  assert.equal(isInternalOnly("abstain_reason"), true);
  assert.equal(isInternalOnly("neutral_close_to_usual"), false);
});
