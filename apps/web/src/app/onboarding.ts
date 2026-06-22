/**
 * First-landing walkthrough — a short, skippable guide so a brand-new user knows what a "hum"
 * is, how to do it, and what they'll get back. It ENDS on a consent step: microphone-permission
 * priming (asked in a warm, explained context, not cold on the first Hum tap) plus an optional,
 * opt-in "notice changes early" longitudinal toggle. Shown once (localStorage flag); re-openable
 * from the instrument tray. Accessible: traps focus while open (inert background), Escape/skip
 * dismiss, honors prefers-reduced-motion, big touch targets.
 */
const KEY = "hum.onboarded.v3";

interface Slide {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  /** The final slide collects consent + primes the mic instead of just advancing. */
  readonly kind?: "consent";
}

const SLIDES: readonly Slide[] = [
  {
    tag: "The ritual",
    title: "Meet your hum",
    body: "Once a day, hum one steady note for about twelve seconds. Hum AI reads your inner state from the sound — entirely on your device.",
  },
  {
    tag: "How it works",
    title: "Hum, and the world tunes to you",
    body: "Hold the glowing orb and let a soft, even note out while the ring fills. The whole screen shifts to match how you sound. No mic handy? You can simulate a hum from the ☰ menu.",
  },
  {
    tag: "Why daily",
    title: "Small check-ins, an early heads-up",
    body: "One hum is a snapshot. Day by day, Hum learns your usual — so it can gently notice when your pattern drifts, and offer one small, research-informed step. Reflective support, never a diagnosis.",
  },
  {
    tag: "Before we begin",
    title: "Your voice stays yours",
    body: "Hum needs your microphone to hear the note. The sound is read on this device and the raw audio never leaves it.",
    kind: "consent",
  },
];

export interface OnboardingOptions {
  /** Called when the tour finishes or is skipped (e.g. focus the Hum button). */
  readonly onDone?: () => void;
  /**
   * Prime microphone permission from the consent step (a user gesture). Resolves to whether
   * access was granted; the tour proceeds either way. Omit to skip mic priming.
   */
  readonly onRequestMic?: () => Promise<boolean>;
  /** Persist the consent choices the user made on the final step. */
  readonly onConsent?: (choices: { readonly longitudinal: boolean }) => void;
  /** Initial checked-state for the longitudinal opt-in (so re-opening reflects current consent). */
  readonly initialLongitudinal?: boolean;
}

let openEls: { root: HTMLElement } | null = null;

interface InertSnap {
  readonly inert: boolean;
  readonly ariaHidden: string | null;
}
function snapshot(el: HTMLElement | null): InertSnap | null {
  return el ? { inert: el.hasAttribute("inert"), ariaHidden: el.getAttribute("aria-hidden") } : null;
}
/** Trap a background region: inert (focus + pointer) AND aria-hidden (screen readers), paired. */
function trap(el: HTMLElement | null): void {
  if (!el) return;
  el.setAttribute("inert", "");
  el.setAttribute("aria-hidden", "true");
}
/** Restore a region to EXACTLY its pre-tour state (so we never clobber the stage's tray policy). */
function restoreInert(el: HTMLElement | null, snap: InertSnap | null): void {
  if (!el || !snap) return;
  if (snap.inert) el.setAttribute("inert", "");
  else el.removeAttribute("inert");
  if (snap.ariaHidden === null) el.removeAttribute("aria-hidden");
  else el.setAttribute("aria-hidden", snap.ariaHidden);
}

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function maybeShowOnboarding(opts: OnboardingOptions = {}): void {
  if (!hasOnboarded()) showOnboarding(opts);
}

