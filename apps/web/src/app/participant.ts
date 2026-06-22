/**
 * DURABLE PARTICIPANT IDENTITY (Workstream 2) — the study-side identity layer.
 *
 * Consumers stay anonymous + local-first (unchanged). A study PARTICIPANT additionally:
 *   - signs in with a passwordless email link (durable identity for longitudinal
 *     linkage + right-to-deletion) — see firebase.ts sendStudySignInLink/completeEmailLinkSignIn;
 *   - is keyed in ALL study data by a CLIENT-MINTED pseudonym (never the email/uid),
 *     so the re-identification map lives only in the participant-management backend;
 *   - holds a `studyParticipant` custom claim (minted server-side) that gates the rules.
 *
 * This module owns: minting + persisting the pseudonym, exposing study status (claims +
 * enrollment), and `withdrawParticipant()` — which stops capture, deletes data across
 * Firestore + Storage, appends an append-only withdrawal ResearchConsentRecord + audit
 * event, and signs out. It NEVER imports the screening model (ADR-0006 firewall).
 */
import {
  asIsoTimestamp,
  type IsoTimestamp,
  type ResearchConsentRecord,
} from "@hum-ai/shared-types";
import {
  currentUser,
  getClaims,
  isReturningEmailLink,
  completeEmailLinkSignIn,
  sendStudySignInLink,
  signOutStudy,
} from "./firebase";
import {
  appendConsentRecordCloud,
  appendAuditEvent,
  deleteParticipantData,
  loadParticipantDoc,
  upsertParticipantDoc,
  type ParticipantDoc,
} from "./clinical-store";
import { deleteParticipantAudio } from "./research-upload";

const PSEUDONYM_KEY = "hum.study.pseudonym.v1";
const ENROLLED_KEY = "hum.study.enrolled.v1";

function nowIso(): IsoTimestamp {
  return asIsoTimestamp(new Date().toISOString());
}

/** crypto.randomUUID needs a secure context; fall back so the path works on plain HTTP. */
function safeUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The client-minted study pseudonym. Minted once per device-install and persisted; it is
 * the ONLY participant identifier that travels with study data. Prefixed so it can never be
 * mistaken for an email/uid (assertValidClinicalExample rejects pseudonyms containing "@").
 */
export function participantPseudonym(): string {
  try {
    let p = localStorage.getItem(PSEUDONYM_KEY);
    if (!p) {
      p = `pp-${safeUuid()}`;
      localStorage.setItem(PSEUDONYM_KEY, p);
    }
    return p;
  } catch {
    // In-memory fallback (private mode): still non-identifying + stable for the session.
    return `pp-session-${safeUuid()}`;
  }
}

/** Whether this device has a minted pseudonym + recorded an enrollment (local flag). */
export function hasEnrolledLocally(): boolean {
  try {
    return localStorage.getItem(ENROLLED_KEY) === "1";
  } catch {
    return false;
  }
}

function markEnrolledLocally(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENROLLED_KEY, "1");
    else localStorage.removeItem(ENROLLED_KEY);
  } catch {
    /* private mode */
  }
}

/** The custom claims that gate study/clinician surfaces (read-only on the client). */
export interface StudyClaims {
  readonly isParticipant: boolean;
  readonly isClinician: boolean;
  readonly isStudyAdmin: boolean;
  readonly studyId: string | null;
  readonly pseudonym: string | null;
}

/** Resolve the durable identity's study claims (minted server-side). */
export async function loadStudyClaims(forceRefresh = false): Promise<StudyClaims> {
  const claims = await getClaims(forceRefresh);
  return {
    isParticipant: claims.studyParticipant === true,
    isClinician: claims.clinician === true,
    isStudyAdmin: claims.studyAdmin === true,
    studyId: typeof claims.studyId === "string" ? claims.studyId : null,
    pseudonym: typeof claims.pseudonym === "string" ? claims.pseudonym : null,
  };
}

/** A snapshot of the participant's current study standing, for the status surface. */
export interface StudyStatus {
  readonly signedIn: boolean;
  readonly enrolledLocally: boolean;
  readonly claims: StudyClaims;
  readonly pseudonym: string;
  readonly participant: ParticipantDoc | null;
}

/**
 * Resolve the participant's full status: durable sign-in, claims, the local pseudonym, and
 * the cloud participant doc (enrollment + schedule + active consent version) when reachable.
 */
export async function loadStudyStatus(): Promise<StudyStatus> {
  const claims = await loadStudyClaims();
  const pseudonym = claims.pseudonym ?? participantPseudonym();
  const participant = claims.studyId ? await loadParticipantDoc(claims.studyId, pseudonym) : null;
  return {
    signedIn: currentUser() !== null,
    enrolledLocally: hasEnrolledLocally(),
    claims,
    pseudonym,
    participant,
  };
}

/**
 * Complete a returning email-link sign-in (the durable-identity round-trip). Call on boot;
 * returns the uid when a link was completed, else null. `promptedEmail` covers the
 * cross-device / private-mode case where the email wasn't stashed locally.
 */
