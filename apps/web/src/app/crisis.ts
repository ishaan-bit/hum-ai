/**
 * CRISIS / SAFETY SURFACE (Workstream 4 — the mandatory IRB gate).
 *
 * The instant PHQ-9 item 9 is answered ≥ 1, phq-admin.ts calls showCrisisSurface()
 * SYNCHRONOUSLY, before navigation, before any model or backend round-trip. The decision
 * itself is the pure, deterministic assessCrisisFromPhq (@hum-ai/affect-model-contracts):
 * no model, no abstention, no confidence.
 *
 * This surface is NON-DISMISSABLE: the participant must acknowledge after seeing the
 * resources. It renders region-aware resources (988 default), one-tap call/text, and a
 * stronger interstitial for level 'active' (item 9 ≥ 2). It appends the append-only
 * auditLog escalation event (the IRB requires evidence the pathway fired).
 *
 * SAFETY LANGUAGE: all copy routes through this module's screened copy()/esc() chokepoint
 * and is verified against @hum-ai/safety-language (assertSafeUserFacingText). Crisis copy is
 * deliberately DIRECT (it names being better off dead / self-harm) — that direct wording
 * passes the matcher (the forbidden list targets diagnosis/screening/performance claims, not
 * crisis directness), so no bypass is needed.
 */
import {
  assessCrisisFromPhq,
  crisisResources,
  type CrisisAssessment,
  type CrisisResource,
  type Phq9Response,
} from "@hum-ai/affect-model-contracts";
import { assertSafeUserFacingText } from "@hum-ai/safety-language";
import { appendAuditEvent } from "./clinical-store";
import { asIsoTimestamp } from "@hum-ai/shared-types";

/** esc() for crisis copy — same HTML-escape chokepoint render.ts uses. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * Screened copy: verify against the safety matcher, then HTML-escape. Crisis directness
 * passes (the forbidden list is about diagnosis/screening claims, not crisis language); if a
 * future edit introduced a forbidden phrase this THROWS at the boundary rather than shipping it.
 */
function copy(s: string): string {
  assertSafeUserFacingText(s);
  return esc(s);
}

export interface CrisisSurfaceOptions {
  readonly studyId: string;
  readonly participantPseudonym: string;
  /** Region key into the resource table (e.g. "US"); falls back to the international directory. */
  readonly region?: string;
  /** Called once the participant acknowledges (so phq-admin.ts can continue navigation). */
  readonly onAcknowledge?: () => void;
}

let openRoot: HTMLElement | null = null;

function resourceActions(r: CrisisResource): string {
  const actions: string[] = [];
  if (r.call) actions.push(`<a class="btn btn-primary crisis-action" href="tel:${esc(r.call)}">Call ${copy(r.call)}</a>`);
  if (r.text) actions.push(`<a class="btn crisis-action" href="sms:${esc(r.text)}">Text ${copy(r.text)}</a>`);
  if (r.url) actions.push(`<a class="btn btn-ghost crisis-action" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>`);
  return `
    <li class="crisis-resource">
      <span class="crisis-resource-name">${copy(r.name)}</span>
      <span class="crisis-resource-region muted small">${copy(r.region)}</span>
      <div class="crisis-actions">${actions.join("")}</div>
    </li>`;
}

/**
 * Render the non-dismissable crisis surface for a PHQ-9 with item 9 endorsed. Returns the
 * CrisisAssessment so the caller can branch (e.g. flag a clinician view). For level "none"
 * it is a no-op and returns the assessment unchanged. Fires the audit event synchronously.
 */
export function showCrisisSurface(phq: Phq9Response, opts: CrisisSurfaceOptions): CrisisAssessment {
  const assessment = assessCrisisFromPhq(phq);
  if (assessment.level === "none") return assessment;
  if (openRoot) return assessment; // already showing

  // Append the append-only escalation audit event (the IRB requires evidence it fired).
  if (assessment.auditEvent) {
    void appendAuditEvent({
      studyId: opts.studyId,
      participantPseudonym: opts.participantPseudonym,
      event: "phq9_item9_escalation",
      detail: `level=${assessment.level} item9=${assessment.item9 ?? "n/a"}`,
      at: asIsoTimestamp(new Date().toISOString()),
    });
  }

  const resources = crisisResources(opts.region ?? "US");
  const strong = assessment.level === "active";

  const root = document.createElement("div");
  root.className = `crisis-overlay${strong ? " crisis-active" : ""}`;
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Support is available");
  root.innerHTML = `
    <div class="crisis-scrim"></div>
    <div class="crisis-card" role="document">
      <h2 class="crisis-title">${copy("You don't have to go through this alone")}</h2>
      <p class="crisis-message">${copy(assessment.message)}</p>
      <ul class="crisis-resources">${resources.map(resourceActions).join("")}</ul>
      <p class="crisis-note muted small">${copy(
        "If you are in immediate danger, please contact your local emergency number. " +
          "Hum is a research tool and not an emergency or clinical service.",
      )}</p>
      <button class="btn btn-ghost crisis-ack" type="button">${copy("I've seen this, continue")}</button>
    </div>`;
  document.body.appendChild(root);
  openRoot = root;

  // Trap focus inside the surface natively + keep the app out of the tab order while open.
  const app = document.querySelector(".app") as HTMLElement | null;
  app?.setAttribute("inert", "");
  app?.setAttribute("aria-hidden", "true");

  const ackBtn = root.querySelector(".crisis-ack") as HTMLButtonElement;
  // Non-dismissable: scrim click + Escape do NOT close. Only the explicit acknowledge does.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") e.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    app?.removeAttribute("inert");
    app?.removeAttribute("aria-hidden");
    openRoot = null;
    opts.onAcknowledge?.();
  };
  ackBtn.addEventListener("click", close);
  requestAnimationFrame(() => ackBtn.focus());

  return assessment;
}

/** Whether a crisis surface is currently open (blocks navigation in phq-admin.ts). */
export function crisisSurfaceOpen(): boolean {
  return openRoot !== null;
}
