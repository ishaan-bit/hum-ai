import { test } from "node:test";
import assert from "node:assert/strict";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { evaluate, type LabeledSample } from "../src/evaluate";

const LABELS: FusionLabel[] = ["calm_regulated", "high_arousal_negative"];
const FEATURES = ["x", "y"];

function separable(): LabeledSample[] {
  const out: LabeledSample[] = [];
  for (let i = 0; i < 96; i++) {
    const positive = i % 2 === 0;
    const label: FusionLabel = positive ? "calm_regulated" : "high_arousal_negative";
    const jitter = ((i % 5) - 2) * 0.05;
    out.push({ vector: [positive ? 2 + jitter : -2 + jitter, jitter], label, group: `g${i % 8}` });
  }
  return out;
}

function randomLabeled(): LabeledSample[] {
  // Deterministic pseudo-random labels uncorrelated with features.
  let a = 99;
  const rng = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  const out: LabeledSample[] = [];
  for (let i = 0; i < 96; i++) {
    const label: FusionLabel = rng() < 0.5 ? "calm_regulated" : "high_arousal_negative";
    out.push({ vector: [rng(), rng()], label, group: `g${i % 8}` });
  }
  return out;
}

test("separable data → above-chance accuracy, low p, supported/moderate tier", () => {
  const res = evaluate(separable(), {
    labels: LABELS,
    featureNames: FEATURES,
    folds: 4,
    iterations: 150,
    permutations: 20,
    permIterations: 60,
  });
  assert.ok(res.accuracy > 0.85, `accuracy ${res.accuracy}`);
  assert.ok(res.significance.pValue <= 0.05, `p ${res.significance.pValue}`);
  assert.ok(["supported", "moderate"].includes(res.evidence.tier), `tier ${res.evidence.tier}`);
  assert.ok(res.calibration.ece >= 0 && res.calibration.ece <= 1);
  assert.ok(res.significance.observedMinusChance > 0);
});

test("random labels → near chance, weak/insufficient tier (no false signal)", () => {
  const res = evaluate(randomLabeled(), {
    labels: LABELS,
    featureNames: FEATURES,
    folds: 4,
    iterations: 120,
    permutations: 20,
    permIterations: 60,
  });
  assert.ok(res.accuracy < 0.7, `accuracy ${res.accuracy}`);
  assert.ok(res.evidence.tier === "weak" || res.evidence.tier === "insufficient", `tier ${res.evidence.tier}`);
});

test("tiny sample → insufficient evidence, never overclaimed", () => {
  const small = separable().slice(0, 20);
  const res = evaluate(small, { labels: LABELS, featureNames: FEATURES, folds: 4, permutations: 10, permIterations: 40 });
  assert.equal(res.evidence.tier, "insufficient");
});

test("chance baselines + caveats are always reported", () => {
  const res = evaluate(separable(), { labels: LABELS, featureNames: FEATURES, permutations: 10, permIterations: 40 });
  assert.ok(res.chance.majorityClassAccuracy > 0);
  assert.ok(res.chance.stratifiedRandomAccuracy > 0);
  assert.ok(res.evidence.caveats.some((c) => c.toLowerCase().includes("prior")));
  assert.ok(res.evidence.caveats.some((c) => c.toLowerCase().includes("not clinically validated")));
});
