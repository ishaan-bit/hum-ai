import { test } from "node:test";
import assert from "node:assert/strict";
import {
  updateArm,
  armVariance,
  selectByUCB,
  selectByThompson,
  gaussianSample,
  type InterventionPolicy,
} from "@hum-ai/personalization-engine";

/** Deterministic LCG uniform RNG for reproducible tests. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test("updateArm tracks an online mean and variance (Welford)", () => {
  let a = updateArm(undefined, 1);
  a = updateArm(a, 1);
  a = updateArm(a, 1);
  assert.equal(a.count, 3);
  assert.ok(Math.abs(a.mean - 1) < 1e-9);
  assert.ok(armVariance(a) < 1e-9);

  const b = updateArm(updateArm(undefined, 0), 2);
  assert.ok(Math.abs(b.mean - 1) < 1e-9);
  assert.ok(Math.abs(armVariance(b) - 2) < 1e-9);
});

test("UCB explores an untried arm, then exploits a proven one", () => {
  const policy: InterventionPolicy = {};
  for (let i = 0; i < 10; i++) policy.breath_regulation = updateArm(policy.breath_regulation, 0.9);
  const candidates = ["breath_regulation", "music_recommendation"] as const;

  const explore = selectByUCB(policy, candidates)!;
  assert.equal(explore.best.type, "music_recommendation"); // untried arm gets the optimism bonus

  for (let i = 0; i < 20; i++) policy.music_recommendation = updateArm(policy.music_recommendation, 0);
  const exploit = selectByUCB(policy, candidates)!;
  assert.equal(exploit.best.type, "breath_regulation"); // proven high-reward arm now wins
});

test("Thompson sampling is reproducible under a seeded RNG and returns a candidate", () => {
  const policy: InterventionPolicy = { breath_regulation: updateArm(updateArm(undefined, 0.8), 0.8) };
  const candidates = ["breath_regulation", "journaling_prompt"] as const;
  const r1 = selectByThompson(policy, candidates, seeded(42))!;
  const r2 = selectByThompson(policy, candidates, seeded(42))!;
  assert.equal(r1.best.type, r2.best.type);
  assert.ok((candidates as readonly string[]).includes(r1.best.type));
});

test("gaussianSample is deterministic for a fixed RNG", () => {
  assert.equal(gaussianSample(seeded(7), 0, 1), gaussianSample(seeded(7), 0, 1));
});

test("empty candidate set returns null", () => {
  assert.equal(selectByUCB({}, []), null);
  assert.equal(selectByThompson({}, [], seeded(1)), null);
});
