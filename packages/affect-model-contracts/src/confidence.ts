import type { Probability, UnitInterval } from "@hum-ai/shared-types";

/**
 * Confidence must be CALIBRATED and EARNED, not decorative (project brief +
 * `hum_spec` §4.8). The model combines eight evidence signals and is then
 * clamped by hard caps that depend on baseline maturity, capture quality, and
 * domain match. See ADR-0004 (confidence & abstention).
 */
export interface ConfidenceInputs {
  /** Top-class probability from the fused model [0,1]. */
  readonly modelProbability: Probability;
  /** Margin between the top two classes [0,1]; small margin → low confidence. */
  readonly topClassMargin: UnitInterval;
  /** Capture quality from the quality gate [0,1]. */
  readonly captureQuality: UnitInterval;
  /** Domain match from the HumDomainAdapter [0,1]; mismatch must reduce confidence. */
  readonly domainMatch: UnitInterval;
  /** Agreement across available experts [0,1]; conflict reduces confidence. */
  readonly modalityAgreement: UnitInterval;
  /** Out-of-distribution score [0,1]; higher reduces confidence. */
  readonly oodScore: UnitInterval;
  /** Personal calibration maturity [0,1] (grows with eligible hums). */
  readonly calibrationMaturity: UnitInterval;
  /** Strength of the longitudinal trend backing this read [0,1]. */
  readonly longitudinalTrendStrength: UnitInterval;
}

export const ABSTAIN_REASONS = [
  "poor_capture_quality",
  "domain_mismatch",
  "out_of_distribution",
  "insufficient_baseline",
  "low_margin",
  "modality_conflict",
  "first_hum",
  "none",
] as const;
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

/**
 * Hard caps + abstention floor applied to the raw confidence. Caps come from
 * the personalization stage (baseline maturity) intersected with capture
 * quality and domain match — the strictest cap wins.
 */
export interface ConfidenceCaps {
  /** Absolute upper bound on confidence for this session [0,1]. */
  readonly cap: UnitInterval;
  /** Human-readable reason for the binding cap (e.g. "first-hum cap 0.72"). */
  readonly capReason: string;
  /** If final confidence is below this floor, the system abstains. */
  readonly abstainBelow: UnitInterval;
}

export interface ConfidenceReport {
  /** Raw, pre-cap confidence [0,1]. */
  readonly rawConfidence: UnitInterval;
  /** Final calibrated confidence after caps [0,1]. */
  readonly confidence: UnitInterval;
  /** Percent form, floored, 0..100 (provably never exceeds the cap × 100). */
  readonly confidencePercent: number;
  /** The cap that actually bound the result [0,1]. */
  readonly appliedCap: UnitInterval;
  readonly capReason: string;
  /** Whether the system abstained at this confidence. */
  readonly abstained: boolean;
  readonly abstainReason: AbstainReason;
}

/**
 * Contract for the confidence model. The v1 implementation lives in
 * `@hum-ai/fusion-engine` (the fused output owns final confidence).
 */
export interface ConfidenceModel {
  compute(inputs: ConfidenceInputs, caps: ConfidenceCaps): ConfidenceReport;
}
