import { test } from "node:test";
import assert from "node:assert/strict";
import { appendExample, emptyCorpus } from "../src/corpus";
import { axisCalibrationReport, corpusCalibration, calibrationTrend } from "../src/calibration";
import { makeExample } from "./fixtures";

function corpusWith(pairs: { id: string; pv: number; lv: number; at?: string }[]) {
  let c = emptyCorpus();
  for (const p of pairs) {
    c = appendExample(
      c,
      makeExample({ id: p.id, predicted: { valence: p.pv, arousal: 0 }, label: { valence: p.lv, arousal: 0 }, at: p.at }),
    );
  }
  return c;
}

test("a perfectly-tracking read scores high sign-agreement, low MAE, high correlation", () => {
  const c = corpusWith([
    { id: "1", pv: 0.6, lv: 0.6 },
    { id: "2", pv: -0.5, lv: -0.5 },
    { id: "3", pv: 0.3, lv: 0.3 },
    { id: "4", pv: -0.8, lv: -0.8 },
  ]);
  const r = axisCalibrationReport(c.examples, "valence");
  assert.equal(r.signAgreement, 1);
  assert.ok(r.mae < 1e-9);
  assert.ok(r.correlation > 0.99);
});

test("a read that systematically disagrees scores low sign-agreement and high MAE", () => {
  const c = corpusWith([
    { id: "1", pv: 0.6, lv: -0.6 },
    { id: "2", pv: -0.5, lv: 0.5 },
    { id: "3", pv: 0.4, lv: -0.4 },
    { id: "4", pv: -0.7, lv: 0.7 },
  ]);
  const r = axisCalibrationReport(c.examples, "valence");
  assert.equal(r.signAgreement, 0);
  assert.ok(r.mae > 1);
  assert.ok(r.correlation < 0);
});

test("ece is ~0 for a well-calibrated read and rises when over-confident", () => {
  // Well-calibrated: predicted strongly positive AND reported positive (and vice-versa).
  const good = corpusWith([
    { id: "1", pv: 0.9, lv: 0.9 },
    { id: "2", pv: 0.85, lv: 0.8 },
    { id: "3", pv: -0.9, lv: -0.9 },
    { id: "4", pv: -0.8, lv: -0.85 },
  ]);
  assert.ok(axisCalibrationReport(good.examples, "valence").ece < 0.2);
  // Over-confident: predicts extreme high pole but the report is actually low.
  const bad = corpusWith([
    { id: "1", pv: 0.95, lv: -0.5 },
    { id: "2", pv: 0.95, lv: -0.6 },
    { id: "3", pv: 0.9, lv: -0.4 },
    { id: "4", pv: 0.92, lv: -0.7 },
  ]);
  assert.ok(axisCalibrationReport(bad.examples, "valence").ece > 0.5);
});

test("corpusCalibration covers both axes; calibrationTrend reports improvement", () => {
  // Earlier half: read disagrees. Recent half: read agrees → improving.
  const pairs: { id: string; pv: number; lv: number; at: string }[] = [];
  for (let i = 0; i < 8; i++) pairs.push({ id: `old${i}`, pv: i % 2 ? 0.5 : -0.5, lv: i % 2 ? -0.5 : 0.5, at: `2026-06-0${1 + (i % 8)}T10:00:00.000Z` });
  for (let i = 0; i < 8; i++) pairs.push({ id: `new${i}`, pv: i % 2 ? 0.5 : -0.5, lv: i % 2 ? 0.5 : -0.5, at: `2026-06-2${i % 8}T10:00:00.000Z` });
  const c = corpusWith(pairs);
  const cal = corpusCalibration(c);
  assert.equal(cal.n, 16);
  assert.ok(cal.valence.n === 16);
  const trend = calibrationTrend(c, "valence");
  assert.equal(trend.direction, "improving");
  assert.ok(trend.recentSignAgreement > trend.earlierSignAgreement);
});

test("calibrationTrend is 'insufficient' below the minimum per-half", () => {
  const c = corpusWith([
    { id: "1", pv: 0.5, lv: 0.5, at: "2026-06-01T10:00:00.000Z" },
    { id: "2", pv: -0.5, lv: -0.5, at: "2026-06-02T10:00:00.000Z" },
  ]);
  assert.equal(calibrationTrend(c, "valence").direction, "insufficient");
});
