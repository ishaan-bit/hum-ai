import {
  gadToBinaryLabel,
  GAD7_SCREENING_CUT,
  phqToBinaryLabel,
  PHQ9_SCREENING_CUT,
} from "@hum-ai/affect-model-contracts";
import { trainableClinicalExamples, type ClinicalCorpus } from "@hum-ai/clinical-corpus";
import { toFeatureVector, featureVectorNames } from "@hum-ai/signal-lab/feature-schema";
import { evaluateBinary, type BinaryEvalResult, type BinaryLabeledSample } from "@hum-ai/signal-lab/evaluate-binary";

/**
 * THE SCREENING HEAD — a STUDY ARTIFACT, not a consumer feature.
 *
 * It trains/validates a hum → depression / anxiety screening signal against a
 * binary clinical reference (PHQ-9 ≥ 10 / GAD-7 ≥ 10). It is structurally separate
 * from the broad affect head and the consumer clinical-risk marker head (ADR-0006):
 * it is NOT imported by the orchestrator or render path. During the pilot the
 * screening probability is blinded (never shown to participants); only after the
 * pre-registered endpoints are met + governance sign-off does any user-facing
 * surfacing unlock (CLAIMS_LADDER §5, `validatedRegulatoryMode`).
 *
 * The model + evaluation are reused wholesale from `@hum-ai/signal-lab`
 * (deterministic LogReg + participant-grouped CV + AUC/calibration/permutation).
 * This module only adapts the clinical corpus into labeled samples and applies the
 * pre-registered promotion gate.
 */

export type ScreeningTarget = "depression" | "anxiety";

export interface BuildSamplesOptions {
  /** Screening cut (defaults: PHQ-9 ≥ 10 / GAD-7 ≥ 10). */
  readonly cut?: number;
}

/**
 * Adapt the clinical corpus into participant-grouped binary samples for one target.
 * Only ELIGIBLE rows that actually carry the relevant instrument are included; the
 * group key is the participant pseudonym, so CV folds never leak a participant.
 */
export function buildScreeningSamples(
  corpus: ClinicalCorpus,
  target: ScreeningTarget,
  opts: BuildSamplesOptions = {},
): BinaryLabeledSample[] {
  const samples: BinaryLabeledSample[] = [];
  for (const ex of trainableClinicalExamples(corpus)) {
    let positive: boolean | null = null;
    if (target === "depression" && ex.phq) {
      positive = phqToBinaryLabel(ex.phq, opts.cut ?? PHQ9_SCREENING_CUT) === "screen_positive";
    } else if (target === "anxiety" && ex.gad) {
      positive = gadToBinaryLabel(ex.gad, opts.cut ?? GAD7_SCREENING_CUT) === "screen_positive";
    }
    if (positive === null) continue;
    samples.push({ vector: toFeatureVector(ex.features), positive, group: ex.participantPseudonym });
  }
  return samples;
}

const TARGET_TASK: Record<ScreeningTarget, string> = {
  depression: "phq9_ge_10",
  anxiety: "gad7_ge_10",
};

/** Run the full participant-grouped screening evaluation for one target. */
export function evaluateScreening(
  corpus: ClinicalCorpus,
  target: ScreeningTarget,
  opts: BuildSamplesOptions & { seed?: number } = {},
): BinaryEvalResult {
  const samples = buildScreeningSamples(corpus, target, opts);
  return evaluateBinary(samples, {
    featureNames: featureVectorNames(),
    target: TARGET_TASK[target],
    task: `hum_screening_${target}`,
    seed: opts.seed,
  });
}

/**
 * THE PRE-REGISTERED PROMOTION GATE — the bar a screening model must clear before
 * the claim is earned. These defaults are PLACEHOLDERS, pending biostatistics
 * sign-off in the pre-registration; the real values are locked there before any
 * data is unblinded. The gate is intentionally far stricter than the on-device
 * native-axis retrain gate (`@hum-ai/native-corpus`), because this is a clinical
 * SCREENING claim, not a within-user reflective nudge.
 */
export interface ScreeningPromotionGate {
  readonly minRows: number;
  readonly minParticipants: number;
  /** Point-estimate AUC floor. */
  readonly minAuc: number;
  /** Lower bound of the AUC 95% CI must clear this (the honest, conservative floor). */
  readonly minAucCiLower: number;
  readonly maxPValue: number;
  readonly maxEce: number;
  /** Sensitivity/specificity required at the chosen operating point. */
  readonly minSensitivity: number;
  readonly minSpecificity: number;
}

/** Placeholder clinical-grade gate — final numbers set by biostatistics in the pre-registration. */
export const DEFAULT_SCREENING_GATE: ScreeningPromotionGate = {
  minRows: 200,
  minParticipants: 100,
  minAuc: 0.8,
  minAucCiLower: 0.7,
  maxPValue: 0.01,
  maxEce: 0.1,
  minSensitivity: 0.8,
  minSpecificity: 0.7,
};

export interface ScreeningPromotion {
  readonly target: ScreeningTarget;
  readonly decision: "promote" | "hold";
  readonly reasons: readonly string[];
  readonly result: BinaryEvalResult;
}

/**
 * Apply the promotion gate to an evaluation result at the Youden-optimal operating
 * point. Returns `hold` with the failing reasons unless EVERY criterion clears —
 * never rounds a criterion up. Promotion here is a precondition for unlocking the
 * claim; it does not itself set `validatedRegulatoryMode` (a governance step).
 */
export function assessScreeningPromotion(
  result: BinaryEvalResult,
  gate: ScreeningPromotionGate = DEFAULT_SCREENING_GATE,
): ScreeningPromotion {
  const reasons: string[] = [];
  const op = result.atYoudenThreshold;
  const ciLower = result.aucCI95[0];

  if (result.n < gate.minRows) reasons.push(`needs ≥${gate.minRows} labeled rows (have ${result.n})`);
  if (result.groupCount < gate.minParticipants) reasons.push(`needs ≥${gate.minParticipants} participants (have ${result.groupCount})`);
  if (!(result.auc >= gate.minAuc)) reasons.push(`AUC ${fmt(result.auc)} below floor ${gate.minAuc}`);
  if (!(Number.isFinite(ciLower) && ciLower >= gate.minAucCiLower)) reasons.push(`AUC 95% CI lower bound ${fmt(ciLower)} below ${gate.minAucCiLower}`);
  if (!(result.significance.pValue < gate.maxPValue)) reasons.push(`permutation p=${result.significance.pValue.toFixed(3)} ≥ ${gate.maxPValue}`);
  if (!(result.calibration.ece <= gate.maxEce)) reasons.push(`ECE ${result.calibration.ece.toFixed(3)} > ${gate.maxEce}`);
  if (!(op.sensitivity >= gate.minSensitivity)) reasons.push(`sensitivity ${fmt(op.sensitivity)} below ${gate.minSensitivity}`);
  if (!(op.specificity >= gate.minSpecificity)) reasons.push(`specificity ${fmt(op.specificity)} below ${gate.minSpecificity}`);

  const target: ScreeningTarget = result.target.startsWith("phq") ? "depression" : "anxiety";
  return { target, decision: reasons.length === 0 ? "promote" : "hold", reasons, result };
}

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : "n/a";
}
