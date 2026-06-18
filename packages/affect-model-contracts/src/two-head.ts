import type { ConsentScope, ConsentState, UnitInterval, ValenceArousal } from "@hum-ai/shared-types";
import { hasConsent } from "@hum-ai/shared-types";
import {
  AFFECT_HEADS,
  AFFECT_STATE_HEADS,
  type AffectHeadId,
  type AffectStateHead,
  type AffectStateScores,
} from "./heads";
import type { MultiHeadAffectInference } from "./inference";

/**
 * TWO-HEAD OUTPUT SEPARATION (ADR-0006).
 *
 * The affect model produces two structurally distinct heads that are never
 * collapsed into one object:
 *
 *  1. **Broad affect head** — dimensional valence/arousal plus the benign,
 *     non-risk affect states. Always available. Drives user-facing copy and the
 *     recommendation engine.
 *  2. **Clinical-risk marker head** — the anxiety/depressive/relapse markers
 *     (everything `riskMarker: true` in AFFECT_HEADS). It is **consent-gated**:
 *     withheld entirely unless the user has opted in (`clinical_risk_surfacing`),
 *     it is **non-diagnostic**, and it may NEVER leak into user-facing copy
 *     verbatim or reach the recommendation engine as raw labels.
 *
 * The separation is enforced by types AND by runtime guards in this module, so a
 * regression that tries to pour clinical labels into the recommendation path or
 * the copy layer fails loudly instead of silently leaking.
 */

/** Benign affect-state heads — safe for copy and recommendations. */
export const BROAD_AFFECT_STATE_HEADS: readonly AffectStateHead[] = AFFECT_STATE_HEADS.filter(
  (h) => !AFFECT_HEADS[h].riskMarker,
);

/** Clinical-risk affect-state heads — consent-gated, non-diagnostic. */
export const CLINICAL_RISK_STATE_HEADS: readonly AffectStateHead[] = AFFECT_STATE_HEADS.filter(
  (h) => AFFECT_HEADS[h].riskMarker,
);

/**
 * Every head id (across all kinds) that is a clinical-risk marker. These ids and
 * their internal labels must never appear as keys in any recommendation view.
 */
export const CLINICAL_RISK_MARKER_HEAD_IDS: readonly AffectHeadId[] = (
  Object.keys(AFFECT_HEADS) as AffectHeadId[]
).filter((id) => AFFECT_HEADS[id].riskMarker);

/** The broad (non-risk) affect head — safe to surface and to recommend on. */
export interface BroadAffectHead {
  readonly dimensional: ValenceArousal;
  /** Only the benign state scores; risk markers are NOT present here. */
  readonly states: Readonly<Partial<Record<AffectStateHead, UnitInterval>>>;
  /** Meta confidence/uncertainty are benign and stay with the broad head. */
  readonly uncertainty: UnitInterval;
}

/** The clinical-risk marker head — consent-gated, non-diagnostic markers only. */
export interface ClinicalRiskMarkerHead {
  /** Risk-marker state scores (e.g. depressive_affect_markers) in [0,1]. */
  readonly markers: Readonly<Partial<Record<AffectStateHead, UnitInterval>>>;
  /** Longitudinal relapse-drift marker [0,1]. */
  readonly relapseDrift: UnitInterval;
  /** Always false at this layer — these are markers/signals, never a diagnosis. */
  readonly isDiagnostic: false;
}

/**
 * Consent gate wrapper. When consent is absent the head is withheld and the
 * caller only learns *that* it was withheld and why — never the values.
 */
export type ConsentGatedClinicalRiskHead =
  | { readonly available: true; readonly head: ClinicalRiskMarkerHead }
  | { readonly available: false; readonly withheldReason: string };

/** Consent scope that gates surfacing the clinical-risk marker head. */
export const CLINICAL_RISK_CONSENT_SCOPE: ConsentScope = "clinical_risk_surfacing";

export interface TwoHeadAffectOutput {
  readonly broad: BroadAffectHead;
  readonly clinical: ConsentGatedClinicalRiskHead;
}

/** Pick a subset of state scores by head id from a full AffectStateScores. */
function pickStates(
  states: AffectStateScores,
  heads: readonly AffectStateHead[],
): Partial<Record<AffectStateHead, UnitInterval>> {
  const out: Partial<Record<AffectStateHead, UnitInterval>> = {};
  for (const h of heads) out[h] = states[h];
  return out;
}

/**
 * Split a fused inference into the two heads, applying the consent gate to the
 * clinical-risk head. The broad head NEVER contains risk-marker scores.
 */
