import {
  assertNoRawAudioFields,
  type IsoTimestamp,
  type UnitInterval,
} from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * CLINICAL SCREENING CONTRACT — the shape of a hum paired with a validated
 * clinical reference instrument (PHQ-9 / GAD-7), the ground truth a depression /
 * anxiety SCREENING model is validated against.
 *
 * This is the SANCTIONED clinical channel and is intentionally NOT the benign
 * `NativeHumExample` corpus. Clinical instrument scores are PHI: they require
 * `clinical_label_capture` consent, a separate store + Firestore path, IRB
 * approval, and pseudonymisation (NATIVE_HUM_DATA_SPEC §4/§7). A `HumLabel`
 * (benign valence/arousal self-report) deliberately CANNOT hold a PHQ-9 score —
 * `assertValidNativeHumExample` calls `assertNoClinicalLeak`, which would reject
 * it. So clinical examples live here, behind their own guard.
 *
 * GOVERNANCE (load-bearing, enforced by `assertValidClinicalExample`):
 *  - DERIVED FEATURES ONLY. Raw audio never enters a `ClinicalHumExample`
 *    (`assertNoRawAudioFields`). Raw audio for the model-development subset travels
 *    a separate `research_audio_upload` channel, never this row.
 *  - This contract does NOT call `assertNoClinicalLeak` — by design it is the one
 *    place a clinical instrument score legitimately lives. It is the analyst's
 *    input, never user-facing copy, and never crosses into the recommendation
 *    engine (ADR-0006). The screening model trained on it is a study artifact and
 *    is NOT wired into the consumer read path during the pilot.
 *  - Item 9 of the PHQ-9 (suicidal ideation) is broken out as a first-class field
 *    so the real-time crisis pathway can act on it deterministically, before any
 *    model, backend round-trip, or navigation (see apps/web crisis.ts).
 */

// ---------------------------------------------------------------------------
// Instrument constants (standard PHQ-9 / PHQ-8 / GAD-7 scoring)
// ---------------------------------------------------------------------------

/** Each instrument item is a 0–3 Likert ("not at all" → "nearly every day"). */
export const INSTRUMENT_ITEM_MIN = 0;
export const INSTRUMENT_ITEM_MAX = 3;

export const PHQ9_ITEM_COUNT = 9;
export const PHQ8_ITEM_COUNT = 8;
export const GAD7_ITEM_COUNT = 7;

export const PHQ9_MAX_TOTAL = 27; // 9 × 3
export const GAD7_MAX_TOTAL = 21; // 7 × 3

/**
 * Pre-registered primary screening cut-points. PHQ-9 ≥ 10 is the standard
 * "moderate or worse" major-depression screening threshold; GAD-7 ≥ 10 the
 * standard anxiety threshold. Both are configurable at the call site, but these
 * are the locked defaults for the co-primary endpoints.
 */
export const PHQ9_SCREENING_CUT = 10;
export const GAD7_SCREENING_CUT = 10;

/** Zero-based index of the PHQ-9 suicidality item within an `items` array. */
export const PHQ9_ITEM9_INDEX = 8;

export type DepressionSeverityBand =
  | "minimal"
  | "mild"
  | "moderate"
  | "moderately_severe"
  | "severe";

export type AnxietySeverityBand = "minimal" | "mild" | "moderate" | "severe";

/** Standard PHQ-9 severity banding by total score (0–27). */
export function depressionSeverityBand(total: number): DepressionSeverityBand {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  if (total <= 19) return "moderately_severe";
  return "severe";
}

/** Standard GAD-7 severity banding by total score (0–21). */
export function anxietySeverityBand(total: number): AnxietySeverityBand {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  return "severe";
}

// ---------------------------------------------------------------------------
// Instrument responses
// ---------------------------------------------------------------------------

/**
 * A completed PHQ-9 (or PHQ-8) administration. `items` holds the per-item 0–3
 * responses (9 for PHQ-9, 8 for PHQ-8). `item9` is the suicidality item broken
 * out as a first-class field; it is `null` for PHQ-8, which omits that item.
 */
