/**
 * CLINICAL-STORE (Workstream 2) — local-first-then-cloud persistence for the SANCTIONED
 * clinical channel, on the pseudonym path. Sibling to corpus-store.ts; the existing
 * appendHumCloud/appendLabelCloud (consumer derived sync) are untouched.
 *
 * Writes go to `studies/{studyId}/...` keyed by the client-minted participant pseudonym:
 *   - clinicalExamples  (ClinicalHumExample — derived features + instrument scores)
 *   - phqResponses / gad7Responses (PHI; the sanctioned clinical channel)
 *   - consentRecords    (append-only, versioned ResearchConsentRecord)
 *   - auditLog          (append-only; consent + item-9 escalation + export + deletion)
 *   - participants/{pseudonym} (enrollment + schedule + active consent + withdrawal)
 *
 * PRIVACY FIREWALL: every ClinicalHumExample is re-validated via assertValidClinicalExample
 * (derived-only, ≥1 instrument, in-range) before any local OR cloud write — so no raw-audio
 * field and no malformed instrument can ever enter the store. Raw audio NEVER travels this
 * path; its only egress is research-upload.ts → Firebase Storage. This module NEVER imports
 * @hum-ai/screening-model (ADR-0006 firewall).
 */
import { doc, collection, getDoc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import {
  assertValidClinicalExample,
  type ClinicalHumExample,
  type Phq9Response,
  type Gad7Response,
} from "@hum-ai/affect-model-contracts";
import {
  appendClinicalExample,
  emptyClinicalCorpus,
  parseClinicalCorpus,
  dropParticipant,
  type ClinicalCorpus,
} from "@hum-ai/clinical-corpus";
import {
  assertValidConsentRecord,
  asIsoTimestamp,
  type IsoTimestamp,
  type ResearchConsentRecord,
} from "@hum-ai/shared-types";
import { getFirebase } from "./firebase";
import { plain } from "./util";

const clinicalCorpusKey = (pseudonym: string) => `hum.clinicalCorpus.v1.${pseudonym}`;

function nowMillis(): number {
  return Date.now();
}

// ── latest-screening LOCAL cache (so the consumer Diary/Today can surface a screening band
//    synchronously, with no network/auth). The authoritative PHQ/GAD history stays in Firestore;
//    this is just the most-recent band + when, mirrored locally for the on-device surface. Device-
//    scoped (one key) — the consumer experience is one person per install. Holds NO item-level
//    answers and no free text — only the coarse band + total + timestamp. ──
const LATEST_SCREENING_KEY = "hum.latestScreening.v1";

/** A coarse, surfaceable snapshot of the most recent screening (no item-level detail). */
export interface LatestScreening {
  readonly phq: { readonly total: number; readonly severityBand: Phq9Response["severityBand"]; readonly administeredAt: IsoTimestamp } | null;
  readonly gad: { readonly total: number; readonly severityBand: Gad7Response["severityBand"]; readonly administeredAt: IsoTimestamp } | null;
}

/** Mirror the just-completed screening into the local cache (call after administration). */
export function cacheLatestScreening(phq: Phq9Response | null, gad: Gad7Response | null): void {
  try {
    const snap: LatestScreening = {
      phq: phq ? { total: phq.total, severityBand: phq.severityBand, administeredAt: phq.administeredAt } : null,
      gad: gad ? { total: gad.total, severityBand: gad.severityBand, administeredAt: gad.administeredAt } : null,
    };
    localStorage.setItem(LATEST_SCREENING_KEY, JSON.stringify(snap));
  } catch {
    /* storage unavailable — the surface just shows no screening band */
  }
}

/** Read the locally-cached latest screening, or null if none taken on this device. */
export function loadLatestScreening(): LatestScreening | null {
  try {
    const raw = localStorage.getItem(LATEST_SCREENING_KEY);
    return raw ? (JSON.parse(raw) as LatestScreening) : null;
  } catch {
    return null;
  }
}

// ── participant doc (enrollment + schedule) ───────────────────────────────────
export interface ParticipantDoc {
  readonly studyId: string;
  readonly participantPseudonym: string;
  readonly enrolledAt: IsoTimestamp;
  readonly activeConsentVersion: string;
  readonly activeConsentRecordId: string;
  /** ISO timestamp of the next scheduled instrument administration, or null. */
  readonly nextInstrumentDueAt: IsoTimestamp | null;
  /** Set when the participant withdrew (the doc is retained as a tombstone; data is deleted). */
  readonly withdrawnAt: IsoTimestamp | null;
}

// ── local-first clinical corpus (derived features + instrument scores) ────────
export function loadClinicalCorpusLocal(pseudonym: string): ClinicalCorpus {
  try {
    return parseClinicalCorpus(localStorage.getItem(clinicalCorpusKey(pseudonym)));
  } catch {
    return emptyClinicalCorpus();
  }
}

export function saveClinicalCorpusLocal(pseudonym: string, corpus: ClinicalCorpus): void {
  try {
    localStorage.setItem(clinicalCorpusKey(pseudonym), JSON.stringify(corpus));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
}

/**
 * Append one clinical example: re-validate (privacy firewall), persist locally, then mirror
 * to the cloud clinical channel when reachable. Returns the updated local corpus.
 */
export async function appendClinicalExampleStore(
  pseudonym: string,
  example: ClinicalHumExample,
): Promise<ClinicalCorpus> {
  assertValidClinicalExample(example); // firewall: derived-only, ≥1 instrument, in-range
  const next = appendClinicalExample(loadClinicalCorpusLocal(pseudonym), example);
  saveClinicalCorpusLocal(pseudonym, next);
  await appendClinicalExampleCloud(example);
  return next;
}

/** Mirror one clinical example to `studies/{studyId}/clinicalExamples/{id}`. No-op when unavailable. */
export async function appendClinicalExampleCloud(example: ClinicalHumExample): Promise<void> {
  assertValidClinicalExample(example); // defense in depth at the write boundary
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "studies", example.studyId, "clinicalExamples"), example.id);
    await setDoc(ref, { ...plain(example), syncedAtMs: nowMillis() });
  } catch (err) {
    console.warn("[clinical-store] cloud clinical-example append failed:", err);
  }
}

