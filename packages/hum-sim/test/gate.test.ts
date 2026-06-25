import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archetypeScenarios,
  runBatch,
  evaluateReleaseGate,
  type RecoveryCheck,
} from "@hum-ai/hum-sim";

/**
 * RELEASE-GATE GUARDS. The Hum Simulator's `npm run hum-sim` enforces a hard pass/fail
 * contract (`evaluateReleaseGate`): the four corner moods must separate + reach their poles,
 * a neutral hum must sit at the origin, fidelity must not manufacture affect, the extractor
 * must recover every control, and invalid audio must abstain. These tests exercise the gate on
 * the real pipeline (the affect-reachability checks) and prove it has teeth (it fails on a
 * regressed input), so the v9 calibration cannot silently regress.
 */

/** A fully-recovered extractor stub (the affect-reachability checks are the focus here). */
const RECOVERED: readonly RecoveryCheck[] = [
  { driver: "energy", feature: "feat.meanRms", expectedSign: 1, observedSlopeSign: 1, span: 0.1, atLow: 0, atHigh: 0.1, recovered: true },
];

test("the live archetype reads PASS the release gate's affect-reachability checks", async () => {
  // 2 realizations per archetype through the exact production pipeline (fast, deterministic).
  const archetypes = await runBatch(archetypeScenarios(2));
  const gate = evaluateReleaseGate({
    archetypes,
    recovery: RECOVERED,
    leaks: [],
    malformed: [],
    failures: [],
  });
  const failed = gate.checks.filter((c) => !c.pass);
  assert.ok(gate.pass, `gate failed: ${failed.map((c) => `${c.id} (${c.detail})`).join("; ")}`);
  // Spot-check the specific reachability contracts the v9 build restored.
  for (const id of ["arousal-separation", "valence-separation", "valence-low-reachable", "neutral-zero-point", "diagonal-ordering"]) {
    assert.ok(gate.checks.find((c) => c.id === id)?.pass, `expected ${id} to pass`);
  }
});

test("the gate has TEETH — a manufactured fidelity leak fails it", async () => {
  const archetypes = await runBatch(archetypeScenarios(1));
  const gate = evaluateReleaseGate({
    archetypes,
    recovery: RECOVERED,
    // A fidelity sweep that manufactures affect → the core contract must fail the build.
    leaks: [{
      group: "fidelity:calm:noise", mood: "calm", control: "noise",
      valenceDrift: 0.8, arousalDrift: 0.8, directionalValence: 0.0, directionalArousal: 0.8,
      zonesVisited: 4, leaks: true,
    }],
    malformed: [],
    failures: [],
  });
  assert.equal(gate.pass, false, "a manufactured fidelity leak must fail the gate");
  assert.equal(gate.checks.find((c) => c.id === "fidelity-no-manufacture")?.pass, false);
});

test("the gate has TEETH — invalid audio that does not abstain fails it", async () => {
  const archetypes = await runBatch(archetypeScenarios(1));
  const gate = evaluateReleaseGate({
    archetypes,
    recovery: RECOVERED,
    leaks: [],
    // A malformed capture that produced a (non-throwing) NON-abstained read = a confident
    // emotional read from garbage. Must fail the build.
    malformed: [{ id: "malformed/nan", threw: false, abstained: false, decision: "accepted" }],
    failures: [],
  });
  assert.equal(gate.pass, false, "invalid audio producing a confident read must fail the gate");
  assert.equal(gate.checks.find((c) => c.id === "malformed-abstains")?.pass, false);
});
