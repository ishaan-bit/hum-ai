import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sweepAll,
  driversFor,
  readOutputs,
  computeFindings,
  computeScenarioFindings,
  fullReport,
  runMoodScenarios,
  runFidelityInvariance,
  runPinReReference,
  runHybridLayers,
  REFERENCE_HUM,
  FEATURE_SPECS,
  MIN_AXIS_DRIVERS,
  DEAD_SPAN,
  type OutputKey,
} from "../src/index";

/**
 * READ-PATH CALIBRATION REGRESSION. These lock in the research-grounded contracts the
 * sim-lab harness measures, so a future change to the rule-based read or the OCEAN
 * windows that re-introduces a fidelity leak, pins an axis, inverts a sign, or breaks
 * the within-user unpin is caught by `npm test`. (The CLI `npm run sim` gates the same
 * findings for a build.)
 */

test("the full calibration report has no FAIL findings", () => {
  const { ok, findings } = fullReport();
  const fails = findings.filter((f) => f.severity === "fail");
  assert.equal(ok, true, `unexpected calibration failures:\n${fails.map((f) => `  - [${f.area}] ${f.message}`).join("\n")}`);
});

test("CONTRACT: pure spectral-color fidelity has zero affect effect; noise level may only fade toward neutral", () => {
  const sweeps = sweepAll();
  const NOISE_LEVEL_FIDELITY = new Set(["signalToNoiseProxy", "noiseFloorRms"]);
  for (const s of sweeps.filter((x) => x.kind === "fidelity")) {
    for (const out of ["valence", "arousal"] as const) {
      const e = s.effects[out];
      if (NOISE_LEVEL_FIDELITY.has(s.feature)) {
        // SNR is the confidence signal: it may fade fidelity-fragile cues TOWARD NEUTRAL as
        // SNR drops (low-SNR end closer to 0 than high-SNR end), but never toward a pole.
        const fadesTowardNeutral =
          Math.abs(e.atLow) <= Math.abs(e.atHigh) + DEAD_SPAN &&
          (Math.sign(e.atLow) === Math.sign(e.atHigh) || Math.abs(e.atLow) < 0.05);
        assert.ok(
          fadesTowardNeutral,
          `signalToNoiseProxy pushed ${out} toward a pole (low-SNR ${e.atLow.toFixed(2)} vs high-SNR ${e.atHigh.toFixed(2)})`,
        );
      } else {
        assert.ok(e.span < DEAD_SPAN, `${s.feature} (fidelity) moved ${out} by ${e.span.toFixed(3)} — must be ~0`);
      }
    }
  }
});

test("each affect axis has enough live drivers (not pinned to a constant)", () => {
  const sweeps = sweepAll();
  for (const axis of ["valence", "arousal"] as const) {
    const drivers = driversFor(sweeps, axis);
    assert.ok(drivers.length >= MIN_AXIS_DRIVERS, `${axis} has only ${drivers.length} live drivers`);
  }
});

test("every OCEAN trait responds to at least one parameter", () => {
  const sweeps = sweepAll();
  for (const trait of [
    "openness", "conscientiousness", "extraversion", "agreeableness", "emotional_stability",
  ] as const) {
    assert.ok(driversFor(sweeps, trait).length > 0, `OCEAN trait ${trait} is dead (no driver)`);
  }
});

test("sensitivity SIGNS match the research-grounded directions", () => {
  const sweeps = sweepAll();
  const dir = (feature: string, out: OutputKey): -1 | 0 | 1 =>
    sweeps.find((s) => s.feature === feature)!.effects[out].slopeSign;

  // arousal rises with energy, pitch height, brightness, flux (V-A circumplex)
  assert.equal(dir("meanRms", "arousal"), 1);
  assert.equal(dir("pitchMeanHz", "arousal"), 1);
  assert.equal(dir("spectralCentroidHz", "arousal"), 1);
  assert.equal(dir("spectralFlux", "arousal"), 1);
  // valence rises with pitch height + melodic movement + settled voice quality; falls with agitation
  assert.equal(dir("pitchMeanHz", "valence"), 1);
  assert.equal(dir("pitchRangeSemitones", "valence"), 1);
  assert.equal(dir("smoothnessScore", "valence"), 1);
  assert.equal(dir("residualInstabilityScore", "valence"), -1);
  // OCEAN (voice-big-five.md): openness↑ with pitch range/musicality; conscientiousness↑ with
  // control/stability, ↓ with shimmer; steadiness↓ with jitter/shimmer.
  assert.equal(dir("pitchRangeSemitones", "openness"), 1);
  assert.equal(dir("musicalityScore", "openness"), 1);
  assert.equal(dir("controlledExpressionScore", "conscientiousness"), 1);
  assert.equal(dir("shimmerProxy", "conscientiousness"), -1);
  assert.equal(dir("jitter", "emotional_stability"), -1);
});