// ── instrument responses (PHI; sanctioned clinical channel) ───────────────────
/** Append a PHQ-9/PHQ-8 response to `studies/{studyId}/phqResponses/{id}`. */
export async function appendPhqResponseCloud(
  studyId: string,
  pseudonym: string,
  responseId: string,
  phq: Phq9Response,
): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "studies", studyId, "phqResponses"), responseId);
    await setDoc(ref, {
      ...plain(phq),
      studyId,
      participantPseudonym: pseudonym,
      responseId,
      syncedAtMs: nowMillis(),
    });
  } catch (err) {
    console.warn("[clinical-store] cloud PHQ append failed:", err);
  }
}

/** Append a GAD-7 response to `studies/{studyId}/gad7Responses/{id}`. */
export async function appendGad7ResponseCloud(
  studyId: string,
  pseudonym: string,
  responseId: string,
  gad: Gad7Response,
): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "studies", studyId, "gad7Responses"), responseId);
    await setDoc(ref, {
      ...plain(gad),
      studyId,
      participantPseudonym: pseudonym,
      responseId,
      syncedAtMs: nowMillis(),
    });
  } catch (err) {
    console.warn("[clinical-store] cloud GAD-7 append failed:", err);
  }
}

// ── append-only consent log ───────────────────────────────────────────────────
const consentLogKey = (pseudonym: string) => `hum.study.consentLog.v1.${pseudonym}`;