export interface Phq9Response {
  readonly instrument: "PHQ-9" | "PHQ-8";
  readonly items: readonly number[];
  /** Suicidality item (0–3); null when the PHQ-8 variant was administered. */
  readonly item9: number | null;
  readonly total: number;
  readonly severityBand: DepressionSeverityBand;
  readonly administeredAt: IsoTimestamp;
}

/** A completed GAD-7 administration (7 items, 0–3 each). */
export interface Gad7Response {
  readonly instrument: "GAD-7";
  readonly items: readonly number[];
  readonly total: number;
  readonly severityBand: AnxietySeverityBand;
  readonly administeredAt: IsoTimestamp;
}

export class InvalidInstrumentResponseError extends Error {
  constructor(reason: string) {
    super(`invalid instrument response: ${reason}`);
    this.name = "InvalidInstrumentResponseError";
  }
}

function assertLikertItems(items: readonly number[], expected: number, instrument: string): void {
  if (items.length !== expected) {
    throw new InvalidInstrumentResponseError(
      `${instrument} expects ${expected} items, got ${items.length}`,
    );
  }
  items.forEach((x, i) => {
    if (!Number.isInteger(x) || x < INSTRUMENT_ITEM_MIN || x > INSTRUMENT_ITEM_MAX) {
      throw new InvalidInstrumentResponseError(`${instrument} item ${i} out of 0–3: ${x}`);
    }
  });
}

/**
 * Build + validate a PHQ-9 / PHQ-8 response from raw item scores. Computes the
 * total and severity band, and extracts item 9 (null for PHQ-8). Throws on any
 * out-of-range or wrong-length input.
 */
export function buildPhq9Response(
  items: readonly number[],
  administeredAt: IsoTimestamp,
  instrument: "PHQ-9" | "PHQ-8" = "PHQ-9",
): Phq9Response {
  const expected = instrument === "PHQ-9" ? PHQ9_ITEM_COUNT : PHQ8_ITEM_COUNT;
  assertLikertItems(items, expected, instrument);
  const total = items.reduce((s, x) => s + x, 0);
  const item9 = instrument === "PHQ-9" ? items[PHQ9_ITEM9_INDEX]! : null;
  return { instrument, items: [...items], item9, total, severityBand: depressionSeverityBand(total), administeredAt };
}

/** Build + validate a GAD-7 response from raw item scores. */
export function buildGad7Response(items: readonly number[], administeredAt: IsoTimestamp): Gad7Response {
  assertLikertItems(items, GAD7_ITEM_COUNT, "GAD-7");
  const total = items.reduce((s, x) => s + x, 0);
  return { instrument: "GAD-7", items: [...items], total, severityBand: anxietySeverityBand(total), administeredAt };
}

// ---------------------------------------------------------------------------
// Binary screening labels (the pre-registered co-primary targets)
// ---------------------------------------------------------------------------

/** The binary screening outcome a model is validated against. */
export type ScreeningLabel = "screen_positive" | "screen_negative";

/** Map a PHQ-9 total to a binary depression-screening label at the cut (default ≥10). */
export function phqToBinaryLabel(phq: Phq9Response, cut: number = PHQ9_SCREENING_CUT): ScreeningLabel {
  return phq.total >= cut ? "screen_positive" : "screen_negative";
}

/** Map a GAD-7 total to a binary anxiety-screening label at the cut (default ≥10). */
export function gadToBinaryLabel(gad: Gad7Response, cut: number = GAD7_SCREENING_CUT): ScreeningLabel {
  return gad.total >= cut ? "screen_positive" : "screen_negative";
}

// ---------------------------------------------------------------------------
// The clinical example (one paired row of screening ground truth)
// ---------------------------------------------------------------------------

