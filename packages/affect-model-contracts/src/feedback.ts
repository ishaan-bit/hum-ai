import {
  assertNoRawAudioFields,
  clamp,
  type IsoTimestamp,
  type ModelVersion,
  type UnitInterval,
  type ValenceArousal,
} from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";
import { assertNoClinicalLeak } from "./two-head";

/**
 * HUMAN-IN-THE-LOOP (HiTL) FEEDBACK CONTRACT — the shape of a user-confirmed label
 * and the native-hum training example it mints.
 *
 * The product runs on far-domain ACTED-SPEECH priors (RAVDESS) that saturate /
 * abstain OOD on real hums (ADR-0005/0010). The only way out is a NATIVE-HUM
 * corpus — derived features paired with a human label — that does not exist yet
 * (the whole `DIAGNOSTIC_ROADMAP` B1/B3 is blocked on it). This contract is how
 * that corpus comes into being: after a read, the user confirms or adjusts the
 * dimensional read, and that becomes one `{features, label}` row of hum truth.
 *
 * GOVERNANCE (load-bearing, enforced by `assertValidNativeHumExample`):
 *  - The label is BENIGN AFFECT only — self-reported valence + arousal on the
 *    Russell axes (subdued↔pleasant, settled↔activated). It is NEVER a clinical
 *    instrument score (PHQ-9 / GAD-7 / CES-DC) or a clinical-risk marker. Those
 *    are PHI, need `clinical_label_capture` consent + a separate channel + IRB
 *    (NATIVE_HUM_DATA_SPEC §4/§7), and would trip `assertNoClinicalLeak`. A
 *    self-report of how-you-feel-right-now on two coarse axes does not.
 *  - The example carries DERIVED FEATURES ONLY — the exact `AcousticFeatures` the
 *    read was computed from, the same representation `HumSyncPayload` already
 *    syncs. Raw audio never enters it (`assertNoRawAudioFields`).
 */

/** Whether the user confirmed the read as-is or adjusted it. */
export type LabelSource = "self_report_confirm" | "self_report_adjust";

/** Provenance of a native-hum example. In-app HiTL self-report is the only v1 source. */
export type NativeHumProvenance = "in_app_hitl_self_report";

/**
 * The user's self-reported affect for one hum — benign dimensional axes only.
 * `valence`/`arousal` are signed in [-1, 1] (the same scale as the axis read).
 */
export interface HumLabel {
  /** Self-reported valence, subdued(−1) ↔ pleasant(+1). */
  readonly valence: number;
  /** Self-reported arousal, settled(−1) ↔ activated(+1). */
  readonly arousal: number;
}

/** One feedback event from the user, before it is bound to a captured hum. */
export interface HumSelfReport {
  readonly label: HumLabel;
  readonly source: LabelSource;
  /**
   * Whether the user judged the model's read to already match how they felt. A
   * `confirm` always agrees; an `adjust` may still broadly agree (small nudge) or
   * disagree (a flip). Recorded for honest provenance + calibration, never copy.
   */
  readonly agreedWithRead: boolean;
}

/**
 * ONE ROW OF NATIVE-HUM TRUTH — a derived-feature vector paired with a human
 * label. Self-contained on purpose (it embeds the full `features` snapshot) so it
 * is a standalone training row needing no cross-document join (the `HumSyncPayload`
 * write generates a throwaway id and never returns it — a label keyed to it could
 * never be rejoined). Privacy-guarded by `assertValidNativeHumExample`.
 */
export interface NativeHumExample {
  /** Stable id (caller-minted; e.g. the same id used for the hum's sync doc). */
  readonly id: string;
  readonly capturedAt: IsoTimestamp;
  readonly modelVersion: ModelVersion;
  /** DERIVED features only — never raw audio. The model's input for this hum. */
  readonly features: AcousticFeatures;
  /** The dimensional read the model produced for this hum (what the user reacted to). */
  readonly predicted: ValenceArousal;
  /** The model's earned confidence for that read [0,1] (for active-learning weighting). */
  readonly predictedConfidence: UnitInterval;
  /** The user's self-reported label — the ground-truth signal for THIS hum. */
  readonly label: HumLabel;
  readonly source: LabelSource;
  readonly agreedWithRead: boolean;
  /** Capture-quality score at label time — the corpus only keeps usable hums. */
  readonly captureQualityScore: UnitInterval;
  /** Whether this hum was baseline-eligible (clean enough to also train on). */
  readonly eligible: boolean;
  readonly provenance: NativeHumProvenance;
  /**
   * The feature-vector schema version this row was captured under, so a later
   * schema change (renamed/added feature) can reject or migrate stale rows rather
   * than silently train on a mismatched layout.
   */
  readonly featureSchemaVersion: string;
}

/** Raised when a native-hum example violates the label or privacy invariants. */
export class InvalidNativeHumExampleError extends Error {
  constructor(reason: string) {
    super(`invalid native-hum example: ${reason}`);
    this.name = "InvalidNativeHumExampleError";
  }
}

/** Clamp a self-report axis into the valid signed range (defensive against UI overshoot). */
function clampAxis(x: number): number {
  return clamp(Number.isFinite(x) ? x : 0, -1, 1);
}

/** Normalize a raw self-report into a valid `HumLabel` (clamped, finite). */
export function normalizeLabel(label: HumLabel): HumLabel {
  return { valence: clampAxis(label.valence), arousal: clampAxis(label.arousal) };
}

/**
 * Validate a native-hum example against BOTH privacy invariants before it may be
 * stored or synced:
 *  - `assertNoRawAudioFields` — no raw-audio-like field at any depth (the row
 *    carries derived features only).
 *  - `assertNoClinicalLeak` — no clinical-risk-marker id as a key OR string value
 *    (the label is benign valence/arousal; this is defense in depth against a
 *    refactor ever attaching a risk-marker label to the corpus).
 * Also checks the label axes are finite and in range. Throws on any violation.
 */
export function assertValidNativeHumExample(ex: NativeHumExample): void {
  if (!Number.isFinite(ex.label.valence) || Math.abs(ex.label.valence) > 1.0000001) {
    throw new InvalidNativeHumExampleError(`label.valence out of [-1,1]: ${ex.label.valence}`);
  }
  if (!Number.isFinite(ex.label.arousal) || Math.abs(ex.label.arousal) > 1.0000001) {
    throw new InvalidNativeHumExampleError(`label.arousal out of [-1,1]: ${ex.label.arousal}`);
  }
  assertNoRawAudioFields(ex); // privacy: derived-only, no raw audio
  assertNoClinicalLeak(ex); // governance: benign label only, no clinical-risk leak
}
