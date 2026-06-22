import type { Phq9Response } from "./clinical-feedback";

/**
 * CRISIS / SAFETY-ESCALATION CONTRACT (the mandatory IRB gate).
 *
 * PHQ-9 item 9 asks about thoughts of being better off dead or of self-harm. Any
 * endorsement (score ≥ 1) MUST trigger a real-time safety pathway — synchronously,
 * before any model runs, before any backend round-trip, before the participant can
 * navigate away. This module is the PURE, deterministic decision that the
 * (DOM-bound) crisis surface renders; keeping it here makes the safety rule unit-
 * testable with no DOM and reusable by the clinician routing + audit log.
 *
 * This is NOT a model output and NOT a screening signal — it is a fixed clinical
 * safety rule on a single self-report item. It never abstains and never depends on
 * confidence.
 */

export type CrisisLevel = "none" | "elevated" | "active";

/** A region-scoped crisis resource. `call`/`text` are the one-tap actions a surface offers. */
export interface CrisisResource {
  readonly region: string;
  readonly name: string;
  readonly call?: string;
  readonly text?: string;
  readonly url?: string;
}

/**
 * Default region-aware resources. The US 988 Suicide & Crisis Lifeline is the
 * built-in default; a study site configures its own per the IRB-approved safety
 * plan. The international entry is a directory pointer, never a dead end.
 */
export const DEFAULT_CRISIS_RESOURCES: Readonly<Record<string, readonly CrisisResource[]>> = {
  US: [{ region: "US", name: "988 Suicide & Crisis Lifeline", call: "988", text: "988", url: "https://988lifeline.org" }],
  INTL: [{ region: "INTL", name: "Find a Helpline (international directory)", url: "https://findahelpline.com" }],
};

/** Resources for a region, falling back to the international directory. */
export function crisisResources(
  region: string,
  table: Readonly<Record<string, readonly CrisisResource[]>> = DEFAULT_CRISIS_RESOURCES,
): readonly CrisisResource[] {
  return table[region] ?? table.INTL ?? [];
}

export interface CrisisAssessment {
  readonly level: CrisisLevel;
  /** The triggering item-9 score (null for PHQ-8, which omits the item). */
  readonly item9: number | null;
  /**
   * True whenever level !== "none": the surface MUST be non-dismissable until the
   * participant has seen the resources. Item 9 ≥ 2 raises a stronger interstitial.
   */
  readonly requiresInterstitial: boolean;
  /** The audit-log event to append (the IRB requires evidence the pathway fired). Null when none. */
  readonly auditEvent: "phq9_item9_endorsed" | null;
  /** Direct, non-euphemistic copy for the surface (deliberately plain, not softened). */
  readonly message: string;
}

const ELEVATED_MESSAGE =
  "You answered that you've had thoughts of being better off dead or of hurting yourself. " +
  "You're not alone, and support is available right now. Please reach out to one of these resources.";

const ACTIVE_MESSAGE =
  "It sounds like you may be having frequent thoughts of being better off dead or of hurting yourself. " +
  "Please reach out for support right now — you can call or text the resources below, or contact someone you trust. " +
  "If you are in immediate danger, please contact your local emergency number.";

/**
 * The deterministic safety rule. Item 9 endorsed at all → elevated (non-dismissable
 * resources). Item 9 ≥ 2 ("more than half the days" / "nearly every day") → active
 * (stronger interstitial). PHQ-8 (no item 9) and item 9 = 0 → none.
 */
export function assessCrisisFromPhq(phq: Phq9Response): CrisisAssessment {
  const item9 = phq.item9;
  if (item9 == null || item9 <= 0) {
    return { level: "none", item9, requiresInterstitial: false, auditEvent: null, message: "" };
  }
  if (item9 >= 2) {
    return { level: "active", item9, requiresInterstitial: true, auditEvent: "phq9_item9_endorsed", message: ACTIVE_MESSAGE };
  }
  return { level: "elevated", item9, requiresInterstitial: true, auditEvent: "phq9_item9_endorsed", message: ELEVATED_MESSAGE };
}
