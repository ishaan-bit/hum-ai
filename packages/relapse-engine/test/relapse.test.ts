import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import {
  assessRelapse,
  classifyComparison,
  personalStableBand,
  STABLE_BAND_MIN,
  STABLE_BAND_MAX,
  RELAPSE_CLASSES,
  type RelapseSample,
} from "@hum-ai/relapse-engine";

const at = (s: string) => asIsoTimestamp(s);
const sample = (riskScore: number, valence = 0, arousal = 0): RelapseSample => ({
  capturedAt: at("2026-06-18T00:00:00.000Z"),
  dimensional: { valence, arousal },
  riskScore,
});

test("output contract: verdict class is always one of the declared classes", () => {
  const v = assessRelapse(sample(0.5), { baseline_7d: sample(0.5) });
  assert.ok(RELAPSE_CLASSES.includes(v.class));
  assert.ok(v.drift >= 0 && v.drift <= 1);
  assert.ok(Array.isArray(v.comparisons));
});

test("no references → uncertain (never guess a relapse with no history)", () => {
  const v = assessRelapse(sample(0.9), {});
  assert.equal(v.class, "uncertain");
  assert.equal(v.dvdsa, null);
});

test("personalStableBand widens for a high-variance user, tightens for a steady one", () => {
  const steady = personalStableBand([0.30, 0.31, 0.29, 0.30, 0.305, 0.295, 0.30]);
  const noisy = personalStableBand([0.1, 0.6, 0.2, 0.7, 0.15, 0.65, 0.25]);
  assert.ok(noisy > steady, `noisy band ${noisy} > steady ${steady}`);
  assert.ok(steady >= STABLE_BAND_MIN && noisy <= STABLE_BAND_MAX);
  // Below ~4 samples it falls back to the uniform default (0.12), never NaN.
  assert.equal(personalStableBand([0.5, 0.5]), 0.12);
});

test("a wider personal band classifies a moderate swing as stable; the tight default flags it", () => {
  // riskDelta 0.15 vs a recent baseline: stable under a 0.20 band, worsening under 0.12.
  const wide = classifyComparison(sample(0.65), sample(0.5), "baseline_7d", { stableBand: 0.2 });
  const tight = classifyComparison(sample(0.65), sample(0.5), "baseline_7d", { stableBand: 0.12 });
  assert.equal(wide.class, "stable");
  assert.equal(tight.class, "worsening");
});

test("signature-weighted drift amplifies when aligned with the user's high-risk pattern, damps on recovery", () => {
  const refs = { baseline_7d: sample(0.3), previous_stable: sample(0.3) };
  const base = assessRelapse(sample(0.7), refs);
  const highRisk = assessRelapse(sample(0.7), refs, { signatureAlignment: { highRisk: 0.8, recovery: 0 } });
  const recovery = assessRelapse(sample(0.7), refs, { signatureAlignment: { highRisk: 0, recovery: 0.8 } });
  assert.ok(highRisk.drift > base.drift, `high-risk ${highRisk.drift} > base ${base.drift}`);
  assert.ok(recovery.drift < base.drift, `recovery ${recovery.drift} < base ${base.drift}`);
  assert.ok(highRisk.drift <= 1 && recovery.drift >= 0);
});

test("moving away from a previous high-risk hum is recovery", () => {
  const c = classifyComparison(sample(0.2), sample(0.85), "previous_high_risk");
  assert.equal(c.class, "recovery");
  const v = assessRelapse(sample(0.2), { previous_high_risk: sample(0.85), baseline_30d: sample(0.25) });
  assert.equal(v.class, "recovery");
  assert.equal(v.dvdsa, "recovery");
});

test("rising risk vs a stable reference is worsening / drift", () => {
  const c = classifyComparison(sample(0.8), sample(0.3), "previous_stable");
  assert.equal(c.class, "relapse_drift");
  const v = assessRelapse(sample(0.85), {
    previous_stable: sample(0.3),
    baseline_7d: sample(0.35),
    baseline_30d: sample(0.4),
  });
  assert.ok(v.class === "relapse_drift" || v.class === "worsening");
  assert.equal(v.dvdsa, "worsening");
  assert.ok(v.drift > 0);
});

test("staying close to a recent baseline is stable / unchanged", () => {
  const v = assessRelapse(sample(0.45), { baseline_7d: sample(0.46), baseline_30d: sample(0.44) });
  assert.equal(v.class, "stable");
  assert.equal(v.dvdsa, "unchanged");
});

test("conflicting references yield uncertain", () => {
  const v = assessRelapse(sample(0.5), {
    previous_high_risk: sample(0.9), // → recovery (moved away)
    previous_stable: sample(0.2), // → worsening (rose above stable)
  });
  assert.equal(v.class, "uncertain");
});