export function splitInference(
  inf: MultiHeadAffectInference,
  consent: ConsentState,
): TwoHeadAffectOutput {
  const broad: BroadAffectHead = {
    dimensional: inf.dimensional,
    states: pickStates(inf.states, BROAD_AFFECT_STATE_HEADS),
    uncertainty: inf.uncertainty,
  };

  if (!hasConsent(consent, CLINICAL_RISK_CONSENT_SCOPE)) {
    return {
      broad,
      clinical: {
        available: false,
        withheldReason: `clinical-risk markers withheld — '${CLINICAL_RISK_CONSENT_SCOPE}' consent not granted`,
      },
    };
  }

  return {
    broad,
    clinical: {
      available: true,
      head: {
        markers: pickStates(inf.states, CLINICAL_RISK_STATE_HEADS),
        relapseDrift: inf.relapseDrift,
        isDiagnostic: false,
      },
    },
  };
}

/**
 * RECOMMENDATION VIEW (ADR-0006).
 *
 * The sanitized projection the recommendation/intervention engine is allowed to
 * see. It carries the benign dimensional signal and **abstracted risk bands** —
 * booleans derived from the clinical-risk head at this boundary — but NEVER the
 * raw clinical labels themselves. The recommendation engine reasons over bands,
 * not over `depressive_affect_markers`.
 */
export interface RecommendationView {
  readonly abstained: boolean;
  readonly dimensional: ValenceArousal;
  /** Benign uncertainty meta-signal. */
  readonly uncertainty: UnitInterval;
  /** Abstracted: a sustained pattern that warrants gentle regulation/escalation. */
  readonly elevatedRegulationNeed: boolean;
  /** Abstracted: a low-energy / low-recovery pattern. */
  readonly lowEnergyPattern: boolean;
  /** Abstracted: a sustained lower-mood pattern. */
  readonly lowMoodPattern: boolean;
  /** Abstracted: a mixed or uncertain pattern. */
  readonly mixedOrUncertain: boolean;
}

/** Thresholds used at the sanitization boundary (kept here, not in the engine). */
const REG_NEED = { relapseDrift: 0.5, depressive: 0.6, stress: 0.6 } as const;
const LOW_ENERGY_FATIGUE = 0.4;
const LOW_MOOD = { sadness: 0.5, depressive: 0.4 } as const;
const MIXED = { mixedState: 0.4, uncertainty: 0.6 } as const;

/**
 * Project a fused inference into the sanitized recommendation view. This is the
 * ONLY sanctioned way for the recommendation engine to consume affect: the raw
 * clinical labels are read here, at the boundary, and collapsed into abstracted
 * bands. The returned object provably contains no clinical-marker keys.
 */
export function toRecommendationView(inf: MultiHeadAffectInference): RecommendationView {
  const s = inf.states;
  return {
    abstained: inf.abstained,
    dimensional: inf.dimensional,
    uncertainty: inf.uncertainty,
    elevatedRegulationNeed:
      inf.relapseDrift >= REG_NEED.relapseDrift ||
      s.depressive_affect_markers >= REG_NEED.depressive ||
      s.stress_overload >= REG_NEED.stress,
    lowEnergyPattern: s.fatigue_low_recovery >= LOW_ENERGY_FATIGUE,
    lowMoodPattern: s.sadness_low_mood >= LOW_MOOD.sadness || s.depressive_affect_markers >= LOW_MOOD.depressive,
    mixedOrUncertain: s.mixed_state >= MIXED.mixedState || inf.uncertainty >= MIXED.uncertainty,
  };
}

/**
 * Runtime guard: assert an object handed to the recommendation engine carries no
 * clinical-risk marker field (by head id or internal label). The last line of
 * defense against a future refactor leaking raw labels into the engine.
 */
export function assertNoClinicalLeak(view: object): void {
  const forbidden = new Set<string>();
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    forbidden.add(id);
    forbidden.add(AFFECT_HEADS[id].internalLabel);
  }
  const offenders: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) offenders.push(key);
      visit(child);
    }
  };
  visit(view);
  if (offenders.length > 0) {
    throw new ClinicalLeakError(offenders);
  }
}

export class ClinicalLeakError extends Error {
  readonly offendingFields: readonly string[];
  constructor(offendingFields: readonly string[]) {
    super(
      `Recommendation view contains clinical-risk marker field(s): ${offendingFields.join(", ")}. ` +
        `The recommendation engine must consume the sanitized RecommendationView (abstracted bands), ` +
        `never raw clinical labels (ADR-0006).`,
    );
    this.name = "ClinicalLeakError";
    this.offendingFields = offendingFields;
  }
}
