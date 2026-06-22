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
import { isGranted } from "./consent";
import { createBreathPacer, type BreathPacer } from "./breath";
import type { PersonalitySignature } from "@hum-ai/personality-signature";

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
    // The read's region — a safe, reflective description derived from the V-A read (the same
    // signal the intervention is shaped for). This is the diagnostic "what it leans toward",
    // qualitative and non-clinical (ADR-0008): e.g. "more activated and less steady than usual".
    // Skipped for the longitudinal/safety_support region (its description is a multi-hum trend,
    // not how THIS hum sounded — surfacing it as a single-read region would be dishonest).
    const iod = read.userFacing.interventionOfDay;
    const region = iod?.targetStateDescription;
    const regionLine = region && iod?.category !== "safety_support"
      ? `<p class="read-region">This hum read as <strong>${esc(region)}</strong>.</p>`
      : "";
    axes.innerHTML = `
      <h3>Where you are <span class="muted small">(mood + energy · reflective, non-diagnostic)</span></h3>
      ${moodField(a.valence, a.arousal)}
      ${regionLine}
      <p class="axis-prov muted small">${esc(axisProvenance(a.valence))}</p>
      ${hint}
    `;
  }
}

/** The four named zones of the valence–arousal circumplex (friendly, non-clinical). */
const MOOD_ZONES: ReadonlyArray<{ readonly hiV: boolean; readonly hiA: boolean; readonly label: string }> = [
  { hiV: true, hiA: true, label: "Energised" },
  { hiV: false, hiA: true, label: "Tense" },
  { hiV: false, hiA: false, label: "Low" },
  { hiV: true, hiA: false, label: "Calm" },
];

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

/**
 * GAMIFIED mood–energy field (ASK 4): the read plotted as a glowing marker on a 2-D circumplex
 * — horizontal = mood (low ↔ bright), vertical = energy (calm ↔ charged) — with the four named
 * zones lit around it. Magnitude lives in the marker's POSITION + glow, never a number (ADR-0008).
 * The overall confidence sets how sharp/bright the marker reads.
 */
function moodField(vRes: AxisResolution, aRes: AxisResolution): string {
  const v = Math.max(-1, Math.min(1, vRes.value));
  const a = Math.max(-1, Math.min(1, aRes.value));
  const left = ((v + 1) / 2) * 100;
  const top = (1 - (a + 1) / 2) * 100; // arousal high → top
  const conf = Math.max(vRes.confidence, aRes.confidence);
  const band = conf >= EVIDENCE_BANDS.high ? "clear" : conf >= EVIDENCE_BANDS.medium ? "moderate" : "developing";
  const zone = zoneFor(v, a);
  const zones = MOOD_ZONES.map((z) => {
    const on = z.label === zone;
    const pos = `mz-${z.hiV ? "r" : "l"}${z.hiA ? "t" : "b"}`;
    return `<span class="mood-zone ${pos}${on ? " on" : ""}">${esc(z.label)}</span>`;
  }).join("");
  const aria = `Mood and energy: ${zone}, ${band} signal. Mood ${v >= 0.12 ? "bright" : v <= -0.12 ? "low" : "neutral"}, energy ${a >= 0.12 ? "charged" : a <= -0.12 ? "calm" : "even"}.`;
  return `
    <div class="mood-field mood-${band}" role="img" aria-label="${esc(aria)}">
      <div class="mood-grid" aria-hidden="true">
        <span class="mood-axis-label mal-top">charged</span>
        <span class="mood-axis-label mal-bottom">calm</span>
        <span class="mood-axis-label mal-left">low</span>
        <span class="mood-axis-label mal-right">bright</span>
        <span class="mood-cross-h"></span>
        <span class="mood-cross-v"></span>
        ${zones}
      </div>
      <span class="mood-marker" style="left:${left.toFixed(1)}%; top:${top.toFixed(1)}%"></span>
      <span class="mood-zone-now">${esc(zone)} <span class="mood-conf mood-conf-${band}">· ${band} signal</span></span>
    </div>`;
}

