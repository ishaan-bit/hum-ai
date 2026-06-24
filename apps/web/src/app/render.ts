/**
 * Rendering — surfaces ONLY safe representations:
 *   - `read.userFacing`         (already safety-screened by the spine)
 *   - `read.recommendationView` (sanitized bands; rendered as bands, never raw numbers)
 *   - the dimensional AXIS read  (`read.internal.axis`) — valence/arousal values +
 *     qualitative per-axis confidence + honest trained-prior provenance (non-clinical)
 *   - non-clinical meta (stage, eligible-hum count, model provenance, domain/quality)
 *
 * The read LEADS with the valence + arousal axis meters, available from the first hum.
 * The longitudinal panel stays consent-gated AND rendered from BOOLEAN flags only, with
 * a non-diagnostic disclaimer. The raw risk hypothesis, relapse-drift details, and any
 * numeric per-read confidence in `read.internal` are NEVER rendered.
 */
import type { OrchestratedRead, AxisResolution } from "@hum-ai/orchestrator";
import type { HumSelfReport } from "@hum-ai/affect-model-contracts";
import type { MusicRecommendation } from "@hum-ai/intervention-engine";
import { EVIDENCE_BANDS } from "@hum-ai/safety-language";
import { formatEnumLabel } from "./util";
import type { ConsentState } from "@hum-ai/shared-types";
import type { CaptureGateDecision } from "@hum-ai/signal-lab/capture-gate";
import {
  corpusStats,
  corpusCalibration,
  calibrationTrend,
  corpusReadiness,
  nextCollectionHint,
  assessPersonalizationBenefit,
  type NativeCorpus,
  type HumNativeArtifact,
  type HumNativeAxisStatus,
  type PersonalizationBenefit,
} from "@hum-ai/native-corpus";
import type { LoadedPrior } from "./prior";
import { isGranted } from "./consent";
import { createBreathPacer, type BreathPacer } from "./breath";
import type { PersonalitySignature, BigFiveKey } from "@hum-ai/personality-signature";
import { LIFE_CONTEXT, type DiaryContextMap } from "./diary-store";
import { loadOceanOverride, saveOceanOverride, clearOceanOverride } from "./signature-store";
import { loadLatestScreening, type LatestScreening } from "./clinical-store";
import { relativeDayIST, whenLabelIST, formatTimeIST } from "./time";

