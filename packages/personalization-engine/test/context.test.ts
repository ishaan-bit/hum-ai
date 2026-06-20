import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRobustStats } from "@hum-ai/shared-types";
import {
  timeBucket,
  newContextualCenters,
  updateContextualCenters,
  contextAdjustedBaseline,
  CONTEXT_MIN_N,
} from "@hum-ai/personalization-engine";

test("timeBucket maps the UTC hour to night/morning/afternoon/evening", () => {
  assert.equal(timeBucket("2026-06-20T03:00:00.000Z"), "night");
  assert.equal(timeBucket("2026-06-20T08:00:00.000Z"), "morning");
  assert.equal(timeBucket("2026-06-20T14:00:00.000Z"), "afternoon");
  assert.equal(timeBucket("2026-06-20T21:00:00.000Z"), "evening");
});

test("updateContextualCenters EMA-tracks per-bucket centers and counts", () => {
  let c = newContextualCenters();
  c = updateContextualCenters(c, "morning", { pitchMeanHz: 180 });
  c = updateContextualCenters(c, "morning", { pitchMeanHz: 200 });
  assert.equal(c.morning!.n, 2);
  assert.ok(c.morning!.centers.pitchMeanHz! > 180 && c.morning!.centers.pitchMeanHz! < 200);
  assert.equal(c.evening, undefined);
});

test("contextAdjustedBaseline swaps in the bucket center once well-sampled, else falls back", () => {
  const baseline = { pitchMeanHz: computeRobustStats([180, 181, 179, 180]) };
  let c = newContextualCenters();
  for (let i = 0; i < CONTEXT_MIN_N; i++) c = updateContextualCenters(c, "evening", { pitchMeanHz: 150 });

  const adj = contextAdjustedBaseline(baseline, c, "evening");
  assert.ok(adj.pitchMeanHz!.median < 175, "the evening center (~150) replaces the global median");

  const fallback = contextAdjustedBaseline(baseline, c, "morning"); // under-sampled bucket
  assert.equal(fallback.pitchMeanHz!.median, baseline.pitchMeanHz!.median);
});

test("only the center moves — spread is borrowed from the global baseline", () => {
  const baseline = { f: computeRobustStats([10, 12, 8, 11, 9]) };
  let c = newContextualCenters();
  for (let i = 0; i < CONTEXT_MIN_N; i++) c = updateContextualCenters(c, "night", { f: 100 });
  const adj = contextAdjustedBaseline(baseline, c, "night");
  assert.equal(adj.f!.robustStd, baseline.f!.robustStd);
  assert.ok(adj.f!.median > 50);
});
