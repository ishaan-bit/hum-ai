import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINICAL_RISK_CONFIDENCE_CAP } from "@hum-ai/shared-types";
import {
  assessLongitudinalState,
  MIN_CONSECUTIVE_DRIFT_HUMS,
  type LongitudinalStateInputs,
  type RelapseClass,
  type RelapseVerdict,
} from "@hum-ai/relapse-engine";

const verdict = (cls: RelapseClass, drift = 0.3, comparisons = 2): RelapseVerdict => ({
  class: cls,
  drift,
  comparisons: Array.from({ length: comparisons }, () => ({
    kind: "baseline_7d" as const,
    riskDelta: 0.2,
    class: cls,
  })),
  dvdsa: null,
  rationale: "test",
});

/** A fully-formed input at a mature, baseline-active, relapse-model-active account. */
const base = (over: Partial<LongitudinalStateInputs> = {}): LongitudinalStateInputs => ({
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
  driftEvidenceFeatures: ["pitchHz", "meanRms"],
  priorConsecutiveDriftHums: 0,
  ...over,
});

test("output shape is stable and structurally non-diagnostic", () => {
  const s = assessLongitudinalState(base());
  assert.equal(s.isDiagnostic, false);
  assert.equal(s.riskHypothesis.isDiagnostic, false);
  assert.ok(["improving", "worsening", "stable", "uncertain"].includes(s.trendDirection));
  assert.ok(["risk_marker_present", "nominal", "insufficient_data"].includes(s.riskHypothesis.status));
  assert.equal(typeof s.monitoringFlag, "boolean");
  assert.equal(typeof s.consecutiveDriftHums, "number");
  // provenance is always present
  for (const k of [
    "currentHum",
    "populationPrior",
    "personalBaseline",
    "longitudinalTrend",
    "relapseModel",
    "highRiskSignature",
    "recoverySignature",
  ] as const) {
    assert.equal(typeof s.evidenceSources[k], "boolean");
  }
});

test("first hum / no baseline produces no longitudinal certainty (insufficient_data, priors only)", () => {
  const s = assessLongitudinalState(
    base({ baselineActive: false, relapseModelActive: false, anchoredActive: false, riskScore: 0.9 }),
  );
  assert.equal(s.riskHypothesis.status, "insufficient_data");
  assert.equal(s.relapseDrift, null);
  assert.equal(s.recovery, null);
  assert.equal(s.monitoringFlag, false);
  assert.equal(s.trendDirection, "uncertain");
  // provenance: the population prior was the basis, not a personal baseline.
  assert.equal(s.evidenceSources.populationPrior, true);
  assert.equal(s.evidenceSources.personalBaseline, false);
  assert.equal(s.evidenceSources.relapseModel, false);
});

test("risk_marker_present requires a personal baseline — never population norms", () => {
  // High risk but NO baseline ⇒ we abstain rather than judge against the population.
  const noBaseline = assessLongitudinalState(base({ baselineActive: false, riskScore: 0.95 }));
  assert.equal(noBaseline.riskHypothesis.status, "insufficient_data");
  // Same high risk WITH a baseline ⇒ within-user judgement is allowed.
  const withBaseline = assessLongitudinalState(base({ riskScore: 0.95 }));
  assert.equal(withBaseline.riskHypothesis.status, "risk_marker_present");
  assert.ok(withBaseline.riskHypothesis.evidenceFeatures.length > 0);
});

test("clinical-risk confidence is HARD CAPPED at 88% regardless of maturity", () => {
  // A 20+ hum account whose general cap is 0.92 still cannot exceed 0.88 here.
  const s = assessLongitudinalState(
    base({ baseConfidence: 0.92, riskScore: 0.9, relapse: verdict("worsening"), priorConsecutiveDriftHums: 5 }),
  );
  assert.equal(s.riskHypothesis.confidence, CLINICAL_RISK_CONFIDENCE_CAP);
  assert.ok(s.relapseDrift);
  assert.equal(s.relapseDrift!.confidence, CLINICAL_RISK_CONFIDENCE_CAP);
  assert.ok(s.riskHypothesis.confidence <= CLINICAL_RISK_CONFIDENCE_CAP);
});

