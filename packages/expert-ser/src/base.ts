import { clamp01, normalizeDistribution, type Modality } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  missingExpertOutput,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
  type FusionLabel,
} from "@hum-ai/affect-model-contracts";

/**
 * Base class for the audio-stream conceptual experts. Following the brief, the
 * SER stream is NOT one model — it is several conceptual experts that each see
 * the hum through a different lens. v1 implementations are HONEST STUBS:
 *  - they never claim high confidence (`maxSelfConfidence` is small),
 *  - they carry a per-expert `defaultDomainMatch` reflecting how on-domain that
 *    expert is for a *hum* (speech/clinical experts are off-domain for a hum),
 *  - they reject missing/empty input instead of inventing a result.
 *
 * The real Wav2Vec2 / WavLM-style models slot in behind the same contract.
 */
export abstract class StubAudioExpert implements AffectExpert {
  readonly modality: Modality = "audio";
  abstract readonly expertId: string;
  abstract readonly labelSpace: readonly FusionLabel[];
  /** How on-domain this expert is for a native hum (0..1). */
  protected abstract readonly defaultDomainMatch: number;
  /** Untrained stubs may never exceed this self-confidence. */
  protected readonly maxSelfConfidence = 0.35;

  /** Subclasses produce an (unnormalized) tilt over their label space. */
  protected abstract tilt(f: AcousticFeatures): Partial<Record<FusionLabel, number>>;

  async predict(features: unknown, meta: ExpertInputMeta): Promise<ExpertOutput> {
    const f = features as AcousticFeatures | null;
    if (!f || meta.captureQuality <= 0 || f.isSilent) {
      return missingExpertOutput(this.expertId, this.modality);
    }

    const raw = this.tilt(f);
    const probabilities = normalizeDistribution(raw, this.labelSpace);

    const selfConfidence = clamp01(Math.min(this.maxSelfConfidence, meta.captureQuality * 0.4));
    const oodScore = clamp01(1 - meta.captureQuality * this.defaultDomainMatch);
    return {
      expertId: this.expertId,
      modality: this.modality,
      available: true,
      probabilities,
      selfConfidence,
      domainMatch: clamp01(this.defaultDomainMatch),
      oodScore,
      notes: "deterministic heuristic expert (untrained; capped low-confidence)",
    };
  }
}
