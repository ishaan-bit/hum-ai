import { clamp01 } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  FUSION_LABELS,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
  type FusionLabel,
} from "@hum-ai/affect-model-contracts";
import { toFeatureVector } from "./feature-schema";
import { predictProba, type LogRegParams } from "./model";
import { AFFECT_PRIOR_FAR_DOMAIN_CAP } from "./axis-prior";

/**
 * `LearnedAffectPriorExpert` — the trained baseline surfaced through the EXISTING
 * `AffectExpert` contract, so it drops into `FusionEngine` exactly where the
 * `SpeechEmotionExpert` stub sits (`@hum-ai/expert-ser`), with no fusion redesign.
 *
 * Honesty / governance (ADR-0005): this expert is an AFFECT PRIOR learned on
 * acted speech (RAVDESS, `acted_speech_emotion`, far domain). Its `domainMatch`
 * defaults to the far-domain penalty (0.45) and is further reduced by the live
 * capture's domain match, so fusion down-weights it — it is never hum truth.
 */
export class LearnedAffectPriorExpert implements AffectExpert {
  readonly expertId: string;
  readonly modality = "audio" as const;
  readonly labelSpace: readonly FusionLabel[];
  private readonly params: LogRegParams;
  /** Prior domain penalty for the dataset this model was trained on (default far=0.45). */
  private readonly priorDomainPenalty: number;

  constructor(params: LogRegParams, opts: { expertId?: string; priorDomainPenalty?: number } = {}) {
    this.params = params;
    this.priorDomainPenalty = opts.priorDomainPenalty ?? AFFECT_PRIOR_FAR_DOMAIN_CAP;
    this.expertId = opts.expertId ?? "signal-lab:learned-affect-prior";
    // Only labels the model actually emits AND that exist in the fusion space.
    const set = new Set(params.labels);
    this.labelSpace = FUSION_LABELS.filter((l) => set.has(l));
  }

  /**
   * Predict over the fusion label space from derived features. `captureDomainMatch`
   * (from `HumDomainAdapter.scoreCapture`) is folded into the reported `domainMatch`
   * so an off-domain capture additionally down-weights this prior.
   */
  predict(features: unknown, meta: ExpertInputMeta, captureDomainMatch = 1): Promise<ExpertOutput> {
    const f = features as AcousticFeatures;
    const vector = toFeatureVector(f);
    const dist = predictProba(this.params, vector);
    // Normalize onto the full fusion space (labels we don't emit stay 0).
    const probabilities: Record<string, number> = {};
    let total = 0;
    for (const l of FUSION_LABELS) {
      const p = dist[l] ?? 0;
      probabilities[l] = p;
      total += p;
    }
    if (total > 0) for (const l of FUSION_LABELS) probabilities[l]! /= total;

    const sorted = [...FUSION_LABELS].sort((a, b) => probabilities[b]! - probabilities[a]!);
    const top = probabilities[sorted[0]!]!;
    const second = probabilities[sorted[1]!] ?? 0;
    const margin = top - second;

    // Self-confidence: peakedness of the distribution, capped (this is a prior, not truth).
    const selfConfidence = clamp01(0.2 + 0.6 * margin) * 0.6;
    // Domain match: prior penalty × live capture match (both reduce trust).
    const domainMatch = clamp01(this.priorDomainPenalty * clamp01(captureDomainMatch));
    // OOD: low margin or silent/faint capture reads as more out-of-distribution.
    const oodScore = clamp01(1 - margin) * (f.isSilent || f.isTooFaint ? 1 : 0.6);

    return Promise.resolve({
      expertId: this.expertId,
      modality: this.modality,
      available: !f.isSilent,
      probabilities,
      selfConfidence,
      domainMatch,
      oodScore,
      notes: `learned affect prior (LogReg over AcousticFeatures); trained on far-domain acted speech; captureQuality=${meta.captureQuality.toFixed(2)}`,
    });
  }
}
