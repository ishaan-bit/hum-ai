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
import { LIFE_CONTEXT, type DiaryContextMap } from "./diary-store";

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
      <h3>${icon("compass")} Where you are <span class="muted small">(mood + energy · reflective)</span></h3>
      ${moodSpectra(a.valence, a.arousal)}
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
      diag.innerHTML = diagnosticsBody(read);
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

/**
 * One READING SPECTRUM (ASK: the 2×2 was illegible): a labelled duotone gradient bar with a
 * glowing marker at the read's position, the current pole word lit, and both poles named. Two of
 * these (Mood, Energy) replace the old quadrant grid — an end user reads them at a glance.
 * Magnitude lives in the marker POSITION + glow (style attr, stripped by the safety screen), never
 * a number (ADR-0008). The markers GLIDE in on reveal (CSS transition on `left`).
 */
function spectrumRow(label: string, leftPole: string, rightPole: string, value: number, nowWord: string, tone: string): string {
  const pct = ((clampUnit(value) + 1) / 2) * 100;
  return `
    <div class="spectrum spectrum-${tone}">
      <div class="spectrum-top">
        <span class="spectrum-label">${esc(label)}</span>
        <span class="spectrum-now">${esc(nowWord)}</span>
      </div>
      <div class="spectrum-track">
        <span class="spectrum-fill" style="left:${pct.toFixed(1)}%"></span>
      </div>
      <div class="spectrum-poles"><span>${esc(leftPole)}</span><span>${esc(rightPole)}</span></div>
    </div>`;
}

/** The legible mood + energy read: a bold named state, then two reading spectra. */
function moodSpectra(vRes: AxisResolution, aRes: AxisResolution): string {
  const v = clampUnit(vRes.value);
  const a = clampUnit(aRes.value);
  const band = confBand(Math.max(vRes.confidence, aRes.confidence));
  const zone = zoneFor(v, a);
  const aria = `You read as ${zone}: ${zoneDescriptor(v, a)}, ${band} signal.`;
  return `
    <div class="mood-read mood-${band}" role="img" aria-label="${esc(aria)}">
      <div class="state-name">
        <span class="state-name-zone">${esc(zone)}</span>
        <span class="state-name-desc">${esc(zoneDescriptor(v, a))}</span>
        <span class="signal-chip signal-${band}" aria-hidden="true">${esc(band)} signal</span>
      </div>
      <div class="spectra" aria-hidden="true">
        ${spectrumRow("Mood", "low", "bright", v, moodWord(v), "mood")}
        ${spectrumRow("Energy", "calm", "charged", a, energyWord(a), "energy")}
      </div>
    </div>`;
}

/** Provenance line for the read — user-facing, no model-status detail. */
function axisProvenance(_res: AxisResolution): string {
  return "On-device acoustic read.";
}

// ── richer diagnostics: a small tile grid of everything Hum noticed (qualitative only) ──
function diagTile(k: string, v: string, tone: string): string {
  return `<div class="diag-tile"><span class="diag-k">${esc(k)}</span><span class="diag-v diag-${tone}">${esc(v)}</span></div>`;
}

/**
 * "What Hum noticed" — surfaces the read's internal detail the dashboard view used to hide:
 * per-axis clarity, how much clear signal the hum carried, whether the trained model contributed,
 * and how this hum sits against the user's own baseline. All qualitative (ADR-0008): the words are
 * coarse bands, never numbers, and carry no clinical id.
 */
