/**
 * RUN CONTEXT — the non-audio inputs the production pipeline needs around a hum:
 * consent posture, model version, and deterministic timestamps. Kept separate from
 * the latent profile because (per the design mandate) contextual / historical inputs
 * are NOT inferable from audio and must be supplied explicitly through their own
 * pathway — never smuggled in through the waveform.
 */
import {
  asIsoTimestamp,
  asModelVersion,
  defaultConsent,
  type ConsentState,
  type IsoTimestamp,
  type ModelVersion,
} from "@hum-ai/shared-types";

export const SIM_MODEL_VERSION: ModelVersion = asModelVersion("hum-sim@0.0.0");

/** Local-only consent (the default product posture; clinical-risk surfacing OFF). */
export function consentLocal(now: IsoTimestamp): ConsentState {
  return defaultConsent(now);
}

/** Consent with clinical-risk surfacing ON — exercises the consent-gated escalation path. */
export function consentClinical(now: IsoTimestamp): ConsentState {
  return { grantedScopes: ["local_processing", "clinical_risk_surfacing"], updatedAt: now };
}

/** Fixed base instant so every sim run is byte-for-byte reproducible (no Date.now). */
const BASE_MS = Date.parse("2026-06-01T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic timestamp `dayOffset` days (and `minuteOffset` minutes) after the base instant. */
export function simTimestamp(dayOffset = 0, minuteOffset = 0): IsoTimestamp {
  return asIsoTimestamp(new Date(BASE_MS + dayOffset * DAY_MS + minuteOffset * 60_000).toISOString());
}
