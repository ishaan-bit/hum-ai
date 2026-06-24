import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessLongitudinalState,
  deriveRiskMarkers,
  MIN_SERIES_FOR_MARKERS,
  RISK_LEVEL_RANK,
  type LongitudinalStateInputs,
  type RelapseClass,
  type RelapseVerdict,
  type RiskSeriesPoint,
} from "@hum-ai/relapse-engine";

// ── series builders ───────────────────────────────────────────────────────────
let clock = 0;
const pt = (valence: number, arousal: number, risk = 0.2): RiskSeriesPoint => ({
  t: (clock += 1000),
  valence,
  arousal,
  risk,
});
/** A steady baseline run (calm, slightly pleasant, low risk). */
function baselineRun(n: number): RiskSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => pt(0.1 + (i % 2 ? 0.03 : -0.03), 0.0 + (i % 2 ? 0.02 : -0.02), 0.2));
}

// ── longitudinal helpers (reused from the engine's own contracts) ──────────────
const verdict = (cls: RelapseClass, drift = 0.3): RelapseVerdict => ({
  class: cls,
  drift,
  comparisons: [{ kind: "baseline_7d" as const, riskDelta: 0.2, class: cls }],
  dvdsa: null,
  rationale: "test",
});
const lgInputs = (over: Partial<LongitudinalStateInputs> = {}): LongitudinalStateInputs => ({
  relapseModelActive: true,
  baselineActive: true,
  anchoredActive: true,
  relapse: null,
  divergenceMagnitude: 0,
  riskScore: 0.2,
  baseConfidence: 0.8,
  abstained: false,
  abstainReason: "none",
  highRiskAlignment: null,
  recoveryAlignment: null,
  driftEvidenceFeatures: ["pitchHz"],
  priorConsecutiveDriftHums: 0,
  ...over,
});

test("abstains for acoustic markers without a personal baseline", () => {
  const r = deriveRiskMarkers({ series: baselineRun(8), baselineActive: false, longitudinal: null });
  assert.equal(r.depressive.level, "insufficient_data");
  assert.equal(r.anxiety.level, "insufficient_data");
  assert.equal(r.baselineReady, false);
});

test("abstains for acoustic markers with too few hums", () => {
  const r = deriveRiskMarkers({ series: baselineRun(MIN_SERIES_FOR_MARKERS - 1), baselineActive: true, longitudinal: null });
  assert.equal(r.depressive.level, "insufficient_data");
  assert.equal(r.anxiety.level, "insufficient_data");
});

test("steady-in-usual series leaves all acoustic markers settled", () => {
  const r = deriveRiskMarkers({ series: baselineRun(12), baselineActive: true, longitudinal: null });
  assert.equal(r.depressive.level, "settled");
  assert.equal(r.anxiety.level, "settled");
});

test("sustained low-valence + flat-arousal raises the DEPRESSIVE marker, not anxiety", () => {
  const series = [...baselineRun(10), pt(-0.6, -0.3), pt(-0.62, -0.28), pt(-0.65, -0.32), pt(-0.6, -0.3)];
  const r = deriveRiskMarkers({ series, baselineActive: true, longitudinal: null });
  assert.equal(r.depressive.level, "elevated");
  assert.ok(r.depressive.sustainedHums >= 3, `sustained ${r.depressive.sustainedHums}`);
  // Low-but-flat must NOT light the anxiety (tense/keyed-up) marker.
  assert.notEqual(r.anxiety.level, "elevated");
  assert.ok(r.depressive.intensity > 0 && r.depressive.intensity <= 1);
});

test("sustained high-arousal + negative-valence raises the ANXIETY marker, not depressive", () => {
  const series = [...baselineRun(10), pt(-0.3, 0.6), pt(-0.28, 0.62), pt(-0.32, 0.58), pt(-0.3, 0.6)];
  const r = deriveRiskMarkers({ series, baselineActive: true, longitudinal: null });
  assert.equal(r.anxiety.level, "elevated");
  assert.ok(r.anxiety.sustainedHums >= 3, `sustained ${r.anxiety.sustainedHums}`);
  // Keyed-up-negative must NOT light the depressive (down/flat) marker.
  assert.notEqual(r.depressive.level, "elevated");
});

