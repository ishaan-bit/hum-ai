/**
 * STUDY UI ORCHESTRATION (Workstreams 2 + 6) — owns every research surface and keeps the
 * consumer experience 100% intact. A NON-PARTICIPANT sees only a single "learn about the
 * study" entry; all study surfaces (status, schedule, dashboard, manage/withdraw, export) are
 * gated behind enrollment (clinical_label_capture).
 *
 * Flow: learn → study-consent.ts (e-consent) → participant.ts enroll → status surface with the
 * due instrument → phq-admin.ts (PHQ-9 + GAD-7, crisis pathway) → the next eligible hum is
 * paired into a ClinicalHumExample written via clinical-store, and raw audio (if opted in) goes
 * out the research-upload channel ONLY. dashboard.ts renders the blinded trajectory.
 *
 * This module NEVER imports @hum-ai/screening-model (ADR-0006 firewall).
 */
import type { AudioInput, AcousticFeatures } from "@hum-ai/audio-features";
import {
  type ClinicalHumExample,
  type Phq9Response,
  type Gad7Response,
} from "@hum-ai/affect-model-contracts";
import {
  asIsoTimestamp,
  clamp01,
  type ConsentState,
  type IsoTimestamp,
} from "@hum-ai/shared-types";
import { isGranted, setScope, STUDY_SCOPES, type ToggleableScope } from "./consent";
import {
  loadStudyStatus,
  enroll,
  withdrawParticipant,
  resumeStudySignIn,
  beginStudySignIn,
  participantPseudonym,
  type StudyStatus,
} from "./participant";
import { showStudyConsent, STUDY_CONSENT_VERSION } from "./study-consent";
import { showInstrumentAdministration } from "./phq-admin";
import { renderDashboard } from "./dashboard";
import {
  appendClinicalExampleStore,
  appendAuditEvent,
  instrumentDue,
  type ParticipantDoc,
} from "./clinical-store";
import { uploadRawAudio } from "./research-upload";

/** The single pilot study id (a partner site overrides via build env later). */
const STUDY_ID = import.meta.env.HUM_AI_STUDY_ID ?? "hum-pilot-001";

/** Feature-vector schema version stamped on each clinical example (migration guard). */
const FEATURE_SCHEMA_VERSION = "hum-features-v1";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function nowIso(): IsoTimestamp {
  return asIsoTimestamp(new Date().toISOString());
}
function safeUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Coarse, non-identifying device class for QUADAS-2 spectrum coverage. */
function deviceClass(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios_safari";
  if (/Android/i.test(ua)) return "android_chrome";
  if (/Macintosh/i.test(ua)) return "macos_desktop";
  if (/Windows/i.test(ua)) return "windows_desktop";
  return "other";
}

export interface StudyUiHooks {
  /** Current device-local consent (so study scopes can be reflected/toggled). */
  readonly getConsent: () => ConsentState;
  /** Persist a consent change made through a study surface (mirrors main.ts's path). */
  readonly setConsent: (next: ConsentState) => void;
  /** Stop any in-flight capture immediately (used by withdrawal). */
  readonly stopCapture?: () => void;
  /** A within-user, already-screened qualitative hum-trend line for the dashboard (optional). */
  readonly relapseLine?: () => string | null;
}

let hooks: StudyUiHooks | null = null;
let cachedStatus: StudyStatus | null = null;
/** Set true after an instrument session, so the NEXT eligible hum is paired as a clinical row. */
let awaitingPairedHum = false;
/** The instruments from the most recent session, awaiting pairing with a hum. */
let pendingInstruments: { phq: Phq9Response | null; gad: Gad7Response | null } | null = null;

/** Whether the current device/identity is an enrolled study participant. */
export function isEnrolledParticipant(): boolean {
  return Boolean(cachedStatus?.enrolledLocally || cachedStatus?.claims.isParticipant);
}

/**
 * Boot the study layer: complete a returning email-link sign-in (durable identity), resolve
 * status, and render the study surface. Safe to call unconditionally on app boot — a
 * non-participant just sees the "learn about the study" entry.
 */
export async function initStudyUi(h: StudyUiHooks): Promise<void> {
  hooks = h;
  await resumeStudySignIn().catch(() => null);
  cachedStatus = await loadStudyStatus().catch(() => null);
  wire();
  await renderSurface();
}

function wire(): void {
  document.getElementById("btn-study-join")?.addEventListener("click", () => void startConsentFlow());
}

async function refreshStatus(): Promise<void> {
  cachedStatus = await loadStudyStatus().catch(() => cachedStatus);
  await renderSurface();
}

