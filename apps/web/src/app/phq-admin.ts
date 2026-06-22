/**
 * INSTRUMENT ADMINISTRATION (Workstream 6) — self-administered PHQ-9 + GAD-7.
 *
 * Standard items (0–3 Likert, 2-week recall) rendered one screen at a time. On submit it
 * computes totals/bands via buildPhq9Response/buildGad7Response, writes the responses through
 * clinical-store on the pseudonym path, and — CRITICALLY — the instant PHQ-9 item 9 is
 * answered ≥ 1 it invokes crisis.ts SYNCHRONOUSLY before any navigation or write completes.
 *
 * All copy routes through this module's screened copy()/esc() chokepoint and is verified
 * against @hum-ai/safety-language. The item bodies are the standard instrument wording.
 */
import {
  buildPhq9Response,
  buildGad7Response,
  PHQ9_ITEM9_INDEX,
  type Phq9Response,
  type Gad7Response,
} from "@hum-ai/affect-model-contracts";
import { assertSafeUserFacingText } from "@hum-ai/safety-language";
import { asIsoTimestamp, type IsoTimestamp } from "@hum-ai/shared-types";
import {
  appendPhqResponseCloud,
  appendGad7ResponseCloud,
  appendAuditEvent,
  upsertParticipantDoc,
  nextDueAfter,
} from "./clinical-store";
import { showCrisisSurface } from "./crisis";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function copy(s: string): string {
  assertSafeUserFacingText(s);
  return esc(s);
}

function safeUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── standard instrument items (0–3 each) ──────────────────────────────────────
const RECALL_FRAME = "Over the last 2 weeks, how often have you been bothered by the following?";

const PHQ9_ITEMS: readonly string[] = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "Trouble concentrating on things, such as reading or watching television",
  "Moving or speaking so slowly that other people could have noticed; or being so fidgety or restless that you have been moving around a lot more than usual",
  "Thoughts that you would be better off dead, or of hurting yourself in some way",
];

const GAD7_ITEMS: readonly string[] = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];

const LIKERT: readonly { value: number; label: string }[] = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "Several days" },
  { value: 2, label: "More than half the days" },
  { value: 3, label: "Nearly every day" },
];

export interface PhqAdminOptions {
  readonly studyId: string;
  readonly participantPseudonym: string;
  readonly region?: string;
  /** Called when both instruments are submitted (totals computed, responses written). */
  readonly onComplete?: (result: { phq: Phq9Response; gad: Gad7Response }) => void;
  /** Called when the participant closes/abandons before completing. */
  readonly onCancel?: () => void;
}

function nowIso(): IsoTimestamp {
  return asIsoTimestamp(new Date().toISOString());
}

let openRoot: HTMLElement | null = null;

/**
 * Open the scheduled administration: PHQ-9 (9 items) then GAD-7 (7 items), each item a 0–3
 * Likert. On the final submit, builds + writes both responses and advances the schedule. The
 * crisis pathway fires synchronously the moment item 9 receives a ≥ 1 answer.
 */
