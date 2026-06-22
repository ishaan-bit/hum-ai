/**
 * THE AURA ORB — one luminous orb that IS the user's inner state made visible.
 *
 * A single full-bleed Canvas 2D layer, one requestAnimationFrame loop, that morphs across four
 * modes without ever being re-created (it is the shared element that travels between windows):
 *
 *   - resting    : a slow, dim, cool "pilot light" — alive but neutral, between hums.
 *   - capturing  : the live hum visualizer. Mic level inflates it, voicing fills it with light
 *                  and pulls motes in from the screen edges, detected pitch draws a floating tone
 *                  line, and a thin ring traces the 12-second timer.
 *   - revealed   : reborn in the read. Valence sets hue/warmth + posture, arousal sets the
 *                  breathing tempo + glow reach, and the evidence band sets how sharply it
 *                  resolves (a faint read looks pale + hazy; an abstain becomes a hollow ring).
 *   - abstain    : a translucent pearl-grey listening ring — "didn't catch a hum, try again".
 *
 * Performance discipline (WebView / iOS Safari): only transform-free Canvas drawing on the hot
 * path, glow built from radial gradients (never per-frame CSS filter:blur / box-shadow), a capped
 * particle pool, delta-time clamping so a janked frame can't fast-forward the world, and the loop
 * pauses on tab blur / visibilitychange to save battery. Honors prefers-reduced-motion.
 */
import { NEUTRAL_VISUAL, type StateVisual } from "./theme";
import type { CaptureLevel } from "./capture";

export type OrbMode = "resting" | "capturing" | "revealed" | "abstain";

export interface Orb {
  start(): void;
  stop(): void;
  resize(): void;
  setMode(mode: OrbMode): void;
  /** Animate the orb toward a new inner-state visual (THE TUNING bloom on reveal). */
  setVisual(v: StateVisual): void;
  /** Move/size the orb's anchor as the active window changes (normalized 0..1; size 0.3..1). */
  setAnchor(x: number, y: number, size?: number): void;
  /** Feed live capture telemetry (~20 Hz). Pass null when recording stops. */
  pushLevel(level: CaptureLevel | null): void;
  /** A one-shot satisfied pulse — fired when a 12s capture completes. */
  pulse(): void;
}

interface Mote {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number; // 1 → 0
  active: boolean;
}

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate-independent exponential approach (rate ≈ fraction closed per 60fps frame). */
const approach = (cur: number, tgt: number, rate: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.pow(1 - rate, dt * 60));