// ── the study-status surface (rendered into #study-surface) ───────────────────
async function renderSurface(): Promise<void> {
  const surface = document.getElementById("study-surface");
  if (!surface) return;

  if (!isEnrolledParticipant()) {
    surface.innerHTML = `
      <p class="muted small">A pre-registered, investigational research study. For research use only, not a diagnosis. You can take part, or just keep using Hum as usual.</p>
      <button id="btn-study-join" class="btn btn-sm btn-primary">Learn about the study</button>`;
    document.getElementById("btn-study-join")?.addEventListener("click", () => void startConsentFlow());
    return;
  }

  const consent = hooks?.getConsent();
  const audioOptIn = consent ? isGranted(consent, "research_audio_upload") : false;
  const doc = cachedStatus?.participant ?? null;
  const due = instrumentDue(doc);
  const nextDue = doc?.nextInstrumentDueAt ? new Date(doc.nextInstrumentDueAt) : null;
  const dueLine = due
    ? `<p class="study-due"><strong>A scheduled check-in is due.</strong></p>`
    : nextDue
      ? `<p class="muted small">Next check-in: ${esc(nextDue.toLocaleDateString())}.</p>`
      : `<p class="muted small">No check-in scheduled right now.</p>`;

  surface.innerHTML = `
    <p class="study-status-line"><span class="chip chip-on">✓ Enrolled</span> <span class="muted small">investigational · for research use only · not a diagnosis</span></p>
    ${dueLine}
    <div class="study-actions controls">
      ${due ? `<button id="btn-study-instrument" class="btn btn-sm btn-primary">Start scheduled check-in</button>` : ""}
      <button id="btn-study-dashboard" class="btn btn-sm">View my trajectory</button>
      <button id="btn-study-export" class="btn btn-sm btn-ghost">Request my data</button>
    </div>
    <label class="toggle study-audio-toggle">
      <input type="checkbox" id="study-consent-audio" ${audioOptIn ? "checked" : ""} />
      <span>Also upload the <strong>raw audio</strong> of my hums for the research subset. Optional; you can take part without this.</span>
    </label>
    <div id="study-dashboard" class="study-dashboard" hidden></div>
    <details class="study-manage">
      <summary>Manage / withdraw</summary>
      <p class="muted small">Withdrawing stops collection and deletes your study data (including any raw audio) from the cloud. Your consent version on file: ${esc(doc?.activeConsentVersion ?? STUDY_CONSENT_VERSION)}.</p>
      <button id="btn-study-withdraw" class="btn btn-sm btn-ghost">Withdraw &amp; delete my data</button>
    </details>`;

  if (due) document.getElementById("btn-study-instrument")?.addEventListener("click", () => launchInstrument());
  document.getElementById("btn-study-dashboard")?.addEventListener("click", () => void showDashboard());
  document.getElementById("btn-study-export")?.addEventListener("click", () => void requestExport());
  document.getElementById("btn-study-withdraw")?.addEventListener("click", () => void doWithdraw());
  document.getElementById("study-consent-audio")?.addEventListener("change", (e) =>
    toggleAudioConsent((e.target as HTMLInputElement).checked),
  );
}

// ── consent → enroll ──────────────────────────────────────────────────────────
async function startConsentFlow(): Promise<void> {
  showStudyConsent({
    onResult: (result) => {
      if (!result) return;
      void (async () => {
        // Reflect the chosen study scopes into device-local consent (same persistence path).
        // The study e-consent only ever grants the study scopes; narrow to the toggleable set.
        if (hooks) {
          let consent = hooks.getConsent();
          const studyScopes = new Set<ToggleableScope>(STUDY_SCOPES);
          for (const scope of result.grantedScopes) {
            if (studyScopes.has(scope as ToggleableScope)) consent = setScope(consent, scope as ToggleableScope, true);
          }
          hooks.setConsent(consent);
        }
        await enroll({
          studyId: STUDY_ID,
          consentVersion: result.consentVersion,
          consentDocHash: result.consentDocHash,
          grantedScopes: result.grantedScopes,
        });
        await refreshStatus();
      })();
    },
  });
  // Durable identity: best-effort prompt for an email-link sign-in so longitudinal linkage +
  // right-to-deletion work across sessions. Non-blocking; enrollment proceeds locally regardless.
  void promptDurableSignIn();
}

async function promptDurableSignIn(): Promise<void> {
  if (cachedStatus?.signedIn) return;
  if (typeof window === "undefined" || typeof window.prompt !== "function") return;
  const email = window.prompt(
    "Optional: enter your email to receive a secure sign-in link, so your study data stays linked across devices and can be deleted on request. Leave blank to stay on this device only.",
  );
  if (email && email.includes("@")) await beginStudySignIn(email.trim());
}

// ── scheduled instrument ────────────────────────────────────────────────────
function launchInstrument(): void {
  showInstrumentAdministration({
    studyId: STUDY_ID,
    participantPseudonym: cachedStatus?.pseudonym ?? participantPseudonym(),
    onComplete: ({ phq, gad }) => {
      // Arm clinical-example pairing: the next eligible hum becomes the paired feature row.
      pendingInstruments = { phq, gad };
      awaitingPairedHum = true;
      void refreshStatus();
    },
  });
}

