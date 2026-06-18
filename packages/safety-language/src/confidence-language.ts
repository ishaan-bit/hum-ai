/**
 * USER-FACING CONFIDENCE LANGUAGE (ADR-0008).
 *
 * The model computes a calibrated, capped numeric confidence (see ADR-0004,
 * `@hum-ai/fusion-engine` `ConfidenceReport`). That number is for MODEL LOGIC —
 * abstention, ranking, gating. It must NOT be surfaced to the user as a raw,
 * clinical-looking percentage by default, because "87%" reads as a diagnostic
 * accuracy the system does not have.
 *
 * Instead, users see qualitative, honest language:
 *  - **Signal clarity** — High / Medium / Low evidence, or "Early baseline".
 *  - **Based on N clean hums** — grounds the read in how much the system knows.
 *  - **Early baseline** — explicit while the personal baseline is still forming.
 *
 * This module is the one-way translation from internal confidence → user copy.
 * It takes a structural confidence input (so it stays free of the model-contract
 * dependency) and never emits the raw number.
 */

/** Minimal structural shape of the internal confidence report (model-side). */
export interface ConfidenceLike {
  /** Calibrated, capped confidence in [0,1] — internal only. */
  readonly confidence: number;
  readonly abstained: boolean;
}

export const EVIDENCE_LEVELS = ["early_baseline", "low", "medium", "high"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Eligible hums below which the read is always framed as "Early baseline". */
export const EARLY_BASELINE_HUMS = 5; // baseline activates at 5 (hum_spec §4.6)

/** Confidence bands (internal number → qualitative level), once baseline-active. */
export const EVIDENCE_BANDS = { high: 0.8, medium: 0.6 } as const;

/**
 * Map internal confidence + maturity to a qualitative evidence level. Pre-baseline
 * accounts are always "early_baseline" regardless of the number; abstaining reads
 * are "low".
 */
export function evidenceLevelFromConfidence(c: ConfidenceLike, eligibleHumCount: number): EvidenceLevel {
  if (eligibleHumCount < EARLY_BASELINE_HUMS) return "early_baseline";
  if (c.abstained) return "low";
  if (c.confidence >= EVIDENCE_BANDS.high) return "high";
  if (c.confidence >= EVIDENCE_BANDS.medium) return "medium";
  return "low";
}

/** Human label for an evidence level (the "Signal clarity" value). */
export function signalClarityLabel(level: EvidenceLevel): string {
  switch (level) {
    case "high":
      return "High evidence";
    case "medium":
      return "Medium evidence";
    case "low":
      return "Low evidence";
    case "early_baseline":
      return "Early baseline";
  }
}

/** "Based on N clean hums" grounding phrase. */
export function basedOnCleanHums(eligibleHumCount: number): string {
  const n = Math.max(0, Math.floor(eligibleHumCount));
  if (n <= 0) return "Based on this first hum";
  if (n === 1) return "Based on your first clean hum";
  return `Based on ${n} clean hums`;
}

export interface UserFacingConfidence {
  readonly evidenceLevel: EvidenceLevel;
  /** "Signal clarity" value, e.g. "High evidence". */
  readonly signalClarity: string;
  /** "Based on N clean hums". */
  readonly basedOn: string;
  /** True while the personal baseline is still forming. */
  readonly isEarlyBaseline: boolean;
  /** One-line composed phrase safe to render directly. */
  readonly summary: string;
}

/**
 * Build the full user-facing confidence object from internal confidence. Never
 * includes the raw numeric confidence.
 */
export function userFacingConfidence(c: ConfidenceLike, eligibleHumCount: number): UserFacingConfidence {
  const evidenceLevel = evidenceLevelFromConfidence(c, eligibleHumCount);
  const signalClarity = signalClarityLabel(evidenceLevel);
  const basedOn = basedOnCleanHums(eligibleHumCount);
  return {
    evidenceLevel,
    signalClarity,
    basedOn,
    isEarlyBaseline: evidenceLevel === "early_baseline",
    summary: `Signal clarity: ${signalClarity} · ${basedOn}`,
  };
}

/**
 * Guard: a user-facing confidence string must not embed a raw confidence
 * percentage (e.g. "87%", "0.87 confidence"). Returns true if it looks safe.
 * Use to catch a regression that pipes the internal number into copy.
 */
export function isConfidenceCopySafe(text: string): boolean {
  // A percentage adjacent to confidence/sure/certain wording, or a bare 2-digit %.
  const percentNearConfidence = /\b\d{1,3}\s?%/.test(text);
  return !percentNearConfidence;
}