// esc() also de-dashes (house style: NO em dashes anywhere a user can see). Folding deDash() in
// here means EVERY escaped string — our static copy AND the orchestrator's generated read copy —
// reaches the screen dash-free, from a single chokepoint. (deDash is hoisted; safe to call above.)
function esc(s: string): string {
  return deDash(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/**
 * De-dash (house style: NO em dashes anywhere a user can see). A single render-boundary pass so
 * NO em/en dash can reach the screen, whatever the source — our static copy, the orchestrator's
 * generated read copy, or an intervention template. Em dashes become a comma separator (which is
 * how they almost always read), numeric en-dash ranges keep a hyphen. Render-only: the underlying
 * read copy is untouched, so the safety screens still run on the originals.
 */
function deDash(s: string): string {
  return s
    .replace(/\s*—\s*/g, ", ") // em dash → comma separator
    .replace(/(\d)\s*–\s*(\d)/g, "$1-$2") // numeric en-dash range → hyphen
    .replace(/\s*–\s*/g, ", ") // other en dash → comma
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** esc() + de-dash for DYNAMIC (model-generated) copy — the one helper every interpolation uses. */
function copy(s: string): string {
  return esc(deDash(s));
}

// ── inline duotone glyphs (graphics, not a dashboard) ─────────────────────────
// Tiny stroke-only SVGs that inherit the live accent via currentColor — they cost nothing and
// give every section a small graphical anchor instead of a wall of text.
const ICONS: Record<string, string> = {
  compass:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.2 9.5 9.2 8 11.8 6.5 9.2Z" fill="currentColor" stroke="none"/></svg>',
  pulse:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l1.6-4.2L8.4 12.4 10.4 7H15"/></svg>',
  spark:
    '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 1 9.5 6.5 15 8 9.5 9.5 8 15 6.5 9.5 1 8 6.5 6.5Z" fill="currentColor"/></svg>',
  book:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 3C6.2 1.9 3.3 1.9 1.7 2.7V13c1.6-.8 4.5-.8 6.3.5 1.8-1.3 4.7-1.3 6.3-.5V2.7C12.7 1.9 9.8 1.9 8 3Z"/><path d="M8 3v10.5"/></svg>',
};
function icon(name: keyof typeof ICONS): string {
  return `<span class="ic" aria-hidden="true">${ICONS[name] ?? ""}</span>`;
}

/** Qualitative confidence band (no numbers ever reach the user — ADR-0008). */
function confBand(conf: number): "clear" | "moderate" | "developing" {
  return conf >= EVIDENCE_BANDS.high ? "clear" : conf >= EVIDENCE_BANDS.medium ? "moderate" : "developing";
}

const STAGE_LABEL: Record<string, string> = {
  population_prior: "Model-led read",
  early_calibration: "Model-led read · early personalization",
  personal_baseline: "Personal baseline refining",
  personalized_fusion: "Personalized fusion",
  relapse_model: "Longitudinal model active",
};

// ── friendly quality-gate reason text ─────────────────────────────────────────
const REASON_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["too_short", "the hum was too short — let your note carry for the full 12 seconds"],
  ["near_silent", "almost no sound came through — hum a bit louder, closer to the mic"],
  ["clipped", "the input was distorting — ease off or move back from the mic"],
  ["too_interrupted", "too many gaps — keep the hum continuous, without stopping"],
  ["mostly_quiet", "mostly too quiet — hum a little louder"],
  ["too_little_active_audio", "not enough humming — keep your note going"],
  ["poor_voicing", "couldn't find a steady pitch — hum a clear, even note"],
  ["poor_snr", "too much background noise relative to the hum — find a quieter spot"],
];

function reasonText(reasons: readonly string[]): string {
  for (const r of reasons) {
    const hit = REASON_TEXT.find(([k]) => r.startsWith(k));
    if (hit) return hit[1];
  }
  return "the signal wasn't clear enough to read this time";
}

// ── the read card (LEADS with valence + arousal axes) ─────────────────────────
export function renderRead(read: OrchestratedRead, consent: ConsentState): void {
  const uf = read.userFacing;
  const card = $("read-card");
  if (!card) return;

  const suggestion =
    uf.suggestion && !uf.abstained
      ? `<div class="suggestion">
           <span class="suggestion-type">${esc(formatEnumLabel(uf.suggestion.type))}</span>
           <p>${copy(uf.suggestion.copy)}</p>
         </div>`
      : "";

  // Lead with the synthesized inner-state read (valence + arousal + the affect lean);
  // fall back to the acoustic headline only when the read abstained (innerState === null).
  const lead = uf.innerState ?? uf.headline;
  const eyebrow = uf.innerState ? `<p class="read-eyebrow muted small">Your inner state, right now</p>` : "";
  // The inline state-avatar: a small living orb that IS your state — it carries the orb's "this is
  // you" meaning here so the big canvas orb can recede to an ambient wash and stop eating the screen.
  const band = uf.abstained ? "developing" : confBand(read.internal.axis.signalStrength);
  card.innerHTML = `
    <div class="read-head">
      <span class="read-avatar read-avatar-${band}" aria-hidden="true"></span>
      <div class="read-head-meta">
        <span class="evidence evidence-${esc(uf.confidence.evidenceLevel)}">${copy(uf.confidence.signalClarity)}</span>
        <span class="evidence-basedon">${copy(uf.confidence.basedOn)}</span>
      </div>
    </div>
    ${eyebrow}
    <h2 class="headline">${copy(lead)}</h2>
    <p class="note">${copy(uf.note)}</p>
    ${suggestion}
  `;

  const axes = $("axes-card");
  const diag = $("diagnostics-card");
  if (axes) {
    if (uf.abstained) {
      const q = read.internal.quality;
      const why =
        q.decision === "rejected"
          ? `This hum wasn't usable: ${reasonText(q.reasons)}.`
          : "The signal was too faint or unclear to read this time.";
      axes.innerHTML = `<p class="muted">${copy(why)}</p>`;
      if (diag) diag.hidden = true;
      return;
    }
    const a = read.internal.axis;
    const hint = read.internal.affectHint
      ? `<p class="muted small axis-hint">Leans toward ${copy(formatEnumLabel(read.internal.affectHint))}.</p>`
      : "";
    // The read's region — a safe, reflective description derived from the V-A read (the same
    // signal the intervention is shaped for). This is the diagnostic "what it leans toward",
    // qualitative and non-clinical (ADR-0008): e.g. "more activated and less steady than usual".
    // Skipped for the longitudinal/safety_support region (its description is a multi-hum trend,
    // not how THIS hum sounded — surfacing it as a single-read region would be dishonest).
    const iod = read.userFacing.interventionOfDay;
    const region = iod?.targetStateDescription;
    const regionLine = region && iod?.category !== "safety_support"
      ? `<p class="read-region">This hum read as <strong>${copy(region)}</strong>.</p>`
      : "";
    axes.innerHTML = `
      <h3>${icon("compass")} Where you are <span class="muted small">(your read — drag the dot if it's off)</span></h3>
      ${moodField(a.valence, a.arousal)}
      ${regionLine}
      <p class="axis-prov muted small">${copy(axisProvenance(a.valence))}</p>
      ${hint}
    `;
  }
  // Richer, first-class diagnostics on the main screen (everything Hum noticed this hum).
  if (diag) {
    if (uf.abstained) diag.hidden = true;
    else {
      diag.hidden = false;
      diag.innerHTML = diagnosticsBody(read, consent);
    }
  }
}

const clampUnit = (x: number): number => (x < -1 ? -1 : x > 1 ? 1 : x);

/** The named zone of the valence–arousal circumplex (friendly, non-clinical). */
function zoneFor(valence: number, arousal: number): string {
  if (valence > -0.12 && valence < 0.12 && arousal > -0.12 && arousal < 0.12) return "Balanced";
  return arousal >= 0
    ? valence >= 0
      ? "Energised"
      : "Tense"
    : valence >= 0
      ? "Calm"
      : "Low";
}

const moodWord = (v: number): string => (v >= 0.12 ? "bright" : v <= -0.12 ? "low" : "even");
const energyWord = (a: number): string => (a >= 0.12 ? "charged" : a <= -0.12 ? "calm" : "even");

/** A short plain-language descriptor under the state name (no numbers). */
function zoneDescriptor(v: number, a: number): string {
  if (zoneFor(v, a) === "Balanced") return "steady, close to centre";
  return `${moodWord(v)} mood · ${energyWord(a)} energy`;
}


/** % position of a signed [-1,1] value along a horizontal axis (left = −1). */
const pctX = (v: number): number => ((clampUnit(v) + 1) / 2) * 100;
/** % position on the mood MAP's vertical axis — high arousal sits at the TOP (0%). */
const pctYUp = (a: number): number => ((1 - clampUnit(a)) / 2) * 100;

/**
 * THE MOOD FIELD — one interactive control that IS the read, the visual, AND the correction.
 *
 * Replaces the old read-only twin spectra (whose floating "now" word stacked over the right pole,
 * reading as "low over bright" / "charged over charged"). Now there's a single 2-D circumplex map —
 * a glowing dot you can drag, on a calm-↔-charged × low-↔-bright field — plus two precise sliders
 * with their poles fixed UNDER the track (never overlapping a value word). The user reads where they
 * are at a glance, and slides the SAME control to correct it; "Save how I feel" teaches the model
 * (HiTL) — there is no second, separate slider. Wired by {@link renderMoodAdjust}.
 */
function moodField(vRes: AxisResolution, aRes: AxisResolution): string {
  const v = clampUnit(vRes.value);
  const a = clampUnit(aRes.value);
  const band = confBand(Math.max(vRes.confidence, aRes.confidence));
  const zone = zoneFor(v, a);
  const aria = `You read as ${zone}: ${zoneDescriptor(v, a)}, ${band} signal. Drag the dot or use the sliders to adjust.`;
  const sliderRow = (axis: "v" | "a", label: string, leftPole: string, rightPole: string, value: number, now: string): string => `
    <div class="mood-slider">
      <div class="mood-slider-head"><span class="mood-slider-label">${esc(label)}</span><span class="mood-now" id="mood-now-${axis}">${esc(now)}</span></div>
      <input class="mood-range mood-range-${axis}" id="mood-${axis}" type="range" min="-100" max="100" step="2" value="${Math.round(value * 100)}" aria-label="${esc(label)} from ${esc(leftPole)} to ${esc(rightPole)}" />
      <div class="mood-poles"><span>${esc(leftPole)}</span><span>${esc(rightPole)}</span></div>
    </div>`;
  return `
    <div class="mood-field mood-${band}" data-pv="${v.toFixed(3)}" data-pa="${a.toFixed(3)}" data-v="${v.toFixed(3)}" data-a="${a.toFixed(3)}">
      <div class="mood-map-wrap">
        <div class="mood-map" id="mood-map" role="application" aria-label="${esc(aria)}" tabindex="0" style="touch-action:none">
          <svg class="mood-map-grid" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
            <defs><radialGradient id="mf-glow" cx="50%" cy="50%" r="60%"><stop offset="0%" class="mf-core"/><stop offset="100%" class="mf-edge"/></radialGradient></defs>
            <rect x="1" y="1" width="98" height="98" rx="16" class="mf-bg"/>
            <circle cx="50" cy="50" r="46" class="mf-ring"/><circle cx="50" cy="50" r="24" class="mf-ring mf-ring-in"/>
            <line x1="50" y1="6" x2="50" y2="94" class="mf-axis"/><line x1="6" y1="50" x2="94" y2="50" class="mf-axis"/>
            <circle cx="50" cy="50" r="2.2" class="mf-centre"/>
          </svg>
          <span class="mf-q mf-q-tr">${esc("Bright")}</span>
          <span class="mf-q mf-q-tl">${esc("Tense")}</span>
          <span class="mf-q mf-q-bl">${esc("Low")}</span>
          <span class="mf-q mf-q-br">${esc("Calm")}</span>
          <span class="mf-edge-top">charged</span><span class="mf-edge-bottom">calm</span>
          <span class="mf-edge-left">low</span><span class="mf-edge-right">bright</span>
          <button type="button" class="mood-dot" id="mood-dot" aria-label="Your mood. Drag to adjust." style="left:${pctX(v).toFixed(1)}%;top:${pctYUp(a).toFixed(1)}%"></button>
        </div>
      </div>
      <div class="mood-state" id="mood-state">
        <span class="state-name-zone" id="mood-zone">${esc(zone)}</span>
        <span class="state-name-desc" id="mood-desc">${esc(zoneDescriptor(v, a))}</span>
        <span class="signal-chip signal-${band}">${esc(band)} signal</span>
      </div>
      <div class="mood-sliders">
        ${sliderRow("v", "Mood", "low", "bright", v, moodWord(v))}
        ${sliderRow("a", "Energy", "calm", "charged", a, energyWord(a))}
      </div>
      <div class="mood-actions">
        <button id="mood-save" class="btn btn-primary btn-sm" type="button">Save how I feel</button>
        <button id="mood-confirm" class="btn btn-sm btn-ghost" type="button">Spot on, leave it</button>
      </div>
      <p class="mood-hint muted small" id="mood-hint">Slide the dot or the sliders if the read is off — saving teaches your hum model. Stored as derived features + your self-report only, never raw audio.</p>
    </div>`;
}

/**
 * Wire the interactive mood field rendered by {@link moodField}: live two-way sync between the
 * draggable dot and the two sliders, a live state name, and Save/confirm that mints one HiTL row
 * (the SAME correction the old separate slider made — now folded into the read itself). Called by
 * the app right after `renderRead`. Re-querying the live DOM each call keeps it stateless.
 */
export function renderMoodAdjust(read: OrchestratedRead, onSubmit: (report: HumSelfReport) => void): void {
  // Mood adjustment only exists for a usable read; an abstain shows no field.
  if (read.userFacing.abstained) return;
  const field = document.querySelector<HTMLElement>(".mood-field");
  const map = $("mood-map");
  const dot = $("mood-dot");
  const sv = document.getElementById("mood-v") as HTMLInputElement | null;
  const sa = document.getElementById("mood-a") as HTMLInputElement | null;
  if (!field || !map || !dot || !sv || !sa) return;
  const predicted = read.internal.axis.dimensional;

  const apply = (v: number, a: number, from: "slider" | "drag" | "init"): void => {
    const vc = clampUnit(v);
    const ac = clampUnit(a);
    field.dataset.v = vc.toFixed(3);
    field.dataset.a = ac.toFixed(3);
    dot.style.left = `${pctX(vc).toFixed(1)}%`;
    dot.style.top = `${pctYUp(ac).toFixed(1)}%`;
    if (from !== "slider") {
      sv.value = String(Math.round(vc * 100));
      sa.value = String(Math.round(ac * 100));
    }
    const zoneEl = $("mood-zone");
    const descEl = $("mood-desc");
    const nv = $("mood-now-v");
    const na = $("mood-now-a");
    if (zoneEl) zoneEl.textContent = zoneFor(vc, ac);
    if (descEl) descEl.textContent = zoneDescriptor(vc, ac);
    if (nv) nv.textContent = moodWord(vc);
    if (na) na.textContent = energyWord(ac);
    field.classList.toggle("mood-edited", Math.abs(vc - predicted.valence) > 0.05 || Math.abs(ac - predicted.arousal) > 0.05);
  };

  sv.addEventListener("input", () => apply(Number(sv.value) / 100, Number(sa.value) / 100, "slider"));
  sa.addEventListener("input", () => apply(Number(sv.value) / 100, Number(sa.value) / 100, "slider"));

  // Pointer drag / tap on the map → set the dot (high arousal at the top).
  let dragging = false;
  const fromPointer = (e: PointerEvent): void => {
    const r = map.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    apply(x * 2 - 1, 1 - y * 2, "drag");
  };
  const onMove = (e: PointerEvent): void => { if (dragging) { e.preventDefault(); fromPointer(e); } };
  map.addEventListener("pointerdown", (e) => { dragging = true; map.setPointerCapture(e.pointerId); fromPointer(e); });
  map.addEventListener("pointermove", onMove);
  map.addEventListener("pointerup", (e) => { dragging = false; try { map.releasePointerCapture(e.pointerId); } catch { /* ignore */ } });
  // Keyboard nudge for the focused map (accessible alternative to drag).
  map.addEventListener("keydown", (e) => {
    const v = Number(field.dataset.v ?? 0), a = Number(field.dataset.a ?? 0);
    const step = 0.06;
    if (e.key === "ArrowRight") { apply(v + step, a, "drag"); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { apply(v - step, a, "drag"); e.preventDefault(); }
    else if (e.key === "ArrowUp") { apply(v, a + step, "drag"); e.preventDefault(); }
    else if (e.key === "ArrowDown") { apply(v, a - step, "drag"); e.preventDefault(); }
  });

  const done = (msg: string): void => {
    const hint = $("mood-hint");
    if (hint) hint.textContent = msg;
    const actions = field.querySelector(".mood-actions");
    if (actions) (actions as HTMLElement).style.opacity = "0.45";
  };
  $("mood-save")?.addEventListener("click", () => {
    const v = Number(field.dataset.v ?? predicted.valence);
    const a = Number(field.dataset.a ?? predicted.arousal);
    const agreed = Math.abs(v - predicted.valence) < 0.12 && Math.abs(a - predicted.arousal) < 0.12;
    onSubmit({ label: { valence: v, arousal: a }, source: agreed ? "self_report_confirm" : "self_report_adjust", agreedWithRead: agreed });
    done(agreed ? "Saved — your read stands. Your hum model just learned from it. ✓" : "Saved how you feel — your hum model just learned from it. ✓");
  });
  $("mood-confirm")?.addEventListener("click", () => {
    onSubmit({ label: predicted, source: "self_report_confirm", agreedWithRead: true });
    done("Thanks — your hum model just learned from this. ✓");
  });
}

/** Provenance line for the read — user-facing, no model-status detail. */
function axisProvenance(_res: AxisResolution): string {
  return "On-device acoustic read.";
}

// ── richer diagnostics: a small tile grid of everything Hum noticed (qualitative only) ──
function diagTile(k: string, v: string, tone: string): string {
  return `<div class="diag-tile"><span class="diag-k">${esc(k)}</span><span class="diag-v diag-${tone}">${esc(v)}</span></div>`;
}

// ── early-detection + result categorisation (the longitudinal/clinical layer, surfaced) ──
// The engine computes several CATEGORISATIONS the old surface under-showed: an early-detection
// TREND, a non-diagnostic risk hypothesis (nominal / marker-present / insufficient), a sustained
// relapse-DRIFT early-warning, a RECOVERY trajectory, and — if a screening was taken on this device
// — the most recent PHQ-9 / GAD-7 band. These are surfaced here (Today) and in the Diary. Always
// qualitative + non-diagnostic, consent-gated for the clinical layer (ADR-0006/0008).

type EarlyTone = "clear" | "moderate" | "watch" | "developing";
interface EarlySignal { readonly label: string; readonly tone: EarlyTone; readonly line: string; }

/** Resolve the early-detection status from the longitudinal layer (non-diagnostic, screened copy). */
function earlyDetection(lg: LongitudinalView | null): EarlySignal {
  if (!lg || lg.abstained || lg.riskHypothesis.status === "insufficient_data") {
    return {
      label: "still learning",
      tone: "developing",
      line: "Hum is still learning your usual — early signals appear once it knows your baseline.",
    };
  }
  if (lg.relapseDrift) {
    const d = lg.relapseDrift.driftWindowHums;
    return {
      label: "worth a gentle check-in",
      tone: "watch",
      line: `An early signal: your recent hums have drifted from your steadier pattern across ${d} check-in${d === 1 ? "" : "s"}. Not a diagnosis — a nudge that talking to someone you trust could help.`,
    };
  }
  if (lg.recovery) {
    return {
      label: "easing back",
      tone: "clear",
      line: "A positive early signal: your recent hums are moving back toward your steadier pattern.",
    };
  }
  if (lg.riskHypothesis.status === "risk_marker_present") {
    return {
      label: "keeping an eye",
      tone: "moderate",
      line: "One recent signal sits a little apart from your usual. Nothing standing out as a pattern yet — Hum keeps watching, gently.",
    };
  }
  return {
    label: "nothing standing out",
    tone: "clear",
    line: "Nothing in your recent pattern is standing out from your usual right now.",
  };
}

/** Friendly early-detection trend word (the longitudinal trend categorisation). */
function trendWord(dir: "improving" | "worsening" | "stable" | "uncertain"): string {
  return dir === "improving" ? "easing" : dir === "worsening" ? "unsettled" : dir === "stable" ? "steady" : "forming";
}

/** A gentle, readable label for a screening severity band (non-alarming, non-diagnostic). */
function screeningBandLabel(band: string): string {
  switch (band) {
    case "minimal": return "minimal";
    case "mild": return "mild";
    case "moderate": return "moderate";
    case "moderately_severe": return "moderately high";
    case "severe": return "high";
    default: return band;
  }
}
const SCREENING_TONE: Record<string, string> = {
  minimal: "clear", mild: "clear", moderate: "moderate", moderately_severe: "watch", severe: "watch",
};

/**
 * The most-recent on-device screening (PHQ-9 mood + GAD-7 worry), surfaced gently. Returns "" when
 * no screening was ever taken on this device (the common consumer case) — it never invents one.
 * Non-diagnostic framing, with a support line when a band runs high.
 */
function screeningBlock(s: LatestScreening | null, now: number): string {
  if (!s || (!s.phq && !s.gad)) return "";
  const row = (label: string, band: string, at: string): string =>
    `<div class="screen-row"><span class="screen-dot tone-${SCREENING_TONE[band] ?? "moderate"}"></span>` +
    `<span class="screen-label">${esc(label)}</span>` +
    `<span class="screen-band band-${esc(band)}">${esc(screeningBandLabel(band))}</span>` +
    `<span class="screen-when muted small">${esc(relativeDayIST(at, now))}</span></div>`;
  const rows = [
    s.phq ? row("Mood check-in (PHQ-9)", s.phq.severityBand, s.phq.administeredAt) : "",
    s.gad ? row("Worry check-in (GAD-7)", s.gad.severityBand, s.gad.administeredAt) : "",
  ].join("");
  const high =
    (s.phq && (s.phq.severityBand === "severe" || s.phq.severityBand === "moderately_severe")) ||
    (s.gad && s.gad.severityBand === "severe");
  const support = high
    ? `<p class="muted small">A higher band is worth taking seriously — please consider reaching out to someone you trust or a support line. This is a screening reflection, never a diagnosis.</p>`
    : `<p class="muted small">A reflection from your own check-in answers — a screening signal, never a diagnosis.</p>`;
  return `
    <div class="diary-screening">
      <h4>${icon("pulse")} Your recent check-in <span class="muted small">(self-report screening)</span></h4>
      <div class="screen-rows">${rows}</div>
      ${support}
    </div>`;
}

/**
 * "What Hum noticed" — surfaces the read's internal detail the dashboard view used to hide:
 * per-axis clarity, how much clear signal the hum carried, whether the trained model contributed,
 * and how this hum sits against the user's own baseline. All qualitative (ADR-0008): the words are
 * coarse bands, never numbers, and carry no clinical id.
 */
function diagnosticsBody(read: OrchestratedRead, consent: ConsentState): string {
  const a = read.internal.axis;
  const p = read.internal.personalization;
  const n = read.internal.eligibleHumCount;
  const clinicalOn = isGranted(consent, "clinical_risk_surfacing");

  const sig = a.signalStrength;
  const sigWord = sig >= 0.66 ? "strong" : sig >= 0.33 ? "steady" : "faint";
  const sigTone = sig >= 0.66 ? "clear" : sig >= 0.33 ? "moderate" : "developing";

  const trained =
    a.valence.trainedContribution === "in_domain" || a.arousal.trainedContribution === "in_domain";
  const basis = trained ? "acoustic + trained" : "on-device acoustic";

  const persWord = p.applied
    ? p.selfNormality >= 0.6
      ? "close to your usual"
      : "apart from your usual"
    : n < 5
      ? "baseline forming"
      : "population read";
  const persTone = p.applied ? (p.selfNormality >= 0.6 ? "clear" : "moderate") : "developing";

  // The early-detection categorisation (consent-gated): the trend + risk hypothesis, surfaced as one
  // qualitative tile here in Today, with the full read in the Diary. Screening band tile if taken.
  const lg = read.internal.longitudinal;
  const early = earlyDetection(lg);
  const screening = clinicalOn ? loadLatestScreening() : null;
  const earlyTile = clinicalOn && !lg.abstained
    ? diagTile("Early signal", early.label, early.tone)
    : "";
  const trendTile = clinicalOn && !lg.abstained && lg.riskHypothesis.status !== "insufficient_data"
    ? diagTile("Recent trend", trendWord(lg.trendDirection), "info")
    : "";
  const screenTile = screening?.phq
    ? diagTile("Mood check-in", screeningBandLabel(screening.phq.severityBand), SCREENING_TONE[screening.phq.severityBand] ?? "moderate")
    : "";

  const tiles = [
    diagTile("Mood clarity", confBand(a.valence.confidence), confBand(a.valence.confidence)),
    diagTile("Energy clarity", confBand(a.arousal.confidence), confBand(a.arousal.confidence)),
    diagTile("Signal", sigWord, sigTone),
    diagTile("Read basis", basis, "info"),
    diagTile("Your baseline", persWord, persTone),
    earlyTile,
    trendTile,
    screenTile,
  ].join("");

  const shift =
    p.regimeShift === "up"
      ? "Your usual looks like it's been drifting a little higher lately; the read is re-centering on it."
      : p.regimeShift === "down"
        ? "Your usual looks like it's been drifting a little lower lately; the read is re-centering on it."
        : "";
  const shiftLine = shift ? `<p class="diag-note muted small">${esc(shift)}</p>` : "";
  // Surface the early-detection sentence here in Today too (the user asked for it in both places).
  const earlyLine = clinicalOn && !lg.abstained ? `<p class="diag-note muted small">${esc(early.line)}</p>` : "";

  return `
    <h3>${icon("pulse")} What Hum is noticing <span class="muted small">(this hum + your pattern, non-diagnostic)</span></h3>
    <div class="diag-grid">${tiles}</div>
    ${earlyLine}
    ${shiftLine}
  `;
}

// ── rejected capture (Stage ① — not a usable hum) ────────────────────────────
// A non-hum (noise/silence/speech/sigh/whistle/too-quiet) is NEVER given an affect read.
// We clear every read surface and ask for another hum — no axis meters, no suggestion, no
// history entry, nothing learned or saved. The raw hum-likeness number is never shown.
//
// We DO tell the user exactly WHY it wasn't usable (from the gate's specific reason code), so
// the next take is an informed retry rather than a guess. Burst hums with breath pauses are
// accepted upstream (Brocal/DALI pause tolerance), so a "too_choppy" message only appears for a
// clip that really was mostly silence.
const HUM_AGAIN_REASON: Record<string, { title: string; note: string }> = {
  too_short: {
    title: "That was a little too short",
    note: "I only caught a moment of it. Pick any note that feels easy and let it carry for the full twelve seconds, and I'll read it.",
  },
  too_quiet: {
    title: "That came through very quietly",
    note: "Almost no sound reached the mic. Move a bit closer and hum a touch louder — nothing was read or saved from this take.",
  },
  too_noisy: {
    title: "There was too much background noise",
    note: "The hum got lost in the room. Find a quieter spot and try once more — nothing was read or saved from this take.",
  },
  sounded_like_speech: {
    title: "That sounded more like talking than humming",
    note: "The pitch moved around like speech. A hum settles on a note and lets it ring — lips closed — rather than wandering like a tune. Pick any pitch you like and hold it. Nothing was read or saved.",
  },
  not_voiced: {
    title: "I couldn't quite catch the note",
    note: "That read more like a breath or a sigh than a hum. Pick any note you like and let it ring so you can feel it buzzing. Nothing was read or saved from this take.",
  },
  too_choppy: {
    title: "That was mostly pauses",
    note: "A few breath pauses are fine, but this was mostly quiet. Keep the hum going a little more of the time — nothing was read or saved.",
  },
  unclear: {
    title: "I didn't catch a clear hum",
    note: "That take didn't quite land as a hum. Find a quiet spot, pick any note you like and let it carry for the full twelve seconds. Nothing was read or saved.",
  },
};

export function renderCaptureRejected(decision: CaptureGateDecision): void {
  const r = HUM_AGAIN_REASON[decision.reasonCode || "unclear"] ?? HUM_AGAIN_REASON.unclear!;
  const card = $("read-card");
  if (card) {
    card.innerHTML = `
      <div class="read-head">
        <span class="evidence evidence-low">hum again</span>
      </div>
      <h2 class="headline">${esc(r.title)}</h2>
      <p class="note">${esc(r.note)}</p>
    `;
  }
  const axes = $("axes-card");
  if (axes) axes.innerHTML = `<p class="muted">No read this time. I only interpret a clear, sustained hum.</p>`;
  const intervention = $("intervention-card");
  if (intervention) intervention.innerHTML = "";
  const personalization = $("personalization-card");
  if (personalization) personalization.innerHTML = "";
  const longitudinal = $("longitudinal-card");
  if (longitudinal) longitudinal.hidden = true;
  const diagnostics = $("diagnostics-card");
  if (diagnostics) diagnostics.hidden = true;
  const signature = $("signature-card");
  if (signature) signature.hidden = true;
  const provenance = $("provenance");
  if (provenance) provenance.innerHTML = "";
  clearFeedbackPrompt();
}

// ── HiTL feedback: confirm / adjust the read → one row of native-hum truth ─────
// After a usable read we ask the user whether it matches how they feel. A confirm or a
// two-slider adjust mints a {derived features, benign self-report} training example (the
// orchestrator's applyFeedback runs the privacy + clinical-leak guards). This is the only
// source of hum truth the model can actually learn from on-domain (ADR-0011).

// A pending "thanks" auto-clear timer. Cancelled whenever the card is re-rendered or
// cleared, so a stale timeout from a PREVIOUS feedback can never wipe a freshly-rendered
// prompt for a newer hum.
let thanksTimer: ReturnType<typeof setTimeout> | undefined;

export function clearFeedbackPrompt(): void {
  if (thanksTimer !== undefined) {
    clearTimeout(thanksTimer);
    thanksTimer = undefined;
  }
  const card = $("feedback-card");
  if (card) {
    card.hidden = true;
    card.innerHTML = "";
  }
}

// HiTL feedback is now collected inline in the read's interactive mood field
// (`moodField` + `renderMoodAdjust`), so the old standalone two-slider prompt was removed —
// it duplicated the read and its floating value word stacked over the pole labels
// ("low" over "bright", "charged" over "charged"). `clearFeedbackPrompt` is kept to retire
// the legacy `#feedback-card` container on each render.

// ── "Your hum model" lab — watch your own native model + calibration improve ──
const NATIVE_TREND_COPY: Record<string, string> = {
  improving: "getting better — your read tracks your feeling more closely than before",
  steady: "holding steady",
  worsening: "a little noisier lately — keep logging how you feel",
  insufficient: "still gathering enough of your feedback to tell",
};

// Personalization-benefit copy (v3, §C) — qualitative only, never a percentage.
const BENEFIT_COPY: Record<Exclude<PersonalizationBenefit, "insufficient_evidence">, string> = {
  personalization_helping: "Personalizing your read is tracking your self-reports more closely than the generic read would.",
  neutral_or_unclear: "Personalizing your read is tracking about the same as the generic read so far — keep teaching it.",
  personalization_worsening: "Personalizing isn't helping your read right now — keep logging how you feel so it can re-center on you.",
};

function nativeAxisLine(label: string, s: HumNativeAxisStatus): string {
  // Qualitative only — no accuracy percentages in user copy (ADR-0008). `s.n` is a hum
  // COUNT (not a confidence/accuracy number), like the eligible-hum counts shown elsewhere.
  if (s.decision === "promote") {
    return `<li><span class="chip chip-on">✓ ${esc(label)}</span> live hum-native model, learned from ${s.n} of your confirmed hums; it now reads your hums more closely than the generic acoustic mapping does.</li>`;
  }
  return `<li><span class="chip chip-forming">○ ${esc(label)} · forming</span> <span class="muted small">keep confirming reads to train it</span></li>`;
}

export function renderModelLab(corpus: NativeCorpus, artifact: HumNativeArtifact | null): void {
  const card = $("model-lab");
  if (!card) return;
  const stats = corpusStats(corpus);
  const cal = corpusCalibration(corpus);
  const ready = corpusReadiness(corpus);
  const hint = nextCollectionHint(corpus);

  const modelLines = artifact
    ? `${nativeAxisLine("Mood", artifact.manifest.valence)}${nativeAxisLine("Energy", artifact.manifest.arousal)}`
    : `<li class="muted small">No retrain yet. Confirm a few reads to get started.</li>`;

  const trendLine = (axis: "valence" | "arousal", label: string): string => {
    const t = calibrationTrend(corpus, axis);
    return `<li><strong>${esc(label)}:</strong> ${esc(NATIVE_TREND_COPY[t.direction] ?? "")}</li>`;
  };

  const calBlock =
    cal.n >= 4
      ? `<p class="muted small">How well your read matches your self-reports (a higher agreement, lower error read is a better one):</p>
         <ul class="model-trend">${trendLine("valence", "Mood")}${trendLine("arousal", "Energy")}</ul>`
      : `<p class="muted small">Calibration starts once you've confirmed a few reads.</p>`;

  const hintBlock = hint ? `<p class="model-hint">${esc(hint)}</p>` : ready.anyReady ? `<p class="muted small">Enough data to retrain. Your model updates as you go.</p>` : "";

  // PERSONALIZATION BENEFIT (v3, §C): an honest, abstaining "is personalizing actually
  // helping vs the plain backbone, against your own self-reports?" — a coarse category,
  // never a raw accuracy number (ADR-0008).
  const benefit = assessPersonalizationBenefit(corpus).status;
  const benefitBlock =
    benefit === "insufficient_evidence"
      ? ""
      : `<p class="muted small model-benefit">${esc(BENEFIT_COPY[benefit])}</p>`;

  card.innerHTML = `
    <h3>${icon("spark")} Your hum model <span class="muted small">(learns from your feedback, non-diagnostic)</span></h3>
    <p class="muted small">${stats.total} labelled hum${stats.total === 1 ? "" : "s"} so far · ${stats.quadrantsCovered}/4 mood-energy regions covered.</p>
    <ul class="model-status-list">${modelLines}</ul>
    ${calBlock}
    ${benefitBlock}
    ${hintBlock}
    <p class="disclaimer">Research-stage and non-clinical. This model reflects how your hums map to how you say you feel; it is not a diagnosis.</p>
  `;
}

// ── intervention of the day (richer guided step; strings already safety-screened) ──
//
// Renders read.userFacing.interventionOfDay — the @hum-ai/intervention-engine
// "intervention of the day" (curated template, qualitative confidence language, gated
// escalation). Every string was screened by the spine (interventionOfDayStrings →
// assertSafeUserFacingText + isConfidenceCopySafe), so we surface it verbatim; the only
// number shown is the duration in minutes (a session length, never a confidence value).
const IOD_CATEGORY_LABEL: Record<string, string> = {
  breath_regulation: "Breath",
  grounding: "Grounding",
  music_regulation: "Music",
  movement_reset: "Movement",
  rest_recovery: "Rest",
  journaling: "Journaling",
  social_check_in: "Connection",
  reduce_load: "Ease the load",
  repeat_capture: "Try again",
  no_action_needed: "All good",
  safety_support: "Support",
};

// Map the qualitative confidence ENUM to friendly prose (never a number/percent, ADR-0008).
const IOD_CONFIDENCE_LABEL: Record<string, string> = {
  early_signal: "An early signal — still getting to know your baseline.",
  low_evidence: "A lighter-confidence read for today.",
  moderate_evidence: "A moderately confident read today.",
  stronger_evidence: "A clearer read today.",
};

// A concrete music suggestion derived from the model's V-A read. The only number shown is
// the tempo (BPM) — a tempo, never a confidence figure. All strings were safety-screened
// by the spine before reaching here.
function musicBlock(m: MusicRecommendation): string {
  const tracks = m.tracks
    .map(
      (t) =>
        `<li><span class="music-title">${esc(t.title)}</span> <span class="muted small">${esc(t.genre)} · ~${t.bpm} BPM</span></li>`,
    )
    .join("");
  return `
    <div class="music-rec">
      <p class="music-copy">${esc(m.copy)}</p>
      <p class="muted small">Tempo: ${esc(m.tempoBand)} · matched to ${esc(m.basedOn)}.</p>
      <ul class="music-tracks">${tracks}</ul>
    </div>`;
}

// The live breath pacer (one at a time) — destroyed whenever the card re-renders for a new hum.
let breathPacer: BreathPacer | null = null;

export function renderInterventionOfDay(read: OrchestratedRead): void {
  const card = $("intervention-card");
  if (!card) return;
  // Tear down any pacer from a previous hum before we replace the card's DOM.
  if (breathPacer) {
    breathPacer.destroy();
    breathPacer = null;
  }
  const iod = read.userFacing.interventionOfDay;
  const cat = IOD_CATEGORY_LABEL[iod.category] ?? formatEnumLabel(iod.category);
  const durationChip =
    iod.durationMinutes > 0 ? `<span class="iod-dur">${iod.durationMinutes} min</span>` : "";

  // Lead-in: tie the step to the diagnostic read in one plain clause ("Because this one
  // sounded …"). Only for an interpreted (non-abstained) affective read; the longitudinal
  // safety_support region is a multi-hum trend, not how a single hum "sounded".
  const forBlock =
    iod.targetStateDescription && !read.userFacing.abstained && iod.category !== "safety_support"
      ? `<p class="iod-for"><span class="iod-for-tag">Because</span> this one sounded ${esc(iod.targetStateDescription)}.</p>`
      : "";

  // History-aware (ASK 8): "over your last few hums you've sounded …", plus the exploratory
  // personality note. Both already safety-screened by the spine before reaching here.
  const recentBlock = iod.recentContext
    ? `<p class="iod-recent"><span class="iod-recent-tag">Lately</span> ${esc(iod.recentContext)}</p>`
    : "";
  const personalBlock = iod.personalNote ? `<p class="iod-personal">${esc(iod.personalNote)}</p>` : "";

  // Breath pacer (ASK 6): a follow-along animation the user can breathe with, paced to their
  // read (longer exhale when more activated). Only for the breath step + a non-abstained read.
  const breathMount =
    iod.category === "breath_regulation" && !read.userFacing.abstained
      ? `<div class="breath-mount" data-no-swipe></div>`
      : "";

  // Pick-one agency: two concrete micro-options the user chooses between (the strongest
  // anti-"generic" lever — single-session-intervention "you're the expert" scaffolding).
  const moves =
    iod.microMoves && iod.microMoves.length
      ? `<div class="iod-moves" role="group" aria-label="Two ways to do this, pick whichever fits">
           ${iod.microMoves.map((m) => `<p class="iod-move">${esc(m)}</p>`).join("")}
         </div>`
      : "";

  // One interoceptive pointer — somatic specificity is what reads as earned rather than generic.
  const bodyCue = iod.bodyCue
    ? `<p class="iod-bodycue"><span class="iod-bodycue-tag">Notice</span> ${esc(iod.bodyCue)}</p>`
    : "";

  const music = iod.musicRecommendation ? musicBlock(iod.musicRecommendation) : "";

  // "Why this" — the read-tied reason, ending in the named technique. Provenance (what shaped
  // it + the sources) is tucked behind a disclosure so the card isn't a citation dump.
  const provItems: string[] = [];
  if (iod.basedOnSignals.length) {
    provItems.push(
      `<div class="chips"><span class="muted small">Read from:</span> ${iod.basedOnSignals
        .map((s) => `<span class="chip">${esc(s)}</span>`)
        .join("")}</div>`,
    );
  }
  if (iod.sources.length) {
    provItems.push(
      `<ul class="iod-sources">${iod.sources
        .map((s) => `<li><span class="src-label">${esc(s.label)}</span><span class="muted small">${esc(s.detail)}</span></li>`)
        .join("")}</ul>`,
    );
  }
  const provenance = provItems.length
    ? `<details class="iod-prov"><summary>What shaped this</summary>${provItems.join("")}</details>`
    : "";
  const why = `
    <div class="iod-research">
      <p class="iod-rationale"><span class="iod-rationale-tag">Why this</span> ${esc(iod.whySuggested)} <span class="iod-technique">(${esc(iod.technique)})</span></p>
      ${provenance}
    </div>`;

  const escalationCopy = iod.escalation?.show ? iod.escalation.copy : undefined;
  const escalation = escalationCopy ? `<p class="monitor">${esc(escalationCopy)}</p>` : "";
  const safety = iod.safetyNote ? `<p class="disclaimer">${esc(iod.safetyNote)}</p>` : "";

  // Collapse the old confidence line + "not based on" wall into ONE de-emphasized footer.
  const conf = esc(IOD_CONFIDENCE_LABEL[iod.confidenceLanguage] ?? iod.confidenceLanguage);
  const footer = `<p class="iod-foot muted small">${conf} · reflective only, no medical label, clinical instrument, or certainty score.</p>`;

  card.innerHTML = `
    <div class="iod-head iod-cat-${esc(iod.category)}">
      <h3>Today's suggestion</h3>
      <span class="iod-cat">${esc(cat)}</span>
    </div>
    ${forBlock}
    ${recentBlock}
    <div class="iod-move-head">
      <p class="iod-title"><strong>${esc(iod.title)}</strong></p>
      ${durationChip}
    </div>
    <p class="iod-instruction">${esc(iod.instruction)}</p>
    ${breathMount}
    ${moves}
    ${bodyCue}
    ${personalBlock}
    ${music}
    ${why}
    ${escalation}
    ${safety}
    ${footer}
  `;

  // Mount the live breath pacer once the card DOM exists, paced to this read's arousal.
  if (iod.category === "breath_regulation" && !read.userFacing.abstained) {
    const mount = card.querySelector(".breath-mount") as HTMLElement | null;
    if (mount) breathPacer = createBreathPacer(mount, { arousal: read.internal.axis.arousal.value });
  }
}

// ── inter-hum intervention feedback ("did yesterday's suggestion help?") ────────
export function renderInterventionFeedback(onResponse: (helpful: boolean) => void): void {
  const section = document.getElementById("intervention-feedback-section") as HTMLElement | null;
  const card = $("intervention-feedback-card");
  if (!section || !card) return;
  card.innerHTML = `
    <p class="muted small">How did yesterday's suggestion land?</p>
    <div class="controls">
      <button id="iof-yes" class="btn btn-small">Helped</button>
      <button id="iof-no" class="btn btn-small btn-ghost">Not really</button>
    </div>
  `;
  section.hidden = false;
  const respond = (helpful: boolean) => {
    onResponse(helpful);
    section.hidden = true;
  };
  document.getElementById("iof-yes")?.addEventListener("click", () => respond(true), { once: true });
  document.getElementById("iof-no")?.addEventListener("click", () => respond(false), { once: true });
}

export function clearInterventionFeedback(): void {
  const section = document.getElementById("intervention-feedback-section") as HTMLElement | null;
  if (section) section.hidden = true;
}

// ── personalization status (honest engaging-state, from hum #1) ────────────────
export function renderPersonalization(read: OrchestratedRead): void {
  const card = $("personalization-card");
  if (!card) return;
  const p = read.internal.personalization;
  const n = read.internal.eligibleHumCount;
  let body: string;
  if (p.applied) {
    const closeness = p.selfNormality >= 0.6 ? "close to your usual" : "a little apart from your usual";
    const shift =
      p.regimeShift === "up"
        ? `<p class="muted small">Your baseline looks like it's been shifting a little higher lately; the model is re-centering on your new usual.</p>`
        : p.regimeShift === "down"
          ? `<p class="muted small">Your baseline looks like it's been shifting a little lower lately; the model is re-centering on your new usual.</p>`
          : "";
    const drivers =
      p.topContributors && p.topContributors.length > 0
        ? `<p class="muted small">A few of your most distinctive hum features shaped today's comparison.</p>`
        : "";
    body = `<p>Re-referenced against <strong>your</strong> baseline, this hum reads as ${esc(closeness)}. Your personal pattern now shapes the read.</p>${shift}${drivers}`;
  } else if (n < 5) {
    const count = n > 0 ? ` <span class="muted small">(${n} eligible hum${n === 1 ? "" : "s"} so far.)</span>` : "";
    body = `<p>Working from the population baseline now; your read is fully live. As your own pattern builds over the next few hums, it quietly starts re-referencing against <em>your</em> usual.${count}</p>`;
  } else {
    body = `<p class="muted">Population read for this hum, not enough matching baseline coverage to personalize it yet. It keeps refining as you hum.</p>`;
  }
  card.innerHTML = `
    <h3>Personalization <span class="muted small">(silent refinement, never gates the read)</span></h3>
    ${body}
  `;
}

// ── the refinement card (quiet status, NOT a gate) ────────────────────────────
// ADR-0010: the read is LIVE from hum #1. The personal baseline / fusion / longitudinal
// layers only REFINE it over time — they never gate, withhold, or delay it. So we show
// them as quiet on/forming status, never as an "N / 5 hums to unlock" countdown wall.
export function renderLadder(stage: string, n: number): void {
  const card = $("ladder-card");
  if (!card) return;
  const chip = (on: boolean, label: string): string =>
    `<span class="chip ${on ? "chip-on" : "chip-forming"}">${on ? "✓ " : "○ "}${esc(label)}${on ? "" : " · forming"}</span>`;

  card.innerHTML = `
    <h3>Read refinement <span class="muted small">(quietly sharpens the read, never withholds it)</span></h3>
    <p class="stage">Your read is live now. Stage: <strong>${esc(STAGE_LABEL[stage] ?? stage)}</strong>.</p>
    <div class="refine-chips">
      ${chip(true, "On-device read")}
      ${chip(n >= 5, "Personal baseline")}
      ${chip(n >= 10, "Personalized fusion")}
      ${chip(n >= 20, "Longitudinal view")}
    </div>
    <p class="muted small">There's no calibration wall: every hum gets a full read. These layers switch on quietly as your own pattern builds, refining a read you already have.</p>
  `;
}

// ── the hum signature (ASK 7): the within-you assessment, first-class in the State window ──
//
// Surfaces the tentative, EXPLORATORY Big Five (OCEAN) signature computed from the longitudinal
// baseline, foregrounding the two best voice-recoverable traits — Openness and Conscientiousness
// — alongside a compact within-you trend line. This is the "real assessment of your internal
// state over time" the read leads toward — non-clinical, a mirror not a verdict. All strings are
// screen-safe (see the @hum-ai/personality-signature package test); we esc() them anyway.

/** A plain-language icon per OCEAN trait so the end user isn't reading bare jargon. */
const TRAIT_ICON: Record<BigFiveKey, string> = {
  openness: "🎨",
  conscientiousness: "🎯",
  extraversion: "☀️",
  agreeableness: "🤝",
  emotional_stability: "🌊",
};

/** The lean word for a value: high pole / low pole / balanced (no numbers — ADR-0008). */
function leanWord(t: PersonalitySignature["traits"][number], value: number): string {
  return value >= 0.12 ? t.highPole : value <= -0.12 ? t.lowPole : "balanced";
}

/**
 * One ADJUSTABLE trait row: an icon, the trait name, the live lean word, a slider from the low pole
 * to the high pole (poles fixed UNDER the track), and a plain blurb. ALL FIVE traits render this
 * way with EQUAL prominence — the old display foregrounded only Openness + Conscientiousness and
 * dimmed the other three, which read as hiding them. `value` is the user's saved calibration if any,
 * else the acoustic read.
 */
function traitSlider(t: PersonalitySignature["traits"][number], value: number, edited: boolean): string {
  return `
    <div class="trait-adj${edited ? " trait-edited" : ""}" data-key="${esc(t.key)}">
      <div class="trait-adj-head">
        <span class="trait-ico" aria-hidden="true">${TRAIT_ICON[t.key]}</span>
        <span class="trait-name">${esc(t.label)}</span>
        <span class="trait-now" id="trait-now-${esc(t.key)}">${esc(leanWord(t, value))}</span>
      </div>
      <input class="trait-range" id="trait-${esc(t.key)}" data-key="${esc(t.key)}" type="range" min="-100" max="100" step="2" value="${Math.round(value * 100)}" aria-label="${esc(t.label)} from ${esc(t.lowPole)} to ${esc(t.highPole)}" />
      <div class="trait-poles"><span>${esc(t.lowPole)}</span><span>${esc(t.highPole)}</span></div>
      <p class="trait-blurb muted small">${esc(t.blurb)}</p>
    </div>`;
}

const SIG_TREND_COPY: Record<"improving" | "worsening" | "stable" | "uncertain", string> = {
  improving: "easing toward steadier lately",
  worsening: "a little more unsettled than your usual lately",
  stable: "holding steady lately",
  uncertain: "still gathering your pattern",
};

export function renderSignature(
  sig: PersonalitySignature,
  read: OrchestratedRead | null,
  consent: ConsentState,
  eligibleHumCount: number,
  localId: string,
): void {
  const card = $("signature-card");
  if (!card) return;
  card.hidden = false;
  const n = read ? read.internal.eligibleHumCount : eligibleHumCount;

  // The within-you trend line: live + consent-on shows the real trend; otherwise an honest hint.
  let trendLine: string;
  if (!isGranted(consent, "clinical_risk_surfacing")) {
    trendLine = `<p class="sig-trend muted small">Turn on <strong>“Notice changes early”</strong> (in the menu) to track how this shifts over time.</p>`;
  } else if (read && !read.internal.longitudinal.abstained) {
    trendLine = `<p class="sig-trend muted small">Your recent pattern is <strong>${esc(SIG_TREND_COPY[read.internal.longitudinal.trendDirection])}</strong>.</p>`;
  } else {
    trendLine = `<p class="sig-trend muted small">Your within-you trend sharpens as your pattern grows · ${n} hum${n === 1 ? "" : "s"} in.</p>`;
  }

  if (sig.status === "forming") {
    card.innerHTML = `
      <h3>${icon("spark")} Your hum signature <span class="badge-mini">forming · exploratory, not a test</span></h3>
      <p class="muted">${esc(sig.headline)}</p>
      ${trendLine}
    `;
    return;
  }

  // Merge the user's saved self-calibration over the acoustic read (per trait). All FIVE traits are
  // shown equally and are adjustable; saving teaches a personal calibration (the OCEAN HiTL).
  const override = loadOceanOverride(localId);
  const rows = sig.traits
    .map((t) => {
      const saved = override[t.key];
      const value = saved ?? t.value;
      return traitSlider(t, value, saved !== undefined);
    })
    .join("");
  const anyEdited = sig.traits.some((t) => override[t.key] !== undefined);

  card.innerHTML = `
    <h3>${icon("spark")} Your hum signature <span class="badge-mini">Big Five (OCEAN) · ${sig.status === "tentative" ? "tentative" : "early"} · exploratory, not a test</span></h3>
    <p class="sig-headline">${esc(sig.headline)}</p>
    <p class="muted small">All five shown — drag any to where it actually feels true for you, then save. Some traits show up more clearly in a voice than others, but none are hidden.</p>
    <div class="sig-traits">${rows}</div>
    <div class="sig-actions">
      <button id="sig-save" class="btn btn-primary btn-sm" type="button">Save my traits</button>
      <button id="sig-reset" class="btn btn-sm btn-ghost"${anyEdited ? "" : " hidden"} type="button">Reset to my hum read</button>
    </div>
    ${trendLine}
    <p class="disclaimer">An exploratory mirror of how your hums tend to sound over time — not a personality test, not a clinical read. Your saved adjustments are kept on this device as your own calibration.</p>
  `;

  // Live lean word as each slider moves.
  for (const t of sig.traits) {
    const slider = document.getElementById(`trait-${t.key}`) as HTMLInputElement | null;
    const now = document.getElementById(`trait-now-${t.key}`);
    const rowEl = card.querySelector<HTMLElement>(`.trait-adj[data-key="${t.key}"]`);
    slider?.addEventListener("input", () => {
      const val = Number(slider.value) / 100;
      if (now) now.textContent = leanWord(t, val);
      rowEl?.classList.add("trait-edited");
    });
  }

  $("sig-save")?.addEventListener("click", () => {
    const next: Record<string, number> = {};
    for (const t of sig.traits) {
      const slider = document.getElementById(`trait-${t.key}`) as HTMLInputElement | null;
      if (slider) next[t.key] = Number(slider.value) / 100;
    }
    saveOceanOverride(localId, next);
    const reset = $("sig-reset");
    if (reset) reset.hidden = false;
    const hint = card.querySelector(".sig-actions");
    if (hint) hint.insertAdjacentHTML("afterend", `<p class="sig-saved muted small">Saved your calibration. ✓</p>`);
    setTimeout(() => card.querySelector(".sig-saved")?.remove(), 2600);
  });
  $("sig-reset")?.addEventListener("click", () => {
    clearOceanOverride(localId);
    renderSignature(sig, read, consent, eligibleHumCount, localId);
  });
}

// ── the diary of hums (the private field-notebook view) ──────────────────────
//
// The longitudinal SHAPE — is this recent stretch typical or different for YOU, is it a
// one-off or a run, is it settling or holding — rendered as a personal record: a time-aware
// chart with YOUR usual range shaded, inspectable individual hums, your own optional context,
// and one plain-language "lately" line. Everything is words + geometry; it never renders
// riskHypothesis.confidence, driftMagnitude, any percent, or any clinical label, and the DATA
// stays consent-gated. Model/feature terminology lives only in the "How this works" disclosure.

/** One stored hum, as the diary sees it: when it was, its mood, and its (hidden) risk weight. */
export interface DiaryPoint {
  readonly at: string;
  readonly valence: number;
  readonly risk: number;
}

/** Everything the diary needs beyond the live read + consent. All optional (degrades to a ghost). */
export interface DiaryData {
  /** The user's real hum history (oldest→newest), from the on-device relapse ring. */
  readonly points?: readonly DiaryPoint[];
  /** Self-authored, local-only context per hum (chips + note), keyed by `at`. */
  readonly context?: DiaryContextMap;
  /** Which hum is open for inspection (defaults to the most recent). */
  readonly focusAt?: string | null;
}

/** The internal longitudinal view (consent-gated surfacing only; never rendered with numbers). */
type LongitudinalView = OrchestratedRead["internal"]["longitudinal"];

// The standing honesty frame for the pattern view: a mirror, not a verdict (compact, one line).
const PATTERN_MIRROR_NOTE =
  "A mirror, not a verdict. It only ever compares you to you, can't see why anything shifted, and decides nothing for you.";

// ── pattern state: ONE resolved reading, so the headline and the sub-line never contradict ──
type PatternTone = "forming" | "steady" | "easing" | "unsettled";
interface PatternState {
  readonly tone: PatternTone;
  /** The lead "Lately" sentence. */
  readonly lately: string;
  /** Where it appears to be heading — always consistent with `lately`. */
  readonly heading: string;
  /** A calm note on what the next few check-ins can clarify. */
  readonly next: string;
}

function derivePattern(lg: LongitudinalView | null, sustained: boolean): PatternState {
  // No personal judgement yet (pre-baseline, abstained, or uncertain) → "forming", never a verdict.
  if (!lg || lg.abstained || (lg.trendDirection === "uncertain" && !lg.recovery && !lg.relapseDrift)) {
    return {
      tone: "forming",
      lately: "Your pattern is still forming.",
      heading: "There isn't enough of your own history yet to call a direction.",
      next: "Each hum adds a page. Your usual range appears once there are a few more to compare against.",
    };
  }
  if (lg.relapseDrift || lg.trendDirection === "worsening") {
    return {
      tone: "unsettled",
      lately: "This recent stretch looks less like your usual pattern.",
      heading: sustained
        ? "It has held across several recent hums, not just a single off day."
        : "It reads as a recent shift for now, not a long run.",
      next: "A few more check-ins this week will show whether this settles or holds. Reaching out to someone you trust is never a bad idea.",
    };
  }
  if (lg.recovery || lg.trendDirection === "improving") {
    return {
      tone: "easing",
      lately: "This recent stretch looks like it is easing back toward your steadier.",
      heading: "Your last few hums have been moving the gentle way.",
      next: "A few more check-ins will show whether this keeps settling.",
    };
  }
  return {
    tone: "steady",
    lately: "This recent stretch looks much like your usual.",
    heading: "Your hums have been sitting close to your normal range.",
    next: "Keep checking in. The picture only gets clearer the more pages your diary has.",
  };
}

// ── constellation geometry: each hum is a star, the user's usual range is a glowing horizon ───
const CH_W = 320;
const CH_H = 150;
const CH_PADX = 20;
const CH_TOP = 20;
const CH_BOT = 24;
const CH_PLOT = CH_H - CH_TOP - CH_BOT; // usable pixel height
const chX = (i: number, n: number): number =>
  n <= 1 ? CH_W / 2 : CH_PADX + (i / (n - 1)) * (CH_W - 2 * CH_PADX);

interface NormalBand {
  readonly mid: number;
  readonly lo: number;
  readonly hi: number;
}
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** The user's typical mood range, as a robust centre ± spread. Null until there's enough history. */
function normalBand(values: readonly number[]): NormalBand | null {
  if (values.length < 4) return null;
  const mid = median(values);
  const mad = median(values.map((v) => Math.abs(v - mid)));
  const spread = Math.max(mad * 1.4826, 0.12); // a visible floor so the band never collapses
  return { mid, lo: clampUnit(mid - spread), hi: clampUnit(mid + spread) };
}

/**
 * Adaptive y-domain so the chart fills its plotting area even when all hums cluster in a
 * narrow valence range. Anchors to the data range + band bounds, adds 20% padding on each
 * side, enforces a minimum visible span of 0.36 units, and clamps to [-1, 1].
 * The normalBand is always fully visible inside the domain.
 */
function chartDomain(pts: readonly DiaryPoint[], band: NormalBand | null): readonly [number, number] {
  if (pts.length === 0) return [-1, 1];
  const vals = pts.map((p) => p.valence);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (band) { lo = Math.min(lo, band.lo); hi = Math.max(hi, band.hi); }
  const pad = Math.max((hi - lo) * 0.2, 0.1);
  lo -= pad; hi += pad;
  // enforce minimum span so a perfectly flat series still shows as a visible stripe
  const center = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, 0.18);
  return [Math.max(center - half, -1), Math.min(center + half, 1)];
}

/** Where one hum sits relative to the user's own usual range. */
type Pos = "usual" | "above" | "below" | "farBelow";
function positionOf(v: number, band: NormalBand | null): Pos {
  if (!band) return "usual";
  if (v > band.hi) return "above";
  if (v >= band.lo) return "usual";
  const spread = band.mid - band.lo;
  return v < band.mid - 2 * spread ? "farBelow" : "below";
}
const POS_LONG: Record<Pos, string> = {
  usual: "much like your usual",
  above: "brighter than your usual",
  below: "a little below your usual",
  farBelow: "well below your usual",
};
const POS_SHORT: Record<Pos, string> = {
  usual: "like your usual",
  above: "brighter",
  below: "a little below",
  farBelow: "well below",
};

// ── when-labels (relative, human; pinned to IST — see ./time) ─────────────────────────────────
// All user-facing day/time labels render in IST regardless of the runtime timezone, so a hum's
// timestamp is correct on any host. (Storage stays UTC ISO.)
const relativeDay = relativeDayIST;
const whenLabel = whenLabelIST;

/**
 * Catmull-Rom → cubic Bézier through the points: a smooth, deliberate mood curve instead of a
 * jagged polyline. Control-point Y is clamped to the canvas so the curve can't overshoot out of
 * view between widely-spaced points.
 */
function smoothPath(pts: ReadonlyArray<readonly [number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  const clampY = (y: number): number => (y < 1 ? 1 : y > CH_H - 1 ? CH_H - 1 : y);
  let d = `M ${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * THE CONSTELLATION OF HUMS — each hum is a living mood-star.
 *
 * x = time (oldest → newest, left → right), y = mood (your usual range glows as a horizon band),
 * colour = where this hum sat against YOUR usual (usual / brighter / below / well below), and the
 * newest hum is the bright "today" star with its own halo. A faint thread links them in order, like
 * a constellation line. Stars twinkle + drift gently (CSS, staggered per star; static under
 * reduced motion). Every star is tappable (data-at) to open that moment. No numbers reach the user;
 * magnitude lives only in position + glow (ADR-0008).
 */
function diaryChart(points: readonly DiaryPoint[], band: NormalBand | null, focusAt: string | null): string {
  const pts = points.slice(-30); // a readable window; the headline count stays authoritative
  const n = pts.length;
  if (n === 0) return diaryGhost();

  // Adaptive y-domain so the stars spread across the sky even when all hums cluster in a narrow
  // valence band; the usual-range band bounds are always inside the domain so the horizon shows.
  const [domLo, domHi] = chartDomain(pts, band);
  const domSpan = domHi - domLo;
  const chYD = (v: number): number => {
    const clamped = v < domLo ? domLo : v > domHi ? domHi : v;
    return CH_TOP + (1 - (clamped - domLo) / domSpan) * CH_PLOT;
  };
  const coords = pts.map((p, i) => [chX(i, n), chYD(p.valence)] as const);

  // The user's usual mood range, as a luminous horizon band (the "compared to me" anchor).
  let horizon = "";
  if (band) {
    const yHi = chYD(band.hi);
    const yMid = chYD(band.mid);
    const h = (chYD(band.lo) - yHi).toFixed(1);
    horizon =
      `<rect class="sky-band" x="0" y="${yHi.toFixed(1)}" width="${CH_W}" height="${h}" rx="10" fill="url(#sky-band-grad)"/>` +
      `<line class="sky-horizon" x1="0" y1="${yMid.toFixed(1)}" x2="${CH_W}" y2="${yMid.toFixed(1)}"/>`;
  }
  // A faint thread linking the hums in time order — the constellation line.
  const thread = n > 1 ? `<path class="sky-thread" pathLength="100" fill="none" d="${smoothPath(coords)}"/>` : "";

  const stars = pts
    .map((p, i) => {
      const [x, y] = coords[i]!;
      const today = i === n - 1;
      const focused = focusAt ? p.at === focusAt : today;
      const pos = positionOf(p.valence, band);
      const rCore = focused ? 4.4 : today ? 3.6 : 2.5;
      const rGlow = rCore * (focused || today ? 3.6 : 2.7);
      const cls = `diary-star pos-${pos}${today ? " is-today" : ""}${focused ? " is-focus" : ""}`;
      const ring = today ? `<circle class="star-ring" r="${(rCore + 3).toFixed(1)}" fill="none"/>` : "";
      // The <g> carries the fixed position (SVG transform attr); the child circles carry the CSS
      // twinkle/drift so animating them never disturbs the placement. --i/--tw stagger per star.
      return (
        `<g class="${cls}" data-at="${esc(p.at)}" style="--i:${i};--tw:${((i % 7) * 0.41).toFixed(2)}s" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
        `<circle class="star-glow" r="${rGlow.toFixed(1)}"/>${ring}<circle class="star-core" r="${rCore.toFixed(1)}"/>` +
        `</g>`
      );
    })
    .join("");

  const defs =
    `<defs><radialGradient id="sky-band-grad" cx="50%" cy="50%" r="75%">` +
    `<stop class="sky-band-in" offset="0%"/><stop class="sky-band-out" offset="100%"/>` +
    `</radialGradient></defs>`;
  return `<svg class="diary-sky" viewBox="0 0 ${CH_W} ${CH_H}" role="img" aria-label="Your recent hums as a constellation: each star is one hum, placed by time and coloured by how it sat against your usual range, which glows as a band.">${defs}<rect class="sky-bg" x="0" y="0" width="${CH_W}" height="${CH_H}" rx="14"/>${horizon}${thread}${stars}</svg>`;
}

