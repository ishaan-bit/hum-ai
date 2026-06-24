import type { IsoTimestamp } from "./ids";

/**
 * Privacy posture, modeled directly from `hum_spec` §5.3 / §11.
 *
 * Posture summary:
 *  - Local-first. Raw audio is NOT uploaded by default.
 *  - Only DERIVED features may be synced.
 *  - Raw-audio-like field names are hard-blocked from any sync payload.
 *  - Consent is explicit and scoped; research audio and clinical labels each
 *    require their own opt-in.
 *
 * See DATA_GOVERNANCE.md and ADR (privacy is built into schemas from the start).
 */

/**
 * Independently granted consent scopes. Absence of a scope = not granted.
 * `local_processing` is the only scope implied by app use; everything that
 * leaves the device is opt-in.
 */
export const CONSENT_SCOPES = [
  "local_processing", // on-device feature extraction & baseline (implied by use)
  "derived_feature_sync", // upload derived feature summaries only (no raw audio) — to the user's OWN private space
  "research_audio_upload", // upload raw audio for research — explicit opt-in
  "clinical_label_capture", // capture PHQ/GAD/CES-DC etc. — explicit research consent
  "clinical_risk_surfacing", // surface anxiety/depressive/relapse risk markers to the user — explicit opt-in (ADR-0006)
  // Contribute this device's DERIVED native-hum examples + self-report labels (never raw audio,
  // never clinical labels) to a POOLED, pseudonymous corpus so a population baseline model can be
  // retrained and benefit every user — distinct from `derived_feature_sync`, which only backs up
  // to the user's OWN space. Explicit opt-in; the pooled corpus is server/aggregator-readable
  // only (never cross-user), and contributions are append-only (ADR-0012). See @hum-ai/population-corpus.
  "population_corpus_contribution",
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface ConsentState {
  readonly grantedScopes: readonly ConsentScope[];
  readonly updatedAt: IsoTimestamp;
}

export function hasConsent(state: ConsentState, scope: ConsentScope): boolean {
  return state.grantedScopes.includes(scope);
}

/** Default posture for a brand-new user: local processing only. */
export function defaultConsent(now: IsoTimestamp): ConsentState {
  return { grantedScopes: ["local_processing"], updatedAt: now };
}

/**
 * VERSIONED RESEARCH-CONSENT RECORD.
 *
 * The device-local `ConsentState` is a mutable snapshot of currently-granted
 * scopes — fine for the consumer product. Research consent is more: an IRB needs
 * an APPEND-ONLY, versioned, timestamped record of exactly what a participant
 * agreed to and when, bound to the hash of the consent document they saw, plus an
 * explicit withdrawal as a NEW record (never an edit/delete of the original).
 * These are written to the study backend (`studies/{id}/consentRecords`), where
 * the Firestore rules deny update/delete so the record is immutable by construction.
 */
export interface ResearchConsentRecord {
  readonly recordId: string;
  readonly participantPseudonym: string;
  readonly studyId: string;
  /** Version of the consent document the participant acknowledged. */
  readonly consentVersion: string;
  /** Hash of the exact consent text shown, so the agreed wording stays auditable. */
  readonly consentDocHash: string;
  /** Scopes granted at signing (a subset of CONSENT_SCOPES). */
  readonly grantedScopes: readonly ConsentScope[];
  readonly signedAt: IsoTimestamp;
  /** "enrol" grants; "withdraw" revokes — a withdrawal references the record it revokes. */
  readonly kind: "enrol" | "withdraw";
  /** For a withdrawal: the recordId being revoked. Null on an enrolment record. */
  readonly withdrawsRecordId: string | null;
}

export class InvalidConsentRecordError extends Error {
  constructor(reason: string) {
    super(`invalid research-consent record: ${reason}`);
    this.name = "InvalidConsentRecordError";
  }
}

/** Validate a research-consent record before it is written to the append-only log. */
export function assertValidConsentRecord(r: ResearchConsentRecord): void {
  if (!r.recordId) throw new InvalidConsentRecordError("recordId required");
  if (!r.participantPseudonym || r.participantPseudonym.includes("@")) {
    throw new InvalidConsentRecordError("participantPseudonym must be a non-identifying pseudonym");
  }
  if (!r.studyId) throw new InvalidConsentRecordError("studyId required");
  if (!r.consentVersion) throw new InvalidConsentRecordError("consentVersion required");
  if (!r.consentDocHash) throw new InvalidConsentRecordError("consentDocHash required");
  for (const s of r.grantedScopes) {
    if (!CONSENT_SCOPES.includes(s)) throw new InvalidConsentRecordError(`unknown scope: ${s}`);
  }
  if (r.kind === "withdraw" && !r.withdrawsRecordId) {
    throw new InvalidConsentRecordError("a withdrawal record must reference the record it revokes");
  }
  if (r.kind === "enrol" && r.withdrawsRecordId) {
    throw new InvalidConsentRecordError("an enrolment record must not reference a revoked record");
  }
}

/**
 * Exact forbidden field names from `hum_spec` §5.4 (`lib/firebase/humPayload.ts`),
 * plus defensive additions. These must never appear in a derived sync payload.
 */
export const FORBIDDEN_RAW_AUDIO_FIELDS: readonly string[] = [
  "audio",
  "audioBlob",
  "audioBuffer",
  "audioData",
  "audioBase64",
  "rawAudio",
  "recording",
  "recordingUrl",
  "file",
  "fileUrl",
  "blob",
  "waveformRaw",
  "microphoneData",
  // Exact-match defensive entries (matched by full, case-insensitive field name).
  // Broad variant coverage (pcmData, pcmBuffer, linearPcm, …) comes from the
  // RAW_AUDIO_TOKENS substring matcher below — raw-audio STEMS belong there, not
  // here. `sampleArray`/`sampleData`/`floatSamples` are listed exactly because a
  // bare `sample` token would false-positive on `sampleRate`/`sampleCount`.
  "pcm",
  "samples",
  "waveform",
  "sampleArray",
  "sampleData",
  "floatSamples",
];

/**
 * Substring tokens that, if found in a field name (case-insensitive), indicate
 * a likely raw-audio carrier. Catches `audioChunk`, `rawWaveform`, `micBlob`,
 * `pcmData`, `pcmBuffer`, `linearPcm`, etc. that an exact list would miss.
 * `pcm` is safe as a token — no benign field name contains it — and subsumes the
 * earlier `rawpcm` entry.
 */
const RAW_AUDIO_TOKENS = ["audio", "waveform", "pcm", "microphone", "micblob", "blob"];

export function isRawAudioFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  if (FORBIDDEN_RAW_AUDIO_FIELDS.some((f) => f.toLowerCase() === lower)) return true;
  return RAW_AUDIO_TOKENS.some((tok) => lower.includes(tok));
}

export class RawAudioFieldError extends Error {
  readonly offendingFields: readonly string[];
  constructor(offendingFields: readonly string[]) {
    super(
      `Sync payload contains forbidden raw-audio field(s): ${offendingFields.join(", ")}. ` +
        `Raw audio must never leave the device unless research_audio_upload consent is granted ` +
        `through the dedicated raw-audio channel (never the derived sync payload).`,
    );
    this.name = "RawAudioFieldError";
    this.offendingFields = offendingFields;
  }
}

/**
 * Recursively scan an object for forbidden raw-audio field names and collect
 * every offender. Arrays are traversed; nested objects are traversed.
 */
export function findRawAudioFields(payload: unknown): string[] {
  const offenders: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isRawAudioFieldName(key)) offenders.push(key);
      visit(child);
    }
  };
  visit(payload);
  return offenders;
}

/**
 * Guard used at the sync boundary. Throws `RawAudioFieldError` if the derived
 * payload carries any raw-audio-like field. This is the last line of defense in
 * `hum_spec` ("Raw audio field in Firestore payload → throws before write").
 */
export function assertNoRawAudioFields(payload: unknown): void {
  const offenders = findRawAudioFields(payload);
  if (offenders.length > 0) throw new RawAudioFieldError(offenders);
}
