import { CLINICAL_RISK_CONFIDENCE_CAP, clamp01, type UnitInterval } from "@hum-ai/shared-types";
import type { RelapseVerdict } from "./relapse";

/**
 * LONGITUDINAL DIAGNOSTIC STATE — the internal, non-diagnostic synthesis that sits
 * BESIDE (not in place of) the relapse verdict, personalization, and confidence
 * model. It bundles the within-user signals the platform already computes —
 * current-hum clinical-risk score, the relapse verdict, dual-baseline divergence,
 * the user's learned recovery/high-risk signature alignment — into one structured
 * read that carries:
 *
 *  - a longitudinal trend direction,
 *  - a consent-gated, non-diagnostic risk hypothesis,
 *  - a sustained relapse-drift signal (or recovery signature),
 *  - a monitoring flag + routing action,
 *  - an abstention reason when evidence is insufficient,
 *  - PROVENANCE: which sources (population prior / current hum / personal baseline /
 *    longitudinal trend / relapse model / learned signatures) materially fed it.
 *
 * Design discipline (all from the repo's own design reviews, ADR-0003/0004/0006):
 *  - The signal confidence is HARD CAPPED at {@link CLINICAL_RISK_CONFIDENCE_CAP}
 *    (88%), regardless of baseline maturity — a high-maturity user can never get a
 *    92%-confident relapse signal.
 *  - A relapse-drift signal requires SUSTAINED drift
 *    ({@link MIN_CONSECUTIVE_DRIFT_HUMS} consecutive hums). A single hum never
 *    raises it; an acute deviation is still read (it is not normalised away), but
 *    it does not, on its own, trip the early-warning monitoring flag.
 *  - Without a personal baseline there is NO within-user judgement —
 *    `risk_marker_present` is computed from the user's own baseline, never from
 *    population norms — so the state abstains as `insufficient_data`.
 *  - This object is INTERNAL. Surfacing any of it is consent-gated and must pass
 *    through `@hum-ai/safety-language`; it is never a diagnosis (`isDiagnostic`).
 */

/** Minimum consecutive drifting hums before a relapse-drift signal is raised. */
export const MIN_CONSECUTIVE_DRIFT_HUMS = 3;
/** riskScore ≥ this ⇒ the current hum carries a high-risk marker (matches the engine's existing 0.6 band). */
export const HIGH_RISK_BAND = 0.6;
/** Drift / alignment magnitude treated as "strong" (matches the relapse-drift override threshold). */
export const STRONG_DRIFT = 0.5;
/** Divergence magnitude (anchored-σ) that maps to full longitudinal-trend strength. */
const DIVERGENCE_FULL_SCALE = 2.5;

export type LongitudinalTrendDirection = "improving" | "worsening" | "stable" | "uncertain";

/** Which evidence sources materially contributed to this read (provenance). */
export interface LongitudinalEvidenceSources {
  /** The current hum's own read (always present). */
  readonly currentHum: boolean;
  /** The cold-start population/clinical prior was the dominant basis (pre-baseline). */
  readonly populationPrior: boolean;
  /** The user's personal rolling baseline was active and re-referenced the read. */
  readonly personalBaseline: boolean;
  /** The anchored long-term baseline was active, so a longitudinal trend exists. */
  readonly longitudinalTrend: boolean;
  /** The within-user relapse model ran (≥ relapse_model stage with references). */
  readonly relapseModel: boolean;
  /** The user's learned high-risk signature had shared support with this hum. */
  readonly highRiskSignature: boolean;
  /** The user's learned recovery signature had shared support with this hum. */
  readonly recoverySignature: boolean;
}

/**
 * The consolidated, INTERNAL, non-diagnostic risk hypothesis for this read. Mirrors
 * the design review's `clinicalRiskSignal` (`risk_marker_present | nominal |
 * insufficient_data`, confidence capped at 88%). Computed from the user's own
 * baseline — `insufficient_data` whenever there is no personal baseline to compare
 * against.
 */
export interface RiskHypothesis {
  readonly status: "risk_marker_present" | "nominal" | "insufficient_data";
  /** ≤ {@link CLINICAL_RISK_CONFIDENCE_CAP}. */
  readonly confidence: UnitInterval;
  /** Features that drove the hypothesis (explainability); empty when nominal/insufficient. */
  readonly evidenceFeatures: readonly string[];
  /** Structural, non-diagnostic assertion (this is a screening signal, never a diagnosis). */
  readonly isDiagnostic: false;
}

