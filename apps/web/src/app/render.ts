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
import type { ConsentState } from "@hum-ai/shared-types";
import type { LoadedPrior } from "./prior";
import type { CaptureLevel } from "./capture";
import { isGranted } from "./consent";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

const STAGE_LABEL: Record<string, string> = {
  population_prior: "Model-led read",
  early_calibration: "Model-led read · early personalization",
  personal_baseline: "Personal baseline refining",
  personalized_fusion: "Personalized fusion",
  relapse_model: "Longitudinal model active",
};

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

// ── friendly quality-gate reason text ─────────────────────────────────────────
const REASON_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["too_short", "the hum was too short — hold a steady tone for the full 12 seconds"],
  ["near_silent", "almost no sound came through — hum a bit louder, closer to the mic"],
  ["clipped", "the input was distorting — ease off or move back from the mic"],
  ["too_interrupted", "too many gaps — keep the hum continuous, without stopping"],
  ["mostly_quiet", "mostly too quiet — hum a little louder"],
  ["too_little_active_audio", "not enough steady humming — sustain one clear note"],
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
export function renderRead(read: OrchestratedRead): void {
  const uf = read.userFacing;
  const card = $("read-card");
  if (!card) return;

  const suggestion =
    uf.suggestion && !uf.abstained
      ? `<div class="suggestion">
           <span class="suggestion-type">${esc(uf.suggestion.type.replace(/_/g, " "))}</span>
           <p>${esc(uf.suggestion.copy)}</p>
         </div>`
      : "";

  card.innerHTML = `
    <div class="read-head">
      <span class="evidence evidence-${esc(uf.confidence.evidenceLevel)}">${esc(uf.confidence.signalClarity)}</span>
      <span class="evidence-basedon">${esc(uf.confidence.basedOn)}</span>
    </div>
    <h2 class="headline">${esc(uf.headline)}</h2>
    <p class="note">${esc(uf.note)}</p>
    ${suggestion}
  `;

  const axes = $("axes-card");
  if (axes) {
    if (uf.abstained) {
      const q = read.internal.quality;
      const why =
        q.decision === "rejected"
          ? `This hum wasn't usable: ${reasonText(q.reasons)}.`
          : "The signal was too faint or unclear to read this time.";
      axes.innerHTML = `<p class="muted">${esc(why)}</p>`;
      return;
    }
    const a = read.internal.axis;
    const hint = read.internal.affectHint
      ? `<p class="muted small axis-hint">Leans: ${esc(read.internal.affectHint.replace(/_/g, " "))}.</p>`
      : "";
    axes.innerHTML = `
      <h3>Your read <span class="muted small">(valence + arousal · reflective, non-diagnostic)</span></h3>
      ${axisMeter("Mood", "subdued", "pleasant", a.valence)}
      ${axisMeter("Energy", "settled", "activated", a.arousal)}
      ${hint}
    `;
  }
}

/** A single axis meter with qualitative confidence + honest trained-prior provenance. */
function axisMeter(label: string, lowPole: string, highPole: string, res: AxisResolution): string {
  const left = Math.max(0, Math.min(100, ((res.value + 1) / 2) * 100));
  const conf =
    res.confidence >= 0.72 ? "clear" : res.confidence >= 0.5 ? "moderate" : "developing";
  let prov: string;
  if (res.trainedContribution === "in_domain") {
    const acc = res.trainedBalancedAccuracy != null ? ` (${pct(res.trainedBalancedAccuracy)}${res.trainedPassedGate ? ", gate-passed" : ""})` : "";
    prov = `Acoustic read, with the trained ${res.axis} prior${acc} agreeing — it was in-domain for this hum.`;
  } else if (res.trainedContribution === "abstained_ood") {
    prov = `Transparent acoustic read. The trained ${res.axis} prior was held back — this hum sits outside its acted-speech training domain (ADR-0005).`;
  } else {
    prov = `Transparent acoustic read (no trained ${res.axis} prior loaded).`;
  }
  return `
    <div class="axis">
      <div class="axis-top">
        <span class="axis-name">${esc(label)}</span>
        <span class="axis-conf axis-conf-${conf}">${conf} signal</span>
      </div>
      <div class="meter">
        <span class="meter-pole">${esc(lowPole)}</span>
        <div class="meter-track"><span class="meter-fill" style="left:${left.toFixed(1)}%"></span></div>
        <span class="meter-pole">${esc(highPole)}</span>
      </div>
      <p class="axis-prov muted small">${esc(prov)}</p>
    </div>`;
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
    body = `<p>Re-referenced against <strong>your</strong> baseline — this hum reads as ${esc(closeness)}. Your personal pattern now shapes the read.</p>`;
  } else if (n < 5) {
    body = `<p class="muted">Learning your baseline — <strong>${n}</strong> eligible hum${n === 1 ? "" : "s"} so far. The read works now from population priors; it starts re-referencing against <em>your</em> usual as your pattern forms (around 5 hums).</p>`;
  } else {
    body = `<p class="muted">Population read for this hum — not enough matching baseline coverage to personalize it yet. It keeps refining as you hum.</p>`;
  }
  card.innerHTML = `
    <h3>Personalization <span class="muted small">(silent refinement — never gates the read)</span></h3>
    ${body}
  `;
}