// ── pair a hum capture into a ClinicalHumExample (called from main.ts per hum) ──
export interface CaptureContext {
  readonly features: AcousticFeatures;
  readonly captureQuality: number;
  readonly eligible: boolean;
  /** The ephemeral raw audio, tapped before release — used ONLY when raw upload is consented. */
  readonly audio: AudioInput;
}

/**
 * Offer one hum capture to the study channel. Only acts for an enrolled participant who has a
 * pending instrument session to pair against. Writes a derived ClinicalHumExample (firewall:
 * derived-only, validated) and, ONLY when research_audio_upload is consented, sends the raw
 * audio out the isolated research-upload channel. No-op for non-participants.
 */
export async function offerCaptureToStudy(ctx: CaptureContext): Promise<void> {
  if (!isEnrolledParticipant() || !awaitingPairedHum || !pendingInstruments) return;
  const consent = hooks?.getConsent();
  if (!consent || !isGranted(consent, "clinical_label_capture")) return;

  const pseudonym = cachedStatus?.pseudonym ?? participantPseudonym();
  const captureId = safeUuid();
  const example: ClinicalHumExample = {
    id: captureId,
    participantPseudonym: pseudonym,
    studyId: STUDY_ID,
    capturedAt: nowIso(),
    features: ctx.features,
    phq: pendingInstruments.phq,
    gad: pendingInstruments.gad,
    captureQualityScore: clamp01(ctx.captureQuality),
    eligible: ctx.eligible,
    deviceClass: deviceClass(),
    stratum: "adult_general",
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  };

  try {
    // DERIVED channel (Firestore) — re-validated in the store (firewall).
    await appendClinicalExampleStore(pseudonym, example);

    // RAW-AUDIO channel (Storage) — ONLY when separately opted in; physically isolated.
    if (isGranted(consent, "research_audio_upload")) {
      await uploadRawAudio({
        studyId: STUDY_ID,
        participantPseudonym: pseudonym,
        captureId,
        audio: ctx.audio,
        consent,
      });
    }
  } catch (err) {
    console.warn("[study-ui] clinical pairing failed:", err);
  } finally {
    // One hum pairs one instrument session.
    awaitingPairedHum = false;
    pendingInstruments = null;
  }
}

// ── dashboard ────────────────────────────────────────────────────────────────
async function showDashboard(): Promise<void> {
  const mount = document.getElementById("study-dashboard");
  if (!mount) return;
  mount.hidden = false;
  mount.innerHTML = `<p class="muted small">Loading your trajectory…</p>`;
  await renderDashboard(mount, {
    studyId: STUDY_ID,
    participantPseudonym: cachedStatus?.pseudonym ?? participantPseudonym(),
    relapseLine: hooks?.relapseLine?.() ?? null,
  });
}

// ── consent management ─────────────────────────────────────────────────────────
function toggleAudioConsent(on: boolean): void {
  if (!hooks) return;
  const next = setScope(hooks.getConsent(), "research_audio_upload", on);
  hooks.setConsent(next);
}

// ── data export request (logged to the audit trail) ──────────────────────────
async function requestExport(): Promise<void> {
  const pseudonym = cachedStatus?.pseudonym ?? participantPseudonym();
  await appendAuditEvent({
    studyId: STUDY_ID,
    participantPseudonym: pseudonym,
    event: "data_export_requested",
    detail: "participant requested a copy of their study data",
    at: nowIso(),
  });
  const surface = document.getElementById("study-surface");
  const note = surface?.querySelector(".study-export-note");
  if (note) note.remove();
  surface?.insertAdjacentHTML(
    "beforeend",
    `<p class="study-export-note muted small">Your request was recorded. The study team will send a copy of your data to your enrolled contact.</p>`,
  );
}

// ── withdrawal ──────────────────────────────────────────────────────────────
async function doWithdraw(): Promise<void> {
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    const ok = window.confirm(
      "Withdraw from the study? This stops collection and permanently deletes your study data, including any uploaded raw audio. This cannot be undone.",
    );
    if (!ok) return;
  }
  const doc: ParticipantDoc | null = cachedStatus?.participant ?? null;
  const consent = hooks?.getConsent();
  const grantedScopes = consent
    ? consent.grantedScopes.filter((s) => s === "clinical_label_capture" || s === "research_audio_upload")
    : [];
  await withdrawParticipant({
    studyId: STUDY_ID,
    revokesRecordId: doc?.activeConsentRecordId ?? "unknown",
    grantedScopes,
    stopCapture: hooks?.stopCapture,
  });
  // Revoke the study scopes from device-local consent too.
  if (hooks) {
    let next = hooks.getConsent();
    next = setScope(next, "clinical_label_capture", false);
    next = setScope(next, "research_audio_upload", false);
    hooks.setConsent(next);
  }
  await refreshStatus();
}
