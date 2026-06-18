import type { Modality, Probability, UnitInterval } from "@hum-ai/shared-types";

/**
 * Output of a single expert (FER / SER / TER, or one of the audio-stream
 * conceptual experts). Following the TriSense late-fusion philosophy, experts
 * emit independent probabilistic outputs that the fusion meta-learner combines
 * — they never see each other's predictions.
 */
export interface ExpertOutput {
  /** Stable expert id, e.g. "expert-ser:hum-acoustic". */
  readonly expertId: string;
  readonly modality: Modality;
  /**
   * Whether this expert produced a usable result for the sample. `false` means
   * a missing/failed modality (silence, blur, no text) — fusion must tolerate
   * this without catastrophic degradation.
   */
  readonly available: boolean;
  /** Distribution over the expert's native label space (sums≈1 when available). */
  readonly probabilities: Readonly<Record<string, Probability>>;
  /** Optional learned embedding, reserved for v2 attention/gated-MoE fusion. */
  readonly embedding?: readonly number[];
  /** Expert's self-assessed reliability for THIS sample [0,1]. */
  readonly selfConfidence: UnitInterval;
  /**
   * For audio experts: how well the input domain matches the expert's training
   * domain [0,1] (see HumDomainAdapter). 1 for non-audio experts by convention.
   */
  readonly domainMatch: UnitInterval;
  /** Out-of-distribution score [0,1]; higher = more OOD. */
  readonly oodScore: UnitInterval;
  readonly notes?: string;
}

export interface ExpertInputMeta {
  readonly modality: Modality;
  /** Capture quality [0,1] for this modality, from the quality gate. */
  readonly captureQuality: UnitInterval;
}

/**
 * Minimal expert interface. v1 implementations are deterministic stubs; the
 * real ViT / Wav2Vec2 / DistilRoBERTa-style models slot in behind this contract
 * without changing fusion. `predict` is async to allow future model inference.
 */
export interface AffectExpert {
  readonly expertId: string;
  readonly modality: Modality;
  /** Native label space this expert emits probabilities over. */
  readonly labelSpace: readonly string[];
  predict(features: unknown, meta: ExpertInputMeta): Promise<ExpertOutput>;
}

/** A missing-modality output placeholder fusion can safely ignore. */
export function missingExpertOutput(expertId: string, modality: Modality): ExpertOutput {
  return {
    expertId,
    modality,
    available: false,
    probabilities: {},
    selfConfidence: 0,
    domainMatch: 0,
    oodScore: 1,
    notes: "missing modality",
  };
}
