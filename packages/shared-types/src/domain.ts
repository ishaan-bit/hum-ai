/**
 * Audio domain vocabulary.
 *
 * Hum's central domain requirement: a hum is NOT ordinary speech, NOT a full
 * music track, and NOT necessarily singing. Audio datasets are therefore not
 * interchangeable. `AudioDomain` tags the provenance/nature of a dataset or
 * sample; `DomainClass` is what the runtime `DomainClassifier` predicts for a
 * live capture.
 *
 * See ADR-0002 (domain-aware audio modeling) and ADR-0005 (public datasets as
 * priors, not truth).
 */

/** The provenance/nature of an audio dataset or recording. */
export const AUDIO_DOMAINS = [
  "clinical_speech",
  "acted_speech_emotion",
  "singing_or_sustained_phonation",
  "vocal_burst_or_nonverbal_expression",
  "music_emotion",
  "native_hum",
  "multimodal_conversation",
  "unknown",
] as const;
export type AudioDomain = (typeof AUDIO_DOMAINS)[number];

/** What the runtime DomainClassifier predicts for a single capture. */
export const DOMAIN_CLASSES = [
  "speech",
  "singing",
  "hum",
  "vocal_burst",
  "music",
  "silence",
  "invalid",
  "noisy_unknown",
] as const;
export type DomainClass = (typeof DOMAIN_CLASSES)[number];

/**
 * Ordinal "distance" from a public dataset's domain to native hum, used to
 * penalise priors learned on far-domain data. `none` is native hum itself.
 * Carried on every dataset registry entry as `domain_gap_to_hum`.
 */
export const DOMAIN_GAPS = ["none", "near", "moderate", "far", "unknown"] as const;
export type DomainGap = (typeof DOMAIN_GAPS)[number];

/**
 * Default mapping from a dataset's `AudioDomain` to its gap-to-hum. This is a
 * starting heuristic (ADR-0002); per-dataset overrides are allowed.
 * - sustained phonation / singing is the closest public bridge to a hum
 *   (`vocal_biomarker_and_singing_protocol_support`),
 * - clinical/acted speech and conversation are far (different vocal gesture),
 * - music-emotion is far and additionally diagnosis-prohibited (ADR-0005).
 */
export const DEFAULT_DOMAIN_GAP: Record<AudioDomain, DomainGap> = {
  native_hum: "none",
  singing_or_sustained_phonation: "near",
  vocal_burst_or_nonverbal_expression: "moderate",
  clinical_speech: "far",
  acted_speech_emotion: "far",
  multimodal_conversation: "far",
  music_emotion: "far",
  unknown: "unknown",
};

/**
 * Multiplicative confidence penalty applied when a prior was learned on a
 * far-from-hum domain (ADR-0002, ADR-0005). A prior derived from clinical
 * speech cannot speak about a hum with full confidence. `unknown` is treated
 * as worse than `far` because we cannot reason about an unlabelled gap.
 */
export const DOMAIN_GAP_PENALTY: Record<DomainGap, number> = {
  none: 1.0,
  near: 0.9,
  moderate: 0.7,
  far: 0.45,
  unknown: 0.4,
};

export function domainGapPenalty(gap: DomainGap): number {
  return DOMAIN_GAP_PENALTY[gap];
}