/** A faint, drifting placeholder sky so the diary reads as graphical before there's data. */
function diaryGhost(): string {
  const seeds: ReadonlyArray<readonly [number, number]> = [
    [0.12, 0.62], [0.24, 0.4], [0.37, 0.72], [0.49, 0.32], [0.6, 0.56], [0.71, 0.38], [0.83, 0.64], [0.92, 0.46],
  ];
  const stars = seeds
    .map(([fx, fy], i) => {
      const x = (CH_PADX + fx * (CH_W - 2 * CH_PADX)).toFixed(1);
      const y = (CH_TOP + (1 - fy) * CH_PLOT).toFixed(1);
      return `<g class="diary-star diary-star-ghost" style="--i:${i};--tw:${((i % 7) * 0.41).toFixed(2)}s" transform="translate(${x} ${y})"><circle class="star-glow" r="6.5"/><circle class="star-core" r="2.4"/></g>`;
    })
    .join("");
  return `<svg class="diary-sky diary-sky-ghost" viewBox="0 0 ${CH_W} ${CH_H}" aria-hidden="true"><rect class="sky-bg" x="0" y="0" width="${CH_W}" height="${CH_H}" rx="14"/>${stars}</svg>`;
}

/** Date scale under the chart (plain dates — no confidence numbers). */
function chartScale(points: readonly DiaryPoint[], now: number): string {
  const pts = points.slice(-30);
  if (pts.length < 2) return "";
  const first = relativeDay(pts[0]!.at, now);
  const last = relativeDay(pts[pts.length - 1]!.at, now);
  return `<div class="diary-scale"><span>${esc(first)}</span><span class="diary-scale-legend">glowing band = your usual range</span><span>${esc(last)}</span></div>`;
}

