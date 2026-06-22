/**
 * AURA — adaptive theming. The signature "the whole UI tunes itself to your inner state" feature.
 *
 * The dimensional read (valence/arousal ∈ [-1,1]) plus the earned evidence band are mapped to a
 * small set of CSS custom properties on the document root. Every visual surface — the atmosphere
 * wash, the orb, the meters, the text accents — reads ONLY these variables, so a single call
 * re-themes the entire app. The orb canvas reads the same numbers via {@link computeStateVisual}.
 *
 * Per ADR-0008 the magnitude is ENCODED IN LIGHT, never quoted in words:
 *   - VALENCE drives HUE / warmth (a 3-stop warmth wheel — never "green = good / red = bad"),
 *   - AROUSAL drives ENERGY (saturation, luminance, glow reach, and motion tempo),
 *   - the EVIDENCE band caps chroma + sharpness, so a low-confidence read literally looks paler
 *     and hazier. The world never looks more certain than the instrument actually is.
 */
import type { OrchestratedRead } from "@hum-ai/orchestrator";

export type EvidenceStrength = number; // 0.55 (developing) | 0.78 (moderate) | 1.0 (clear)

/** The fully-resolved visual state. The orb reads these numbers; CSS reads the mirrored vars. */
export interface StateVisual {
  /** Source dimensional read, clamped to [-1,1]. */
  readonly valence: number;
  readonly arousal: number;
  /** Chroma / sharpness ceiling from the earned evidence band, 0.55 | 0.78 | 1.0. */
  readonly evidence: EvidenceStrength;
  /** Derived hue in degrees (valence → warmth wheel). */
  readonly hue: number;
  /** Derived saturation %, already multiplied by evidence. */
  readonly sat: number;
  /** Derived core lightness %. */
  readonly light: number;
  /** Glow reach as a fraction of the orb radius (0.34–0.72). */
  readonly reach: number;
  /** Master motion clock, 0 (settled) → 1 (activated). */
  readonly energy: number;
  /** True when the read abstained — the orb shows a hollow "listening" ring, the world dims. */
  readonly abstained: boolean;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Valence → hue, as a 3-stop piecewise lerp on v ∈ [-1,1]:
 *   subdued  v=-1   → 230° (deep slate-indigo)
 *   calm     v=0.45 → 150° (sage-teal, the calm-regulated hero state)
 *   pleasant v=+1   →  42° (warm amber-gold)
 * The arc travels indigo → teal → sage → gold (warmth grows with valence) and is deliberately
 * NOT a good/bad red↔green axis.
 */
export function valenceHue(v: number): number {
  const x = clamp(v, -1, 1);
  if (x <= 0.45) return lerp(230, 150, (x + 1) / 1.45); // [-1 .. 0.45] → [230 .. 150]
  return lerp(150, 42, (x - 0.45) / 0.55); //                [0.45 .. 1] → [150 .. 42]
}

/** Map the read's overall evidence band to a chroma/sharpness strength. */
export function evidenceStrength(level: string): EvidenceStrength {
  switch (level) {
    case "high":
      return 1.0;
    case "medium":
      return 0.78;
    default: // "low", "early_baseline", anything else → a faint, honest read
      return 0.55;
  }
}

/** The idle / pre-first-hum world: near-grey, barely breathing, honestly empty (not pretending). */
export const NEUTRAL_VISUAL: StateVisual = {
  valence: 0,
  arousal: -0.35,
  evidence: 0.55,
  hue: 210,
  sat: 12,
  light: 15,
  reach: 0.4,
  energy: 0.3,
  abstained: false,
};

/** The abstain world: dimmer still, hollow listening ring — "didn't catch a hum, try again". */
export const ABSTAIN_VISUAL: StateVisual = {
  ...NEUTRAL_VISUAL,
  sat: 8,
  light: 13,
  energy: 0.22,
  abstained: true,
};

/** Pure: derive the full visual state from valence, arousal, and an evidence strength. */
export function computeStateVisual(valence: number, arousal: number, evidence: EvidenceStrength): StateVisual {
  const v = clamp(valence, -1, 1);
  const a = clamp(arousal, -1, 1);
  const aN = (a + 1) / 2; // 0 (settled) → 1 (activated)
  return {
    valence: v,
    arousal: a,
    evidence,
    hue: valenceHue(v),
    sat: lerp(26, 58, aN) * evidence,
    light: lerp(14, 24, aN),
    reach: lerp(0.34, 0.72, aN),
    energy: aN,
    abstained: false,
  };
}

/** Derive the visual state straight from an orchestrated read (the common case). */
export function visualFromRead(read: OrchestratedRead): StateVisual {
  if (read.userFacing.abstained) return ABSTAIN_VISUAL;
  const axis = read.internal.axis;
  const ev = evidenceStrength(read.userFacing.confidence.evidenceLevel);
  return computeStateVisual(axis.valence.value, axis.arousal.value, ev);
}

/**
 * Write the visual state to CSS custom properties on the root (or a given element). The
 * atmosphere wash, accents, and meters all transition smoothly because the numeric props are
 * registered with @property in styles.css. Safe to call with no DOM (no-ops).
 */
export function applyStateVisual(v: StateVisual, el: HTMLElement | null = safeRoot()): void {
  if (!el) return;
  const s = el.style;
  s.setProperty("--valence", v.valence.toFixed(3));
  s.setProperty("--arousal", v.arousal.toFixed(3));
  s.setProperty("--evidence", v.evidence.toFixed(3));
  s.setProperty("--state-hue", v.hue.toFixed(1));
  s.setProperty("--state-sat", `${v.sat.toFixed(1)}%`);
  s.setProperty("--state-light", `${v.light.toFixed(1)}%`);
  s.setProperty("--state-reach", v.reach.toFixed(3));
  s.setProperty("--state-energy", v.energy.toFixed(3));
  // DUOTONE AURA: the world borrows TWO related temperatures, not one flat accent — so cards,
  // graphics and the spectra read as a lit two-colour gradient rather than a monotone dashboard.
  //   --state-accent    the primary accent (valence warmth, arousal brightness),
  //   --state-accent-2  an analogous companion hue (+34°), a touch brighter — the gradient's far stop,
  //   --state-accent-deep a low, saturated version for grounding/shadow,
  //   --state-glow      a ready alpha glow colour for soft shadows.
  // All three are derived from the SAME live read, so the duotone stays fully state-adaptive.
  const hue2 = (v.hue + 34) % 360;
  s.setProperty("--state-hue-2", hue2.toFixed(1));
  s.setProperty("--state-accent", `hsl(${v.hue.toFixed(1)} ${(v.sat + 22).toFixed(0)}% ${Math.min(78, v.light + 48).toFixed(0)}%)`);
  s.setProperty("--state-accent-2", `hsl(${hue2.toFixed(1)} ${(v.sat + 30).toFixed(0)}% ${Math.min(82, v.light + 54).toFixed(0)}%)`);
  s.setProperty("--state-accent-deep", `hsl(${v.hue.toFixed(1)} ${(v.sat + 18).toFixed(0)}% ${Math.max(16, v.light + 6).toFixed(0)}%)`);
  s.setProperty("--state-glow", `hsla(${v.hue.toFixed(1)}, ${(v.sat + 34).toFixed(0)}%, ${Math.min(70, v.light + 42).toFixed(0)}%, 0.55)`);
  el.dataset.read = v.abstained ? "abstain" : "live";
}

function safeRoot(): HTMLElement | null {
  return typeof document !== "undefined" ? document.documentElement : null;
}
