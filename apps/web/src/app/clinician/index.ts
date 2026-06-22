/**
 * CLINICIAN READ-PROJECTION (Workstream 6) — the "partner site plugs in later" surface.
 *
 * A READ-ONLY projection per pseudonym: instrument history summary, capture compliance,
 * PHQ-9 item-9 escalation flags, and an audit summary. Gated by a `clinician` custom claim
 * scoped to the projection's studyId (enforced both here and by the Firestore rules on
 * `clinicianViews/{pseudonym}`, which allow client reads only and deny client writes — the
 * projection is materialised server-side by trusted backend code).
 *
 * FIREWALL: this reads ONLY the sanctioned `clinicianViews` projection — NEVER raw audio,
 * NEVER the screening model (@hum-ai/screening-model is offline-only, ADR-0006). It does not
 * compute scores; it surfaces the materialised summary. All copy routes through the screened
 * copy()/esc() chokepoint.
 */
import { doc, collection, getDoc } from "firebase/firestore";
import { assertSafeUserFacingText } from "@hum-ai/safety-language";
import { getFirebase } from "../firebase";
import { loadStudyClaims } from "../participant";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function copy(s: string): string {
  assertSafeUserFacingText(s);
  return esc(s);
}

/**
 * The materialised clinician projection. Mirrors `clinicianViews/{pseudonym}`; the backend
 * populates it. Deliberately a SUMMARY (counts, bands, flags) — never raw audio, never the
 * derived feature vectors, never a screening probability.
 */
export interface ClinicianView {
  readonly studyId: string;
  readonly participantPseudonym: string;
  /** Number of completed PHQ-9 + GAD-7 administrations. */
  readonly instrumentCount: number;
  /** Most recent PHQ-9 / GAD-7 severity bands (words only). */
  readonly latestPhqBand: string | null;
  readonly latestGad7Band: string | null;
  /** Eligible hum captures / scheduled captures — compliance, as counts. */
  readonly capturesCompleted: number;
  readonly capturesScheduled: number;
  /** Number of PHQ-9 item-9 escalations recorded (the safety flag the IRB requires visible). */
  readonly item9EscalationCount: number;
  /** Last few audit-event summaries (event + ISO time), most recent last. */
  readonly auditSummary: readonly { readonly event: string; readonly at: string }[];
  /** ISO timestamp this projection was last materialised. */
  readonly updatedAt: string;
}

/**
 * Load the clinician projection for a pseudonym, enforcing the clinician claim client-side
 * (defense in depth; the rules also enforce it). Returns null when not authorised / no data.
 */
export async function loadClinicianView(studyId: string, pseudonym: string): Promise<ClinicianView | null> {
  const claims = await loadStudyClaims();
  if (!claims.isClinician || (claims.studyId && claims.studyId !== studyId)) return null;
  const fb = getFirebase();
  if (!fb) return null;
  try {
    const snap = await getDoc(doc(collection(fb.db, "clinicianViews"), pseudonym));
    const data = snap.data();
    if (!data) return null;
    return data as ClinicianView;
  } catch (err) {
    console.warn("[clinician] view load failed:", err);
    return null;
  }
}

function flag(label: string, value: string, tone: "ok" | "warn" | "info"): string {
  return `<div class="clin-flag clin-${tone}"><span class="clin-k">${copy(label)}</span><span class="clin-v">${copy(value)}</span></div>`;
}

/**
 * Render a clinician's read-only projection into a container. Shows an "unauthorised" notice
 * when the clinician claim is absent, so the surface fails closed.
 */
export async function renderClinicianView(
  container: HTMLElement,
  studyId: string,
  pseudonym: string,
): Promise<void> {
  const view = await loadClinicianView(studyId, pseudonym);
  if (!view) {
    container.innerHTML = `<div class="clinician-view"><p class="muted">${copy(
      "No clinician projection available, or this view requires a clinician account scoped to the study.",
    )}</p></div>`;
    return;
  }

  const escalationTone = view.item9EscalationCount > 0 ? "warn" : "ok";
  const compliance = view.capturesScheduled > 0
    ? `${view.capturesCompleted} of ${view.capturesScheduled}`
    : `${view.capturesCompleted}`;

  const audit = view.auditSummary.length
    ? `<ul class="clin-audit">${view.auditSummary
        .map((e) => `<li><span class="clin-audit-ev">${copy(e.event.replace(/_/g, " "))}</span> <span class="muted small">${copy(e.at)}</span></li>`)
        .join("")}</ul>`
    : `<p class="muted small">${copy("No audit events recorded yet.")}</p>`;

  container.innerHTML = `
    <div class="clinician-view">
      <h3>${copy("Participant projection")} <span class="muted small">${copy(pseudonym)}</span></h3>
      <div class="clin-flags">
        ${flag("Instruments completed", String(view.instrumentCount), "info")}
        ${flag("Latest PHQ-9 band", view.latestPhqBand ? view.latestPhqBand.replace(/_/g, " ") : "—", "info")}
        ${flag("Latest GAD-7 band", view.latestGad7Band ? view.latestGad7Band.replace(/_/g, " ") : "—", "info")}
        ${flag("Capture compliance", compliance, "info")}
        ${flag("Item-9 escalations", String(view.item9EscalationCount), escalationTone)}
      </div>
      <h4>${copy("Audit summary")}</h4>
      ${audit}
      <p class="disclaimer">${copy(
        "Read-only research projection. Derived summary only — no raw audio, no calculated screening result.",
      )}</p>
    </div>`;
}
