import type { DatasetRegistryEntry } from "./schema";

/**
 * Sample registry entries for this first pass — one per primary source.
 * These are mostly `reference` entries (architecture/protocol/review docs)
 * rather than raw datasets, because Hum has no native hum corpus yet. As real
 * datasets are added, they follow the same schema and the same domain rules.
 *
 * Every entry is validated by `assertValidRegistry` in the test suite.
 */
export const REGISTRY: readonly DatasetRegistryEntry[] = [
  {
    id: "trisense_meld_architecture",
    name: "TriSense (MELD) — multimodal emotion architecture reference",
    kind: "reference",
    role: "architecture_source",
    source_path_or_url: "docs/source/IJERTCONV14IS040031.pdf",
    domain: "multimodal_conversation",
    task_type: "architecture_reference",
    label_type: "categorical_emotion",
    recording_context: "TV dialogue (Friends), in-the-wild; multi-party, noisy",
    population: "actors / general adult conversation",
    clinical_status: "non_clinical",
    language: "en",
    modality: ["audio", "face", "text"],
    domain_gap_to_hum: "far",
    allowed_model_use: ["pretraining", "evaluation", "affect_prior"],
    prohibited_model_use: ["clinical_prior", "hum_finetune", "personalization", "relapse_tracking"],
    consent_notes: "Public research dataset (MELD); used as architecture reference, not retrained here.",
    validation_notes:
      "MELD stream accuracies (Visual 18.4%, Audio 38.0%, Text 54.0%, Fusion 66.0%) are ARCHITECTURE-REFERENCE numbers on TV dialogue — NOT Hum metrics. Late-fusion + LogReg meta-learner is the design we adapt.",
  },
  {
    id: "hum_legacy_spec",
    name: "Hum Academic Review Technical Specification (legacy spec)",
    kind: "reference",
    role: "hum_protocol_source",
    source_path_or_url: "docs/source/Hum_Academic_Review_Technical_Specification.docx",
    domain: "native_hum",
    task_type: "protocol_reference",
    label_type: "none",
    recording_context: "12-second hum, browser MediaRecorder, local-first, raw-ish capture",
    population: "general self-tracking users (non-clinical)",
    clinical_status: "non_clinical",
    language: "any",
    modality: ["audio"],
    domain_gap_to_hum: "none",
    allowed_model_use: ["hum_finetune", "personalization", "relapse_tracking", "evaluation", "affect_prior"],
    prohibited_model_use: ["clinical_prior", "market_research_only"],
    consent_notes: "Local-first; derived-data-only sync; raw audio blocked by default. Source of the privacy posture.",
    validation_notes:
      "Defines the 12s protocol, acoustic feature dictionary, quality gate, robust rolling baseline, and confidence caps. Heuristic and explicitly NOT clinically validated.",
  },
  {
    id: "native_hum_self_report_corpus",
    name: "Native-hum self-report corpus (in-app HiTL)",
    kind: "dataset",
    role: "dataset",
    source_path_or_url:
      "local-first://native-hum-corpus (on-device @hum-ai/native-corpus; derived features + benign valence/arousal self-report; see docs/validation/NATIVE_HUM_DATA_SPEC.md)",
    domain: "native_hum",
    task_type: "voice_biomarker",
    label_type: "dimensional_va",
    recording_context:
      "Production 12-second hum capture (apps/web → audio-features → quality-gate); a capture enters the corpus only after passing the Stage ① gate AND being baseline-eligible. Derived features only — raw audio never stored.",
    population: "general self-tracking users (non-clinical); the user labels their OWN hums",
    clinical_status: "non_clinical",
    language: "any",
    modality: ["audio"],
    domain_gap_to_hum: "none",
    // native_hum is the only source of hum truth (ADR-0005). This corpus serves the
    // affect/personalization track: it finetunes the hum-native axis model, drives the
    // personal calibration, and is eval-able. It is NOT a relapse-tracking or clinical
    // corpus — that needs clinician-anchored longitudinal events + IRB (NATIVE_HUM_DATA_SPEC C2).
    allowed_model_use: ["hum_finetune", "personalization", "affect_prior", "evaluation"],
    prohibited_model_use: ["clinical_prior", "relapse_tracking", "recommendation", "market_research_only", "pretraining"],
    consent_notes:
      "Labels are BENIGN affect self-report (valence/arousal), NOT clinical instruments (PHQ/GAD/CES-DC). Stored on-device under local_processing (default on); backed up to the user's OWN private space under derived_feature_sync. Pooling across users into a shared corpus is a separate backend step requiring its own research consent + IRB. No raw audio; no PHI.",
    validation_notes:
      "Created by the human-in-the-loop loop (ADR-0011): after a read the user confirms/adjusts the valence/arousal, minting one {derived features, self-report} row. A hum-native model retrained on it is IN-DOMAIN for hums (no far-domain penalty) and is promoted only when it beats the transparent acoustic backbone on held-out hums. Convergent-validity (correlation) signal, NOT a diagnostic classifier; non-clinical and not clinically validated.",
  },
  {
    id: "native_hum_clinical_screening_corpus",
    name: "Native-hum clinical screening corpus (PHQ-9 / GAD-7 paired)",
    kind: "dataset",
    role: "dataset",
    source_path_or_url:
      "study-backend://clinical-screening-corpus (@hum-ai/clinical-corpus; derived features paired with PHQ-9/GAD-7; pseudonymised; see docs/validation/PRE_REGISTRATION.md, docs/validation/DATA_DICTIONARY.md)",
    domain: "native_hum",
    task_type: "voice_biomarker",
    label_type: "clinical_scale",
    recording_context:
      "Production 12-second hum capture paired with a self-administered PHQ-9/PHQ-8 + GAD-7 in the same session (tight gap; see ClinicalSessionLink). Derived features only — raw audio never stored here (a separate research_audio_upload channel holds the model-dev subset).",
    population: "consented adult study participants (target condition: depression + anxiety); self-recruited remote cohort, partner-site pluggable",
    clinical_status: "clinical",
    language: "any",
    modality: ["audio"],
    domain_gap_to_hum: "none",
    // native_hum is the only source of hum truth (ADR-0005); this is the CLINICAL variant, the
    // ground truth the depression/anxiety SCREENING model is validated against. Gated by
    // clinical_label_capture consent + IRB approval. hum_finetune/evaluation are permitted ONLY
    // under an approved, pre-registered protocol; this entry's existence presupposes that approval.
    allowed_model_use: ["evaluation", "hum_finetune", "clinical_prior"],
    prohibited_model_use: ["personalization", "relapse_tracking", "recommendation", "market_research_only", "pretraining"],
    consent_notes:
      "PHI. Requires clinical_label_capture consent (PHQ-9/GAD-7) + research_audio_upload consent (raw-audio subset only), under IRB approval with versioned informed e-consent and right-to-deletion. Pseudonymised (re-identification key held only in the participant backend, never in the corpus). Clinical instrument scores live ONLY in this sanctioned channel (assertValidClinicalExample), never in the benign native_hum_self_report_corpus.",
    validation_notes:
      "The dataset for the pre-registered cross-sectional screening endpoints (PHQ-9 ≥ 10 / GAD-7 ≥ 10): participant-grouped CV, AUC + sensitivity/specificity at the locked cut, calibration (binary ECE), QUADAS-2 risk-of-bias control. Investigational and NOT clinically validated until the pilot reads out and CLAIMS_LADDER §5 is satisfied; the screening probability is blinded during data collection.",
  },
  {
    id: "voice_depression_systematic_review",
    name: "Speech & Voice Quality as Digital Biomarkers in Depression (systematic review)",
    kind: "reference",
    role: "clinical_voice_biomarker_review",
    source_path_or_url: "docs/source/1-s2.0-S0892199725001870-main.pdf",
    domain: "clinical_speech",
    task_type: "systematic_review",
    label_type: "clinical_scale",
    recording_context: "Clinical & mobile speech (read + spontaneous), 12 studies",
    population: "MDD (n=1535), BD (111), schizophrenia (35), anxiety (224); 16,872 total",
    clinical_status: "clinical",
    language: "multi",
    modality: ["audio"],
    domain_gap_to_hum: "far",
    allowed_model_use: ["clinical_prior", "affect_prior", "evaluation"],
    prohibited_model_use: ["hum_finetune", "personalization", "relapse_tracking", "recommendation", "market_research_only"],
    consent_notes: "Aggregate review; no raw data. Clinical labels require explicit research consent to ever capture in-app.",
    validation_notes:
      "Voice features distinguished depression AUC 0.71–0.93, accuracy 78–96.5%, but 6/12 studies high methodological-bias risk; generalizability unproven. Use as clinical PRIOR only — never hum truth (domain gap: read clinical speech ≠ hum).",
  },
  {
    id: "vocal_biomarkers_singing_perspective",
    name: "Listening to the Mind — vocal biomarkers & singing protocol (perspective)",
    kind: "reference",
    role: "vocal_biomarker_and_singing_protocol_support",
    source_path_or_url: "docs/source/brainsci-15-00762.pdf",
    domain: "singing_or_sustained_phonation",
    task_type: "voice_biomarker",
    label_type: "none",
    recording_context: "Proposes singing / simple melodic structures as the voice-biomarker source",
    population: "general; populations with linguistic/cognitive impairment highlighted",
    clinical_status: "mixed",
    language: "multi",
    modality: ["audio"],
    domain_gap_to_hum: "near",
    allowed_model_use: ["affect_prior", "hum_finetune", "evaluation", "pretraining"],
    prohibited_model_use: ["clinical_prior", "personalization", "relapse_tracking", "recommendation", "market_research_only"],
    consent_notes: "Perspective article; no dataset. Scientific basis for sung-tone / hum protocol.",
    validation_notes:
      "Argues singing can substitute for speech; acoustic features (F0/jitter/shimmer/spectral) are language-independent and highly transferable. CLOSEST public bridge to native hum. Perspective, not a validation study → not a clinical_prior.",
  },
  {
    id: "ser_mental_health_systematic_review",
    name: "Speech Emotion Recognition in Mental Health (systematic review)",
    kind: "reference",
    role: "ser_mental_health_review",
    source_path_or_url: "docs/source/mental-2025-1-e74260.pdf",
    domain: "clinical_speech",
    task_type: "systematic_review",
    label_type: "categorical_emotion",
    recording_context: "SER applied to clinical speech; 14 studies",
    population: "suicide risk (3 studies), depression (8), psychotic disorders (3)",
    clinical_status: "clinical",
    language: "multi",
    modality: ["audio"],
    domain_gap_to_hum: "far",
    allowed_model_use: ["affect_prior", "clinical_prior", "evaluation", "pretraining"],
    prohibited_model_use: ["hum_finetune", "personalization", "relapse_tracking", "recommendation"],
    consent_notes: "Aggregate review; no raw data.",
    validation_notes:
      "SER mostly used indirectly; architecture/dataset/pathology diversity makes direct assessment hard. Dimensional V-A models under-explored vs categorical → justifies Hum's multi-head dimensional+categorical contract and abstention discipline.",
  },
  {
    id: "adolescent_mdd_dvdsa_longitudinal",
    name: "DNN voice biomarkers for treatment response in adolescent MDD (DVDSA)",
    kind: "reference",
    role: "longitudinal_voice_treatment_response_source",
    source_path_or_url: "docs/source/s43856-025-01326-3.pdf",
    domain: "clinical_speech",
    task_type: "longitudinal_treatment_response",
    label_type: "change_class",
    recording_context: "Paired pre/post-treatment voice (Stroop color-naming task), ~107-day interval",
    population: "48 adolescent MDD patients (15M/33F, mean age 15.5)",
    clinical_status: "clinical",
    language: "ko",
    modality: ["audio"],
    domain_gap_to_hum: "far",
    allowed_model_use: ["clinical_prior", "affect_prior", "evaluation"],
    prohibited_model_use: ["hum_finetune", "personalization", "relapse_tracking", "recommendation", "market_research_only"],
    consent_notes: "Clinical study with written informed consent; no raw data here.",
    validation_notes:
      "Methodological BASIS for Hum's relapse engine: within-patient paired comparison (DVDSA → recovery/worsening/unchanged), WavLM F1 78.05% binary / 70.58% DVDSA; only F0 changed significantly per-feature. The METHOD inspires us; the clinical-speech DATA cannot be used as hum truth or for relapse_tracking on hums.",
  },
  {
    id: "music_interventions_stress_metaanalysis",
    name: "Music interventions on stress-related outcomes (review + two meta-analyses)",
    kind: "reference",
    role: "intervention_support_source",
    source_path_or_url:
      "docs/source/Effects_of_music_interventions_on_stress_related_outcomes_a_systematic_review_and_two_meta_analyses.pdf",
    domain: "music_emotion",
    task_type: "intervention_meta_analysis",
    label_type: "none",
    recording_context: "RCTs of music listening / music making in clinical, medical, work settings",
    population: "9,617 participants across 104 RCTs (327 effect sizes)",
    clinical_status: "mixed",
    language: "multi",
    modality: ["audio"],
    domain_gap_to_hum: "far",
    allowed_model_use: ["recommendation", "evaluation", "market_research_only", "pretraining"],
    prohibited_model_use: ["clinical_prior", "affect_prior", "hum_finetune", "personalization", "relapse_tracking"],
    consent_notes: "Aggregate meta-analysis; no raw data.",
    validation_notes:
      "Music interventions reduce physiological stress (d=.380) and psychological stress (d=.545). INTERVENTION SUPPORT ONLY — never diagnostic evidence and never a prior over user state (ADR-0005 prohibited rule).",
  },
];

const byId = new Map(REGISTRY.map((e) => [e.id, e]));
const byRole = new Map(REGISTRY.map((e) => [e.role, e]));

export function getEntry(id: string): DatasetRegistryEntry | undefined {
  return byId.get(id);
}

export function getEntryByRole(role: DatasetRegistryEntry["role"]): DatasetRegistryEntry | undefined {
  return byRole.get(role);
}
