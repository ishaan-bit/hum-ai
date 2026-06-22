/**
 * Breath pacer — a follow-along breathing animation tied to the user's read.
 *
 * When today's step is breath regulation, the user can FOLLOW a visible pacer for three cycles
 * instead of just reading instructions. The pacing is shaped by the read's AROUSAL: a more
 * activated read gets a longer exhale (the paced-/extended-exhale that down-regulates arousal —
 * the same "longer out-breath" technique the intervention copy names). A calmer read gets an
 * even in/out. Respects `prefers-reduced-motion` (cues still advance; the orb just doesn't scale).
 *
 * Pure DOM, no dependencies. `createBreathPacer(host, opts)` renders into `host` and returns a
 * handle; calling `start()` runs the cycles, `stop()` cancels and resets.
 */

export interface BreathPacerOptions {
  /** The read's arousal in [-1, 1] — higher → a longer exhale. */
  readonly arousal: number;
  /** Number of full breath cycles to guide (default 3). */
  readonly cycles?: number;
}

export interface BreathPacer {
  start(): void;
  stop(): void;
  /** Remove timers + DOM (call when the card is re-rendered for a new hum). */
  destroy(): void;
}

interface Phase {
  readonly label: string;
  readonly seconds: number;
  /** Target scale of the breathing disc for this phase. */
  readonly scale: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Build the phase plan. Higher arousal ⇒ longer exhale (down-regulation). */
function phasesFor(arousal: number): Phase[] {
  const a = clamp01((arousal + 1) / 2); // 0 settled → 1 activated
  const inhale = 4;
  const hold = 1.5;
  const exhale = Math.round((5 + a * 3) * 10) / 10; // 5s (calm) → 8s (activated)
  return [
    { label: "Breathe in", seconds: inhale, scale: 1 },
    { label: "Hold", seconds: hold, scale: 1 },
    { label: "Breathe out, slowly", seconds: exhale, scale: 0.42 },
  ];
}

export function createBreathPacer(host: HTMLElement, opts: BreathPacerOptions): BreathPacer {
  const cycles = opts.cycles ?? 3;
  const phases = phasesFor(opts.arousal);
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  host.innerHTML = `
    <div class="breath" data-state="idle">
      <div class="breath-stage">
        <div class="breath-disc"><span class="breath-cue">Ready</span></div>
      </div>
      <div class="breath-controls">
        <button type="button" class="btn btn-sm btn-primary breath-begin">Follow along · ${cycles} breaths</button>
        <button type="button" class="btn btn-sm btn-ghost breath-stop" hidden>Stop</button>
      </div>
      <p class="breath-count muted small" aria-live="polite"></p>
    </div>`;

  const root = host.querySelector(".breath") as HTMLElement;
  const disc = host.querySelector(".breath-disc") as HTMLElement;
  const cue = host.querySelector(".breath-cue") as HTMLElement;
  const count = host.querySelector(".breath-count") as HTMLElement;
  const beginBtn = host.querySelector(".breath-begin") as HTMLButtonElement;
  const stopBtn = host.querySelector(".breath-stop") as HTMLButtonElement;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  function reset(): void {
    clearTimer();
    running = false;
    root.dataset.state = "idle";
    disc.style.transition = "";
    disc.style.transform = "scale(0.6)";
    cue.textContent = "Ready";
    count.textContent = "";
    beginBtn.hidden = false;
    stopBtn.hidden = true;
  }

  function runPhase(cycle: number, phaseIdx: number): void {
    if (!running) return;
    if (phaseIdx >= phases.length) {
      if (cycle + 1 >= cycles) {
        finish();
        return;
      }
      count.textContent = `Breath ${cycle + 2} of ${cycles}`;
      runPhase(cycle + 1, 0);
      return;
    }
    const phase = phases[phaseIdx]!;
    cue.textContent = phase.label;
    // Drive the disc smoothly over the phase's duration (snap instantly if reduced-motion).
    disc.style.transition = reduced ? "none" : `transform ${phase.seconds}s cubic-bezier(0.4, 0, 0.2, 1)`;
    disc.style.transform = `scale(${phase.scale})`;
    timer = setTimeout(() => runPhase(cycle, phaseIdx + 1), phase.seconds * 1000);
  }

  function finish(): void {
    clearTimer();
    running = false;
    root.dataset.state = "done";
    disc.style.transition = reduced ? "none" : "transform 1.2s ease";
    disc.style.transform = "scale(0.6)";
    cue.textContent = "✓";
    count.textContent = "Nicely done. Notice how that landed.";
    beginBtn.hidden = false;
    beginBtn.textContent = "Again";
    stopBtn.hidden = true;
  }

  function start(): void {
    if (running) return;
    running = true;
    root.dataset.state = "running";
    beginBtn.hidden = true;
    stopBtn.hidden = false;
    count.textContent = `Breath 1 of ${cycles}`;
    runPhase(0, 0);
  }

  beginBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", reset);
  reset();

  return {
    start,
    stop: reset,
    destroy(): void {
      clearTimer();
      running = false;
      host.innerHTML = "";
    },
  };
}
