import { clamp01, type Modality } from "@hum-ai/shared-types";
import {
  missingExpertOutput,
  uniformFusionDistribution,
  FUSION_LABELS,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
} from "@hum-ai/affect-model-contracts";

/**
 * Facial Emotion Recognition expert (ViT-style), per the TriSense spine.
 * For Hum, the face modality is OPTIONAL and usually absent — most hum sessions
 * are audio-only. This v1 stub therefore returns a missing-modality output
 * unless a face frame is explicitly provided, exercising fusion's
 * missing-modality path. The real ViT model slots in behind `AffectExpert`.
 */
export class FaceEmotionExpert implements AffectExpert {
  readonly expertId = "expert-fer:vit-stub";
  readonly modality: Modality = "face";
  readonly labelSpace = FUSION_LABELS;

  async predict(features: unknown, meta: ExpertInputMeta): Promise<ExpertOutput> {
    const hasFace = features != null && meta.captureQuality > 0;
    if (!hasFace) return missingExpertOutput(this.expertId, this.modality);
    // NOTE: this available:true branch is a SYNTHETIC fusion-path exercise, not
    // visual inference — it returns a uniform distribution at capped confidence
    // and is never reached by the hum flow (which always passes no face frame).
    // No camera/FER model exists this pass (voice-first; ADR-0009). The real ViT
    // model slots in behind `AffectExpert` in Phase 3.
    return {
      expertId: this.expertId,
      modality: this.modality,
      available: true,
      probabilities: uniformFusionDistribution(),
      selfConfidence: clamp01(Math.min(0.3, meta.captureQuality * 0.3)),
      domainMatch: 1, // face is not subject to the hum audio-domain gap
      oodScore: clamp01(1 - meta.captureQuality),
      notes: "v1-stub (face usually absent for hum sessions)",
    };
  }
}