/** Honest trained-prior provenance line for the read (qualitative only, no accuracy %). */
function axisProvenance(res: AxisResolution): string {
  if (res.trainedContribution === "in_domain")
    return "On-device acoustic read — the trained model agreed with the signal for this hum.";
  if (res.trainedContribution === "abstained_ood")
    return "On-device acoustic read — the trained model was set aside (this hum is outside its training domain).";
  if (res.trainedContribution === "held_failed_gate")
    return "On-device acoustic read — a trained model is available but isn't ready to steer your read yet.";
  return "On-device acoustic read (no trained model loaded).";
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
    note: "I only caught a moment of it. Hold one steady note for the full twelve seconds and I'll read it.",
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
    note: "I heard pitch moving around like speech or a tune. Hum one steady, even note — lips closed — and hold it. Nothing was read or saved.",
  },
  not_voiced: {
    title: "I couldn't find a steady tone",
    note: "That read more like a breath or a sigh than a hum. Hum a clear, even note you can feel buzzing. Nothing was read or saved from this take.",
  },
  too_choppy: {
    title: "That was mostly pauses",
    note: "A few breath pauses are fine, but this was mostly quiet. Keep the hum going a little more of the time — nothing was read or saved.",
  },
  unclear: {
    title: "I didn't catch a clear hum",
    note: "That take didn't sound like a sustained hum. Find a quiet spot and hum one steady note for the full twelve seconds. Nothing was read or saved.",
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
  if (axes) axes.innerHTML = `<p class="muted">No read this time — I only interpret a clear, sustained hum.</p>`;
  const intervention = $("intervention-card");
  if (intervention) intervention.innerHTML = "";
  const personalization = $("personalization-card");
  if (personalization) personalization.innerHTML = "";
  const longitudinal = $("longitudinal-card");
  if (longitudinal) longitudinal.hidden = true;
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
  // ASK 5: no separate "Adjust" toggle — the sliders are right here, pre-set to the read. Nudge
  // them if it's off and hit Save; or tap "Spot on" if the read already fits. One obvious path.
  card.innerHTML = `
    <h4>Does this match how you feel? <span class="muted small">nudge the sliders if not — it teaches your hum model</span></h4>
    <p class="muted small">${esc(request.note)}</p>
    <div class="feedback-adjust">
      <label class="fb-slider">
        <span>Mood <span class="muted small">low ↔ bright</span></span>
        <input type="range" id="fb-valence" min="-100" max="100" step="5" value="${v0}" />
      </label>
      <label class="fb-slider">
        <span>Energy <span class="muted small">calm ↔ charged</span></span>
        <input type="range" id="fb-arousal" min="-100" max="100" step="5" value="${a0}" />
      </label>
    </div>
    <div class="feedback-actions">
      <button id="fb-save" class="btn btn-primary btn-sm">Save how I feel</button>
      <button id="fb-confirm" class="btn btn-sm btn-ghost">Spot on — leave it</button>
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
  $("fb-save")?.addEventListener("click", () => {
    const vEl = document.getElementById("fb-valence") as HTMLInputElement | null;
    const aEl = document.getElementById("fb-arousal") as HTMLInputElement | null;
    const valence = vEl ? Number(vEl.value) / 100 : predicted.valence;
    const arousal = aEl ? Number(aEl.value) / 100 : predicted.arousal;
    // Unmoved sliders ⇒ this IS a confirmation of the read (agreedWithRead true).
    const agreed = Math.abs(valence - predicted.valence) < 0.2 && Math.abs(arousal - predicted.arousal) < 0.2;
    onSubmit({
      label: { valence, arousal },
      source: agreed ? "self_report_confirm" : "self_report_adjust",
      agreedWithRead: agreed,
    });
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
      ? `<div class="iod-moves" role="group" aria-label="Two ways to do this — pick whichever fits">
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
  const footer = `<p class="iod-foot muted small">${conf} · reflective only — no medical label, clinical instrument, or certainty score.</p>`;

  card.innerHTML = `
    <div class="iod-head">
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

// ── the hum signature (ASK 7): the within-you assessment, first-class in the State window ──
//
// Surfaces the tentative, EXPLORATORY personality signature (Big Five tendencies + a playful
// 4-letter "hum type") computed from the longitudinal baseline, alongside a compact within-you
// trend line. This is the "real assessment of your internal state over time" the read leads
// toward — non-clinical, a mirror not a verdict. All strings are screen-safe (see the
// @hum-ai/personality-signature package test); we esc() them anyway.

/** A single trait bar: low pole ←•→ high pole, with the lean lit. */
function traitBar(t: PersonalitySignature["traits"][number]): string {
  const left = Math.max(0, Math.min(100, ((t.value + 1) / 2) * 100));
  return `
    <div class="trait" title="${esc(t.blurb)}">
      <div class="trait-poles"><span class="${t.lean === "low" ? "on" : ""}">${esc(t.lowPole)}</span><span class="${t.lean === "high" ? "on" : ""}">${esc(t.highPole)}</span></div>
      <div class="trait-track"><span class="trait-fill" style="left:${left.toFixed(1)}%"></span></div>
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
    trendLine = `<p class="sig-trend muted small">Your within-you trend sharpens as your pattern grows — ${n} hum${n === 1 ? "" : "s"} in.</p>`;
  }

  if (sig.status === "forming") {
    card.innerHTML = `
      <h3>Your hum signature <span class="badge-mini">forming · exploratory, not a test</span></h3>
      <p class="muted">${esc(sig.headline)}</p>
      ${trendLine}
    `;
    return;
  }

  const typeChip =
    sig.type && sig.typeNickname
      ? `<div class="sig-type"><span class="sig-type-letters">${esc(sig.type)}</span><span class="sig-type-nick">${esc(sig.typeNickname)}</span></div>`
      : "";
  const bars = sig.traits.map(traitBar).join("");
  card.innerHTML = `
    <h3>Your hum signature <span class="badge-mini">${sig.status === "tentative" ? "tentative" : "early"} · exploratory, not a test</span></h3>
    ${typeChip}
    <p class="sig-headline">${esc(sig.headline)}</p>
    <div class="sig-traits">${bars}</div>
    ${trendLine}
    <p class="disclaimer">A playful mirror of how your hums tend to sound over time — not a personality test, not a diagnosis.</p>
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

// The standing honesty frame for the pattern view — a mirror, not a verdict.
const PATTERN_MIRROR_NOTE =
  "A mirror, not a verdict. It compares you only to you, can't see why anything shifted, and never decides anything for you. If you're struggling, please reach out to someone you trust or a support line. Research-stage and non-clinical — not a medical evaluation.";

export function renderLongitudinal(
  read: OrchestratedRead | null,
  consent: ConsentState,
  eligibleHumCount: number,
): void {
  const card = $("longitudinal-card");
  if (!card) return;
  // ADR-0006: the longitudinal DATA stays consent-gated — but the PANEL is always
  // discoverable, so a first-time user can see the view exists and how to turn it on
  // (rather than it being invisible). When consent is off we render a clear locked state —
  // framed as THE early-noticing feature, not a buried risk toggle.
  card.hidden = false;
  if (!isGranted(consent, "clinical_risk_surfacing")) {
    card.innerHTML = `
      <h3>Your pattern over time <span class="badge-mini">off until you turn it on · not a medical view</span></h3>
      <p class="muted">This is the part that makes Hum more than a daily mood check. It learns <em>your</em> normal — your steady pattern — so it can gently flag when you've drifted away from it, <strong>early</strong>. It can't do that without remembering your hums, so it stays off until you say yes.</p>
      <p class="muted small">Turn on <strong>“Notice changes early”</strong> under <strong>Privacy &amp; consent</strong> below. Your per-hum read is exactly the same either way.</p>
      <p class="disclaimer">${esc(PATTERN_MIRROR_NOTE)}</p>
    `;
    return;
  }
  const lg = read ? read.internal.longitudinal : null;
  const n = read ? read.internal.eligibleHumCount : eligibleHumCount;

  // Before a personal baseline forms there is no within-you longitudinal judgement yet
  // (also the pre-first-hum case, read === null). Lead with INTENT — today is baseline-
  // building, which is what later lets Hum notice change early — never surfacing
  // riskHypothesis, relapseDrift, or any clinical field (all null/insufficient when abstained).
  if (!read || !lg || lg.abstained) {
    let progressCopy: string;
    if (n === 0) {
      progressCopy =
        "Baseline-building starts with your first hum. We learn what “usual” sounds like for you — the noticing comes once there's enough of your own history to compare against.";
    } else if (n < 5) {
      progressCopy = `Baseline forming · ${n} hum${n === 1 ? "" : "s"} in. Each one adds a snapshot of your usual. Your personal pattern engages around hum 5; the trend view, as it grows.`;
    } else {
      progressCopy = `Your personal baseline is active · ${n} hums in. The early-noticing trend view sharpens as your pattern grows (around 20 daily hums) — but it's already learning your usual.`;
    }
    card.innerHTML = `
      <h3>Your pattern over time <span class="badge-mini">on · non-diagnostic</span></h3>
      <p class="muted">${esc(progressCopy)}</p>
      <p class="muted small">Your per-hum read above is unaffected by this.</p>
      <p class="disclaimer">${esc(PATTERN_MIRROR_NOTE)}</p>
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
    <h3>Your pattern over time <span class="badge-mini">on · non-diagnostic</span></h3>
    ${parts.join("")}
    ${provenance}
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
