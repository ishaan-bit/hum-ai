import { clamp01, mean, type IsoTimestamp, type ModelVersion, type ValenceArousal } from "@hum-ai/shared-types";
import {
  assertValidNativeHumExample,
  normalizeLabel,
  type HumSelfReport,
  type NativeHumExample,
} from "@hum-ai/affect-model-contracts";
import type { PersonalAxisCorrection } from "@hum-ai/personalization-engine";
import type { OrchestratedRead } from "./orchestrator";

/**
 * HUMAN-IN-THE-LOOP (HiTL) FEEDBACK — turn a read + a user self-report into (a) one
 * row of native-hum truth for the global retraining corpus and (b) one personal
 * axis correction for the within-user calibration. This is the seam that lets the
 * product OUTGROW its far-domain acted-speech priors: every confirmation is a hum
 * the model can finally learn from on-domain.
 *
 * Two pure functions, no I/O:
 *  - `buildFeedbackRequest` — ACTIVE LEARNING: decide whether THIS read is worth a
 *    label prompt and how informative it would be, so prompts land on the hums that
 *    teach the model the most (low-confidence / no-trained-agreement reads) instead
 *    of nagging on every hum.
 *  - `applyFeedback` — bind the user's report to the read: mint a guard-validated
 *    `NativeHumExample` (derived features + benign label, never raw audio) and a
 *    `PersonalAxisCorrection` for `ingestFeedback`.
 */

/** Axis confidence at/above which a read is "clear" and a prompt is low-priority. */
export const FEEDBACK_CLEAR_CONFIDENCE = 0.72;
/** Priority at/above which a read is worth a prompt on its own merits. */
export const FEEDBACK_ASK_THRESHOLD = 0.34;

export type FeedbackReason =
  | "abstained"
  | "low_confidence"
  | "no_trained_agreement"
  | "boundary"
  | "clear_read";

export interface FeedbackRequest {
  /** Whether this read is worth a label prompt by its own informativeness. */
  readonly shouldAsk: boolean;
  /** How informative a label here would be [0,1] (active-learning priority). */
  readonly priority: number;
  readonly reason: FeedbackReason;
  /** The dimensional read the user would confirm or correct (what they saw). */
  readonly predicted: ValenceArousal;
  /** Earned confidence of that read [0,1] (provenance; never rendered as a number). */
  readonly predictedConfidence: number;
  /** A short, non-diagnostic rationale safe to render beside the prompt. */
  readonly note: string;
}

/** How close the read sits to the neutral cross (a quadrant boundary) — ambiguous reads. */
function nearBoundary(dim: ValenceArousal): boolean {
  return Math.abs(dim.valence) < 0.15 && Math.abs(dim.arousal) < 0.15;
}

/**
 * ACTIVE LEARNING. An abstained / unusable read is never worth labelling (the
 * features carry too little signal to train on). Otherwise priority rises as the
 * read's earned confidence falls, with a boost when no trained prior agreed
 * (OOD-abstained on either axis — exactly the on-domain gap a native label closes)
 * and when the read sits on a quadrant boundary (ambiguous). The caller adds its own
 * cadence (e.g. also confirm periodically) — this answers "is THIS hum informative".
 */
export function buildFeedbackRequest(read: OrchestratedRead): FeedbackRequest {
  const axis = read.internal.axis;
  const predicted = axis.dimensional;
  const predictedConfidence = clamp01(mean([axis.valence.confidence, axis.arousal.confidence]));

  if (read.userFacing.abstained) {
    return {
      shouldAsk: false,
      priority: 0,
      reason: "abstained",
      predicted,
      predictedConfidence,
      note: "No clear read to confirm on this hum.",
    };
  }

  let priority = clamp01(1 - predictedConfidence);
  let reason: FeedbackReason = predictedConfidence < FEEDBACK_CLEAR_CONFIDENCE ? "low_confidence" : "clear_read";

  const noTrainedAgreement =
    axis.valence.trainedContribution !== "in_domain" && axis.arousal.trainedContribution !== "in_domain";
  if (noTrainedAgreement) {
    priority = clamp01(priority + 0.15);
    if (reason === "clear_read") reason = "no_trained_agreement";
  }
  if (nearBoundary(predicted)) {
    priority = clamp01(priority + 0.12);
    if (reason === "clear_read") reason = "boundary";
  }

  const NOTE: Record<FeedbackReason, string> = {
    abstained: "No clear read to confirm on this hum.",
    low_confidence: "This is a lighter-confidence read — telling us how you actually feel sharpens it.",
    no_trained_agreement: "No trained model has seen a hum like this yet — your answer becomes its first example.",
    boundary: "This read sits right in the middle — a quick check helps place it.",
    clear_read: "A quick check keeps your read honest and tunes it to you.",
  };

  return {
    shouldAsk: priority >= FEEDBACK_ASK_THRESHOLD,
    priority,
    reason,
    predicted,
    predictedConfidence,
    note: NOTE[reason],
  };
}

/** What the caller must supply to bind a report to a captured hum. */
export interface FeedbackBinding {
  /** Stable id for the example (reuse the hum's sync-doc id when there is one). */
  readonly id: string;
  /** When the hum was captured (NOT now — the example belongs to that hum). */
  readonly capturedAt: IsoTimestamp;
  readonly modelVersion: ModelVersion;
}

export interface FeedbackOutcome {
  /** One guard-validated row of native-hum truth for the global corpus. */
  readonly example: NativeHumExample;
  /** One personal axis correction for `ingestFeedback` (within-user calibration). */
  readonly correction: PersonalAxisCorrection;
}

/** A one-tap CONFIRM is weaker evidence of a systematic offset than a deliberate ADJUST. */
const CONFIRM_CORRECTION_WEIGHT = 0.6;

/**
 * Bind a user self-report to a read: produce the native-hum training example and the
 * personal correction. The `predicted` value on both is the dimensional read the user
 * actually saw (`read.internal.axis.dimensional`, after any personal calibration), so
 * the residual `reported − predicted` correctly drives the calibration toward
 * equilibrium. The example is validated against the raw-audio + clinical-leak guards
 * before return — it can never be built into an unsafe row.
 */
export function applyFeedback(
  read: OrchestratedRead,
  report: HumSelfReport,
  binding: FeedbackBinding,
): FeedbackOutcome {
  const internal = read.internal;
  const predicted = internal.axis.dimensional;
  const label = normalizeLabel(report.label);
  const predictedConfidence = clamp01(mean([internal.axis.valence.confidence, internal.axis.arousal.confidence]));

  const example: NativeHumExample = {
    id: binding.id,
    capturedAt: binding.capturedAt,
    modelVersion: binding.modelVersion,
    features: internal.features,
    predicted,
    predictedConfidence,
    label,
    source: report.source,
    agreedWithRead: report.agreedWithRead,
    captureQualityScore: clamp01(internal.quality.captureQualityScore),
    eligible: internal.quality.baselineEligible,
    provenance: "in_app_hitl_self_report",
    featureSchemaVersion: internal.features.featureMode,
  };
  assertValidNativeHumExample(example); // raw-audio + clinical-leak guards (defense in depth)

  const correction: PersonalAxisCorrection = {
    predicted,
    reported: label,
    weight: report.source === "self_report_confirm" ? CONFIRM_CORRECTION_WEIGHT : 1,
  };

  return { example, correction };
}
