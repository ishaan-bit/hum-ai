import { test } from "node:test";
import assert from "node:assert/strict";
import { FUSION_LABEL_AFFECT } from "@hum-ai/affect-model-contracts";
import {
  AROUSAL_BINARY_TARGET,
  VALENCE_BINARY_TARGET,
  AFFECT_FUSION_TARGET,
  EXPERIMENT_TARGETS,
  targetSnapshot,
  AFFECT_AXIS_DEADBAND,
} from "../src/targets";
import { supportedFusionLabels } from "../src/labels";

test("arousal/valence targets are derived EXACTLY from the contract's V-A anchors", () => {
  for (const label of supportedFusionLabels()) {
    const { valence, arousal } = FUSION_LABEL_AFFECT[label].va;
    const aCls = AROUSAL_BINARY_TARGET.classOf(label);
    const vCls = VALENCE_BINARY_TARGET.classOf(label);
    // Inside the dead-band ⇒ excluded (null); else the sign of the anchor decides.
    assert.equal(aCls, Math.abs(arousal) <= AFFECT_AXIS_DEADBAND ? null : arousal > 0 ? "high_arousal" : "low_arousal");
    assert.equal(vCls, Math.abs(valence) <= AFFECT_AXIS_DEADBAND ? null : valence > 0 ? "positive_valence" : "negative_valence");
  }
});

test("only the neutral mid-point is excluded by each binary split (not force-fit)", () => {
  // neutral_close_to_usual is V0/A0 → excluded from both binary targets.
  assert.equal(AROUSAL_BINARY_TARGET.classOf("neutral_close_to_usual"), null);
  assert.equal(VALENCE_BINARY_TARGET.classOf("neutral_close_to_usual"), null);
  // every OTHER supported label is assigned (no silent drops).
  for (const label of supportedFusionLabels()) {
    if (label === "neutral_close_to_usual") continue;
    assert.notEqual(AROUSAL_BINARY_TARGET.classOf(label), null, `${label} arousal`);
    assert.notEqual(VALENCE_BINARY_TARGET.classOf(label), null, `${label} valence`);
  }
});

test("classOf never emits a class outside the target's declared class set", () => {
  for (const t of EXPERIMENT_TARGETS) {
    for (const label of supportedFusionLabels()) {
      const c = t.classOf(label);
      if (c !== null) assert.ok(t.classes.includes(c), `${t.id} emitted ${c} not in ${t.classes.join(",")}`);
    }
  }
});

test("affect fusion target is the identity over RAVDESS-supported labels", () => {
  for (const label of supportedFusionLabels()) assert.equal(AFFECT_FUSION_TARGET.classOf(label), label);
});

test("target snapshot is fully traceable (every supported label assigned or excluded)", () => {
  const snap = targetSnapshot(AROUSAL_BINARY_TARGET);
  assert.equal(snap.id, "arousal_binary");
  assert.ok(snap.source.includes("arousal"));
  for (const label of supportedFusionLabels()) assert.ok(label in snap.assignment);
});