/** Append a versioned ResearchConsentRecord locally + to the append-only cloud log. */
export async function appendConsentRecordCloud(record: ResearchConsentRecord): Promise<void> {
  assertValidConsentRecord(record);
  // Local append-only mirror (so withdrawal/audit survives an offline session).
  try {
    const raw = localStorage.getItem(consentLogKey(record.participantPseudonym));
    const log = raw ? (JSON.parse(raw) as ResearchConsentRecord[]) : [];
    log.push(record);
    localStorage.setItem(consentLogKey(record.participantPseudonym), JSON.stringify(log));
  } catch {
    /* private mode */
  }
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "studies", record.studyId, "consentRecords"), record.recordId);
    await setDoc(ref, { ...plain(record), syncedAtMs: nowMillis() });
  } catch (err) {
    console.warn("[clinical-store] cloud consent-record append failed:", err);
  }
}

// ── append-only audit log ─────────────────────────────────────────────────────
export type AuditEventKind =
  | "consent_granted"
  | "consent_revoked"
  | "instrument_administered"
  | "phq9_item9_escalation"
  | "data_export_requested"
  | "data_deleted";

export interface AuditEvent {
  readonly studyId: string;
  readonly participantPseudonym: string;
  readonly event: AuditEventKind;
  readonly detail: string;
  readonly at: IsoTimestamp;
}

/** Append one append-only audit event to `studies/{studyId}/auditLog/{id}`. */
export async function appendAuditEvent(ev: AuditEvent): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    const id = `${ev.event}-${ev.at}-${Math.random().toString(36).slice(2, 8)}`;
    const ref = doc(collection(fb.db, "studies", ev.studyId, "auditLog"), id);
    await setDoc(ref, { ...plain(ev), syncedAtMs: nowMillis() });
  } catch (err) {
    console.warn("[clinical-store] cloud audit append failed:", err);
  }
}

// ── participant doc r/w ────────────────────────────────────────────────────────
const participantDocKey = (studyId: string, pseudonym: string) => `hum.study.participant.v1.${studyId}.${pseudonym}`;

/** Create / merge the participant doc (enrollment, schedule, withdrawal). Local mirror + cloud. */
export async function upsertParticipantDoc(
  studyId: string,
  pseudonym: string,
  patch: Partial<ParticipantDoc>,
): Promise<void> {
  // Local mirror (so the status surface + schedule work offline).
  try {
    const raw = localStorage.getItem(participantDocKey(studyId, pseudonym));
    const prev = raw ? (JSON.parse(raw) as Partial<ParticipantDoc>) : {};
    localStorage.setItem(participantDocKey(studyId, pseudonym), JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* private mode */
  }
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "studies", studyId, "participants"), pseudonym);
    await setDoc(ref, { ...plain(patch), studyId, participantPseudonym: pseudonym }, { merge: true });
  } catch (err) {
    console.warn("[clinical-store] participant-doc upsert failed:", err);
  }
}

/** Load the participant doc (cloud authoritative; local fallback). Null when neither exists. */
export async function loadParticipantDoc(studyId: string, pseudonym: string): Promise<ParticipantDoc | null> {
  const fb = getFirebase();
  if (fb) {
    try {
      const snap = await getDoc(doc(collection(fb.db, "studies", studyId, "participants"), pseudonym));
      const data = snap.data();
      if (data) return data as ParticipantDoc;
    } catch (err) {
      console.warn("[clinical-store] participant-doc load failed — using local:", err);
    }
  }
  try {
    const raw = localStorage.getItem(participantDocKey(studyId, pseudonym));
    return raw ? (JSON.parse(raw) as ParticipantDoc) : null;
  } catch {
    return null;
  }
}

// ── instrument-history loaders (for the longitudinal dashboard) ──────────────
/** Load this participant's PHQ-9 responses, oldest-first by administration time. */
export async function loadPhqHistory(studyId: string, pseudonym: string): Promise<Phq9Response[]> {
  const fb = getFirebase();
  if (!fb) return [];
  try {
    const snap = await getDocs(collection(fb.db, "studies", studyId, "phqResponses"));
    const out: Phq9Response[] = [];
    snap.forEach((d) => {
      const data = d.data() as Phq9Response & { participantPseudonym?: string };
      if (data.participantPseudonym === pseudonym) out.push(data);
    });
    return out.sort((a, b) => new Date(a.administeredAt).getTime() - new Date(b.administeredAt).getTime());
  } catch (err) {
    console.warn("[clinical-store] PHQ history load failed:", err);
    return [];
  }
}

