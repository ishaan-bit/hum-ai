/**
 * @hum-ai/signal-lab — offline pretraining / evaluation / inference foundation.
 *
 * Reads prepared public datasets zip-direct → extracts the REAL `AcousticFeatures`
 * (`@hum-ai/audio-features`) → harmonizes labels to `FUSION_LABELS` → trains a
 * baseline affect-PRIOR model → evaluates with calibration + significance → runs a
 * new hum through the learned pipeline (reusing fusion/quality/domain/intervention
 * contracts) → emits an honest evidence report. Governance: ADR-0005 (priors not
 * truth), ADR-0004 (confidence/abstention). Artifacts are git-ignored only.
 */
export * from "./paths";
export * from "./wav";
export * from "./zip";
export * from "./feature-schema";
export * from "./labels";
export * from "./datasets";
export * from "./extract";
export * from "./model";
export * from "./evaluate";
export * from "./expert";
export * from "./inference";
export * from "./manifest";
export * from "./neural-feature-model";
export * from "./runtime-bridge";
export * from "./report";
export * from "./pipeline";
export * from "./targets";
export * from "./cohort";
export * from "./cohort-eval";
export * from "./feature-importance";
export * from "./domain-experiment";
export * from "./experiment";
