import { test } from "node:test";
import assert from "node:assert/strict";
import { appendExample, emptyCorpus } from "../src/corpus";
import { evaluateAxisPromotion, NATIVE_MAX_P_VALUE, NATIVE_ECE_CAP } from "../src/train";
import { learnableArousalCorpus, makeExample } from "./fixtures";

test("a promoted axis carries honest significance metadata (p-value, ECE, accuracy CI)", () => {
  const p = evaluateAxisPromotion(learnableArousalCorpus(40), "arousal");
  assert.equal(p.decision, "promote", `reasons: ${p.reasons.join("; ")}`);
  // The improvement is statistically real (beyond chance) and well-calibrated.
  assert.ok(p.pValue !== null && p.pValue < NATIVE_MAX_P_VALUE, `p=${p.pValue}`);
  assert.ok(p.ece !== null && p.ece <= NATIVE_ECE_CAP, `ece=${p.ece}`);
  // The accuracy is reported with an honest bootstrap CI bracketing the point estimate.
  assert.ok(p.accuracyCI95 !== null);
  assert.ok(p.accuracyCI95!.lo <= p.challengerBalancedAccuracy + 1e-9);
  assert.ok(p.accuracyCI95!.hi >= p.challengerBalancedAccuracy - 1e-9);
  assert.ok(p.accuracyCI95!.lo <= p.accuracyCI95!.hi);
});

test("a no-signal corpus (constant features) HOLDS and never runs the permutation test", () => {
  // Features identical across rows → neither the model nor the backbone can separate the
  // alternating labels → ~chance, no margin → held BEFORE the expensive permutation step.
  let c = emptyCorpus();
  for (let i = 0; i < 30; i++) {
    c = appendExample(c, makeExample({ id: `n${i}`, label: { valence: 0.2, arousal: i % 2 ? 0.6 : -0.6 } }));
  }
  const p = evaluateAxisPromotion(c, "arousal");
  assert.equal(p.decision, "hold");
  assert.equal(p.pValue, null, "permutation is skipped when the model doesn't beat the backbone");
  assert.ok(p.reasons.some((r) => r.includes("beat the acoustic read") || r.includes("floor")));
});