export async function resumeStudySignIn(promptedEmail?: string): Promise<string | null> {
  if (!isReturningEmailLink()) return null;
  return completeEmailLinkSignIn(promptedEmail);
}

/** Begin the durable-identity flow: email a passwordless sign-in link. */
export async function beginStudySignIn(email: string): Promise<boolean> {
  return sendStudySignInLink(email);
}

export interface EnrollInput {
  readonly studyId: string;
  readonly consentVersion: string;
  readonly consentDocHash: string;
  readonly grantedScopes: ResearchConsentRecord["grantedScopes"];
}

/**
 * Record enrollment: write the participant doc, append the append-only ENROL consent
 * record, and log an audit event. The `studyParticipant` claim itself is minted
 * server-side from this enrollment; we force-refresh claims afterward so the client
 * sees the new grant. Returns the enrolment ResearchConsentRecord.
 */
export async function enroll(input: EnrollInput): Promise<ResearchConsentRecord> {
  const pseudonym = participantPseudonym();
  const signedAt = nowIso();
  const record: ResearchConsentRecord = {
    recordId: safeUuid(),
    participantPseudonym: pseudonym,
    studyId: input.studyId,
    consentVersion: input.consentVersion,
    consentDocHash: input.consentDocHash,
    grantedScopes: input.grantedScopes,
    signedAt,
    kind: "enrol",
    withdrawsRecordId: null,
  };

  await upsertParticipantDoc(input.studyId, pseudonym, {
    studyId: input.studyId,
    participantPseudonym: pseudonym,
    enrolledAt: signedAt,
    activeConsentVersion: input.consentVersion,
    activeConsentRecordId: record.recordId,
    withdrawnAt: null,
    nextInstrumentDueAt: signedAt, // first instrument is due immediately on enrollment
  });
  await appendConsentRecordCloud(record);
  await appendAuditEvent({
    studyId: input.studyId,
    participantPseudonym: pseudonym,
    event: "consent_granted",
    detail: `enrol · consent ${input.consentVersion} · scopes ${input.grantedScopes.join(",")}`,
    at: signedAt,
  });
  markEnrolledLocally(true);
  // Pick up the freshly-minted studyParticipant claim (best-effort).
  await loadStudyClaims(true).catch(() => undefined);
  return record;
}

export interface WithdrawResult {
  readonly withdrawalRecord: ResearchConsentRecord;
  readonly dataDeleted: boolean;
}

/**
 * RIGHT-TO-WITHDRAWAL + DELETION. Stops capture (the caller passes a `stopCapture` hook),
 * deletes the participant's data across Firestore + Storage, appends the append-only
 * WITHDRAW consent record + audit event, clears local study state, and signs the durable
 * identity out. The withdrawal references the enrolment record it revokes (the audit
 * guarantee). Resolves with the recorded withdrawal + whether cloud deletion succeeded.
 */
export async function withdrawParticipant(opts: {
  readonly studyId: string;
  readonly revokesRecordId: string;
  readonly grantedScopes: ResearchConsentRecord["grantedScopes"];
  readonly stopCapture?: () => void;
}): Promise<WithdrawResult> {
  // 1. Stop any ongoing capture immediately (no new data once withdrawal begins).
  opts.stopCapture?.();

  const pseudonym = participantPseudonym();
  const withdrawnAt = nowIso();

  // 2. Append the WITHDRAW record FIRST (append-only audit guarantee) + audit event,
  //    so the withdrawal is recorded even if deletion is partially incomplete.
  const withdrawalRecord: ResearchConsentRecord = {
    recordId: safeUuid(),
    participantPseudonym: pseudonym,
    studyId: opts.studyId,
    consentVersion: "withdrawal",
    consentDocHash: "withdrawal",
    grantedScopes: opts.grantedScopes,
    signedAt: withdrawnAt,
    kind: "withdraw",
    withdrawsRecordId: opts.revokesRecordId,
  };
  await appendConsentRecordCloud(withdrawalRecord);
  await appendAuditEvent({
    studyId: opts.studyId,
    participantPseudonym: pseudonym,
    event: "consent_revoked",
    detail: `withdraw · revokes ${opts.revokesRecordId}`,
    at: withdrawnAt,
  });

  // 3. Mark the participant doc withdrawn, then delete data across Firestore + Storage.
  await upsertParticipantDoc(opts.studyId, pseudonym, { withdrawnAt }).catch(() => undefined);
  const firestoreDeleted = await deleteParticipantData(opts.studyId, pseudonym);
  const audioDeleted = await deleteParticipantAudio(opts.studyId, pseudonym);

  // 4. Clear local study state + sign out the durable identity.
  markEnrolledLocally(false);
  clearLocalStudyState();
  await signOutStudy();

  return { withdrawalRecord, dataDeleted: firestoreDeleted && audioDeleted };
}

/** Clear the device-local study state (pseudonym + enrollment flag) after withdrawal. */
export function clearLocalStudyState(): void {
  try {
    localStorage.removeItem(PSEUDONYM_KEY);
    localStorage.removeItem(ENROLLED_KEY);
  } catch {
    /* private mode */
  }
}