/** The life-context chips + optional note for ONE hum (the inspected / most-recent moment). */
function focusPanel(point: DiaryPoint, pos: Pos, ctx: { tags: readonly string[]; note: string }, now: number): string {
  const chips = LIFE_CONTEXT.map((tag) => {
    const on = ctx.tags.includes(tag);
    return `<button type="button" class="diary-chip${on ? " on" : ""}" data-ctx-tag="${esc(tag)}" aria-pressed="${on}">${esc(tag)}</button>`;
  }).join("");
  return `
    <div class="diary-focus" data-focus-at="${esc(point.at)}">
      <div class="diary-focus-head">
        <strong>${esc(whenLabel(point.at, now))}</strong>
        <span class="diary-tag tag-${pos}">${esc(POS_LONG[pos])}</span>
      </div>
      <p class="muted small diary-ctx-label">Add your own context (optional, stays on this device)</p>
      <div class="diary-chips" role="group" aria-label="Life context for this hum">${chips}</div>
      <label class="diary-note">
        <span class="visually-hidden">A note for this hum</span>
        <input type="text" data-ctx-note maxlength="120" placeholder="A few words for future you…" value="${esc(ctx.note)}" />
      </label>
    </div>`;
}

/** The recent check-ins as inspectable rows (newest first). The keyboard-accessible way in. */
function momentsList(
  points: readonly DiaryPoint[],
  band: NormalBand | null,
  context: DiaryContextMap,
  focusAt: string | null,
  now: number,
): string {
  const recent = points.slice(-6).reverse();
  if (recent.length < 2) return "";
  const focus = focusAt ?? points[points.length - 1]?.at ?? null;
  const rows = recent
    .map((p) => {
      const pos = positionOf(p.valence, band);
      const note = context[p.at]?.note?.trim();
      const tags = context[p.at]?.tags ?? [];
      const ctxBit = note ? `“${esc(note)}”` : tags.length ? esc(tags.join(" · ")) : "";
      return `<button type="button" class="diary-moment${p.at === focus ? " on" : ""}" data-moment data-at="${esc(p.at)}">
        <span class="m-when">${esc(relativeDay(p.at, now))}</span>
        <span class="diary-tag tag-${pos}">${esc(POS_SHORT[pos])}</span>
        <span class="m-note">${ctxBit}</span>
      </button>`;
    })
    .join("");
  return `<div class="diary-moments"><p class="muted small diary-section-label">Recent check-ins</p>${rows}</div>`;
}

