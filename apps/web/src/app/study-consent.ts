/**
 * STUDY E-CONSENT (Workstream 6) — clinical-grade, multi-step informed consent, distinct from
 * the lightweight consumer onboarding.ts. It walks: purpose → what's collected (derived always;
 * PHQ/GAD under clinical_label_capture; raw audio under research_audio_upload) → retention →
 * withdrawal/deletion rights → the explicit non-clinical/not-a-diagnosis statement → crisis-
 * resources notice → the recorded, versioned acknowledgment. It reuses onboarding's focus-trap /
 * inert / a11y scaffolding pattern.
 *
 * On acknowledgment it returns the chosen scopes + a hash of the exact consent text shown, so
 * the caller (participant.ts enroll) writes a versioned, immutable ResearchConsentRecord. All
 * copy routes through this module's screened copy()/esc() chokepoint (assertSafeUserFacingText).
 */
import { assertSafeUserFacingText } from "@hum-ai/safety-language";
import type { ConsentScope } from "@hum-ai/shared-types";

/** Bump when the consent wording materially changes (drives consentVersion in the record). */
export const STUDY_CONSENT_VERSION = "study-consent-v1";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function copy(s: string): string {
  assertSafeUserFacingText(s);
  return esc(s);
}

/** A small, dependency-free stable hash (FNV-1a) of the exact consent text shown. */
export function hashConsentText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

