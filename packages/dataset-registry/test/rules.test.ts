import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGISTRY,
  assertValidRegistry,
  validateEntry,
  isUseAllowed,
  getEntryByRole,
  DOMAIN_FORBIDDEN_USES,
  type DatasetRegistryEntry,
} from "@hum-ai/dataset-registry";

test("all source entries are present and govern-valid", () => {
  assert.equal(REGISTRY.length, 8);
  assert.doesNotThrow(() => assertValidRegistry(REGISTRY));
});

test("the native-hum self-report corpus (HiTL) is a dataset that may serve hum truth, but not clinical/relapse", () => {
  const native = REGISTRY.find((e) => e.id === "native_hum_self_report_corpus")!;
  assert.equal(native.kind, "dataset");
  assert.equal(native.domain, "native_hum");
  assert.equal(native.domain_gap_to_hum, "none");
  assert.equal(native.clinical_status, "non_clinical");
  assert.equal(native.label_type, "dimensional_va");
  // It IS the source of hum truth for the affect/personalization track.
  assert.equal(isUseAllowed(native, "hum_finetune"), true);
  assert.equal(isUseAllowed(native, "personalization"), true);
  assert.equal(isUseAllowed(native, "affect_prior"), true);
  // But benign self-report affect is NOT a clinical prior or a relapse corpus.
  assert.equal(isUseAllowed(native, "clinical_prior"), false);
  assert.equal(isUseAllowed(native, "relapse_tracking"), false);
});

test("music-emotion dataset cannot be used as user-state diagnosis", () => {
  const music = getEntryByRole("intervention_support_source")!;
  assert.equal(music.domain, "music_emotion");
  assert.equal(isUseAllowed(music, "clinical_prior"), false);
  assert.equal(isUseAllowed(music, "relapse_tracking"), false);
  assert.equal(isUseAllowed(music, "affect_prior"), false);
  // but it MAY support recommendation
  assert.equal(isUseAllowed(music, "recommendation"), true);
});

test("clinical-speech dataset cannot be treated as direct hum truth", () => {
  const clinical = getEntryByRole("clinical_voice_biomarker_review")!;
  assert.equal(clinical.domain, "clinical_speech");
  assert.equal(isUseAllowed(clinical, "hum_finetune"), false);
  assert.equal(isUseAllowed(clinical, "personalization"), false);
  // but it MAY be a clinical prior
  assert.equal(isUseAllowed(clinical, "clinical_prior"), true);
});

test("only native_hum may serve hum truth / personalization / relapse_tracking", () => {
  const hum = getEntryByRole("hum_protocol_source")!;
  assert.equal(hum.domain, "native_hum");
  assert.equal(isUseAllowed(hum, "hum_finetune"), true);
  assert.equal(isUseAllowed(hum, "personalization"), true);
  assert.equal(isUseAllowed(hum, "relapse_tracking"), true);
});

test("singing/sustained-phonation is the closest public bridge (near gap, hum_finetune ok)", () => {
  const singing = getEntryByRole("vocal_biomarker_and_singing_protocol_support")!;
  assert.equal(singing.domain_gap_to_hum, "near");
  assert.equal(isUseAllowed(singing, "hum_finetune"), true);
  assert.equal(isUseAllowed(singing, "personalization"), false);
});

test("validator catches a hand-crafted illegal entry (music used for diagnosis)", () => {
  const bad: DatasetRegistryEntry = {
    ...getEntryByRole("intervention_support_source")!,
    id: "bad_music",
    allowed_model_use: ["recommendation", "clinical_prior"], // illegal for music_emotion
    prohibited_model_use: ["affect_prior", "hum_finetune", "personalization", "relapse_tracking"],
  };
  const violations = validateEntry(bad);
  assert.ok(violations.length > 0);
  assert.ok(violations.some((v) => v.code === "music_used_for_diagnosis" || v.code === "allowed_uses_forbidden_for_domain"));
});

test("every domain has a forbidden-use rule and native_hum forbids nothing", () => {
  assert.deepEqual(DOMAIN_FORBIDDEN_USES.native_hum, []);
  assert.ok(DOMAIN_FORBIDDEN_USES.music_emotion.includes("clinical_prior"));
});