/** The "How this works" disclosure — where uncertainty, provenance, and boundaries live, OUT of
 *  the main flow (so trust comes from clarity, not a wall of legal copy). Words only. */
function diaryExplainer(lg: LongitudinalView | null): string {
  const sources: ReadonlyArray<readonly [boolean, string]> = lg
    ? [
        [lg.evidenceSources.personalBaseline, "your personal baseline"],
        [lg.evidenceSources.longitudinalTrend, "your trend over time"],
        [lg.evidenceSources.relapseModel, "your own pattern model"],
        [lg.evidenceSources.recoverySignature, "your steadier-period signature"],
      ]
    : [];
  const chips = sources
    .filter(([on]) => on)
    .map(([, label]) => `<span class="chip">${esc(label)}</span>`)
    .join("");
  const basedOn = chips ? `<p class="muted small">This view is shaped by: ${chips}</p>` : "";
  return `
    <details class="diary-how">
      <summary>How this works</summary>
      <div class="diary-how-body">
        <p class="muted small">Each hum is a star, placed left to right by time and coloured by where its mood sat against your own usual range, which glows as a band. That range is worked out only from your past hums, so "different" always means different <em>for you</em>, not different from anyone else.</p>
        <p class="muted small">It reads patterns in your voice, not your situation. It can't see why anything changed, and a single unusual hum is never treated as a trend.</p>
        ${basedOn}
        <p class="muted small">Research-stage and non-clinical. It does not diagnose, and it is not a medical evaluation. If you are struggling, please reach out to someone you trust or a support line.</p>
      </div>
    </details>`;
}