// ── the maturity card (refinement, NOT a gate) ────────────────────────────────
export function renderLadder(stage: string, n: number): void {
  const card = $("ladder-card");
  if (!card) return;
  const milestones = [
    { at: 5, label: "Personal baseline refines the read" },
    { at: 10, label: "Personalized fusion" },
    { at: 20, label: "Longitudinal trend monitoring" },
  ];
  const next = milestones.find((m) => n < m.at);
  const progressTo = next ? `${n} / ${next.at} eligible hums → ${esc(next.label)}` : "All refinement stages active.";
  const p = next ? Math.min(100, (n / next.at) * 100) : 100;

  card.innerHTML = `
    <h3>Your model maturity <span class="muted small">(sharpens the read; never withholds it)</span></h3>
    <p class="stage">Stage: <strong>${esc(STAGE_LABEL[stage] ?? stage)}</strong> · ${n} eligible hum${n === 1 ? "" : "s"}</p>
    <div class="progress"><span style="width:${p.toFixed(1)}%"></span></div>
    <p class="muted small">${progressTo}. Your read is available from the very first hum — these only refine it over time.</p>
  `;
}

// ── consent-gated longitudinal panel (booleans only; non-diagnostic) ──────────
export function renderLongitudinal(read: OrchestratedRead, consent: ConsentState): void {
  const card = $("longitudinal-card");
  if (!card) return;
  if (!isGranted(consent, "clinical_risk_surfacing")) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const lg = read.internal.longitudinal;
  const n = read.internal.eligibleHumCount;
  const active = read.internal.stage === "relapse_model";
  let body: string;
  if (active && !lg.abstained) {
    body = lg.monitoringFlag
      ? `<p class="monitor">A gentle check-in is suggested based on your recent pattern. This is reflective support, not a medical assessment.</p>`
      : `<p class="muted">Nothing notable stands out in your longitudinal pattern right now.</p>`;
  } else {
    body = `<p class="muted">Collecting longitudinal history — <strong>${n}</strong> eligible hum${n === 1 ? "" : "s"}. Trend monitoring engages once there's enough of your own history (around 20 daily hums). The per-hum read above is unaffected.</p>`;
  }
  card.innerHTML = `
    <h3>Longitudinal view <span class="badge-mini">consented · non-diagnostic</span></h3>
    ${body}
    <p class="disclaimer">Research-stage and non-clinical. Hum AI does not diagnose, and this view is not a medical evaluation.</p>
  `;
}

// ── provenance + privacy footer ──────────────────────────────────────────────
export function renderProvenance(read: OrchestratedRead, prior: LoadedPrior | null, synced: boolean): void {
  const el = $("provenance");
  if (!el) return;
  const a = read.internal.axis;
  const axisLine = `Dimensional read: transparent on-domain acoustic mapping of your hum. Trained valence/arousal priors ${
    a.valence.trainedContribution === "in_domain" || a.arousal.trainedContribution === "in_domain"
      ? "contributed where in-domain"
      : "were held back (this hum is outside their acted-speech domain)"
  }.`;
  const mp = read.internal.modelProvenance;
  const affectLine =
    mp.kind === "learned_affect_prior"
      ? `Secondary affect-label hint from the trained 6-class prior${mp.gatePassed === false ? " (below the 80% gate; far-domain, penalized)" : ""}.`
      : "Secondary affect-label hint from the heuristic ensemble (no trained model present).";
  const gate = prior?.promotion.evaluated ? `<span class="muted small">${esc(prior.promotion.note)}</span>` : "";
  el.innerHTML = `
    <p>${esc(axisLine)}</p>
    <p class="muted small">${esc(affectLine)}</p>
    ${gate}
    <p class="muted small">Raw audio never left your device — only derived features are used${synced ? ", and derived-only summaries are backed up to your private cloud space." : "."}</p>
  `;
}

// ── live capture meter ────────────────────────────────────────────────────────
export function setLiveMeter(level: CaptureLevel | null): void {
  const bar = $("live-meter");
  if (!bar) return;
  if (level === null) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const fill = bar.querySelector(".live-fill") as HTMLElement | null;
  const read = bar.querySelector(".live-read") as HTMLElement | null;
  if (fill) {
    fill.style.width = `${Math.round(level.level * 100)}%`;
    fill.classList.toggle("live-fill-on", level.voiced);
  }
  if (read) {
    const pitch = level.pitchHz ? `${Math.round(level.pitchHz)} Hz` : "—";
    read.textContent = level.voiced ? `🎵 hearing your hum · ${pitch}` : "🔇 too quiet — hum a little louder";
  }
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
      const time = new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