/**
 * ONE ROW OF CLINICAL SCREENING GROUND TRUTH — a derived-feature vector paired
 * with the reference instrument(s) administered in the same session. Keyed by a
 * `participantPseudonym` (never an account id / email), so the corpus can be
 * deleted on withdrawal and folds can be grouped by participant with zero leakage.
 */
export interface ClinicalHumExample {
  /** Stable per-capture id (caller-minted). */
  readonly id: string;
  /** Study-scoped pseudonym — the re-identification key lives only in the backend. */
  readonly participantPseudonym: string;
  readonly studyId: string;
  readonly capturedAt: IsoTimestamp;
  /** DERIVED features only — never raw audio. The model's input for this hum. */
  readonly features: AcousticFeatures;
  /** PHQ-9/PHQ-8 administered in this session (null if only anxiety was collected). */
  readonly phq: Phq9Response | null;
  /** GAD-7 administered in this session (null if only depression was collected). */
  readonly gad: Gad7Response | null;
  /** Capture-quality score — the corpus only trains on usable hums. */
  readonly captureQualityScore: UnitInterval;
  /** Whether this hum passed the quality gate (clean enough to train on). */
  readonly eligible: boolean;
  /** Coarse device class (e.g. "ios_safari", "android_chrome") for QUADAS-2 spectrum coverage. */
  readonly deviceClass: string;
  /** Coarse, non-identifying recruitment stratum (e.g. "adult_general") for spectrum coverage. */
  readonly stratum?: string;
  /** Feature-vector schema version, so a later schema change can reject/migrate stale rows. */
  readonly featureSchemaVersion: string;
}

/**
 * Pairs a hum capture with an instrument administration when they are recorded a
 * few minutes apart rather than truly simultaneously. A tight `gapMinutes` is a
 * pre-registered inclusion criterion for the cross-sectional analysis.
 */
export interface ClinicalSessionLink {
  readonly participantPseudonym: string;
  readonly studyId: string;
  readonly humCaptureId: string;
  readonly humCapturedAt: IsoTimestamp;
  readonly instrumentAdministeredAt: IsoTimestamp;
  /** Minutes between hum capture and instrument administration. */
  readonly gapMinutes: number;
}

export class InvalidClinicalExampleError extends Error {
  constructor(reason: string) {
    super(`invalid clinical example: ${reason}`);
    this.name = "InvalidClinicalExampleError";
  }
}

/**
 * Validate a clinical example before it may be stored or synced:
 *  - `assertNoRawAudioFields` — derived features only, no raw audio at any depth.
 *  - at least one reference instrument present (a row with no label trains nothing).
 *  - instrument item ranges/length re-checked (defense in depth vs. a hand-built row).
 *  - `participantPseudonym` present and not an obvious identifier (no "@").
 * Deliberately does NOT call `assertNoClinicalLeak`: this is the sanctioned clinical
 * channel and legitimately carries PHQ-9/GAD-7 scores.
 */
export function assertValidClinicalExample(ex: ClinicalHumExample): void {
  if (!ex.participantPseudonym || ex.participantPseudonym.includes("@")) {
    throw new InvalidClinicalExampleError(`participantPseudonym must be a non-identifying pseudonym`);
  }
  if (!ex.phq && !ex.gad) {
    throw new InvalidClinicalExampleError(`at least one reference instrument (PHQ-9/PHQ-8 or GAD-7) is required`);
  }
  if (ex.phq) {
    const expected = ex.phq.instrument === "PHQ-9" ? PHQ9_ITEM_COUNT : PHQ8_ITEM_COUNT;
    assertLikertItems(ex.phq.items, expected, ex.phq.instrument);
  }
  if (ex.gad) assertLikertItems(ex.gad.items, GAD7_ITEM_COUNT, "GAD-7");
  if (!Number.isFinite(ex.captureQualityScore) || ex.captureQualityScore < 0 || ex.captureQualityScore > 1) {
    throw new InvalidClinicalExampleError(`captureQualityScore out of [0,1]: ${ex.captureQualityScore}`);
  }
  assertNoRawAudioFields(ex); // privacy: derived-only, no raw audio
}