/**
 * THE CLEAR "WHERE YOU ARE NOW" VISUAL — a single legible bar: the user's usual mood range glows as
 * a band, today's hum sits as a bright marker, and a plain line says how today compares. This is the
 * at-a-glance answer the old constellation buried; it leads the diary so the time chart is secondary.
 */
function nowPositionBar(latest: DiaryPoint, band: NormalBand | null): string {
  const v = clampUnit(latest.valence);
  const pos = positionOf(latest.valence, band);
  const markPct = ((v + 1) / 2) * 100;
  let usual = "";
  if (band) {
    const lo = ((clampUnit(band.lo) + 1) / 2) * 100;
    const hi = ((clampUnit(band.hi) + 1) / 2) * 100;
    usual = `<span class="now-usual" style="left:${lo.toFixed(1)}%;width:${Math.max(2, hi - lo).toFixed(1)}%"></span>`;
  }
  return `
    <div class="diary-now">
      <div class="diary-now-head">
        <span class="diary-now-tag">Where you are now</span>
        <span class="diary-now-pos tag-${pos}">${esc(POS_LONG[pos])}</span>
      </div>
      <div class="now-bar" role="img" aria-label="Today's hum reads ${esc(POS_LONG[pos])}.">
        ${usual}
        <span class="now-mark" style="left:${markPct.toFixed(1)}%"></span>
      </div>
      <div class="now-poles"><span>lower</span><span class="now-usual-label">your usual range</span><span>brighter</span></div>
    </div>`;
}