test("a single drifting hum does NOT raise a relapse-drift signal (acute ≠ early-warning)", () => {
  const s = assessLongitudinalState(base({ relapse: verdict("relapse_drift", 0.6), priorConsecutiveDriftHums: 0 }));
  // The acute deviation is still READ — trend worsening, marker present — not normalised away.
  assert.equal(s.trendDirection, "worsening");
  assert.equal(s.riskHypothesis.status, "risk_marker_present");
  // ...but a single hum never trips the early-warning signal.
  assert.equal(s.relapseDrift, null);
  assert.equal(s.monitoringFlag, false);
  assert.equal(s.consecutiveDriftHums, 1);
});

test("sustained drift (≥ MIN_CONSECUTIVE_DRIFT_HUMS) raises the signal with routing", () => {
  const s = assessLongitudinalState(
    base({ relapse: verdict("relapse_drift", 0.6), priorConsecutiveDriftHums: MIN_CONSECUTIVE_DRIFT_HUMS - 1 }),
  );
  assert.ok(s.relapseDrift, "sustained drift raises the signal");
  assert.equal(s.relapseDrift!.signalType, "relapse_drift");
  assert.equal(s.relapseDrift!.consecutiveDriftHums, MIN_CONSECUTIVE_DRIFT_HUMS);
  assert.equal(s.monitoringFlag, true);
  assert.ok(["monitoring_prompt", "check_in_prompt"].includes(s.relapseDrift!.userAction!));
  assert.ok(s.relapseDrift!.driftMagnitude >= 0.5);
  assert.deepEqual(s.relapseDrift!.evidenceFeatures, ["pitchHz", "meanRms"]);
});

test("relapse model inactive ⇒ no signal even on a worsening verdict", () => {
  const s = assessLongitudinalState(
    base({ relapseModelActive: false, relapse: verdict("worsening"), priorConsecutiveDriftHums: 9 }),
  );
  assert.equal(s.relapseDrift, null);
  assert.equal(s.consecutiveDriftHums, 0, "drift does not accrue before the relapse model is active");
});

test("learned high-risk signature alignment sharpens the drift direction", () => {
  const aligned = assessLongitudinalState(
    base({ relapse: verdict("relapse_drift", 0.6), priorConsecutiveDriftHums: 5, highRiskAlignment: 0.8 }),
  );
  assert.equal(aligned.relapseDrift!.driftDirection, "diverging_from_stable");
  assert.equal(aligned.evidenceSources.highRiskSignature, true);

  const unaligned = assessLongitudinalState(
    base({ relapse: verdict("relapse_drift", 0.6), priorConsecutiveDriftHums: 5, highRiskAlignment: -0.5 }),
  );
  assert.equal(unaligned.relapseDrift!.driftDirection, "worsening");
});

test("recovery verdict yields a recovery signature and an improving trend", () => {
  const s = assessLongitudinalState(base({ relapse: verdict("recovery", 0), recoveryAlignment: 0.7, riskScore: 0.1 }));
  assert.equal(s.trendDirection, "improving");
  assert.ok(s.recovery);
  assert.equal(s.recovery!.signalType, "recovery_trajectory");
  assert.equal(s.recovery!.trajectoryDirection, "exceeding_prior_stable");
  assert.ok(s.recovery!.confidence <= CLINICAL_RISK_CONFIDENCE_CAP);
  assert.equal(s.relapseDrift, null);
  assert.equal(s.riskHypothesis.status, "nominal");
});

test("abstention returns insufficient_data and HOLDS the drift streak (no corruption)", () => {
  const s = assessLongitudinalState(
    base({ abstained: true, abstainReason: "poor_capture_quality", priorConsecutiveDriftHums: 2, riskScore: 0.9 }),
  );
  assert.equal(s.riskHypothesis.status, "insufficient_data");
  assert.equal(s.abstained, true);
  assert.equal(s.abstainReason, "poor_capture_quality");
  assert.equal(s.consecutiveDriftHums, 2, "a low-confidence hum neither confirms nor breaks the streak");
  assert.equal(s.relapseDrift, null);
});

test("trend detection over divergence when no relapse verdict is present", () => {
  const drifting = assessLongitudinalState(base({ relapse: null, divergenceMagnitude: 2.0 }));
  assert.equal(drifting.trendDirection, "worsening");
  const steady = assessLongitudinalState(base({ relapse: null, divergenceMagnitude: 0.2 }));
  assert.equal(steady.trendDirection, "stable");
});

test("a non-drifting hum resets the consecutive streak", () => {
  const s = assessLongitudinalState(base({ relapse: verdict("stable"), priorConsecutiveDriftHums: 4 }));
  assert.equal(s.consecutiveDriftHums, 0);
  assert.equal(s.relapseDrift, null);
});
