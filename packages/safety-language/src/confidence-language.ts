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
 *  - **Signal clarity** — High / Medium / Low evidence, EARNED from this hum's own
 *    read (signal clarity + in-domain trained agreement), available from the FIRST
 *    hum. It is NOT gated behind a multi-hum calibration count (redo direction): the
 *    model speaks from hum #1.
 *  - **Based on N clean hums** — grounds the read in how much the system knows.
 *  - **Early baseline** — an INFORMATIONAL flag while the personal baseline is still
 *    forming (the read is population-level, not yet personalized). It no longer
 *    overrides the evidence level — it is surfaced as a gentle secondary note.
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

/** Eligible hums below which the personal baseline is still forming (informational). */
export const EARLY_BASELINE_HUMS = 5; // personal baseline matures around here (hum_spec §4.6)

/** Confidence bands (internal number → qualitative level). */
export const EVIDENCE_BANDS = { high: 0.72, medium: 0.5 } as const;

/** True while the personal baseline is still forming (read is population-level). */
export function isStillFormingBaseline(eligibleHumCount: number): boolean {
  return Math.floor(eligibleHumCount) < EARLY_BASELINE_HUMS;
}

/**
 * Map the read's EARNED confidence to a qualitative evidence level — from the FIRST
 * hum. Abstaining reads are "low". The evidence level is no longer forced to
 * "early_baseline" by a low hum count (redo direction: the model speaks from hum #1);
 * `eligibleHumCount` is accepted for signature stability but no longer gates the level.
 */
export function evidenceLevelFromConfidence(c: ConfidenceLike, _eligibleHumCount = Number.POSITIVE_INFINITY): EvidenceLevel {
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
  const evidenceLevel = evidenceLevelFromConfidence(c);
  const signalClarity = signalClarityLabel(evidenceLevel);
  const basedOn = basedOnCleanHums(eligibleHumCount);
  return {
    evidenceLevel,
    signalClarity,
    basedOn,
    // Informational only now (does NOT force the evidence level): the personal
    // baseline is still forming, so the read is population-level, not personalized.
    isEarlyBaseline: isStillFormingBaseline(eligibleHumCount),
    summary: `Signal clarity: ${signalClarity} · ${basedOn}`,
  };
}

/**
 * Guard: a user-facing confidence string must not embed a raw confidence number
 * (ADR-0008 forbids surfacing raw percentages OR probabilities). Returns true if
 * it looks safe. Use to catch a regression that pipes the internal number into copy.
 *
 * Rejects:
 *  - a percent figure in any common form — ASCII `%`, fullwidth `％` (U+FF05),
 *    small `﹪` (U+FE6A), or the word `percent`/`pct` (e.g. "87%", "87 percent");
 *  - a decimal probability adjacent to confidence wording, in either order
 *    (e.g. "0.87 confidence", "confidence: 0.92", "we're 0.87 sure").
 *
 * A bare decimal NOT next to confidence wording (e.g. "version 1.5") is allowed,
 * so this does not false-positive on legitimate digit-bearing copy like
 * "Based on 12 clean hums".
 */
export function isConfidenceCopySafe(text: string): boolean {
  const CONFIDENCE_WORDS = "confidence|confident|sure|certain|probability|probable|likely";
  const percentFigure = /\d{1,3}\s?(?:%|％|﹪|\s?(?:percent|pct)\b)/i.test(text);
  const decimalNearConfidence =
    new RegExp(`\\b0?\\.\\d+\\s*(?:${CONFIDENCE_WORDS})\\b`, "i").test(text) ||
    new RegExp(`\\b(?:${CONFIDENCE_WORDS})\\b\\D{0,8}0?\\.\\d+`, "i").test(text);
  return !percentFigure && !decimalNearConfidence;
}