/** The early-detection categorisation, as a clear status block for the diary (non-diagnostic). */
function earlySignalsBlock(lg: LongitudinalView | null): string {
  const e = earlyDetection(lg);
  const trend = lg && !lg.abstained && lg.riskHypothesis.status !== "insufficient_data"
    ? `<span class="early-trend">recent trend: <strong>${esc(trendWord(lg.trendDirection))}</strong></span>`
    : "";
  return `
    <div class="diary-early tone-${e.tone}">
      <div class="diary-early-head">
        <span class="early-dot tone-${e.tone}"></span>
        <span class="diary-early-tag">Early detection</span>
        <span class="diary-early-label">${esc(e.label)}</span>
        ${trend}
      </div>
      <p class="muted small">${esc(e.line)}</p>
    </div>`;
}

export function renderLongitudinal(
  read: OrchestratedRead | null,
  consent: ConsentState,
  eligibleHumCount: number,
  diary: DiaryData = {},
): void {
  const card = $("longitudinal-card");
  if (!card) return;
  const points = diary.points ?? [];
  const context = diary.context ?? {};
  const now = Date.now();

  // ADR-0006: the DATA stays consent-gated, but the PANEL is always discoverable, so a first-time
  // user sees the view exists and how to turn it on. Locked state is framed as THE diary, kindly.
  card.hidden = false;
  if (!isGranted(consent, "clinical_risk_surfacing")) {
    card.innerHTML = `
      <h3>${icon("book")} Your diary of hums <span class="badge-mini">off until you turn it on</span></h3>
      ${diaryGhost()}
      <p class="muted">This is the part that makes Hum more than a daily check. It keeps a private record of your hums, learns what is <em>usual</em> for you, and gently shows when a recent stretch looks different, <strong>early</strong>. It only does this if you say yes.</p>
      <p class="muted small">Turn on <strong>“Notice changes early”</strong> under <strong>Privacy &amp; consent</strong> in the menu. Your per-hum read is exactly the same either way.</p>
      <p class="disclaimer">${esc(PATTERN_MIRROR_NOTE)}</p>
    `;
    return;
  }

  const lg = read ? read.internal.longitudinal : null;
  const n = read ? read.internal.eligibleHumCount : eligibleHumCount;
  const countBadge = `${n} hum${n === 1 ? "" : "s"} · private`;

  // EARLY / SPARSE — not enough of the user's own history to compare against yet. Show whatever
  // real dots exist (so it never feels empty), but make NO within-you judgement and NO band.
  const baselineReady = !!read && !!lg && !lg.abstained && read.internal.stage !== "population_prior";
  if (!baselineReady || points.length < 3) {
    const filling =
      n === 0
        ? "Your diary starts with your first hum. Each one adds a page; your usual range appears once there are a few to compare against."
        : `Your diary is filling. A few more check-ins and your usual range will show here, so a hum can read as typical or different for you.`;
    const focus = points.length
      ? focusPanel(
          points[points.length - 1]!,
          "usual",
          context[points[points.length - 1]!.at] ?? { tags: [], note: "" },
          now,
        )
      : "";
    card.innerHTML = `
      <h3>${icon("book")} Your diary of hums <span class="badge-mini">${esc(countBadge)}</span></h3>
      ${points.length ? diaryChart(points, null, diary.focusAt ?? null) : diaryGhost()}
      <p class="diary-lately">${esc(filling)}</p>
      ${screeningBlock(loadLatestScreening(), now)}
      ${focus}
      ${diaryExplainer(lg)}
      <p class="disclaimer">${esc(PATTERN_MIRROR_NOTE)}</p>
    `;
    return;
  }

  // MATURE — a real personal baseline. Resolve ONE pattern reading, draw the band, let the user
  // inspect individual moments and add their own context.
  const band = normalBand(points.map((p) => p.valence));
  const sustained = !!lg!.relapseDrift;
  const pattern = derivePattern(lg, sustained);
  const focusAt = diary.focusAt ?? points[points.length - 1]!.at;
  const focusPoint = points.find((p) => p.at === focusAt) ?? points[points.length - 1]!;
  const focusCtx = context[focusPoint.at] ?? { tags: [], note: "" };
  const focusPos = positionOf(focusPoint.valence, band);

  const latest = points[points.length - 1]!;
  card.innerHTML = `
    <h3>${icon("book")} Your diary of hums <span class="badge-mini">${esc(countBadge)}</span></h3>
    <div class="diary-lately-block tone-${pattern.tone}">
      <span class="diary-lately-tag">Lately</span>
      <p class="diary-lately">${esc(pattern.lately)}</p>
      <p class="muted small">${esc(pattern.heading)}</p>
    </div>
    ${nowPositionBar(latest, band)}
    ${earlySignalsBlock(lg)}
    ${screeningBlock(loadLatestScreening(), now)}
    <details class="diary-overtime">
      <summary>Your hums over time <span class="muted small">— each star is one day</span></summary>
      ${diaryChart(points, band, focusAt)}
      ${chartScale(points, now)}
    </details>
    ${focusPanel(focusPoint, focusPos, focusCtx, now)}
    ${momentsList(points, band, context, focusAt, now)}
    <p class="diary-next">${icon("compass")} ${esc(pattern.next)}</p>
    ${diaryExplainer(lg)}
    <p class="disclaimer">${esc(PATTERN_MIRROR_NOTE)}</p>
  `;
}

