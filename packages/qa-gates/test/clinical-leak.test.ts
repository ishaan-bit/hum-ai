import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalLeakGate, findClinicalLeakKeys, forbiddenClinicalKeys } from "@hum-ai/qa-gates";

test("clinical-leak gate passes on the real recommendation projection", () => {
  const result = clinicalLeakGate(process.cwd());
  assert.deepEqual(
    result.violations,
    [],
    `Clinical leak detected:\n${result.violations.map((v) => `  ${v.where}: ${v.token}`).join("\n")}`,
  );
});

test("forbiddenClinicalKeys includes risk head ids and their internal labels", () => {
  const keys = forbiddenClinicalKeys();
  // depressive_affect_markers is a risk marker head id; its internal label too.
  assert.ok(keys.has("depressive_affect_markers"), "should forbid the head id");
  assert.ok(keys.has("depressive_affect_marker"), "should forbid the internal label");
  assert.ok(keys.has("relapse_drift"), "should forbid the relapse-drift head id");
});

test("findClinicalLeakKeys catches a synthetic leaky object (head id key)", () => {
  const leaky = {
    abstained: false,
    dimensional: { valence: 0, arousal: 0 },
    depressive_affect_markers: 0.9, // raw clinical label leaking into the view
  };
  const offenders = findClinicalLeakKeys(leaky);
  assert.deepEqual(offenders, ["depressive_affect_markers"]);
});

test("findClinicalLeakKeys catches a nested leaky internal label", () => {
  const leaky = {
    abstained: false,
    meta: { detail: { depressive_affect_marker: 0.7 } }, // internal label, nested
  };
  const offenders = findClinicalLeakKeys(leaky);
  assert.deepEqual(offenders, ["depressive_affect_marker"]);
});

test("findClinicalLeakKeys passes a clean abstracted view", () => {
  const clean = {
    abstained: false,
    dimensional: { valence: 0.1, arousal: -0.2 },
    uncertainty: 0.3,
    elevatedRegulationNeed: true,
    lowEnergyPattern: false,
    lowMoodPattern: false,
    mixedOrUncertain: false,
  };
  assert.deepEqual(findClinicalLeakKeys(clean), []);
});