export function showOnboarding(opts: OnboardingOptions = {}): void {
  if (openEls) return; // already open
  let i = 0;

  const root = document.createElement("div");
  root.className = "tour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "How Hum AI works");
  root.innerHTML = `
    <div class="tour-scrim"></div>
    <div class="tour-card">
      <div class="tour-orb" aria-hidden="true"></div>
      <p class="tour-tag"></p>
      <h2 class="tour-title"></h2>
      <p class="tour-body"></p>
      <div class="tour-consent" hidden>
        <ul class="tour-privacy">
          <li><span class="tp-ic" aria-hidden="true">🔒</span> Read on-device · raw audio never uploaded</li>
          <li><span class="tp-ic" aria-hidden="true">🙂</span> No account needed · nothing leaves unless you ask</li>
        </ul>
        <label class="tour-toggle">
          <input type="checkbox" id="tour-consent-longitudinal" />
          <span><strong>Notice changes early.</strong> Let Hum follow how your pattern shifts across days, so it can gently flag a drift from your usual. On-device, opt-in, non-diagnostic — you can turn it off anytime.</span>
        </label>
      </div>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions">
        <button class="btn btn-ghost btn-sm tour-skip" type="button">Skip</button>
        <button class="btn btn-primary tour-next" type="button">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const app = document.querySelector(".app") as HTMLElement | null;
  const tray = document.getElementById("tray");
  const lastFocus = (document.activeElement as HTMLElement | null) ?? null;
  // Snapshot prior trap state and restore it exactly on close (the tray's inert/aria-hidden is
  // normally owned by the stage; the tour must not clobber whatever state it was in).
  const snapApp = snapshot(app);
  const snapTray = snapshot(tray);
  trap(app);
  trap(tray);
  openEls = { root };

  // Keydown on document (not root) so Escape/arrows work even if focus lands on <body>.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" && i < SLIDES.length - 1) {
      i += 1;
      render();
    } else if (e.key === "ArrowLeft" && i > 0) {
      i -= 1;
      render();
    }
  };
  document.addEventListener("keydown", onKey);

  const tagEl = root.querySelector(".tour-tag") as HTMLElement;
  const titleEl = root.querySelector(".tour-title") as HTMLElement;
  const bodyEl = root.querySelector(".tour-body") as HTMLElement;
  const consentEl = root.querySelector(".tour-consent") as HTMLElement;
  const longitudinalInput = root.querySelector("#tour-consent-longitudinal") as HTMLInputElement;
  const dotsEl = root.querySelector(".tour-dots") as HTMLElement;
  const nextBtn = root.querySelector(".tour-next") as HTMLButtonElement;
  const skipBtn = root.querySelector(".tour-skip") as HTMLButtonElement;

  longitudinalInput.checked = Boolean(opts.initialLongitudinal);

  dotsEl.innerHTML = SLIDES.map(() => `<span class="tour-dot"></span>`).join("");
  const dots = Array.from(dotsEl.querySelectorAll<HTMLElement>(".tour-dot"));

  function render(): void {
    const s = SLIDES[i]!;
    const isConsent = s.kind === "consent";
    tagEl.textContent = s.tag;
    titleEl.textContent = s.title;
    bodyEl.textContent = s.body;
    consentEl.hidden = !isConsent;
    dots.forEach((d, n) => d.classList.toggle("on", n === i));
    nextBtn.textContent = isConsent ? "Allow microphone & begin" : "Next";
    skipBtn.textContent = isConsent ? "Not now" : "Skip";
    skipBtn.hidden = false;
    nextBtn.focus();
  }

  function persistOnboarded(): void {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode — tour just won't be remembered */
    }
  }

  function teardown(): void {
    document.removeEventListener("keydown", onKey);
    root.remove();
    restoreInert(app, snapApp);
    restoreInert(tray, snapTray);
    openEls = null;
    lastFocus?.focus?.();
    opts.onDone?.();
  }

  /** Skip / dismiss without acting on consent. */
  function close(): void {
    persistOnboarded();
    teardown();
  }

  /** Finish the consent step: record the opt-in, prime the mic (best-effort), then leave. */
  async function finishConsent(): Promise<void> {
    persistOnboarded();
    opts.onConsent?.({ longitudinal: longitudinalInput.checked });
    nextBtn.disabled = true;
    nextBtn.textContent = "Setting up…";
    try {
      await opts.onRequestMic?.();
    } catch {
      /* permission flow is best-effort; we proceed regardless */
    }
    teardown();
  }

  nextBtn.addEventListener("click", () => {
    if (SLIDES[i]?.kind === "consent") {
      void finishConsent();
    } else if (i < SLIDES.length - 1) {
      i += 1;
      render();
    } else {
      close();
    }
  });
  skipBtn.addEventListener("click", close);
  (root.querySelector(".tour-scrim") as HTMLElement).addEventListener("click", close);

  render();
}