/** A sustained drift away from the user's steadier pattern (early-warning, non-diagnostic). */
export interface RelapseDriftSignal {
  readonly signalType: "relapse_drift";
  readonly driftDirection: "worsening" | "diverging_from_stable";
  readonly evidenceFeatures: readonly string[];
  /** How many consecutive hums the drift has been sustained over. */
  readonly driftWindowHums: number;
  /** Normalised drift magnitude in [0,1] (max of relapse-verdict drift and divergence). */
  readonly driftMagnitude: UnitInterval;
  /** HARD CAPPED at {@link CLINICAL_RISK_CONFIDENCE_CAP} regardless of maturity. */
  readonly confidence: UnitInterval;
  readonly consecutiveDriftHums: number;
  /** Non-clinical routing: a gentle check-in for stronger drift, else passive monitoring. */
  readonly userAction: "monitoring_prompt" | "check_in_prompt" | null;
}

/** Convergence toward the user's steadier/recovered pattern (positive, non-clinical). */
export interface RecoverySignature {
  readonly signalType: "recovery_trajectory";
  readonly evidenceFeatures: readonly string[];
  readonly trajectoryDirection: "converging_to_prior_stable" | "exceeding_prior_stable";
  /** How many references/hums informed the pattern. */
  readonly windowHums: number;
  /** Capped at {@link CLINICAL_RISK_CONFIDENCE_CAP}. */
  readonly confidence: UnitInterval;
}

export interface LongitudinalDiagnosticState {
  readonly trendDirection: LongitudinalTrendDirection;
  readonly riskHypothesis: RiskHypothesis;
  /** Raised only on SUSTAINED drift (≥ MIN_CONSECUTIVE_DRIFT_HUMS); otherwise null. */
  readonly relapseDrift: RelapseDriftSignal | null;
  readonly recovery: RecoverySignature | null;
  /** Trajectory is outside normal variation (a sustained relapse-drift was raised). */
  readonly monitoringFlag: boolean;
  /** Running count of consecutive drifting hums (incl. this one); persisted for the next read. */
  readonly consecutiveDriftHums: number;
  readonly abstained: boolean;
  readonly abstainReason: string | null;
  readonly evidenceSources: LongitudinalEvidenceSources;
  /** Structural assertion: this whole object is non-diagnostic. */
  readonly isDiagnostic: false;
}

export interface LongitudinalStateInputs {
  /** Relapse model active (≥ relapse_model ladder stage). */
  readonly relapseModelActive: boolean;
  /** Personal rolling baseline active (≥ personal_baseline stage). */
  readonly baselineActive: boolean;
  /** Anchored long-term baseline active (divergence is defined). */
  readonly anchoredActive: boolean;
  /** The within-user relapse verdict, or null when not assessed this read. */
  readonly relapse: RelapseVerdict | null;
  /** Rolling-vs-anchor divergence magnitude in anchored-σ (0 when the anchor is inactive). */
  readonly divergenceMagnitude: number;
  /** Composite clinical-risk score for the current (personalized) hum, [0,1]. */
  readonly riskScore: UnitInterval;
  /** The read's overall confidence (pre-clinical-cap). */
  readonly baseConfidence: UnitInterval;
  readonly abstained: boolean;
  readonly abstainReason: string;
  /** Cosine alignment of current z-deltas with the learned high-risk signature, or null if unlearned. */
  readonly highRiskAlignment: number | null;
  /** Cosine alignment with the learned recovery signature, or null. */
  readonly recoveryAlignment: number | null;
  /** Top features (by |z-delta|) driving this read, for explainability. */
  readonly driftEvidenceFeatures: readonly string[];
  /** Consecutive drifting hums through the PREVIOUS read (this read may extend it). */
  readonly priorConsecutiveDriftHums: number;
}

/**
 * Synthesize the longitudinal diagnostic state from already-computed within-user
 * signals. Pure. Takes signature ALIGNMENTS (not the signatures themselves) as
 * inputs so the relapse engine stays free of a personalization-engine dependency.
 */