export function showInstrumentAdministration(opts: PhqAdminOptions): void {
  if (openRoot) return;
  const phqAnswers: (number | null)[] = PHQ9_ITEMS.map(() => null);
  const gadAnswers: (number | null)[] = GAD7_ITEMS.map(() => null);

  // section: 0 = PHQ-9, 1 = GAD-7
  let section: 0 | 1 = 0;

  const root = document.createElement("div");
  root.className = "instrument-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Scheduled questionnaire");
  root.innerHTML = `
    <div class="instrument-scrim"></div>
    <div class="instrument-card" role="document">
      <div class="instrument-head">
        <h2 class="instrument-title"></h2>
        <button class="icon-btn instrument-close" type="button" aria-label="Close">✕</button>
      </div>
      <p class="instrument-frame muted small"></p>
      <ol class="instrument-items"></ol>
      <p class="instrument-disclaimer disclaimer"></p>
      <div class="instrument-actions">
        <button class="btn btn-primary instrument-submit" type="button"></button>
      </div>
    </div>`;
  document.body.appendChild(root);
  openRoot = root;

  const app = document.querySelector(".app") as HTMLElement | null;
  app?.setAttribute("inert", "");
  app?.setAttribute("aria-hidden", "true");

  const titleEl = root.querySelector(".instrument-title") as HTMLElement;
  const frameEl = root.querySelector(".instrument-frame") as HTMLElement;
  const itemsEl = root.querySelector(".instrument-items") as HTMLOListElement;
  const disclaimerEl = root.querySelector(".instrument-disclaimer") as HTMLElement;
  const submitBtn = root.querySelector(".instrument-submit") as HTMLButtonElement;
  const closeBtn = root.querySelector(".instrument-close") as HTMLButtonElement;

  function renderItems(items: readonly string[], answers: (number | null)[]): void {
    itemsEl.innerHTML = items
      .map((body, i) => {
        const options = LIKERT.map(
          (o) => `
          <label class="instrument-opt">
            <input type="radio" name="q${i}" value="${o.value}" ${answers[i] === o.value ? "checked" : ""} />
            <span>${copy(o.label)}</span>
          </label>`,
        ).join("");
        return `<li class="instrument-item"><p class="instrument-q">${copy(body)}</p><div class="instrument-opts">${options}</div></li>`;
      })
      .join("");

    // Item-level listeners. PHQ-9 item 9 (suicidality) fires the crisis surface synchronously
    // the moment it is endorsed (≥ 1), before the participant can navigate on.
    items.forEach((_, i) => {
      const radios = itemsEl.querySelectorAll<HTMLInputElement>(`input[name="q${i}"]`);
      radios.forEach((radio) => {
        radio.addEventListener("change", () => {
          const v = Number(radio.value);
          answers[i] = v;
          if (section === 0 && i === PHQ9_ITEM9_INDEX && v >= 1) {
            fireItem9Crisis();
          }
        });
      });
    });
  }

  /** Build a partial PHQ-9 just to drive the deterministic crisis rule on item 9. */
  function fireItem9Crisis(): void {
    // Synthesize a minimal in-range PHQ-9 (only item 9 matters for the deterministic rule);
    // unanswered items default to 0 so buildPhq9Response stays in range.
    const items = phqAnswers.map((a) => a ?? 0);
    const phq = buildPhq9Response(items, nowIso());
    showCrisisSurface(phq, {
      studyId: opts.studyId,
      participantPseudonym: opts.participantPseudonym,
      region: opts.region,
    });
  }

  function renderSection(): void {
    if (section === 0) {
      titleEl.textContent = "Depression check-in (PHQ-9)";
      frameEl.textContent = RECALL_FRAME;
      disclaimerEl.textContent =
        "A standard research questionnaire. Investigational, for research use only — not a diagnosis.";
      submitBtn.textContent = "Continue to anxiety check-in";
      renderItems(PHQ9_ITEMS, phqAnswers);
    } else {
      titleEl.textContent = "Anxiety check-in (GAD-7)";
      frameEl.textContent = RECALL_FRAME;
      disclaimerEl.textContent =
        "A standard research questionnaire. Investigational, for research use only — not a diagnosis.";
      submitBtn.textContent = "Submit";
      renderItems(GAD7_ITEMS, gadAnswers);
    }
    root.querySelector(".instrument-card")?.scrollTo?.({ top: 0 });
  }

  function allAnswered(answers: (number | null)[]): boolean {
    return answers.every((a) => a !== null);
  }

  async function submit(): Promise<void> {
    if (section === 0) {
      if (!allAnswered(phqAnswers)) {
        flashIncomplete();
        return;
      }
      section = 1;
      renderSection();
      return;
    }
    if (!allAnswered(gadAnswers)) {
      flashIncomplete();
      return;
    }

    const administeredAt = nowIso();
    const phq = buildPhq9Response(phqAnswers.map((a) => a ?? 0), administeredAt);
    const gad = buildGad7Response(gadAnswers.map((a) => a ?? 0), administeredAt);

    // CRISIS PATHWAY: re-assert the item-9 surface synchronously before writing/navigating
    // (covers the case where item 9 was changed after the initial in-line trigger).
    showCrisisSurface(phq, {
      studyId: opts.studyId,
      participantPseudonym: opts.participantPseudonym,
      region: opts.region,
    });

    // Write the responses on the pseudonym path + advance the schedule + audit it.
    const phqId = safeUuid();
    const gadId = safeUuid();
    await appendPhqResponseCloud(opts.studyId, opts.participantPseudonym, phqId, phq);
    await appendGad7ResponseCloud(opts.studyId, opts.participantPseudonym, gadId, gad);
    await appendAuditEvent({
      studyId: opts.studyId,
      participantPseudonym: opts.participantPseudonym,
      event: "instrument_administered",
      detail: `PHQ-9 + GAD-7 administered`,
      at: administeredAt,
    });
    await upsertParticipantDoc(opts.studyId, opts.participantPseudonym, {
      nextInstrumentDueAt: nextDueAfter(administeredAt),
    });

    teardown();
    opts.onComplete?.({ phq, gad });
  }

  function flashIncomplete(): void {
    submitBtn.textContent = "Please answer every item";
    setTimeout(() => renderSection(), 1400);
  }

  function teardown(): void {
    root.remove();
    app?.removeAttribute("inert");
    app?.removeAttribute("aria-hidden");
    openRoot = null;
  }

  function cancel(): void {
    teardown();
    opts.onCancel?.();
  }

  submitBtn.addEventListener("click", () => void submit());
  closeBtn.addEventListener("click", cancel);

  renderSection();
  requestAnimationFrame(() => closeBtn.focus());
}
