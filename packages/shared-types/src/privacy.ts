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
  "derived_feature_sync", // upload derived feature summaries only (no raw audio)
  "research_audio_upload", // upload raw audio for research — explicit opt-in
  "clinical_label_capture", // capture PHQ/GAD/CES-DC etc. — explicit research consent
  "clinical_risk_surfacing", // surface anxiety/depressive/relapse risk markers to the user — explicit opt-in (ADR-0006)
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
  // defensive additions (substring matcher also covers variants):
  "pcm",
  "samples",
  "waveform",
];

/**
 * Substring tokens that, if found in a field name (case-insensitive), indicate
 * a likely raw-audio carrier. Catches `audioChunk`, `rawWaveform`, `micBlob`,
 * etc. that an exact list would miss.
 */
const RAW_AUDIO_TOKENS = ["audio", "waveform", "rawpcm", "microphone", "micblob", "blob"];

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
