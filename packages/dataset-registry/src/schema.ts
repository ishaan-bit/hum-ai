import type { AudioDomain, DomainGap, Modality } from "@hum-ai/shared-types";

/**
 * Dataset registry schema. Public datasets solve cold-start ONLY as priors;
 * native hum data and personal baselines must progressively dominate (ADR-0005).
 * Every dataset/reference Hum touches is catalogued here with its allowed and
 * prohibited model uses, so governance is data, not tribal knowledge.
 */

/**
 * What a dataset/reference may be used for. Note the distinction between a
 * *prior* (cold-start belief that gets overridden by personal data) and
 * *truth* (hum_finetune / personalization / relapse_tracking), which only
 * native hum data may provide.
 */
export const MODEL_USES = [
  "pretraining",
  "evaluation",
  "recommendation",
  "clinical_prior",
  "affect_prior",
  "hum_finetune",
  "personalization",
  "relapse_tracking",
  "market_research_only",
] as const;
export type ModelUse = (typeof MODEL_USES)[number];

export type TaskType =
  | "multimodal_emotion_recognition"
  | "speech_emotion_recognition"
  | "voice_biomarker"
  | "music_emotion"
  | "longitudinal_treatment_response"
  | "intervention_meta_analysis"
  | "architecture_reference"
  | "protocol_reference"
  | "systematic_review"
  | "unknown";

export type LabelType =
  | "categorical_emotion"
  | "dimensional_va"
  | "clinical_scale"
  | "change_class"
  | "tags"
  | "none"
  | "unknown";

export type ClinicalStatus = "clinical" | "non_clinical" | "mixed" | "unknown";

/** Whether the entry is an actual dataset or a reference/protocol document. */
export type EntryKind = "dataset" | "reference";

/**
 * The role this entry plays in the Hum build — mirrors the labels in the
 * project brief (architecture_source, hum_protocol_source, …).
 */
export type EntryRole =
  | "architecture_source"
  | "hum_protocol_source"
  | "clinical_voice_biomarker_review"
  | "vocal_biomarker_and_singing_protocol_support"
  | "ser_mental_health_review"
  | "longitudinal_voice_treatment_response_source"
  | "intervention_support_source"
  | "dataset";

export interface DatasetRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: EntryKind;
  readonly role: EntryRole;
  readonly source_path_or_url: string;
  readonly domain: AudioDomain;
  readonly task_type: TaskType;
  readonly label_type: LabelType;
  readonly recording_context: string;
  readonly population: string;
  readonly clinical_status: ClinicalStatus;
  /** ISO-639 codes or "multi"/"any". */
  readonly language: string;
  readonly modality: readonly Modality[];
  readonly domain_gap_to_hum: DomainGap;
  readonly allowed_model_use: readonly ModelUse[];
  readonly prohibited_model_use: readonly ModelUse[];
  readonly consent_notes: string;
  readonly validation_notes: string;
}