// ── provenance + privacy footer ──────────────────────────────────────────────
export function renderProvenance(read: OrchestratedRead, _prior: LoadedPrior | null, synced: boolean): void {
  const el = $("provenance");
  if (!el) return;
  const a = read.internal.axis;
  const trainedUsed =
    a.valence.trainedContribution === "in_domain" || a.arousal.trainedContribution === "in_domain";
  const modelLine = trainedUsed
    ? "On-device read from an acoustic mapping of your hum, with a trained model that agreed where it applied."
    : "On-device acoustic read. A trained model was available but set aside — it only contributes when the hum type matches its training.";
  const privacyLine = synced
    ? "Raw audio never left your device — only derived summaries are backed up to your private space."
    : "Raw audio never left your device — everything runs locally.";
  el.innerHTML = `
    <p class="muted small">${esc(modelLine)}</p>
    <p class="muted small">${esc(privacyLine)}</p>
  `;
}

// ── session history list ─────────────────────────────────────────────────────
export interface HistoryEntry {
  readonly at: string;
  readonly stage: string;
  readonly eligible: boolean;
  readonly abstained: boolean;
  readonly evidence: string;
  readonly headline: string;
}

export function renderHistory(log: readonly HistoryEntry[]): void {
  const el = $("history-list");
  if (!el) return;
  if (log.length === 0) {
    el.innerHTML = `<li class="muted">No hums yet this session.</li>`;
    return;
  }
  el.innerHTML = log
    .slice()
    .reverse()
    .map((e) => {
      const time = formatTimeIST(e.at, true);
      const tag = e.abstained ? "abstained" : e.eligible ? "counted" : "not counted";
      return `<li>
        <span class="hist-time">${esc(time)}</span>
        <span class="hist-stage">${esc(STAGE_LABEL[e.stage] ?? e.stage)}</span>
        <span class="hist-tag hist-${esc(tag.replace(/ /g, "-"))}">${esc(tag)}</span>
        <span class="hist-head">${esc(e.headline)}</span>
      </li>`;
    })
    .join("");
}

// ── small status setters ─────────────────────────────────────────────────────
export function setCaptureStatus(text: string, fraction?: number): void {
  const s = $("capture-status");
  if (s) s.textContent = text;
  const bar = $("capture-progress");
  if (bar) {
    bar.hidden = fraction === undefined;
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  }
}

/**
 * Advance ONLY the progress hairline, without touching the aria-live prompt — so the listening
 * ritual's calm spoken cue ("Listening", "I can hear you") isn't re-announced ~10×/sec. The hero
 * progress is the orb's timer ring; this thin echo is the non-canvas / reduced-motion fallback.
 */
export function setCaptureProgress(fraction: number): void {
  const bar = $("capture-progress");
  if (!bar) return;
  bar.hidden = false;
  const fill = bar.firstElementChild as HTMLElement | null;
  if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export function setSyncStatus(text: string): void {
  const s = $("sync-status");
  if (s) s.textContent = text;
}

export function setBusy(busy: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("button[data-capture]").forEach((b) => {
    b.disabled = busy;
  });
}

export { STAGE_LABEL };