/** Map a detected pitch (≈70–500 Hz, log scale) to a 0..1 band; null → mid. */
function pitchNorm(hz: number | null): number {
  if (!hz || hz <= 0) return 0.5;
  const lo = Math.log(70);
  const hi = Math.log(500);
  return clamp((Math.log(clamp(hz, 70, 500)) - lo) / (hi - lo), 0, 1);
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A mutable mirror of StateVisual so the hot path can update fields in place (no per-frame alloc). */
type MutableVisual = { -readonly [K in keyof StateVisual]: StateVisual[K] };
function assignVisual(dst: MutableVisual, src: StateVisual): void {
  dst.valence = src.valence;
  dst.arousal = src.arousal;
  dst.evidence = src.evidence;
  dst.hue = src.hue;
  dst.sat = src.sat;
  dst.light = src.light;
  dst.reach = src.reach;
  dst.energy = src.energy;
  dst.abstained = src.abstained;
}

export function createOrb(canvas: HTMLCanvasElement): Orb {
  const ctx = canvas.getContext("2d", { alpha: true });
  let dpr = 1;
  let w = 0;
  let h = 0;

  let mode: OrbMode = "resting";
  // Animated ("cur") vs target ("tgt") visual — the gap closes over ~1.2s for THE TUNING bloom.
  const cur: MutableVisual = { ...NEUTRAL_VISUAL };
  const tgt: MutableVisual = { ...NEUTRAL_VISUAL };
  const reduced = prefersReducedMotion();
  // Redraw gating: under reduced motion (and idle resting) we stop burning frames on a static image.
  let dirty = true;
  let lastDrawT = 0;
  const markDirty = (): void => {
    dirty = true;
  };

  // Orb placement (normalized anchor + relative size), eased so window changes glide.
  const anchor = { x: 0.5, y: 0.46, size: 1 };
  const place = { x: 0.5, y: 0.46, size: 1 };

  // Capture telemetry (eased).
  let level = 0; // 0..1
  let pN = 0.5; // pitch band 0..1
  let voiced = 0; // 0..1 eased
  let fraction = 0; // 12s timer 0..1
  let capturing = false;

  let breathe = 0; // breathing phase accumulator
  let ripplePhase = 0; // traveling-ripple phase (0..1), staggered rings across the surface
  let pulseT = 0; // one-shot pulse envelope 1 → 0
  let last = 0;
  let raf = 0;
  let running = false;

  // History of recent levels for the faint "sonogram" behind the orb (~8s @ ~60fps target).
  const HISTORY = 120;
  const history = new Float32Array(HISTORY);
  let hHead = 0;

  // Capped mote pool.
  const MAX_MOTES = 28;
  const motes: Mote[] = Array.from({ length: MAX_MOTES }, () => ({
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, active: false,
  }));

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    markDirty();
  }

  function spawnMote(cx: number, cy: number): void {
    const m = motes.find((x) => !x.active);
    if (!m) return;
    // Start somewhere out near the screen edge, aimed at the core.
    const ang = Math.random() * TAU;
    const dist = Math.max(w, h) * (0.55 + Math.random() * 0.55);
    m.x = cx + Math.cos(ang) * dist;
    m.y = cy + Math.sin(ang) * dist;
    m.px = m.x;
    m.py = m.y;
    const toC = Math.atan2(cy - m.y, cx - m.x);
    const speed = (Math.max(w, h) / 60) * (0.7 + Math.random() * 0.7);
    m.vx = Math.cos(toC) * speed;
    m.vy = Math.sin(toC) * speed;
    m.life = 1;
    m.active = true;
  }

  function hsl(v: StateVisual, dl: number, alpha: number): string {
    const l = clamp(v.light + dl, 4, 92);
    return `hsla(${v.hue.toFixed(1)}, ${v.sat.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha.toFixed(3)})`;
  }

  function draw(dt: number): void {
    if (!ctx) return;

    // Ease animated visual toward target IN PLACE — quick enough to feel like a "tuning", smooth
    // enough to feel alive, zero per-frame allocation. Hue is wrapped-safe (the arc never crosses 0°).
    const er = mode === "revealed" ? 0.06 : 0.05;
    cur.valence = approach(cur.valence, tgt.valence, er, dt);
    cur.arousal = approach(cur.arousal, tgt.arousal, er, dt);
    cur.evidence = approach(cur.evidence, tgt.evidence, er, dt);
    cur.hue = approach(cur.hue, tgt.hue, er, dt);
    cur.sat = approach(cur.sat, tgt.sat, er, dt);
    cur.light = approach(cur.light, tgt.light, er, dt);
    cur.reach = approach(cur.reach, tgt.reach, er, dt);
    cur.energy = approach(cur.energy, tgt.energy, er, dt);
    cur.abstained = tgt.abstained;

    // Ease placement.
    place.x = approach(place.x, anchor.x, 0.08, dt);
    place.y = approach(place.y, anchor.y, 0.08, dt);
    place.size = approach(place.size, anchor.size, 0.08, dt);

    // Breathing — period shortens with arousal; a captured/pulsing orb breathes a touch deeper.
    const period = reduced ? 1e9 : lerp(5.5, 3.0, cur.energy);
    breathe += (dt / period) * TAU;
    const breatheAmp = reduced ? 0 : lerp(0.045, 0.075, cur.energy);
    const breath = 1 + Math.sin(breathe) * breatheAmp;

    // Traveling ripples advance faster with arousal; a fresh pulse sends one racing out.
    if (!reduced) ripplePhase = (ripplePhase + dt / lerp(3.6, 1.9, cur.energy)) % 1;

    if (pulseT > 0) pulseT = Math.max(0, pulseT - dt * 1.6);

    const cx = place.x * w;
    const cy = place.y * h;
    // Cap so the orb stays a focused presence on big/desktop screens (not a wall of glow).
    const baseR = Math.min(Math.min(w, h) * 0.27, 210) * place.size;
    // Level inflates the orb during capture; the satisfied pulse adds a brief swell.
    const inflate = capturing ? 1 + level * 0.5 : 1;
    const r = baseR * breath * inflate * (1 + pulseT * 0.12);

    ctx.clearRect(0, 0, w, h);

    // Posture: pleasant pools light toward the top (buoyant), subdued sinks it (weighted).
    const postureY = -cur.valence * r * 0.28;

    drawHistory(ctx, cx, cy, r);

    if (mode === "abstain" || cur.abstained) {
      drawHollowRing(ctx, cx, cy, r);
    } else {
      drawHalo(ctx, cx, cy, r);
      drawCore(ctx, cx, cy + postureY, r);
      drawRipples(ctx, cx, cy, r);
      drawSheen(ctx, cx, cy + postureY, r);
      drawRim(ctx, cx, cy, r);
      if (mode !== "resting") drawGrain(ctx, cx, cy, r); // grain is invisible on a static resting orb
    }

    if (capturing) {
      drawMotes(ctx, cx, cy, r, dt);
      drawPitchLine(ctx, cx, cy, r);
      drawTimerRing(ctx, cx, cy, r);
    }
  }

  function drawHistory(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    if (!capturing) return;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineWidth = 1.5;
    const span = r * 2.6;
    for (let s = -1; s <= 1; s += 2) {
      c.beginPath();
      for (let i = 0; i < HISTORY; i++) {
        const idx = (hHead + i) % HISTORY;
        const lv = history[idx] ?? 0;
        const x = cx - span / 2 + (i / (HISTORY - 1)) * span;
        const y = cy + s * (8 + lv * r * 0.9);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.strokeStyle = hsl(cur, 30, 0.1);
      c.stroke();
    }
    c.restore();
  }

  function drawHalo(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const reachR = r * (1 + cur.reach * 1.7);
    const g = c.createRadialGradient(cx, cy, r * 0.2, cx, cy, reachR);
    const strength = lerp(0.18, 0.5, cur.evidence) * (0.6 + cur.energy * 0.6);
    g.addColorStop(0, hsl(cur, 22, strength));
    g.addColorStop(0.5, hsl(cur, 8, strength * 0.4));
    g.addColorStop(1, hsl(cur, 0, 0));
    c.save();
    c.globalCompositeOperation = "lighter";
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, reachR, 0, TAU);
    c.fill();
    c.restore();
  }

  function drawCore(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const g = c.createRadialGradient(cx, cy - r * 0.18, r * 0.05, cx, cy, r);
    const coreA = lerp(0.5, 0.96, cur.evidence);
    const fill = capturing ? lerp(0.35, 0.96, voiced) : 1;
    g.addColorStop(0, hsl(cur, 40, coreA * fill));
    g.addColorStop(0.55, hsl(cur, 14, coreA * fill * 0.92));
    g.addColorStop(0.9, hsl(cur, -2, coreA * fill * 0.5));
    g.addColorStop(1, hsl(cur, -6, 0));
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fill();
  }

  function drawRim(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    // A SINGLE soft rim hugging the core — edge definition = confidence (crisp at clear,
    // diffuse at developing). The old second offset ring read as a "radar target", so it's
    // gone; the luminous halo + core carry the glow, the rim just gives the sphere an edge.
    const sharp = cur.evidence;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.beginPath();
    const seg = 64;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      // Surface shimmer: a faint harmonic whose frequency rises with arousal.
      const shimmer = reduced ? 0 : Math.sin(a * 6 + breathe * (1 + cur.energy * 2)) * r * 0.01 * cur.energy;
      const rad = r + shimmer;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (s === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.lineWidth = lerp(0.6, 1.8, sharp);
    c.strokeStyle = hsl(cur, lerp(18, 46, sharp), lerp(0.1, 0.58, sharp));
    c.stroke();
    c.restore();
  }

  function drawGrain(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    if (reduced) return;
    c.save();
    c.globalCompositeOperation = "lighter";
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const rad = Math.sqrt(Math.random()) * r * 0.92;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      c.fillStyle = hsl(cur, 46, 0.05 + Math.random() * 0.05);
      c.fillRect(x, y, 1.4, 1.4);
    }
    c.restore();
  }

  /** Concentric ripples traveling out through the orb's surface — the "living, humming" signature. */
  function drawRipples(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    if (reduced) return;
    c.save();
    c.beginPath();
    c.arc(cx, cy, r * 1.02, 0, TAU); // clip so ripples dissolve at the rim
    c.clip();
    c.globalCompositeOperation = "lighter";
    const intensity = capturing ? 0.4 + voiced * 0.6 : 1;
    // ONE living ripple (was three concentric rings — the "radar sweep" look). It rises from the
    // core and dissolves AT the rim (travel capped at r), so the orb reads as a breathing sphere.
    const p = ripplePhase;
    const a = Math.sin(p * Math.PI) * 0.1 * cur.evidence * intensity;
    if (a > 0.003) {
      c.beginPath();
      c.arc(cx, cy, p * r, 0, TAU);
      c.lineWidth = 1.1 + (1 - p) * 1.1;
      c.strokeStyle = hsl(cur, 34, a);
      c.stroke();
    }
    c.restore();
  }

  /** A single soft top sheen — reads as a glossy sphere, never a face. */
  function drawSheen(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const sx = cx;
    const sy = cy - r * 0.46;
    const sr = r * (capturing ? 0.5 + voiced * 0.16 : 0.5);
    const a = lerp(0.1, 0.3, cur.evidence);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, `hsla(${cur.hue.toFixed(0)}, 50%, 96%, ${a.toFixed(3)})`);
    g.addColorStop(1, "hsla(0,0%,100%,0)");
    c.save();
    c.globalCompositeOperation = "lighter";
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(sx, sy, sr, sr * 0.7, 0, 0, TAU);
    c.fill();
    c.restore();
  }

  function drawHollowRing(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    c.save();
    c.globalCompositeOperation = "lighter";
    const g = c.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.1);
    g.addColorStop(0, "hsla(220, 12%, 70%, 0)");
    g.addColorStop(0.82, "hsla(220, 14%, 76%, 0.16)");
    g.addColorStop(1, "hsla(220, 12%, 70%, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, r * 1.1, 0, TAU);
    c.fill();
    c.lineWidth = 1.6;
    c.strokeStyle = "hsla(220, 16%, 82%, 0.5)";
    c.beginPath();
    c.arc(cx, cy, r * 0.92, 0, TAU);
    c.stroke();
    c.restore();
  }

  function drawMotes(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, dt: number): void {
    // Spawn while voicing — the orb "drinks the hum".
    if (voiced > 0.35) {
      const want = Math.round(voiced * (w < 560 ? 1.4 : 2.4));
      for (let i = 0; i < want; i++) spawnMote(cx, cy);
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    const f = Math.min(2, dt * 60);
    for (const m of motes) {
      if (!m.active) continue;
      m.px = m.x;
      m.py = m.y;
      m.x += m.vx * f;
      m.y += m.vy * f;
      const d = Math.hypot(cx - m.x, cy - m.y);
      if (d < r * 0.5) {
        // Absorbed — a tiny flash, then recycle.
        c.fillStyle = hsl(cur, 50, 0.5);
        c.beginPath();
        c.arc(m.x, m.y, 2.4, 0, TAU);
        c.fill();
        m.active = false;
        continue;
      }
      m.life -= dt * 0.25;
      if (m.life <= 0) {
        m.active = false;
        continue;
      }
      c.strokeStyle = hsl(cur, 46, 0.32 * m.life);
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(m.px, m.py);
      c.lineTo(m.x, m.y);
      c.stroke();
    }
    c.restore();
  }

  function drawPitchLine(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    if (voiced < 0.25) return;
    const y = cy + (pN - 0.5) * r * 1.4;
    const span = r * 2.5;
    const g = c.createLinearGradient(cx - span / 2, y, cx + span / 2, y);
    g.addColorStop(0, hsl(cur, 40, 0));
    g.addColorStop(0.5, hsl(cur, 52, 0.5 * voiced));
    g.addColorStop(1, hsl(cur, 40, 0));
    c.save();
    c.globalCompositeOperation = "lighter";
    c.strokeStyle = g;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - span / 2, y);
    c.lineTo(cx + span / 2, y);
    c.stroke();
    c.restore();
  }

  function drawTimerRing(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    // A progress HALO hugging the core, not a reticle floating outside it: pulled in flush
    // (was r*1.22) with a near-invisible unfilled track, so only the FILLING arc reads.
    const rr = r * 1.06;
    c.save();
    c.lineCap = "round";
    c.lineWidth = 3;
    c.strokeStyle = "hsla(210, 16%, 60%, 0.08)";
    c.beginPath();
    c.arc(cx, cy, rr, 0, TAU);
    c.stroke();
    c.strokeStyle = hsl(cur, 52, 0.9);
    c.beginPath();
    c.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + fraction * TAU);
    c.stroke();
    c.restore();
  }

  function frame(t: number): void {
    if (!running) return;
    const dt = last ? clamp((t - last) / 1000, 0, 0.05) : 0.016;
    last = t;
    history[hHead] = level;
    hHead = (hHead + 1) % HISTORY;

    const idle = !capturing && pulseT <= 0;
    // Reduced motion: nothing animates, so only redraw when state actually changed.
    if (reduced && idle && !dirty) {
      raf = requestAnimationFrame(frame);
      return;
    }
    // Resting (the most common state) breathes slowly — ~30fps is plenty and halves idle cost.
    if (!reduced && mode === "resting" && idle && t - lastDrawT < 33) {
      raf = requestAnimationFrame(frame);
      return;
    }

    draw(dt);
    lastDrawT = t;
    dirty = false;
    raf = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", resumeIfVisible);
  }
  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", resumeIfVisible);
  }
  // Don't freeze the orb on a mere window blur DURING capture (e.g. the mic permission prompt) —
  // keep animating; only a real tab-hide (visibilitychange) pauses.
  function onBlur(): void {
    if (!capturing) pause();
  }
  function pause(): void {
    if (!running) return;
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }
  function resumeIfVisible(): void {
    if (!running && document.visibilityState !== "hidden") {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function onVisibility(): void {
    if (document.visibilityState === "hidden") pause();
    else resumeIfVisible();
  }

  return {
    start,
    stop,
    resize,
    setMode(m: OrbMode): void {
      mode = m;
      capturing = m === "capturing";
      if (m === "capturing") {
        // Capture stays NEUTRAL — colour is earned at the reveal, not before.
        assignVisual(tgt, NEUTRAL_VISUAL);
        tgt.energy = 0.4;
        fraction = 0;
        level = 0;
        voiced = 0;
      }
      if (m === "resting") assignVisual(tgt, NEUTRAL_VISUAL);
      if (reduced) assignVisual(cur, tgt); // no glide under reduced motion
      markDirty();
    },
    setVisual(v: StateVisual): void {
      assignVisual(tgt, v);
      if (reduced) assignVisual(cur, v); // snap (no ~1.2s glide) when reduced motion is requested
      markDirty();
    },
    setAnchor(x: number, y: number, size = 1): void {
      anchor.x = x;
      anchor.y = y;
      anchor.size = size;
      if (reduced) {
        place.x = x;
        place.y = y;
        place.size = size;
      }
      markDirty();
    },
    pushLevel(l: CaptureLevel | null): void {
      markDirty();
      if (!l) {
        voiced = approach(voiced, 0, 0.3, 0.05);
        return;
      }
      level = approach(level, clamp(l.level, 0, 1), 0.28, 0.05);
      voiced = approach(voiced, l.voiced ? 1 : 0, 0.25, 0.05);
      pN = approach(pN, pitchNorm(l.pitchHz), 0.2, 0.05);
      fraction = clamp(l.fraction, 0, 1);
    },
    pulse(): void {
      if (reduced) return; // reveal is a cut, not a swell, under reduced motion
      pulseT = 1;
      markDirty();
    },
  };
}