interface ConsentStep {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly ConsentStep[] = [
  {
    tag: "Why this study",
    title: "You're invited to a research study",
    body: "This is an investigational research study, for research use only. We are studying whether the sound of a daily hum, paired with standard questionnaires, carries a signal related to mood and anxiety over time. Taking part is voluntary, and you can stop at any time.",
  },
  {
    tag: "Not a diagnosis",
    title: "This is not medical care",
    body: "Hum is a research tool, not a medical device and not a clinical service. Nothing here is a diagnosis or medical advice. During the study you will not be shown any score about your mood or anxiety from your hums — that part is blinded while the research is underway. If you are struggling, please reach out to a clinician or a support line.",
  },
  {
    tag: "What we collect",
    title: "What's collected, and what's optional",
    body: "Always: derived sound features from your hum (never the raw recording on this step). Optional, only if you allow it: standard PHQ-9 and GAD-7 questionnaire answers (your study labels), and separately, the raw audio of your hum for the research subset. Each of these is a separate choice below, and you can change them later.",
  },
  {
    tag: "Your data",
    title: "Pseudonymous, retained, and yours to withdraw",
    body: "Your study data is keyed to a random pseudonym minted on this device, never your email. You can withdraw at any time: that stops collection and deletes your study data from the cloud, including any raw audio. Data is retained only for the study and its analysis per the approved protocol.",
  },
  {
    tag: "If a question is hard",
    title: "Support is always one tap away",
    body: "One questionnaire item asks about thoughts of being better off dead or of hurting yourself. If you indicate any such thoughts, support resources (such as the 988 Suicide & Crisis Lifeline in the US) will appear right away. If you are ever in immediate danger, please contact your local emergency number.",
  },
];

export interface StudyConsentChoices {
  /** True = the participant agreed to the core study (derived features + instruments). */
  readonly clinicalLabelCapture: boolean;
  /** True = the participant additionally opted into raw-audio research upload. */
  readonly researchAudioUpload: boolean;
}

export interface StudyConsentResult {
  readonly acknowledged: true;
  readonly consentVersion: string;
  readonly consentDocHash: string;
  readonly grantedScopes: readonly ConsentScope[];
  readonly choices: StudyConsentChoices;
}

export interface StudyConsentOptions {
  /** Resolves with the recorded acknowledgment, or null if the participant declined/closed. */
  readonly onResult: (result: StudyConsentResult | null) => void;
}

let openRoot: HTMLElement | null = null;

/** The exact, full consent text shown (concatenated) — hashed into the immutable record. */
function fullConsentText(): string {
  return STEPS.map((s) => `${s.tag}\n${s.title}\n${s.body}`).join("\n\n");
}

/**
 * Open the multi-step e-consent flow. Reuses the onboarding focus-trap/inert/a11y pattern:
 * inert background, Escape declines, big touch targets. The final step collects the two scope
 * choices and an explicit "I agree" before resolving onResult.
 */
export function showStudyConsent(opts: StudyConsentOptions): void {
  if (openRoot) return;
  let i = 0;

  const root = document.createElement("div");
  root.className = "study-consent";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Research study consent");
  root.innerHTML = `
    <div class="sc-scrim"></div>
    <div class="sc-card" role="document">
      <p class="sc-tag"></p>
      <h2 class="sc-title"></h2>
      <p class="sc-body"></p>
      <div class="sc-choices" hidden>
        <label class="sc-toggle">
          <input type="checkbox" id="sc-clinical" />
          <span>${copy("I agree to take part: my derived hum features and my PHQ-9 / GAD-7 answers may be collected for this research study.")}</span>
        </label>
        <label class="sc-toggle">
          <input type="checkbox" id="sc-audio" />
          <span>${copy("Optional: I also allow the raw audio of my hums to be uploaded for the research subset. (You can take part without this.)")}</span>
        </label>
      </div>
      <div class="sc-progress" aria-hidden="true"></div>
      <div class="sc-actions">
        <button class="btn btn-ghost sc-decline" type="button">${copy("Not now")}</button>
        <button class="btn btn-primary sc-next" type="button">${copy("Next")}</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  openRoot = root;

  const app = document.querySelector(".app") as HTMLElement | null;
  const tray = document.getElementById("tray");
  const lastFocus = (document.activeElement as HTMLElement | null) ?? null;
  for (const el of [app, tray]) {
    el?.setAttribute("inert", "");
    el?.setAttribute("aria-hidden", "true");
  }

  const tagEl = root.querySelector(".sc-tag") as HTMLElement;
  const titleEl = root.querySelector(".sc-title") as HTMLElement;
  const bodyEl = root.querySelector(".sc-body") as HTMLElement;
  const choicesEl = root.querySelector(".sc-choices") as HTMLElement;
  const clinicalInput = root.querySelector("#sc-clinical") as HTMLInputElement;
  const audioInput = root.querySelector("#sc-audio") as HTMLInputElement;
  const progressEl = root.querySelector(".sc-progress") as HTMLElement;
  const nextBtn = root.querySelector(".sc-next") as HTMLButtonElement;
  const declineBtn = root.querySelector(".sc-decline") as HTMLButtonElement;

  progressEl.innerHTML = STEPS.map(() => `<span class="sc-dot"></span>`).join("") + `<span class="sc-dot"></span>`;
  const dots = Array.from(progressEl.querySelectorAll<HTMLElement>(".sc-dot"));
  const lastStep = STEPS.length; // the final "agree" step is index === STEPS.length

  function onAgreeStep(): boolean {
    return i >= lastStep;
  }

  function render(): void {
    const agree = onAgreeStep();
    if (agree) {
      tagEl.textContent = "Your choice";
      titleEl.textContent = "Confirm what you agree to";
      bodyEl.textContent =
        "You can take part with just the questionnaires and derived features, and optionally add raw-audio upload. Tick what you agree to, then confirm.";
      choicesEl.hidden = false;
      nextBtn.textContent = "I agree and enroll";
      nextBtn.disabled = !clinicalInput.checked;
    } else {
      const s = STEPS[i]!;
      tagEl.textContent = s.tag;
      titleEl.textContent = s.title;
      bodyEl.textContent = s.body;
      choicesEl.hidden = true;
      nextBtn.textContent = i === lastStep - 1 ? "Review choices" : "Next";
      nextBtn.disabled = false;
    }
    dots.forEach((d, n) => d.classList.toggle("on", n === i));
    nextBtn.focus();
  }

  function teardown(): void {
    document.removeEventListener("keydown", onKey);
    root.remove();
    for (const el of [app, tray]) {
      el?.removeAttribute("inert");
      el?.removeAttribute("aria-hidden");
    }
    openRoot = null;
    lastFocus?.focus?.();
  }

  function decline(): void {
    teardown();
    opts.onResult(null);
  }

  function confirm(): void {
    const grantedScopes: ConsentScope[] = ["clinical_label_capture"];
    if (audioInput.checked) grantedScopes.push("research_audio_upload");
    const result: StudyConsentResult = {
      acknowledged: true,
      consentVersion: STUDY_CONSENT_VERSION,
      consentDocHash: hashConsentText(fullConsentText()),
      grantedScopes,
      choices: {
        clinicalLabelCapture: true,
        researchAudioUpload: audioInput.checked,
      },
    };
    teardown();
    opts.onResult(result);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") decline();
    else if (e.key === "ArrowRight" && i < lastStep) {
      i += 1;
      render();
    } else if (e.key === "ArrowLeft" && i > 0) {
      i -= 1;
      render();
    }
  };
  document.addEventListener("keydown", onKey);

  clinicalInput.addEventListener("change", () => {
    if (onAgreeStep()) nextBtn.disabled = !clinicalInput.checked;
  });
  nextBtn.addEventListener("click", () => {
    if (onAgreeStep()) {
      if (clinicalInput.checked) confirm();
      return;
    }
    i += 1;
    render();
  });
  declineBtn.addEventListener("click", decline);
  (root.querySelector(".sc-scrim") as HTMLElement).addEventListener("click", decline);

  render();
}
