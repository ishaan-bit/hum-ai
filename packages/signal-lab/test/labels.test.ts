import { test } from "node:test";
import assert from "node:assert/strict";
import { FUSION_LABELS } from "@hum-ai/affect-model-contracts";
import {
  RAVDESS_EMOTION_MAPPING,
  fusionLabelForEmotion,
  supportedFusionLabels,
  unsupportedFusionLabels,
  labelMappingSnapshot,
} from "../src/labels";

test("every non-excluded mapping targets a real FUSION_LABEL (traceable, no invented targets)", () => {
  for (const m of Object.values(RAVDESS_EMOTION_MAPPING)) {
    if (m.fusionLabel === null) {
      assert.equal(m.strength, "excluded");
    } else {
      assert.ok((FUSION_LABELS as readonly string[]).includes(m.fusionLabel), `${m.fusionLabel} not a fusion label`);
      assert.ok(m.rationale.length > 0, "mapping must carry a rationale");
    }
  }
});

test("ambiguous emotions (disgust, surprised) are excluded, not force-fit", () => {
  assert.equal(fusionLabelForEmotion("disgust"), null);
  assert.equal(fusionLabelForEmotion("surprised"), null);
  const snap = labelMappingSnapshot();
  assert.deepEqual([...snap.excluded_emotions].sort(), ["disgust", "surprised"]);
});

test("direct mappings match the circumplex anchors", () => {
  assert.equal(fusionLabelForEmotion("neutral"), "neutral_close_to_usual");
  assert.equal(fusionLabelForEmotion("calm"), "calm_regulated");
  assert.equal(fusionLabelForEmotion("happy"), "positive_activation");
  assert.equal(fusionLabelForEmotion("sad"), "low_mood");
  assert.equal(fusionLabelForEmotion("angry"), "high_arousal_negative");
});

test("fatigued has no RAVDESS support and is honestly reported as a gap", () => {
  assert.ok(supportedFusionLabels().length >= 5);
  assert.ok(unsupportedFusionLabels().includes("fatigued"));
  // supported + unsupported partition FUSION_LABELS exactly.
  const all = new Set([...supportedFusionLabels(), ...unsupportedFusionLabels()]);
  assert.equal(all.size, FUSION_LABELS.length);
});

test("snapshot records governance + target space provenance", () => {
  const snap = labelMappingSnapshot();
  assert.equal(snap.target_space, "FUSION_LABELS");
  assert.ok(snap.target_space_source.includes("fusion-labels"));
  assert.ok(snap.governance.includes("0.45"));
});
