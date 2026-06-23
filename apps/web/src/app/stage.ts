/**
 * The windowed stage — the friction-free main path is four windows the user moves through:
 *
 *   hum   → YOUR INNER STATE → TODAY'S SUGGESTION → YOUR DIARY OF HUMS
 *
 * One continuous world (the orb + atmosphere persist beneath); only the foreground content
 * changes. Navigation has THREE redundant affordances (never swipe-only, for accessibility and
 * large screens): horizontal swipe, tappable dots, and explicit Next/Back buttons — plus arrow
 * keys. The Diary tab makes the longitudinal "pattern over time" a first-class destination
 * (it used to be buried at the bottom of the State window). The deeper diagnostic surfaces live
 * in a pull-up "instrument tray" (bottom sheet on phones, side panel on large screens).
 */
export type Step = "hum" | "state" | "today" | "diary";
const ORDER: readonly Step[] = ["hum", "state", "today", "diary"];

export interface Stage {
  go(step: Step): void;
  current(): Step;
  /** After the first usable read, the state + today windows become reachable. */
  unlock(): void;
  /** Re-lock the state/today windows (e.g. on reset) and return to the Hum window. */
  lock(): void;
  openTray(): void;
  closeTray(): void;
}

export interface StageOptions {
  /** Called whenever the active window changes (so the orb can re-anchor / re-mode). */
  onStep?: (step: Step) => void;
  /** Called when the tray opens (so deeper panels can be (re)rendered lazily). */
  onTrayOpen?: () => void;
}

export function createStage(opts: StageOptions = {}): Stage {
  const stage = document.getElementById("stage");
  const dots = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-goto]"));
  const tray = document.getElementById("tray");
  const appEl = document.querySelector(".app") as HTMLElement | null;
  let step: Step = "hum";
  let unlocked = false;
  let lastFocus: HTMLElement | null = null;

  // `inert` removes a subtree from focus + AT entirely. We inert the tray while closed (so its
  // controls aren't tabbable off-screen) and inert the app while the tray is open (so focus is
  // trapped inside the sheet natively — no manual Tab loop needed on modern engines).
  const setInert = (el: HTMLElement | null, on: boolean): void => {
    if (!el) return;
    if (on) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  };

  const reachable = (s: Step): boolean => s === "hum" || unlocked;

  function reflect(): void {
    if (stage) stage.dataset.step = step;
    const idx = ORDER.indexOf(step);
    for (const d of dots) {
      const target = d.dataset.goto as Step | undefined;
      const on = target === step;
      d.setAttribute("aria-current", on ? "step" : "false");
      d.classList.toggle("on", on);
      d.disabled = !!target && !reachable(target);
    }
    // Next/Back enablement.
    document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((b) => {
      const dir = b.dataset.nav;
      if (dir === "next") b.toggleAttribute("hidden", idx >= ORDER.length - 1 || !unlocked);
      if (dir === "back") b.toggleAttribute("hidden", idx <= 0);
    });
  }

  function go(next: Step): void {
    if (!reachable(next)) return;
    step = next;
    reflect();
    opts.onStep?.(step);
  }

  function shift(delta: number): void {
    const idx = ORDER.indexOf(step);
    const ni = Math.max(0, Math.min(ORDER.length - 1, idx + delta));
    const target = ORDER[ni];
    if (target) go(target);
  }

  // ── dots + explicit nav buttons ──────────────────────────────────────────────
  for (const d of dots) {
    d.addEventListener("click", () => {
      const t = d.dataset.goto as Step | undefined;
      if (t) go(t);
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => shift(b.dataset.nav === "next" ? 1 : -1));
  });

  // ── swipe (pointer events; axis-locked so vertical scroll still works) ────────
  if (stage) {
    let sx = 0;
    let sy = 0;
    let tracking = false;
    let axis: "x" | "y" | null = null;
    stage.addEventListener(
      "pointerdown",
      (e) => {
        // Don't hijack swipes that begin on a control or inside the tray.
        if ((e.target as HTMLElement).closest("button, a, input, label, #tray, .meter, [data-no-swipe]")) return;
        sx = e.clientX;
        sy = e.clientY;
        tracking = true;
        axis = null;
      },
      { passive: true },
    );
    stage.addEventListener(
      "pointermove",
      (e) => {
        if (!tracking) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (axis === null && Math.hypot(dx, dy) > 12) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "y") tracking = false;
      },
      { passive: true },
    );
    const end = (e: PointerEvent): void => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      if (axis === "x" && Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
    };
    stage.addEventListener("pointerup", end, { passive: true });
    stage.addEventListener("pointercancel", () => (tracking = false), { passive: true });
  }

  // ── keyboard ──────────────────────────────────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") shift(1);
    else if (e.key === "ArrowLeft") shift(-1);
    else if (e.key === "Escape") closeTray();
  });

  // ── instrument tray ─────────────────────────────────────────────────────────
  function openTray(): void {
    if (!tray) return;
    lastFocus = (document.activeElement as HTMLElement | null) ?? null;
    tray.classList.add("open");
    setInert(tray, false);
    tray.setAttribute("aria-hidden", "false");
    setInert(appEl, true); // trap focus inside the sheet, hide the app from AT
    opts.onTrayOpen?.();
    (document.getElementById("tray-close") as HTMLElement | null)?.focus();
  }
  function closeTray(): void {
    if (!tray) return;
    tray.classList.remove("open");
    setInert(appEl, false);
    setInert(tray, true);
    lastFocus?.focus?.(); // return focus to whatever opened the tray (e.g. #tray-handle)
  }
  document.getElementById("tray-handle")?.addEventListener("click", openTray);
  document.getElementById("tray-close")?.addEventListener("click", closeTray);
  document.getElementById("tray-scrim")?.addEventListener("click", closeTray);

  setInert(tray, true); // closed at boot — keep its controls out of the tab order
  reflect();
  opts.onStep?.(step);

  return {
    go,
    current: () => step,
    unlock(): void {
      unlocked = true;
      reflect();
    },
    lock(): void {
      unlocked = false;
      go("hum");
    },
    openTray,
    closeTray,
  };
}
