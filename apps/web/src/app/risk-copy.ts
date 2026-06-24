/**
 * USER-FACING COPY for the three within-user risk markers (depressive-affect,
 * anxiety-tension, relapse-drift). Kept as a PURE module (no DOM, no storage) so the
 * copy-safety test can screen every string with `@hum-ai/safety-language` without
 * pulling in the render chain.
 *
 * RULES this copy obeys (and the test enforces):
 *  - No diagnostic / clinical-claim language (no "diagnos*", no "you have …", no
 *    "screens/detects depression|anxiety", no "prevents relapse", no medical-device
 *    or performance-number claims). The protective register is "signal / marker /
 *    early-warning pattern / reflection".
 *  - No raw numbers (ADR-0008) — magnitude is carried by the dot tone, never digits.
 *  - No clinical head id or internal label ever appears in copy or in a DOM token; the
 *    engine's marker ids (`depressive_affect` / `anxiety_tension` / `relapse_drift`,
 *    the last of which is ALSO a forbidden head id) are mapped to safe kebab `token`s
 *    used for data-attributes and CSS classes.
 */
import type { RiskMarkerId, RiskMarkerLevel } from "@hum-ai/relapse-engine";

/** A coarse, user-safe tone bucket that drives the dot colour + the legend. */
export type RiskTone = "learning" | "settled" | "watch" | "elevated";

export interface RiskMarkerCopy {
  /** Safe kebab token for data-attrs / CSS classes — NEVER the engine or internal id. */
  readonly token: "low-mood" | "tension" | "steadiness";
  /** Warm, plain lead name. */
  readonly name: string;
  /** The sanctioned non-diagnostic register (safety-language ALLOWED_TERMS). */
  readonly sub: string;
  /** Which inline glyph (a key in render.ts ICONS). */
  readonly icon: "moon" | "wave" | "compass";
  /** What this layer is "about", in one plain phrase (used in the legend). */
  readonly about: string;
}

export const RISK_MARKER_COPY: Record<RiskMarkerId, RiskMarkerCopy> = {
  depressive_affect: {
    token: "low-mood",
    name: "Low mood",
    sub: "depressive-affect signal",
    icon: "moon",
    about: "stretches that sit lower and flatter than your usual",
  },
  anxiety_tension: {
    token: "tension",
    name: "Tension and worry",
    sub: "anxiety-risk signal",
    icon: "wave",
    about: "stretches that sound more keyed-up and tense than your usual",
  },
  relapse_drift: {
    token: "steadiness",
    name: "Steadiness",
    sub: "relapse-risk drift",
    icon: "compass",
    about: "a sustained drift away from your steadier pattern",
  },
};

export function riskTone(level: RiskMarkerLevel): RiskTone {
  switch (level) {
    case "insufficient_data":
      return "learning";
    case "settled":
      return "settled";
    case "watch":
      return "watch";
    case "elevated":
      return "elevated";
  }
}

export function riskLevelWord(level: RiskMarkerLevel): string {
  switch (level) {
    case "insufficient_data":
      return "still learning";
    case "settled":
      return "settled";
    case "watch":
      return "worth noting";
    case "elevated":
      return "worth a check-in";
  }
}

const LINES: Record<RiskMarkerId, Record<RiskMarkerLevel, string>> = {
  depressive_affect: {
    insufficient_data:
      "Once Hum learns what your usual mood sounds like, it watches for stretches that sit lower and flatter than that is for you. It is still learning your baseline.",
    settled: "Your recent hums are not sitting unusually low or flat for you. Nothing standing out here.",
    watch: "A recent hum or two has sat lower and flatter than your usual. Worth gently noting, not a pattern yet.",
    elevated:
      "Several recent hums have sat lower and flatter than your usual. A gentle low-mood signal worth taking seriously. This is a reflection, never a medical verdict, and talking to someone you trust can help.",
  },
  anxiety_tension: {
    insufficient_data:
      "Once Hum learns what your usual energy sounds like, it watches for stretches that sound more keyed-up and tense than that is for you. It is still learning your baseline.",
    settled: "Your recent hums are not sitting unusually tense or keyed-up for you. Nothing standing out here.",
    watch: "A recent hum or two has sounded more keyed-up and tense than your usual. Worth gently noting.",
    elevated:
      "Several recent hums have sounded more keyed-up and tense than your usual. A gentle tension signal. This is a reflection, never a medical verdict, and a slow breath or reaching out can help.",
  },
  relapse_drift: {
    insufficient_data:
      "Once Hum knows your steadier pattern, it watches for a sustained drift away from it. It is still learning that pattern.",
    settled: "Your recent hums are holding close to your steadier pattern.",
    watch: "One recent hum sits apart from your steadier pattern. Hum keeps a gentle eye for now.",
    elevated:
      "Your recent hums have drifted from your steadier pattern across several check-ins. An early-warning pattern, never a medical verdict, and a check-in with someone you trust is worth it.",
  },
};

/** The non-diagnostic, supportive line for one marker at one level. */
export function riskMarkerLine(id: RiskMarkerId, level: RiskMarkerLevel, earlyOnset: boolean): string {
  let line = LINES[id][level];
  if (earlyOnset && (level === "watch" || level === "elevated")) {
    line += " It looks like this may be starting now, which is the moment a small step helps most.";
  }
  return line;
}

/** Legend entry for the four risk-dot tones. */
export interface LegendEntry {
  readonly tone: RiskTone;
  readonly label: string;
  readonly meaning: string;
}
export const RISK_LEGEND: readonly LegendEntry[] = [
  { tone: "settled", label: "settled", meaning: "nothing standing out from your usual" },
  { tone: "watch", label: "worth noting", meaning: "a recent hum or two looks a little different for you" },
  { tone: "elevated", label: "worth a check-in", meaning: "a difference that has held across several hums" },
  { tone: "learning", label: "still learning", meaning: "not enough of your own history yet" },
];

/** Legend entry for the mood-ribbon bead colours (the diary's other colour system). */
export interface MoodLegendEntry {
  readonly zone: "low" | "tense" | "neutral" | "calm" | "bright";
  readonly label: string;
}
export const MOOD_LEGEND: readonly MoodLegendEntry[] = [
  { zone: "low", label: "low" },
  { zone: "tense", label: "tense" },
  { zone: "neutral", label: "neutral" },
  { zone: "calm", label: "calm" },
  { zone: "bright", label: "bright" },
];

/** The one-line standing frame for the medical layer (shown under the three markers). */
export const RISK_LAYERS_NOTE =
  "Three within-user early signals. Each compares you only to your own usual range, is research-stage, and is never a medical verdict. They exist so a heavier stretch can be noticed early, with kindness.";