test("happy + energised (high arousal, high valence) does NOT read as anxiety", () => {
  const series = [...baselineRun(10), pt(0.6, 0.6), pt(0.62, 0.58), pt(0.58, 0.62), pt(0.6, 0.6)];
  const r = deriveRiskMarkers({ series, baselineActive: true, longitudinal: null });
  assert.notEqual(r.anxiety.level, "elevated");
  assert.notEqual(r.depressive.level, "elevated");
});

test("a downward valence step flags an early CUSUM onset on the depressive marker", () => {
  // Flat, then a sustained step down — the onset should be detected before a long run.
  const series = [...baselineRun(8), pt(-0.7, -0.3), pt(-0.72, -0.32), pt(-0.68, -0.28), pt(-0.7, -0.3), pt(-0.71, -0.3)];
  const r = deriveRiskMarkers({ series, baselineActive: true, longitudinal: null });
  assert.equal(r.depressive.earlyOnset, true);
  assert.ok(r.depressive.changeIndex !== null);
  assert.ok(r.depressive.evidenceFeatures.length > 0);
});

test("RELAPSE marker is elevated on a sustained longitudinal drift", () => {
  const lg = assessLongitudinalState(
    lgInputs({ relapse: verdict("worsening", 0.6), riskScore: 0.7, priorConsecutiveDriftHums: 2 }),
  );
  assert.ok(lg.relapseDrift, "expected a sustained relapse-drift signal");
  const r = deriveRiskMarkers({ series: baselineRun(8), baselineActive: true, longitudinal: lg });
  assert.equal(r.relapse.level, "elevated");
  assert.ok(r.relapse.sustainedHums >= 3);
});

test("RELAPSE marker abstains when the longitudinal state has insufficient data", () => {
  const lg = assessLongitudinalState(lgInputs({ baselineActive: false }));
  assert.equal(lg.riskHypothesis.status, "insufficient_data");
  const r = deriveRiskMarkers({ series: baselineRun(3), baselineActive: false, longitudinal: lg });
  assert.equal(r.relapse.level, "insufficient_data");
});

test("RELAPSE marker is watch on a single risk-marker-present hum (no sustained drift)", () => {
  const lg = assessLongitudinalState(lgInputs({ riskScore: 0.7 }));
  assert.equal(lg.riskHypothesis.status, "risk_marker_present");
  assert.equal(lg.relapseDrift, null);
  const r = deriveRiskMarkers({ series: baselineRun(8), baselineActive: true, longitudinal: lg });
  assert.equal(r.relapse.level, "watch");
});

test("all marker intensities stay within [0,1] and objects are non-diagnostic", () => {
  const series = [...baselineRun(10), pt(-0.9, 0.9, 0.95), pt(-0.95, 0.85, 0.9), pt(-0.9, 0.95, 0.92)];
  const lg = assessLongitudinalState(lgInputs({ relapse: verdict("worsening", 0.9), riskScore: 0.9, priorConsecutiveDriftHums: 5 }));
  const r = deriveRiskMarkers({ series, baselineActive: true, longitudinal: lg });
  for (const m of [r.depressive, r.anxiety, r.relapse]) {
    assert.ok(m.intensity >= 0 && m.intensity <= 1, `${m.id} intensity ${m.intensity}`);
    assert.equal(m.isDiagnostic, false);
  }
  assert.equal(r.isDiagnostic, false);
});

test("RISK_LEVEL_RANK orders severity", () => {
  assert.ok(RISK_LEVEL_RANK.elevated > RISK_LEVEL_RANK.watch);
  assert.ok(RISK_LEVEL_RANK.watch > RISK_LEVEL_RANK.settled);
  assert.ok(RISK_LEVEL_RANK.settled > RISK_LEVEL_RANK.insufficient_data);
});
