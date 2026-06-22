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
import type { OrchestratedRead, AxisResolution, FeedbackRequest } from "@hum-ai/orchestrator";
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
           <span class="suggestion-type">${esc(formatEnumLabel(uf.suggestion.type))}</span>
           <p>${esc(uf.suggestion.copy)}</p>
         </div>`
      : "";

  // Lead with the synthesized inner-state read (valence + arousal + the affect lean);
  // fall back to the acoustic headline only when the read abstained (innerState === null).
  const lead = uf.innerState ?? uf.headline;
  const eyebrow = uf.innerState ? `<p class="read-eyebrow muted small">Your inner state, right now</p>` : "";
  card.innerHTML = `
    <div class="read-head">
      <span class="evidence evidence-${esc(uf.confidence.evidenceLevel)}">${esc(uf.confidence.signalClarity)}</span>
      <span class="evidence-basedon">${esc(uf.confidence.basedOn)}</span>
    </div>
    ${eyebrow}
    <h2 class="headline">${esc(lead)}</h2>
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
      ? `<p class="muted small axis-hint">Leans: ${esc(formatEnumLabel(read.internal.affectHint))}.</p>`
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
  // Use the canonical evidence-band thresholds (ADR-0008) — never re-hardcode the cutoffs.
  const conf =
    res.confidence >= EVIDENCE_BANDS.high ? "clear" : res.confidence >= EVIDENCE_BANDS.medium ? "moderate" : "developing";
  let prov: string;
  if (res.trainedContribution === "in_domain") {
    // Qualitative only — no accuracy % in the per-read copy (ADR-0008). The gate-passed
    // flag is honest provenance; the raw balanced-accuracy stays internal.
    const gate = res.trainedPassedGate ? " (gate-passed)" : "";
    prov = `Acoustic read, with the trained ${res.axis} prior${gate} agreeing — it was in-domain for this hum.`;
  } else if (res.trainedContribution === "abstained_ood") {
    prov = `Transparent acoustic read. The trained ${res.axis} prior was held back — this hum sits outside its acted-speech training domain (ADR-0005).`;
  } else if (res.trainedContribution === "held_failed_gate") {
    // v3: a prior that has not passed its promotion gate never steers the read.
    prov = `Transparent acoustic read. The trained ${res.axis} prior is held back — it hasn't passed its promotion gate, so it doesn't steer your read (gate-enforced).`;
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

// ── rejected capture (Stage ① — not a usable hum) ────────────────────────────
// A non-hum (noise/silence/speech/sigh/whistle/too-quiet) is NEVER given an affect read.
// We clear every read surface and ask for another hum — no axis meters, no suggestion, no
// history entry, nothing learned or saved. The raw hum-likeness number is never shown.
export function renderCaptureRejected(_decision: CaptureGateDecision): void {
  const card = $("read-card");
  if (card) {
    card.innerHTML = `
      <div class="read-head">
        <span class="evidence evidence-low">hum again</span>
      </div>
      <h2 class="headline">Didn't catch a clear hum</h2>
      <p class="note">That take didn't sound like a sustained hum — it may have been too quiet, too noisy, speech, or silence. Find a quieter spot and hum one steady note for the full 12 seconds. Nothing was read or saved from this take.</p>
    `;
  }
  const axes = $("axes-card");
  if (axes) axes.innerHTML = `<p class="muted">No read — we only interpret a clear, sustained hum.</p>`;
  const intervention = $("intervention-card");
  if (intervention) intervention.innerHTML = "";
  const personalization = $("personalization-card");
  if (personalization) personalization.innerHTML = "";
  const longitudinal = $("longitudinal-card");
  if (longitudinal) longitudinal.hidden = true;
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

/** Render the feedback prompt for a usable read; `onSubmit` is called with the self-report. */
export function renderFeedbackPrompt(
  read: OrchestratedRead,
  request: FeedbackRequest,
  onSubmit: (report: HumSelfReport) => void,
): void {
  const card = $("feedback-card");
  if (!card) return;
  if (read.userFacing.abstained) {
    clearFeedbackPrompt();
    return;
  }
  // Cancel any pending "thanks" auto-clear from a previous hum before rendering this one.
  if (thanksTimer !== undefined) {
    clearTimeout(thanksTimer);
    thanksTimer = undefined;
  }
  const predicted = read.internal.axis.dimensional;
  const v0 = Math.round(predicted.valence * 100);
  const a0 = Math.round(predicted.arousal * 100);
  card.hidden = false;
  card.innerHTML = `
    <h4>Does this match how you feel right now? <span class="muted small">teaches your hum model</span></h4>
    <p class="muted small">${esc(request.note)}</p>
    <div class="feedback-actions">
      <button id="fb-confirm" class="btn btn-primary btn-sm">Yes, that's right</button>
      <button id="fb-toggle-adjust" class="btn btn-sm">Adjust</button>
    </div>
    <div id="fb-adjust" class="feedback-adjust" hidden>
      <label class="fb-slider">
        <span>Mood <span class="muted small">subdued ↔ pleasant</span></span>
        <input type="range" id="fb-valence" min="-100" max="100" step="5" value="${v0}" />
      </label>
      <label class="fb-slider">
        <span>Energy <span class="muted small">settled ↔ activated</span></span>
        <input type="range" id="fb-arousal" min="-100" max="100" step="5" value="${a0}" />
      </label>
      <button id="fb-save" class="btn btn-primary btn-sm">Save how I feel</button>
    </div>
    <p class="muted small disclaimer">Stored as derived features + your self-report only — never raw audio. Non-clinical.</p>
  `;

  const thank = (): void => {
    card.innerHTML = `<p class="fb-thanks">Thanks — your hum model just learned from this. ✓</p>`;
    if (thanksTimer !== undefined) clearTimeout(thanksTimer);
    thanksTimer = setTimeout(() => clearFeedbackPrompt(), 2600);
  };

  $("fb-confirm")?.addEventListener("click", () => {
    onSubmit({ label: predicted, source: "self_report_confirm", agreedWithRead: true });
    thank();
  });
  $("fb-toggle-adjust")?.addEventListener("click", () => {
    const adj = $("fb-adjust");
    if (adj) adj.hidden = !adj.hidden;
  });
  $("fb-save")?.addEventListener("click", () => {
    const vEl = document.getElementById("fb-valence") as HTMLInputElement | null;
    const aEl = document.getElementById("fb-arousal") as HTMLInputElement | null;
    const valence = vEl ? Number(vEl.value) / 100 : predicted.valence;
    const arousal = aEl ? Number(aEl.value) / 100 : predicted.arousal;
    const agreed = Math.abs(valence - predicted.valence) < 0.2 && Math.abs(arousal - predicted.arousal) < 0.2;
    onSubmit({ label: { valence, arousal }, source: "self_report_adjust", agreedWithRead: agreed });
    thank();
  });
}

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
    return `<li><span class="chip chip-on">✓ ${esc(label)}</span> live hum-native model — learned from ${s.n} of your confirmed hums; it now reads your hums more closely than the generic acoustic mapping does.</li>`;
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
    : `<li class="muted small">No retrain yet — confirm a few reads to get started.</li>`;

  const trendLine = (axis: "valence" | "arousal", label: string): string => {
    const t = calibrationTrend(corpus, axis);
    return `<li><strong>${esc(label)}:</strong> ${esc(NATIVE_TREND_COPY[t.direction] ?? "")}</li>`;
  };

  const calBlock =
    cal.n >= 4
      ? `<p class="muted small">How well your read matches your self-reports (a higher agreement, lower error read is a better one):</p>
         <ul class="model-trend">${trendLine("valence", "Mood")}${trendLine("arousal", "Energy")}</ul>`
      : `<p class="muted small">Calibration starts once you've confirmed a few reads.</p>`;

  const hintBlock = hint ? `<p class="model-hint">${esc(hint)}</p>` : ready.anyReady ? `<p class="muted small">Enough data to retrain — your model updates as you go.</p>` : "";

  // PERSONALIZATION BENEFIT (v3, §C): an honest, abstaining "is personalizing actually
  // helping vs the plain backbone, against your own self-reports?" — a coarse category,
  // never a raw accuracy number (ADR-0008).
  const benefit = assessPersonalizationBenefit(corpus).status;
  const benefitBlock =
    benefit === "insufficient_evidence"
      ? ""
      : `<p class="muted small model-benefit">${esc(BENEFIT_COPY[benefit])}</p>`;

  card.innerHTML = `
    <h3>Your hum model <span class="muted small">(learns from your feedback — non-diagnostic)</span></h3>
    <p class="muted small">${stats.total} labelled hum${stats.total === 1 ? "" : "s"} so far · ${stats.quadrantsCovered}/4 mood-energy regions covered.</p>
    <ul class="model-status-list">${modelLines}</ul>
    ${calBlock}
    ${benefitBlock}
    ${hintBlock}
    <p class="disclaimer">Research-stage and non-clinical. This model reflects how your hums map to how you say you feel — it is not a diagnosis.</p>
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

export function renderInterventionOfDay(read: OrchestratedRead): void {
  const card = $("intervention-card");
  if (!card) return;
  const iod = read.userFacing.interventionOfDay;
  const cat = IOD_CATEGORY_LABEL[iod.category] ?? formatEnumLabel(iod.category);
  const duration = iod.durationMinutes > 0 ? ` · ${iod.durationMinutes} min` : "";
  const basedOn = iod.basedOnSignals.length
    ? `<div class="chips"><span class="muted small">Based on:</span> ${iod.basedOnSignals
        .map((s) => `<span class="chip">${esc(s)}</span>`)
        .join("")}</div>`
    : "";
  const notBasedOn = iod.notBasedOn.length
    ? `<p class="muted small">Not based on: ${esc(iod.notBasedOn.join(", "))}.</p>`
    : "";
  const music = iod.musicRecommendation ? musicBlock(iod.musicRecommendation) : "";
  const escalationCopy = iod.escalation?.show ? iod.escalation.copy : undefined;
  const escalation = escalationCopy ? `<p class="monitor">${esc(escalationCopy)}</p>` : "";
  const safety = iod.safetyNote ? `<p class="disclaimer">${esc(iod.safetyNote)}</p>` : "";
  card.innerHTML = `
    <div class="iod-head">
      <h3>Today's suggestion</h3>
      <span class="iod-cat">${esc(cat)}${esc(duration)}</span>
    </div>
    <p class="iod-title"><strong>${esc(iod.title)}</strong></p>
    <p class="iod-instruction">${esc(iod.instruction)}</p>
    <p class="muted iod-why">${esc(iod.whySuggested)}</p>
    <p class="muted small iod-conf">${esc(IOD_CONFIDENCE_LABEL[iod.confidenceLanguage] ?? iod.confidenceLanguage)}</p>
    ${music}
    ${basedOn}
    ${notBasedOn}
    ${escalation}
    ${safety}
  `;
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
        ? `<p class="muted small">Your baseline looks like it's been shifting a little higher lately — the model is re-centering on your new usual.</p>`
        : p.regimeShift === "down"
          ? `<p class="muted small">Your baseline looks like it's been shifting a little lower lately — the model is re-centering on your new usual.</p>`
          : "";
    const drivers =
      p.topContributors && p.topContributors.length > 0
        ? `<p class="muted small">A few of your most distinctive hum features shaped today's comparison.</p>`
        : "";
    body = `<p>Re-referenced against <strong>your</strong> baseline — this hum reads as ${esc(closeness)}. Your personal pattern now shapes the read.</p>${shift}${drivers}`;
  } else if (n < 5) {
    const count = n > 0 ? ` <span class="muted small">(${n} eligible hum${n === 1 ? "" : "s"} so far.)</span>` : "";
    body = `<p>Working from the population baseline now — your read is fully live. As your own pattern builds over the next few hums, it quietly starts re-referencing against <em>your</em> usual.${count}</p>`;
  } else {
    body = `<p class="muted">Population read for this hum — not enough matching baseline coverage to personalize it yet. It keeps refining as you hum.</p>`;
  }
  card.innerHTML = `
    <h3>Personalization <span class="muted small">(silent refinement — never gates the read)</span></h3>
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
    <h3>Read refinement <span class="muted small">(quietly sharpens the read — never withholds it)</span></h3>
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

// ── consent-gated longitudinal panel (qualitative direction + provenance; non-diagnostic) ──
//
// Surfaces the within-you longitudinal SHAPE — trend direction, recovery vs sustained
// drift, gentle routing, and which of YOUR signals informed it — as words only. It never
// renders riskHypothesis.confidence, driftMagnitude, or any number/percent (the 88% clinical
// cap is a no-numbers-in-copy rule here), never a clinical label, and stays consent-gated.
const TREND_COPY: Record<"improving" | "worsening" | "stable" | "uncertain", string> = {
  improving: "Your recent pattern looks like it's gently easing toward steadier.",
  worsening: "Your recent pattern looks a little more unsettled than your usual.",
  stable: "Your recent pattern looks steady.",
  uncertain: "Your recent pattern isn't clear enough to call yet.",
};

export function renderLongitudinal(
  read: OrchestratedRead | null,
  consent: ConsentState,
  eligibleHumCount: number,
): void {
  const card = $("longitudinal-card");
  if (!card) return;
  // ADR-0006: the longitudinal DATA stays consent-gated — but the PANEL is always
  // discoverable, so a first-time user can see the view exists and how to turn it on
  // (rather than it being invisible). When consent is off we render a clear locked state.
  card.hidden = false;
  if (!isGranted(consent, "clinical_risk_surfacing")) {
    card.innerHTML = `
      <h3>Longitudinal view <span class="badge-mini">locked · consent-gated · non-diagnostic</span></h3>
      <p class="muted">This view looks at your pattern <em>across many hums</em> — a gentle trend direction and sustained-change monitoring, in words only. It never diagnoses, and stays off until you turn it on.</p>
      <p class="muted small">Turn on “Surface the consent-gated longitudinal / risk-marker view” in <strong>Consent</strong> above to see it. Your per-hum read is exactly the same either way.</p>
      <p class="disclaimer">Research-stage and non-clinical. Hum AI does not diagnose, and this view is not a medical evaluation.</p>
    `;
    return;
  }
  const lg = read ? read.internal.longitudinal : null;
  const n = read ? read.internal.eligibleHumCount : eligibleHumCount;

  // Before a personal baseline forms there is no within-you longitudinal judgement yet
  // (also the pre-first-hum case, read === null). The per-hum read is never affected.
  if (!read || !lg || lg.abstained) {
    const count = n > 0 ? ` <span class="small">(${n} eligible hum${n === 1 ? "" : "s"} so far.)</span>` : "";
    card.innerHTML = `
      <h3>Longitudinal view <span class="badge-mini">consented · non-diagnostic</span></h3>
      <p class="muted">Collecting your longitudinal history. A trend read starts once your own baseline forms, and sustained-pattern monitoring sharpens as more daily hums come in.${count} The per-hum read above is unaffected.</p>
      <p class="disclaimer">Research-stage and non-clinical. Hum AI does not diagnose, and this view is not a medical evaluation.</p>
    `;
    return;
  }

  const parts: string[] = [`<p class="trend">${esc(TREND_COPY[lg.trendDirection] ?? TREND_COPY.uncertain)}</p>`];

  if (lg.recovery) {
    parts.push(
      lg.recovery.trajectoryDirection === "exceeding_prior_stable"
        ? `<p class="muted">You're tracking a little above your usual steadier baseline — a positive sign.</p>`
        : `<p class="muted">You're settling back toward your steadier pattern.</p>`,
    );
  }

  if (lg.relapseDrift) {
    parts.push(
      lg.relapseDrift.driftDirection === "diverging_from_stable"
        ? `<p class="monitor">This stretch is drifting from your steadier pattern across several recent hums.</p>`
        : `<p class="monitor">This stretch looks more unsettled than your steadier pattern across several recent hums.</p>`,
    );
    parts.push(
      lg.relapseDrift.userAction === "check_in_prompt"
        ? `<p class="monitor">A gentle check-in might help right now. This is reflective support, not a medical assessment.</p>`
        : `<p class="muted">We'll keep gently noticing this — nothing to act on right now.</p>`,
    );
  } else if (read.internal.stage !== "relapse_model") {
    parts.push(
      `<p class="muted small">Sustained-pattern monitoring engages once there's enough of your history (around 20 daily hums); the trend above already reflects your baseline so far.</p>`,
    );
  } else {
    parts.push(`<p class="muted">Nothing notable stands out in your longitudinal pattern right now.</p>`);
  }

  // Provenance chips: which of YOUR signals materially informed this view (explainability,
  // not a verdict). Direct field access — no clinical id, no number.
  const sources: ReadonlyArray<readonly [boolean, string]> = [
    [lg.evidenceSources.personalBaseline, "your personal baseline"],
    [lg.evidenceSources.longitudinalTrend, "your longitudinal trend"],
    [lg.evidenceSources.relapseModel, "your own longitudinal model"],
    [lg.evidenceSources.recoverySignature, "your recovery signature"],
    [lg.evidenceSources.highRiskSignature, "your learned pattern"],
  ];
  const chips = sources
    .filter(([on]) => on)
    .map(([, label]) => `<span class="chip">${esc(label)}</span>`)
    .join("");
  const provenance = chips ? `<div class="chips"><span class="muted small">Based on:</span> ${chips}</div>` : "";

  card.innerHTML = `
    <h3>Longitudinal view <span class="badge-mini">consented · non-diagnostic</span></h3>
    ${parts.join("")}
    ${provenance}
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
    mp.priorContribution === "fused"
      ? `Secondary affect-label hint from the trained 6-class prior${mp.gatePassed === false ? " (below its promotion gate; far-domain, penalized)" : ""}.`
      : mp.priorContribution === "held_failed_gate"
        ? "Secondary affect-label hint from the heuristic ensemble — the trained 6-class prior was held back (it hasn't passed its promotion gate, so it doesn't steer your read)."
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