/** Load this participant's GAD-7 responses, oldest-first by administration time. */
export async function loadGad7History(studyId: string, pseudonym: string): Promise<Gad7Response[]> {
  const fb = getFirebase();
  if (!fb) return [];
  try {
    const snap = await getDocs(collection(fb.db, "studies", studyId, "gad7Responses"));
    const out: Gad7Response[] = [];
    snap.forEach((d) => {
      const data = d.data() as Gad7Response & { participantPseudonym?: string };
      if (data.participantPseudonym === pseudonym) out.push(data);
    });
    return out.sort((a, b) => new Date(a.administeredAt).getTime() - new Date(b.administeredAt).getTime());
  } catch (err) {
    console.warn("[clinical-store] GAD-7 history load failed:", err);
    return [];
  }
}

// ── instrument schedule ─────────────────────────────────────────────────────
/** Standard pilot cadence between scheduled PHQ-9 + GAD-7 administrations (2 weeks). */
export const INSTRUMENT_INTERVAL_DAYS = 14;

/** True when an instrument administration is currently due per the participant doc. */
export function instrumentDue(doc: ParticipantDoc | null): boolean {
  if (!doc || doc.withdrawnAt) return false;
  if (!doc.nextInstrumentDueAt) return true;
  return new Date(doc.nextInstrumentDueAt).getTime() <= Date.now();
}

/** Advance the schedule to the next administration after one is completed. */
export function nextDueAfter(from: IsoTimestamp): IsoTimestamp {
  const next = new Date(from);
  next.setDate(next.getDate() + INSTRUMENT_INTERVAL_DAYS);
  return asIsoTimestamp(next.toISOString());
}

// ── right-to-deletion (Firestore side) ────────────────────────────────────────
/**
 * Delete a withdrawn participant's data across the study Firestore collections (clinical
 * examples, PHQ + GAD responses). Consent + audit records are append-only (retained as the
 * withdrawal audit guarantee). The participant doc is retained as a withdrawn tombstone.
 * Drops the local clinical corpus too. Returns whether the cloud deletion completed.
 */
export async function deleteParticipantData(studyId: string, pseudonym: string): Promise<boolean> {
  // Local side: drop the participant's clinical corpus rows.
  try {
    const local = dropParticipant(loadClinicalCorpusLocal(pseudonym), pseudonym);
    saveClinicalCorpusLocal(pseudonym, local);
    localStorage.removeItem(clinicalCorpusKey(pseudonym));
  } catch {
    /* private mode */
  }

  const fb = getFirebase();
  if (!fb) return true; // local-only: nothing in the cloud to delete
  let ok = true;
  for (const sub of ["clinicalExamples", "phqResponses", "gad7Responses"] as const) {
    try {
      const snap = await getDocs(collection(fb.db, "studies", studyId, sub));
      const deletions: Promise<void>[] = [];
      snap.forEach((d) => {
        const data = d.data() as { participantPseudonym?: string };
        if (data.participantPseudonym === pseudonym) {
          deletions.push(deleteDoc(d.ref));
        }
      });
      await Promise.all(deletions);
    } catch (err) {
      console.warn(`[clinical-store] deletion of ${sub} failed:`, err);
      ok = false;
    }
  }
  // Log the deletion as an append-only audit event (the IRB requires evidence it happened).
  await appendAuditEvent({
    studyId,
    participantPseudonym: pseudonym,
    event: "data_deleted",
    detail: `firestore deletion ${ok ? "complete" : "partial"}`,
    at: asIsoTimestamp(new Date().toISOString()),
  });
  return ok;
}