function diagnosticsBody(read: OrchestratedRead): string {
  const a = read.internal.axis;
  const p = read.internal.personalization;
  const n = read.internal.eligibleHumCount;

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

  const tiles = [
    diagTile("Mood clarity", confBand(a.valence.confidence), confBand(a.valence.confidence)),
    diagTile("Energy clarity", confBand(a.arousal.confidence), confBand(a.arousal.confidence)),
    diagTile("Signal", sigWord, sigTone),
    diagTile("Read basis", basis, "info"),
    diagTile("Your baseline", persWord, persTone),
  ].join("");

  const shift =
    p.regimeShift === "up"
      ? "Your usual looks like it's been drifting a little higher lately; the read is re-centering on it."
      : p.regimeShift === "down"
        ? "Your usual looks like it's been drifting a little lower lately; the read is re-centering on it."
        : "";
  const shiftLine = shift ? `<p class="diag-note muted small">${esc(shift)}</p>` : "";

  return `
    <h3>${icon("pulse")} What Hum noticed <span class="muted small">(this hum, non-diagnostic)</span></h3>
    <div class="diag-grid">${tiles}</div>
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
    <h4>Does this match how you feel? <span class="muted small">nudge the sliders if not, it teaches your hum model</span></h4>
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
      <button id="fb-confirm" class="btn btn-sm btn-ghost">Spot on, leave it</button>
    </div>
    <p class="muted small disclaimer">Stored as derived features + your self-report only, never raw audio. Non-clinical.</p>
  `;

  const thank = (): void => {
    card.innerHTML = `<p class="fb-thanks">Thanks, your hum model just learned from this. ✓</p>`;
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

/** A single trait bar: low pole ←•→ high pole, with the lean lit. Foregrounded OCEAN traits get `.primary`. */
function traitBar(t: PersonalitySignature["traits"][number]): string {
  const left = Math.max(0, Math.min(100, ((t.value + 1) / 2) * 100));
  return `
    <div class="trait${t.primary ? " primary" : ""}" title="${esc(t.label)}: ${esc(t.blurb)}">
      <div class="trait-head"><span class="trait-name">${esc(t.label)}</span></div>
      <div class="trait-poles"><span class="${t.lean === "low" ? "on" : ""}">${esc(t.lowPole)}</span><span class="${t.lean === "high" ? "on" : ""}">${esc(t.highPole)}</span></div>
      <div class="trait-track"><span class="trait-fill" style="left:${left.toFixed(1)}%"></span></div>
    </div>`;
}

/** The OCEAN lede: the two foregrounded traits (Openness, Conscientiousness) as a prominent pair. */
function oceanLede(primaryTraits: PersonalitySignature["primaryTraits"]): string {
  if (primaryTraits.length === 0) return "";
  const cell = (t: PersonalitySignature["traits"][number]): string => {
    const word = t.lean === "high" ? t.highPole : t.lean === "low" ? t.lowPole : "balanced";
    return `
      <div class="sig-ocean-trait">
        <span class="sig-ocean-name">${esc(t.label)}</span>
        <span class="sig-ocean-lean ${t.lean}">${esc(word)}</span>
      </div>`;
  };
  return `<div class="sig-ocean" role="group" aria-label="Your foregrounded Big Five traits">${primaryTraits.map(cell).join("")}</div>`;
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

  const lede = oceanLede(sig.primaryTraits);
  const bars = sig.traits.map(traitBar).join("");
  card.innerHTML = `
    <h3>${icon("spark")} Your hum signature <span class="badge-mini">Big Five (OCEAN) · ${sig.status === "tentative" ? "tentative" : "early"} · exploratory, not a test</span></h3>
    ${lede}
    <p class="sig-headline">${esc(sig.headline)}</p>
    <div class="sig-traits">${bars}</div>
    ${trendLine}
    <p class="disclaimer">An exploratory mirror of how your hums tend to sound over time, leaning on the two traits most legible in a voice (openness and conscientiousness); not a personality test, not a clinical read.</p>
  `;
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

// ── chart geometry: time-aware sparkline with the user's personal-normal band shaded ──────────
const CH_W = 320;
const CH_H = 132;
const CH_PADX = 16;
const CH_TOP = 16;
const CH_BOT = 18;
const chX = (i: number, n: number): number =>
  n <= 1 ? CH_W / 2 : CH_PADX + (i / (n - 1)) * (CH_W - 2 * CH_PADX);
const chY = (v: number): number => CH_TOP + (1 - (clampUnit(v) + 1) / 2) * (CH_H - CH_TOP - CH_BOT);

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

// ── when-labels (relative, human; no confidence numbers, so render-safe) ──────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
function relativeDay(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "A recent hum";
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(t);
  return days < 7
    ? d.toLocaleDateString([], { weekday: "long" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function whenLabel(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "A recent hum";
  const time = new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${relativeDay(at, now)}, ${time}`;
}

/** The time-aware chart: a shaded personal-normal band, a mood line, one tappable dot per hum. */
function diaryChart(points: readonly DiaryPoint[], band: NormalBand | null, focusAt: string | null): string {
  const pts = points.slice(-30); // a readable window; the headline count stays authoritative
  const n = pts.length;
  if (n === 0) return diaryGhost();
  const coords = pts.map((p, i) => [chX(i, n), chY(p.valence)] as const);

  let bandLayer = "";
  if (band) {
    const yHi = chY(band.hi);
    const yMid = chY(band.mid);
    const h = (chY(band.lo) - yHi).toFixed(1);
    bandLayer =
      `<rect class="diary-band" x="0" y="${yHi.toFixed(1)}" width="${CH_W}" height="${h}" rx="7"/>` +
      `<line class="diary-band-mid" x1="0" y1="${yMid.toFixed(1)}" x2="${CH_W}" y2="${yMid.toFixed(1)}"/>`;
  }
  const line =
    n > 1
      ? `<polyline class="diary-line" fill="none" points="${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`
      : "";
  const dots = pts
    .map((p, i) => {
      const [x, y] = coords[i]!;
      const last = i === n - 1;
      const focused = focusAt ? p.at === focusAt : last;
      const pos = positionOf(p.valence, band);
      const cls = `diary-dot pos-${pos}${last ? " diary-today" : ""}${focused ? " is-focus" : ""}`;
      return `<circle class="${cls}" data-at="${esc(p.at)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${focused ? "5" : last ? "4.2" : "3"}" style="--i:${i}"/>`;
    })
    .join("");
  return `<svg class="diary-svg" viewBox="0 0 ${CH_W} ${CH_H}" role="img" aria-label="Your recent hums over time, with your usual mood range shaded.">${bandLayer}${line}${dots}</svg>`;
}

/** A faint, static placeholder chart so the diary reads as graphical before there's data. */
function diaryGhost(): string {
  const heights = [0.6, 0.42, 0.55, 0.34, 0.5, 0.3, 0.46, 0.4];
  const n = heights.length;
  const dots = heights
    .map((t, i) => {
      const cx = chX(i, n).toFixed(1);
      const cy = (CH_TOP + (1 - t) * (CH_H - CH_TOP - CH_BOT)).toFixed(1);
      return `<circle class="diary-dot diary-ghost" cx="${cx}" cy="${cy}" r="2.7"/>`;
    })
    .join("");
  return `<svg class="diary-svg diary-svg-ghost" viewBox="0 0 ${CH_W} ${CH_H}" aria-hidden="true">${dots}</svg>`;
}

/** Date scale under the chart (plain dates — no confidence numbers). */
function chartScale(points: readonly DiaryPoint[], now: number): string {
  const pts = points.slice(-30);
  if (pts.length < 2) return "";
  const first = relativeDay(pts[0]!.at, now);
  const last = relativeDay(pts[pts.length - 1]!.at, now);
  return `<div class="diary-scale"><span>${esc(first)}</span><span class="diary-scale-legend">shaded = your usual range</span><span>${esc(last)}</span></div>`;
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
        <p class="muted small">The chart plots each hum's mood over time. The shaded band is your own usual range, worked out only from your past hums, so "different" always means different <em>for you</em>, not different from anyone else.</p>
        <p class="muted small">It reads patterns in your voice, not your situation. It can't see why anything changed, and a single unusual hum is never treated as a trend.</p>
        ${basedOn}
        <p class="muted small">Research-stage and non-clinical. It does not diagnose, and it is not a medical evaluation. If you are struggling, please reach out to someone you trust or a support line.</p>
      </div>
    </details>`;
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

  card.innerHTML = `
    <h3>${icon("book")} Your diary of hums <span class="badge-mini">${esc(countBadge)}</span></h3>
    <div class="diary-lately-block tone-${pattern.tone}">
      <span class="diary-lately-tag">Lately</span>
      <p class="diary-lately">${esc(pattern.lately)}</p>
      <p class="muted small">${esc(pattern.heading)}</p>
    </div>
    ${diaryChart(points, band, focusAt)}
    ${chartScale(points, now)}
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
