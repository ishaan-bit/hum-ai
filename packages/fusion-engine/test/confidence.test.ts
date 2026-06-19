import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConfidenceInputs } from "@hum-ai/affect-model-contracts";
import { ConfidenceModelV1, combineCaps } from "@hum-ai/fusion-engine";

const model = new ConfidenceModelV1();

// Strong evidence on every axis — should be high UNLESS a cap binds.
const strong: ConfidenceInputs = {
  modelProbability: 0.95,
  topClassMargin: 0.6,
  captureQuality: 0.95,
  domainMatch: 0.95,
  modalityAgreement: 0.9,
  oodScore: 0.05,
  calibrationMaturity: 1,
  longitudinalTrendStrength: 1,
};

test("confidence never exceeds the applied cap", () => {
  const r = model.compute(strong, { cap: 0.9, capReason: "mature cap 0.90", abstainBelow: 0.45 });
  assert.ok(r.confidence <= 0.9 + 1e-9);
  assert.ok(r.confidencePercent <= 90);
});

test("first-hum cap holds even with strong evidence (no fake 90%+)", () => {
  const r = model.compute(strong, { cap: 0.72, capReason: "first-hum cap 0.72", abstainBelow: 0.45 });
  assert.ok(r.confidence <= 0.72 + 1e-9);
  assert.ok(r.confidencePercent <= 72);
  assert.equal(r.appliedCap, 0.72);
});

test("poor-capture cap holds even with strong model probability", () => {
  const r = model.compute(strong, { cap: 0.5, capReason: "poor capture cap 0.50", abstainBelow: 0.45 });
  assert.ok(r.confidence <= 0.5 + 1e-9);
});

test("domain mismatch reduces confidence", () => {
  const caps = { cap: 0.95, capReason: "no cap", abstainBelow: 0.45 };
  const onDomain = model.compute({ ...strong, domainMatch: 0.95 }, caps).confidence;
  const offDomain = model.compute({ ...strong, domainMatch: 0.2 }, caps).confidence;
  assert.ok(offDomain < onDomain);
});

test("weak evidence below the floor abstains with a specific reason", () => {
  const weak: ConfidenceInputs = {
    modelProbability: 0.3,
    topClassMargin: 0.05,
    captureQuality: 0.3,
    domainMatch: 0.3,
    modalityAgreement: 0.3,
    oodScore: 0.7,
    calibrationMaturity: 0.1,
    longitudinalTrendStrength: 0,
  };
  const r = model.compute(weak, { cap: 0.72, capReason: "first-hum cap 0.72", abstainBelow: 0.45 });
  assert.equal(r.abstained, true);
  assert.equal(r.abstainReason, "first_hum");
});

test("confidencePercent is floored, never rounding above a fractional cap × 100 (F7)", () => {
  // A binding cap of 0.715 must not yield 72 (= round(71.5)); flooring keeps the
  // ADR-0004 guarantee that the percent provably never exceeds appliedCap × 100.
  const r = model.compute(strong, { cap: 0.715, capReason: "fractional domain cap", abstainBelow: 0.45 });
  assert.ok(r.confidence <= 0.715 + 1e-9);
  assert.ok(r.confidencePercent <= 71, `floored percent must be <= 71, got ${r.confidencePercent}`);
});

test("an abstaining read never reports abstainReason 'none' (F8)", () => {
  // Boundary inputs: every signal sits exactly at/above its per-signal threshold
  // (so no single reason fires), yet the aggregate confidence falls below the
  // floor → abstained. The reason must not be the not-abstained sentinel.
  const boundary: ConfidenceInputs = {
    modelProbability: 0.5,
    topClassMargin: 0.1,
    captureQuality: 0.4,
    domainMatch: 0.4,
    modalityAgreement: 0.4,
    oodScore: 0.6,
    calibrationMaturity: 0.5,
    longitudinalTrendStrength: 0.2,
  };
  const r = model.compute(boundary, { cap: 0.95, capReason: "no cap", abstainBelow: 0.45 });
  assert.equal(r.abstained, true);
  assert.notEqual(r.abstainReason, "none");
});

test("combineCaps picks the strictest cap and reports its reason", () => {
  const c = combineCaps([
    { cap: 0.88, reason: "stage 10-19 cap" },
    { cap: 0.5, reason: "poor capture" },
  ]);
  assert.equal(c.cap, 0.5);
  assert.equal(c.capReason, "poor capture");
});
