import {
  clamp01,
  DEFAULT_DOMAIN_GAP,
  domainGapPenalty,
  type AudioDomain,
  type DomainClass,
  type DomainGap,
  type UnitInterval,
} from "@hum-ai/shared-types";
import type { DomainClassification } from "./classifier";

/**
 * The HumDomainAdapter models how public-dataset priors are adapted to
 * hum-compatible signals (project brief). It answers two questions:
 *
 *  1. `adaptPrior(sourceDomain)` — how far is a prior learned on this dataset
 *     domain from a hum, and what confidence penalty should that prior carry?
 *  2. `scoreCapture(classification)` — given what we actually heard, how
 *     hum-compatible is this capture, and what penalty should mismatch impose?
 *
 * Both return a `domainMatch` (1 = perfectly hum-compatible) and a multiplicative
 * `confidencePenalty` (1 = no penalty). Domain mismatch MUST reduce confidence
 * (ADR-0004).
 */
export interface DomainAdaptation {
  readonly domainMatch: UnitInterval;
  readonly confidencePenalty: UnitInterval;
  readonly gap: DomainGap;
  readonly rationale: string;
}

/** How hum-compatible each runtime domain class is. */
export const HUM_COMPATIBILITY: Record<DomainClass, number> = {
  hum: 1.0,
  singing: 0.85,
  vocal_burst: 0.6,
  speech: 0.4,
  music: 0.2,
  noisy_unknown: 0.25,
  silence: 0.0,
  invalid: 0.0,
};

export class HumDomainAdapter {
  /**
   * Penalty a prior should carry given the dataset domain it was learned on.
   * Uses the shared `DEFAULT_DOMAIN_GAP` × `domainGapPenalty` mapping.
   */
  adaptPrior(sourceDomain: AudioDomain, overrideGap?: DomainGap): DomainAdaptation {
    const gap = overrideGap ?? DEFAULT_DOMAIN_GAP[sourceDomain];
    const penalty = domainGapPenalty(gap);
    return {
      domainMatch: penalty,
      confidencePenalty: penalty,
      gap,
      rationale: `prior from '${sourceDomain}' has '${gap}' gap to hum → penalty ${penalty}`,
    };
  }

  /**
   * Penalty the live capture should carry given what the domain classifier
   * heard. A confidently-classified hum incurs essentially no penalty; speech,
   * music, or silence incur large penalties.
   */
  scoreCapture(cls: DomainClassification): DomainAdaptation {
    const compatibility = HUM_COMPATIBILITY[cls.predicted];
    // Weight by classifier confidence: an unsure "hum" is less trustworthy.
    const domainMatch = clamp01(compatibility * (0.5 + 0.5 * cls.confidence));
    const confidencePenalty = clamp01(0.25 + 0.75 * domainMatch);
    const gap: DomainGap =
      compatibility >= 0.95 ? "none" : compatibility >= 0.8 ? "near" : compatibility >= 0.55 ? "moderate" : "far";
    return {
      domainMatch,
      confidencePenalty,
      gap,
      rationale: `heard '${cls.predicted}' (conf ${cls.confidence.toFixed(2)}) → match ${domainMatch.toFixed(2)}, penalty ${confidencePenalty.toFixed(2)}`,
    };
  }
}