export function assessLongitudinalState(inp: LongitudinalStateInputs): LongitudinalDiagnosticState {
  // The clinical-risk safety ceiling — never exceeded, whatever the maturity cap allows.
  const clinicalConfidence = clamp01(Math.min(inp.baseConfidence, CLINICAL_RISK_CONFIDENCE_CAP));

  const verdictWorsening =
    inp.relapse !== null && (inp.relapse.class === "worsening" || inp.relapse.class === "relapse_drift");
  const divergenceDrift = inp.anchoredActive ? clamp01(inp.divergenceMagnitude / DIVERGENCE_FULL_SCALE) : 0;

  // Per-hum drift indicator — independent of the consecutive count. Only meaningful
  // once the relapse model is active; an acute single hum is read but does not, by
  // itself, raise the early-warning signal.
  const driftingNow = inp.relapseModelActive && (verdictWorsening || divergenceDrift >= STRONG_DRIFT);
  // Abstention carries no information: HOLD the streak (a low-confidence hum neither
  // confirms nor breaks a drift) so one bad-confidence read cannot corrupt the count.
  const consecutiveDriftHums = inp.abstained
    ? inp.priorConsecutiveDriftHums
    : driftingNow
      ? inp.priorConsecutiveDriftHums + 1
      : 0;

  const evidenceSources: LongitudinalEvidenceSources = {
    currentHum: true,
    populationPrior: !inp.baselineActive,
    personalBaseline: inp.baselineActive,
    longitudinalTrend: inp.anchoredActive,
    relapseModel: inp.relapseModelActive && inp.relapse !== null,
    highRiskSignature: inp.highRiskAlignment !== null,
    recoverySignature: inp.recoveryAlignment !== null,
  };

  // Without a personal baseline (or on abstention) we make NO within-user judgement:
  // priors are a prior, not a longitudinal verdict. Conservative by design.
  if (inp.abstained || !inp.baselineActive) {
    return {
      trendDirection: "uncertain",
      riskHypothesis: {
        status: "insufficient_data",
        confidence: clinicalConfidence,
        evidenceFeatures: [],
        isDiagnostic: false,
      },
      relapseDrift: null,
      recovery: null,
      monitoringFlag: false,
      consecutiveDriftHums,
      abstained: inp.abstained,
      abstainReason: inp.abstained ? inp.abstainReason : null,
      evidenceSources,
      isDiagnostic: false,
    };
  }

  let trendDirection: LongitudinalTrendDirection;
  if (inp.relapse) {
    switch (inp.relapse.class) {
      case "recovery":
        trendDirection = "improving";
        break;
      case "worsening":
      case "relapse_drift":
        trendDirection = "worsening";
        break;
      case "stable":
        trendDirection = "stable";
        break;
      default:
        trendDirection = "uncertain";
    }
  } else {
    trendDirection = inp.anchoredActive
      ? divergenceDrift >= STRONG_DRIFT
        ? "worsening"
        : "stable"
      : "uncertain";
  }

  // RISK HYPOTHESIS — within-user: high current risk OR a worsening verdict.
  const riskMarkerPresent = inp.riskScore >= HIGH_RISK_BAND || verdictWorsening;
  const riskHypothesis: RiskHypothesis = {
    status: riskMarkerPresent ? "risk_marker_present" : "nominal",
    confidence: clinicalConfidence,
    evidenceFeatures: riskMarkerPresent ? inp.driftEvidenceFeatures : [],
    isDiagnostic: false,
  };

  // RELAPSE-DRIFT SIGNAL — only on SUSTAINED worsening under the relapse model.
  const driftMagnitude = clamp01(Math.max(inp.relapse ? inp.relapse.drift : 0, divergenceDrift));
  const sustained =
    inp.relapseModelActive && verdictWorsening && consecutiveDriftHums >= MIN_CONSECUTIVE_DRIFT_HUMS;
  const relapseDrift: RelapseDriftSignal | null = sustained
    ? {
        signalType: "relapse_drift",
        // "diverging_from_stable" when the hum looks like the user's OWN high-risk
        // signature; otherwise a generic worsening drift.
        driftDirection: (inp.highRiskAlignment ?? 0) > 0 ? "diverging_from_stable" : "worsening",
        evidenceFeatures: inp.driftEvidenceFeatures,
        driftWindowHums: consecutiveDriftHums,
        driftMagnitude,
        confidence: clinicalConfidence,
        consecutiveDriftHums,
        userAction: driftMagnitude >= STRONG_DRIFT ? "check_in_prompt" : "monitoring_prompt",
      }
    : null;

  // RECOVERY SIGNATURE — convergence toward the user's steadier pattern.
  const recovery: RecoverySignature | null =
    inp.relapse?.class === "recovery"
      ? {
          signalType: "recovery_trajectory",
          evidenceFeatures: inp.driftEvidenceFeatures,
          trajectoryDirection:
            (inp.recoveryAlignment ?? 0) >= STRONG_DRIFT
              ? "exceeding_prior_stable"
              : "converging_to_prior_stable",
          windowHums: inp.relapse.comparisons.length,
          confidence: clinicalConfidence,
        }
      : null;

  return {
    trendDirection,
    riskHypothesis,
    relapseDrift,
    recovery,
    monitoringFlag: relapseDrift !== null,
    consecutiveDriftHums,
    abstained: false,
    abstainReason: null,
    evidenceSources,
    isDiagnostic: false,
  };
}