test("mood archetypes land in the correct valence/arousal quadrant", () => {
  for (const r of runMoodScenarios()) {
    assert.ok(r.valenceOk, `${r.id}: wrong valence direction (${r.valence.toFixed(2)})`);
    assert.ok(r.arousalOk, `${r.id}: wrong arousal direction (${r.arousal.toFixed(2)})`);
  }
});

test("fidelity invariance: a noisy mic only fades the read toward neutral, never toward a wrong pole", () => {
  for (const f of runFidelityInvariance()) {
    assert.ok(
      !f.directionalLeak,
      `mood ${f.mood}: clean→noisy mic pushed affect toward a wrong pole / away from neutral ` +
        `(valence ${f.cleanValence.toFixed(2)}→${f.noisyValence.toFixed(2)}, arousal ${f.cleanArousal.toFixed(2)}→${f.noisyArousal.toFixed(2)})`,
    );
  }
});

test("within-user re-reference unpins a fixed-voice user across moods", () => {
  const pin = runPinReReference();
  assert.ok(pin.acousticZoneCount <= 2, `absolute read should be pinned (got ${pin.acousticZoneCount} zones)`);
  assert.ok(pin.unpinned, "re-reference failed to unpin the read");
  assert.ok(pin.displayedValenceSpan > pin.acousticValenceSpan, "displayed span should exceed absolute span");
});

test("openness pitch-range cue does not saturate before its realistic ceiling", () => {
  // The defining openness cue (pitch range) must read variation across the full realistic
  // hum range, not clip halfway (voice-big-five.md §2 — wider F0 range → higher openness).
  const s = sweepAll().find((x) => x.feature === "pitchRangeSemitones")!;
  assert.equal(s.effects.openness.saturatedHigh, false, "openness pitch-range window clips before its ceiling");
});

test("HYBRID: an ML axis prior refines the rule-based backbone but never overrides it", () => {
  const hy = runHybridLayers();
  // in-domain native prior nudges toward its lean, stays bounded between backbone and prior.
  assert.ok(hy.inDomainNative.moved, "in-domain native prior should move the read toward its lean");
  assert.ok(hy.inDomainNative.bounded, "refined read must stay between the backbone and the prior (no override)");
  assert.ok(!hy.inDomainNative.unchanged, "in-domain prior should actually refine the read");
  // out-of-domain prior abstains; gate-failed prior is held — both leave the backbone untouched.
  assert.ok(hy.outOfDomain.unchanged, "out-of-domain prior must abstain (read = acoustic backbone)");
  assert.ok(hy.gateFailed.unchanged, "gate-failed prior must be held (read = acoustic backbone)");
});

test("the reference hum is a coherent neutral read", () => {
  const o = readOutputs(REFERENCE_HUM);
  // The neutral reference should not itself be an extreme read on either axis.
  assert.ok(Math.abs(o.valence) < 0.6, `reference valence too extreme: ${o.valence}`);
  assert.ok(Math.abs(o.arousal) < 0.6, `reference arousal too extreme: ${o.arousal}`);
  assert.ok(o.signalStrength > 0.3, `reference should be a usable read: ${o.signalStrength}`);
});

test("FEATURE_SPECS cover the numeric feature surface and computeFindings is stable", () => {
  assert.ok(FEATURE_SPECS.length >= 25, "expected the full captured-parameter surface to be swept");
  // computeFindings + computeScenarioFindings are deterministic (pure read path).
  assert.deepEqual(computeFindings(sweepAll()).length, computeFindings(sweepAll()).length);
  assert.deepEqual(computeScenarioFindings().length, computeScenarioFindings().length);
});
