import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceLevelFromConfidence,
  signalClarityLabel,
  basedOnCleanHums,
  userFacingConfidence,
  isConfidenceCopySafe,
  validateUserFacingText,
} from "@hum-ai/safety-language";

test("pre-baseline accounts are always framed as early baseline", () => {
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.95, abstained: false }, 1), "early_baseline");
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.95, abstained: false }, 4), "early_baseline");
});

test("baseline-active confidence maps to high/medium/low bands", () => {
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.85, abstained: false }, 10), "high");
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.65, abstained: false }, 10), "medium");
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.5, abstained: false }, 10), "low");
});

test("abstaining reads are low evidence even when baseline-active", () => {
  assert.equal(evidenceLevelFromConfidence({ confidence: 0.9, abstained: true }, 30), "low");
});

test("based-on phrasing handles first hum and plurals", () => {
  assert.equal(basedOnCleanHums(0), "Based on this first hum");
  assert.equal(basedOnCleanHums(1), "Based on your first clean hum");
  assert.equal(basedOnCleanHums(12), "Based on 12 clean hums");
});

test("user-facing confidence never contains a raw numeric percentage", () => {
  const cases = [
    userFacingConfidence({ confidence: 0.87, abstained: false }, 12),
    userFacingConfidence({ confidence: 0.72, abstained: false }, 1),
    userFacingConfidence({ confidence: 0.5, abstained: true }, 30),
  ];
  for (const u of cases) {
    assert.equal(isConfidenceCopySafe(u.summary), true, `unsafe copy: ${u.summary}`);
    assert.equal(/\d{1,3}\s?%/.test(u.summary), false, `percent leaked: ${u.summary}`);
    // the qualitative copy must itself pass the safety-language forbidden-phrase check
    assert.equal(validateUserFacingText(u.summary).ok, true, `forbidden phrase in: ${u.summary}`);
  }
});

test("the safety guard catches a leaked confidence percentage", () => {
  assert.equal(isConfidenceCopySafe("We are 87% confident in this read."), false);
  assert.equal(isConfidenceCopySafe("Signal clarity: High evidence · Based on 12 clean hums"), true);
});

test("signal clarity labels are the sanctioned vocabulary", () => {
  assert.equal(signalClarityLabel("high"), "High evidence");
  assert.equal(signalClarityLabel("medium"), "Medium evidence");
  assert.equal(signalClarityLabel("low"), "Low evidence");
  assert.equal(signalClarityLabel("early_baseline"), "Early baseline");
});
