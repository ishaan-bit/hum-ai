/**
 * Hum AI web client — entry point.
 *
 * Drives the end-to-end cycle on-device and grows a personal baseline across hums:
 * capture/synthesize → full spine (with the trained prior) → safe read → LEARN (ingest)
 * → persist (localStorage always; Firebase when consented + signed in). Local-first and
 * resilient: with no mic, no cloud, or no model artifact, it still runs honestly.
 */
import "./styles.css";
import { newPersonalizationState, stagePolicy, ingestFeedback, updateArm } from "@hum-ai/personalization-engine";
import {
  asIsoTimestamp,
  asModelVersion,
  asUserId,
  defaultConsent,
  type ConsentState,
  type IsoTimestamp,
  type ModelVersion,
} from "@hum-ai/shared-types";
import type { AudioInput } from "@hum-ai/audio-features";
import type { HumSelfReport } from "@hum-ai/affect-model-contracts";
import {
  applyFeedback,
  humHistoryFromState,
  type OrchestratedRead,
  type PersonalizationState,
  type AffectAxisPriors,
  type AcousticAxisSample,
} from "@hum-ai/orchestrator";
import { assessPersonalitySignature, type PersonalitySignature } from "@hum-ai/personality-signature";
import {
  emptyCorpus,
  appendExample,
  buildHumNativeArtifact,
  axisPriorsFromArtifact,
  corpusReadiness,
  hasPromotedNativeModel,
  combinedFeatureImportance,
  trainFusionMetaLearner,
  metaLearnerFromParams,
  type NativeCorpus,
  type HumNativeArtifact,
} from "@hum-ai/native-corpus";
import {
  selectAxisPriors,
  populationAxisPriors,
  buildPopulationContribution,
  contributorPseudonym,
  type PopulationArtifact,
} from "@hum-ai/population-corpus";
import type { MetaLearner } from "@hum-ai/orchestrator";
import { loadConsent, setScope, isGranted, type ToggleableScope } from "./consent";
import { loadBrowserPrior, loadPopulationArtifact, type LoadedPrior } from "./prior";
import { recordHum, synthesize, synthesizeMood, primeMicrophone, type SynthKind } from "./capture";
import { runHumCycle } from "./cycle";
import {
  localUserId,
  loadStateLocal,
  saveStateLocal,
  loadStateCloud,
  saveStateCloud,
  appendHumCloud,
} from "./store";
import {
  loadCorpusLocal,
  saveCorpusLocal,
  loadArtifactLocal,
  saveArtifactLocal,
  appendLabelCloud,
  appendPopulationContributionCloud,
  loadCorpusCloud,
  saveArtifactCloud,
  mergeCorpora,
  loadFusionParamsLocal,
  saveFusionParamsLocal,
} from "./corpus-store";
import { signInAnon, getFirebase } from "./firebase";
import {
  loadDiaryContext,
  saveDiaryContext,
  toggleEntryTag,
  patchEntryContext,
  type DiaryContextMap,
} from "./diary-store";
import { loadAcousticRing, appendAcousticRing, clearAcousticRing } from "./acoustic-ring-store";
import { formatDateIST } from "./time";
import { humAgainMessage, type CaptureGateDecision } from "@hum-ai/signal-lab/capture-gate";
import {
  renderRead,
  renderInterventionOfDay,
  renderInterventionFeedback,
  clearInterventionFeedback,
  renderLadder,
  renderLongitudinal,
  renderSignature,
  renderProvenance,
  renderPersonalization,
  renderHistory,
  renderCaptureRejected,
  renderMoodAdjust,
  clearFeedbackPrompt,
  renderModelLab,
  setCaptureStatus,
  setCaptureProgress,
  setSyncStatus,
  setBusy,
  type HistoryEntry,
} from "./render";
import { createOrb, type Orb } from "./orb";
import { createStage, type Stage, type Step } from "./stage";
import { applyStateVisual, visualFromRead, NEUTRAL_VISUAL, ABSTAIN_VISUAL, type StateVisual } from "./theme";
import { saveAuraCard } from "./aura-card";
import { maybeShowOnboarding, showOnboarding, type OnboardingOptions } from "./onboarding";
import { initStudyUi, offerCaptureToStudy } from "./study-ui";

const MODEL_VERSION: ModelVersion = asModelVersion(import.meta.env.HUM_AI_MODEL_VERSION ?? "hum-web@0.1.0");

/** Consent-document version recorded on each pooled population contribution (ADR-0012 audit). */
const POPULATION_CONSENT_VERSION = "population-consent-v1";

const nowTs = (): IsoTimestamp => asIsoTimestamp(new Date().toISOString());

/** crypto.randomUUID needs a secure context; fall back so the simulate-hum path works on plain HTTP. */
function safeUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A captured hum awaiting (optional) HiTL feedback — features live in `read.internal`. */
interface PendingHum {
  readonly id: string;
  readonly capturedAt: IsoTimestamp;
  readonly read: OrchestratedRead;
}

interface Session {
  state: PersonalizationState;
  consent: ConsentState;
  prior: LoadedPrior | null;
  uid: string | null;
  localId: string;
  lastRead: OrchestratedRead | null;
  log: HistoryEntry[];
  /** The user's accumulated native-hum corpus (derived features + self-report labels). */
  corpus: NativeCorpus;
  /** The retrained hum-native model artifact (manifest + promoted models), or null. */
  artifact: HumNativeArtifact | null;
  /** The POPULATION baseline artifact (ADR-0012) — the middle prior tier + population OCEAN
   *  norms a new user starts from; null when none is served (→ far-domain fallback). */
  populationArtifact: PopulationArtifact | null;
  /** HiTL per-feature importance (which features track this user's reported affect). */
  featureImportance: Record<string, number>;
  /** Promoted hum-native fusion meta-learner (secondary read), or null (stub fallback). */
  metaLearner: MetaLearner | null;
  /** The most recent accepted hum, available for the feedback step. */
  pending: PendingHum | null;
  /** The intervention category shown on the previous hum — used to ask "did it help?" on the next hum. */
  previousIntervention: string | null;
  /** Corpus size at the last retrain — gates how often we re-evaluate promotion. */
  lastRetrainSize: number;
  /** The visual derived from the most recent usable read (for the share poster); null when none/abstained. */
  lastVisual: StateVisual | null;
  /** The safety-screened reveal caption for the share poster (uf.innerState ?? uf.headline). */
  lastCaption: string | null;
  /** Rolling buffer of recent reads' dimensional V-A (most-recent last) — makes today's
   *  intervention reflect recent history, not just this hum. In-memory for the session. */
  recentReads: { valence: number; arousal: number }[];
  /** The tentative within-user hum-personality signature (recomputed after each usable read). */
  signature: PersonalitySignature | null;
  /** Self-authored, local-only diary context (chips + note) per hum, keyed by capture time. */
  diaryContext: DiaryContextMap;
  /** Which hum the diary currently has open for inspection (null = the most recent). */
  diaryFocus: string | null;
  /** Recent RAW ACOUSTIC axis reads (most-recent last) — re-references the displayed read on the
   *  user's own usual so it stops pinning to one zone. Local-only; persisted via acoustic-ring-store. */
  acousticRing: AcousticAxisSample[];
}

const session: Session = {
  state: newPersonalizationState(asUserId("bootstrap"), nowTs(), MODEL_VERSION),
  consent: defaultConsent(nowTs()),
  prior: null,
  uid: null,
  localId: "local-anon",
  lastRead: null,
  log: [],
  corpus: emptyCorpus(),
  artifact: null,
  populationArtifact: null,
  featureImportance: {},
  metaLearner: null,
  pending: null,
  previousIntervention: null,
  lastRetrainSize: 0,
  lastVisual: null,
  lastCaption: null,
  recentReads: [],
  signature: null,
  diaryContext: {},
  diaryFocus: null,
  acousticRing: [],
};

/** Recent-reads buffer cap — a "last week or so" window for the history-aware intervention. */
const RECENT_READS_MAX = 8;

/**
 * The tentative within-user personality signature, computed from the longitudinal baseline
 * (the personal feature windows) — exploratory, non-clinical (see @hum-ai/personality-signature).
 */
function currentSignature(): PersonalitySignature {
  const hist = humHistoryFromState(session.state, nowTs());
  // Data-grounded OCEAN windows from the population corpus (ADR-0012) when available, so the Big
  // Five read — like the affect read — keeps improving across users; protocol defaults otherwise.
  return assessPersonalitySignature(
    hist.eligibleSamplesByFeature,
    hist.priorEligibleCount,
    session.populationArtifact?.oceanNorms,
  );
}

/** The persistent AURA orb (one Canvas, shared across windows) + the windowed stage controller. */
let orb: Orb | null = null;
let stage: Stage | null = null;

/** Re-evaluate the hum-native model after this many new labels (kept cheap + responsive). */
const RETRAIN_EVERY = 4;

/**
 * The axis priors actually fed to the read, picked per axis across THREE tiers
 * (ADR-0012): the user's OWN promoted hum-native model > the POPULATION baseline the
 * community improved > the shipped far-domain acted-speech prior (which abstains OOD on
 * hums). A brand-new user reads through the population baseline; as they confirm their own
 * hums and promote a personal model, the read shifts onto their own. All three are routed
 * through the same `AffectAxisPrior` seam — the orchestrator is unchanged.
 */
function effectiveAxisPriors(): AffectAxisPriors {
  return selectAxisPriors({
    personal: axisPriorsFromArtifact(session.artifact),
    population: populationAxisPriors(session.populationArtifact),
    farDomain: session.prior?.axisPriors ?? {},
  });
}

function syncEnabled(): boolean {
  return isGranted(session.consent, "derived_feature_sync") && session.uid !== null;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── THE LISTENING: the recording ritual's phases ────────────────────────────────
// The hum capture is staged so each beat feels intentional, not like a recorder running:
//   ready     — the calm invitation (chrome present).
//   listening — tapped Hum; the world quiets (CSS recedes the chrome) and the orb takes over.
//   faint     — live sub-state: we can barely hear you, nudge gently closer.
//   settling  — the hum landed; the orb blooms in place, a held beat of arrival before the read.
// The phase is mirrored on <body data-hum-phase> so the whole recede/return is pure CSS.
type HumPhase = "ready" | "listening" | "faint" | "settling";
function setHumPhase(phase: HumPhase): void {
  if (typeof document !== "undefined") document.body.dataset.humPhase = phase;
}

/** The resting invitation under the Hum button — calm, never a "no mic?" instrument prompt. */
const READY_PROMPT = "When you’re ready.";

// ── AURA experience: the orb + the windowed stage ───────────────────────────────
function setupExperience(): void {
  const canvas = document.getElementById("orb-canvas") as HTMLCanvasElement | null;
  if (canvas) {
    orb = createOrb(canvas);
    orb.resize();
    orb.setMode("resting");
    orb.start();
  }
  setHumPhase("ready");
  // Boot the world in its honest, idle neutral state — listening, not pretending.
  applyStateVisual(NEUTRAL_VISUAL);

  stage = createStage({ onStep: (step) => anchorOrbForStep(step) });

  const onResize = (): void => {
    orb?.resize();
    const s = stage?.current();
    if (s) anchorOrbForStep(s); // re-anchor all windows (orientation flip reflows State/Today too)
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
}

/** Re-anchor the orb as the active window changes (it is the shared element that travels). */
function anchorOrbForStep(step: Step): void {
  // Mirror the step on <body> so CSS can quiet the orb behind the read/today windows — the
  // ripple over the read card read as noise (ASK 3); the read card is the hero there.
  if (typeof document !== "undefined") document.body.dataset.step = step;
  if (!orb) return;
  // Landscape phones: orb sits left, the content column sits right (see the landscape @media).
  const land = window.innerWidth > window.innerHeight && window.innerHeight < 600;
  // On the read screens the orb recedes to a small, centred ambient wash (dimmed further in CSS):
  // the inline #read-avatar now carries the "this is you" meaning, so the read fills the screen
  // instead of giving the top third to a looming orb.
  if (step === "hum") anchorOrbToHumButton();
  else if (step === "state") orb.setAnchor(land ? 0.24 : 0.5, land ? 0.5 : 0.5, land ? 0.46 : 0.42);
  else orb.setAnchor(land ? 0.2 : 0.5, land ? 0.46 : 0.5, land ? 0.42 : 0.4);
}

/** Center the orb exactly on the Hum button so the button reads as the orb's glowing heart. */
function anchorOrbToHumButton(): void {
  if (!orb) return;
  const btn = document.getElementById("btn-record");
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const r = btn?.getBoundingClientRect();
  // Fall back to a sensible lower-centre when the button isn't laid out yet (rect 0 at boot).
  if (!r || r.width === 0) {
    orb.setAnchor(0.5, 0.6, 1);
    return;
  }
  // center-origin math: the .hum-btn :active scale(0.96) doesn't move this midpoint.
  orb.setAnchor((r.left + r.width / 2) / vw, (r.top + r.height / 2) / vh, 1);
}

function showShare(show: boolean): void {
  document.getElementById("btn-share")?.toggleAttribute("hidden", !show);
}

/** Tune the whole world to a read; on a single capture, reveal it (THE TUNING) and advance. */
function presentRead(read: OrchestratedRead, advance: boolean): void {
  const uf = read.userFacing;
  const visual = visualFromRead(read); // ABSTAIN_VISUAL when faint/abstained
  applyStateVisual(visual);
  orb?.setVisual(visual);
  session.lastVisual = uf.abstained ? null : visual;
  session.lastCaption = uf.abstained ? null : uf.innerState ?? uf.headline;
  if (advance) {
    orb?.pulse();
    orb?.setMode(uf.abstained ? "abstain" : "revealed");
    stage?.unlock();
    anchorOrbForStep("state");
    stage?.go("state");
    document.getElementById("btn-hum-again")?.toggleAttribute("hidden", false);
    // THE UNFURL (ASK 3): re-trigger the cinematic reveal animation on the reveal column by
    // toggling the class (force a reflow between remove + add so it always replays).
    const reveal = document.querySelector(".window-state .reveal") as HTMLElement | null;
    if (reveal) {
      reveal.classList.remove("unfurl");
      void reveal.offsetWidth; // reflow
      reveal.classList.add("unfurl");
    }
    // Move focus to the read so screen-reader users hear the reveal (#read-card is tabindex=-1).
    requestAnimationFrame(() => document.getElementById("read-card")?.focus());
  }
  showShare(advance && !uf.abstained);
}

/** Clear every read surface back to its idle placeholder (used by Reset). */
function resetReadSurfaces(): void {
  const rc = document.getElementById("read-card");
  if (rc) rc.innerHTML = `<p class="muted">Hum to see your reflective read.</p>`;
  const ax = document.getElementById("axes-card");
  if (ax) ax.innerHTML = "";
  const iv = document.getElementById("intervention-card");
  if (iv)
    iv.innerHTML = `<h3>Today’s suggestion</h3><p class="muted">A gentle, optional next step appears here with your read.</p>`;
  clearFeedbackPrompt();
  clearInterventionFeedback();
  document.getElementById("btn-hum-again")?.setAttribute("hidden", "");
}

// ── bootstrap ─────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  session.consent = loadConsent();
  session.localId = localUserId();
  reflectConsentInputs();
  setupExperience();

  // Effective identity + state: prefer cloud (authoritative when signed-in & consented).
  let cloud: PersonalizationState | null = null;
  if (isGranted(session.consent, "derived_feature_sync")) {
    session.uid = await signInAnon();
    if (session.uid) cloud = await loadStateCloud(session.uid);
  }
  const local = loadStateLocal(session.localId);
  const effectiveId = session.uid ?? session.localId;
  session.state =
    pickFurthest(cloud, local) ?? newPersonalizationState(asUserId(effectiveId), nowTs(), MODEL_VERSION);

  // Backfill the recent-reads buffer from persisted relapseHistory so today's history-aware
  // intervention reflects recent reads even on a fresh page load.
  if (session.state.relapseHistory.length > 0) {
    session.recentReads = session.state.relapseHistory
      .slice(-RECENT_READS_MAX)
      .map(s => ({ valence: s.dimensional.valence, arousal: s.dimensional.arousal }));
  }
  // The user's own optional context (chips + notes), local-only.
  session.diaryContext = loadDiaryContext(session.localId);
  // The user's recent RAW ACOUSTIC reads — re-references the displayed read on their own usual.
  session.acousticRing = loadAcousticRing(session.localId);

  renderLadderForState(session.state);
  renderHistory(session.log);
  updateSyncStatus();
  // Render the diary panel up front (locked when consent is off) so it's discoverable from the
  // first visit, before any hum. The data stays consent-gated; the chart starts as a ghost.
  renderDiary(null);

  // Load the user's NATIVE-HUM corpus + retrained model (local; merge cloud when consented).
  // This is the HiTL asset: their own confirmed hums and the model trained on them (ADR-0011).
  session.corpus = loadCorpusLocal(session.localId);
  if (session.uid) {
    const cloudCorpus = await loadCorpusCloud(session.uid);
    session.corpus = mergeCorpora(session.corpus, cloudCorpus);
    saveCorpusLocal(session.localId, session.corpus);
  }
  session.artifact = loadArtifactLocal(session.localId);
  session.featureImportance = combinedFeatureImportance(session.corpus);
  session.metaLearner = metaLearnerFromParams(loadFusionParamsLocal(session.localId));
  session.lastRetrainSize = session.corpus.examples.length;
  renderModelLab(session.corpus, session.artifact);

  // Load the trained far-domain prior + the POPULATION baseline (ADR-0012), if served. The
  // population artifact is the middle prior tier + OCEAN norms a new user starts from; absent ⇒
  // far-domain fallback (identical to before). Non-blocking for the rest of the UI.
  [session.prior, session.populationArtifact] = await Promise.all([loadBrowserPrior(), loadPopulationArtifact()]);
  setModelStatus();

  wireControls();

  // First-landing walkthrough (once; re-openable from the tray's "How it works"). Ends on a
  // consent step that primes the mic and offers the early-noticing opt-in.
  maybeShowOnboarding(onboardingOptions());

  // RESEARCH STUDY layer (Workstreams 2 + 6) — additive + gated. A non-participant sees only
  // the "learn about the study" entry; everything else is gated behind enrollment. Boots after
  // the consumer UI so the consumer experience is never blocked on the study path.
  void initStudyUi({
    getConsent: () => session.consent,
    setConsent: (next) => {
      session.consent = next;
      reflectConsentInputs();
    },
    stopCapture: () => setBusy(false),
    relapseLine: () => studyRelapseLine(),
  });
}

/**
 * A within-user, already-screened qualitative hum-trend line for the study dashboard. Reuses
 * the SAME longitudinal trend copy the consumer diary uses (no numbers, no screening
 * probability) — null when there's nothing safe to say yet.
 */
function studyRelapseLine(): string | null {
  const lg = session.lastRead?.internal.longitudinal;
  if (!lg || lg.abstained) return null;
  if (lg.trendDirection === "improving") return "Your recent hums look like they're easing toward steadier.";
  if (lg.trendDirection === "worsening") return "Your recent hums look a little more unsettled than your usual.";
  if (lg.trendDirection === "stable") return "Your recent hums look steady.";
  return null;
}

/**
 * Render the Diary of Hums from a SINGLE source of truth. The chart + moments come from the
 * real on-device relapse ring (timestamped mood + risk, up to 64 hums), NOT the 8-slot
 * intervention buffer — so the chart, the moments, and the header count all agree. The header
 * count stays `eligibleHumCount` (the lived total Hum has learned from). Optional self-authored
 * context (local-only) and the inspected moment ride alongside.
 */
function renderDiary(read: OrchestratedRead | null): void {
  const points = session.state.relapseHistory.map((s) => ({
    at: s.capturedAt as string,
    valence: s.dimensional.valence,
    arousal: s.dimensional.arousal,
    risk: s.riskScore,
  }));
  renderLongitudinal(
    read,
    session.consent,
    read?.internal.eligibleHumCount ?? session.state.eligibleHumCount,
    { points, context: session.diaryContext, focusAt: session.diaryFocus },
  );
}

function focusHum(): void {
  stage?.go("hum");
  setHumPhase("ready");
  setCaptureStatus(READY_PROMPT);
  (document.getElementById("btn-record") as HTMLElement | null)?.focus();
}

/**
 * Onboarding wiring: the final slide primes mic permission (in a warm, explained context) and
 * records the "notice changes early" opt-in. Granting it turns on the same `clinical_risk_surfacing`
 * scope as the tray toggle, so the longitudinal pattern view is live from hum #1.
 */
function onboardingOptions(): OnboardingOptions {
  return {
    onDone: () => focusHum(),
    onRequestMic: primeMicrophone,
    initialLongitudinal: isGranted(session.consent, "clinical_risk_surfacing"),
    onConsent: ({ longitudinal }) => {
      if (longitudinal && !isGranted(session.consent, "clinical_risk_surfacing")) {
        void onConsentChange("clinical_risk_surfacing", true).then(() => reflectConsentInputs());
      }
    },
  };
}

function pickFurthest(a: PersonalizationState | null, b: PersonalizationState | null): PersonalizationState | null {
  if (a && b) return a.eligibleHumCount >= b.eligibleHumCount ? a : b;
  return a ?? b;
}

function renderLadderForState(state: PersonalizationState): void {
  renderLadder(stagePolicy(state.eligibleHumCount).stage, state.eligibleHumCount);
}

function setModelStatus(): void {
  const el = document.getElementById("model-status");
  if (!el) return;
  // A promoted hum-native model (trained on the user's own confirmed hums) leads the line.
  if (session.artifact && hasPromotedNativeModel(session.artifact)) {
    el.textContent =
      "A hum-native model trained on YOUR confirmed hums is now steering your read, in-domain, no far-domain penalty. It keeps improving as you give feedback. Non-clinical.";
    return;
  }
  if (session.prior) {
    const meta = session.prior.axisMeta;
    // Qualitative provenance only — no accuracy % in user copy (ADR-0008).
    const axisBits: string[] = [];
    if (meta.arousal) axisBits.push(`arousal${meta.arousal.passedGate ? " (gate-passed)" : ""}`);
    if (meta.valence) axisBits.push(`valence${meta.valence.passedGate ? " (gate-passed)" : ""}`);
    const axes = axisBits.length ? `Trained axis priors loaded (${axisBits.join(", ")}), far-domain acted speech, used only when in-domain. ` : "";
    el.textContent = `${axes}Your read leads with an on-device acoustic valence + arousal mapping, available from hum #1.`;
  } else {
    el.textContent = "Running the on-device acoustic valence + arousal read (no trained model artifact served).";
  }
}

// ── consent UI ─────────────────────────────────────────────────────────────────
function reflectConsentInputs(): void {
  const sync = document.getElementById("consent-sync") as HTMLInputElement | null;
  const clinical = document.getElementById("consent-clinical") as HTMLInputElement | null;
  if (sync) sync.checked = isGranted(session.consent, "derived_feature_sync");
  if (clinical) clinical.checked = isGranted(session.consent, "clinical_risk_surfacing");
}

async function onConsentChange(scope: ToggleableScope, granted: boolean): Promise<void> {
  session.consent = setScope(session.consent, scope, granted);
  if (scope === "clinical_risk_surfacing") {
    renderDiary(session.lastRead);
  }
  if (scope === "derived_feature_sync") {
    if (granted) {
      setSyncStatus("Connecting to your private cloud space…");
      session.uid = await signInAnon();
      if (session.uid) await saveStateCloud(session.uid, session.state);
    }
    updateSyncStatus();
    if (session.lastRead) renderProvenance(session.lastRead, session.prior, syncEnabled());
  }
}

function updateSyncStatus(): void {
  if (!getFirebase()) {
    setSyncStatus("Local-only (no cloud backend configured).");
  } else if (!isGranted(session.consent, "derived_feature_sync")) {
    setSyncStatus("Local-only. Enable derived-feature sync to back up to the cloud.");
  } else if (session.uid) {
    setSyncStatus("Cloud backup on. Derived-only summaries sync to your private space.");
  } else {
    setSyncStatus("Cloud unavailable (anonymous sign-in is off for this project). Staying local.");
  }
}

// ── run a hum ───────────────────────────────────────────────────────────────────
async function runOne(
  getAudio: () => AudioInput | Promise<AudioInput>,
  opts: { advance?: boolean; capturedAt?: IsoTimestamp } = {},
): Promise<CaptureGateDecision> {
  const advance = opts.advance ?? false;
  const audio = await getAudio();
  // The tentative hum-personality lean (from the baseline so far) personalises today's step;
  // the recent-reads buffer makes that step reflect recent history, not just this hum (ADR-0010).
  const sigBefore = currentSignature();
  const result = await runHumCycle({
    audio,
    state: session.state,
    consent: session.consent,
    modelVersion: MODEL_VERSION,
    // The demo seeder backdates each hum so a seeded history spreads across real days.
    capturedAt: opts.capturedAt,
    prior: session.prior?.prior ?? null,
    // A promoted hum-native axis model takes precedence over the far-domain prior.
    axisPriors: effectiveAxisPriors(),
    // Personalize which features the read leans on, from the user's own labels.
    featureImportance: session.featureImportance,
    // A promoted hum-native fusion meta-learner sharpens the secondary affect read.
    metaLearner: session.metaLearner,
    // History-aware intervention + exploratory personality personalisation.
    recentReads: session.recentReads,
    // Re-reference the DISPLAYED read against the user's own recent acoustic reads (the current
    // hum is appended AFTER this read), so it reflects their usual instead of a fixed mic offset.
    acousticAxisHistory: session.acousticRing,
    personalityLean: { adjective: sigBefore.lean.adjective, steadiness: sigBefore.lean.steadiness },
  });

  // STAGE ① — a rejected capture is never read for affect. Show "hum again", surface NO
  // affect, and persist/learn nothing (the state came back unchanged). ADR-0005.
  if (!result.accepted) {
    // Diagnostic breadcrumb (console only; derived on-device values, no raw audio): if a real hum
    // is ever rejected again, this single line shows exactly which cue drove the Stage-① decision.
    console.debug("[hum-ai] capture rejected →", result.captureGate.reason);
    session.state = result.nextState;
    session.lastRead = null;
    session.pending = null;
    clearInterventionFeedback();
    renderCaptureRejected(result.captureGate);
    // The world dims to a hollow "listening" state — we only read a clear, sustained hum.
    applyStateVisual(ABSTAIN_VISUAL);
    orb?.setVisual(ABSTAIN_VISUAL);
    orb?.setMode("abstain");
    session.lastVisual = null;
    session.lastCaption = null;
    showShare(false);
    return result.captureGate;
  }

  session.state = result.nextState;
  session.lastRead = result.read;

  // RESEARCH STUDY pairing (Workstream 1) — for an enrolled participant with a pending
  // instrument session, pair this hum's DERIVED features into a ClinicalHumExample (firewall:
  // derived-only, validated in the store) and, ONLY when research_audio_upload is consented,
  // send the ephemeral raw `audio` out the physically-isolated research-upload channel. This is
  // the tap of capture.ts's buffer "before release". No-op for non-participants.
  void offerCaptureToStudy({
    features: result.read.internal.features,
    captureQuality: result.captureGate.humLikeness,
    eligible: result.eligible,
    audio,
  });

  // Update the recent-reads buffer (usable, non-abstained reads only) so the NEXT hum's
  // intervention is informed by recent history; then recompute the signature off the new baseline.
  if (!result.read.userFacing.abstained) {
    const d = result.read.internal.axis.dimensional;
    session.recentReads = [...session.recentReads, { valence: d.valence, arousal: d.arousal }].slice(-RECENT_READS_MAX);
    // Record THIS hum's RAW acoustic read so the NEXT read can re-reference against the user's own
    // usual (the transparent acousticValue, preserved through calibration + display re-referencing).
    session.acousticRing = appendAcousticRing(session.localId, session.acousticRing, {
      valence: result.read.internal.axis.valence.acousticValue,
      arousal: result.read.internal.axis.arousal.acousticValue,
    });
  }
  session.signature = currentSignature();

  renderRead(result.read, session.consent);
  renderInterventionOfDay(result.read);
  renderPersonalization(result.read);
  renderLadder(result.read.internal.stage, result.read.internal.eligibleHumCount);
  // A fresh usable hum becomes the newly-inspected moment (its context panel is ready immediately).
  if (!result.read.userFacing.abstained) session.diaryFocus = null;
  renderDiary(result.read);
  renderSignature(session.signature ?? currentSignature(), result.read, session.consent, result.read.internal.eligibleHumCount, session.localId);
  renderProvenance(result.read, session.prior, syncEnabled());

  // THE TUNING — tune the whole world to this read; on a single capture, reveal + advance.
  presentRead(result.read, advance);

  // Carry forward the intervention shown on the PREVIOUS hum so we can ask "did it help?"
  // after the user has had a chance to try it. Ask only when there was a prior suggestion.
  const prevIntervention = session.previousIntervention;
  if (prevIntervention && prevIntervention !== "none") {
    renderInterventionFeedback((helpful) => onInterventionFeedback(helpful));
  } else {
    clearInterventionFeedback();
  }
  session.previousIntervention = result.read.userFacing.interventionOfDay?.category ?? null;

  // HiTL: stash this hum, then wire the mood field's drag/sliders/Save so a confirm/adjust mints a
  // native-hum training row + a personal calibration correction (ADR-0011). The correction is the
  // SAME read the user sees — no separate slider — so adjusting "where you are" IS the feedback.
  session.pending = { id: safeUuid(), capturedAt: result.now, read: result.read };
  clearFeedbackPrompt(); // the old standalone slider card is retired; mood adjust lives in the read
  if (!result.read.userFacing.abstained) {
    renderMoodAdjust(result.read, (report) => void onFeedback(report));
  }

  session.log.push({
    at: result.now,
    stage: result.read.internal.stage,
    eligible: result.eligible,
    abstained: result.read.userFacing.abstained,
    evidence: result.read.userFacing.confidence.evidenceLevel,
    headline: result.read.userFacing.headline,
  });
  renderHistory(session.log);

  saveStateLocal(session.localId, session.state);
  if (syncEnabled() && session.uid) {
    await saveStateCloud(session.uid, session.state);
    await appendHumCloud(session.uid, result.syncPayload);
  }
  return result.captureGate;
}

// ── HiTL feedback: one user confirmation → personal calibration + global corpus ──
async function onFeedback(report: HumSelfReport): Promise<void> {
  const pending = session.pending;
  if (!pending) return;
  const { example, correction } = applyFeedback(pending.read, report, {
    id: pending.id,
    capturedAt: pending.capturedAt,
    modelVersion: MODEL_VERSION,
  });

  // 1. GLOBAL track — append one row of native-hum truth to the retraining corpus.
  session.corpus = appendExample(session.corpus, example);
  saveCorpusLocal(session.localId, session.corpus);
  // Recompute which features track this user's reported affect (feeds the next read's salience).
  session.featureImportance = combinedFeatureImportance(session.corpus);

  // 2. PERSONAL track — fold the correction into the within-user axis calibration NOW
  //    (the read re-centres on this person immediately, before any retrain).
  session.state = ingestFeedback(session.state, correction);
  saveStateLocal(session.localId, session.state);

  // 3. Cloud backup of both (derived-only, owner-scoped) when consented.
  if (syncEnabled() && session.uid) {
    await appendLabelCloud(session.uid, example);
    await saveStateCloud(session.uid, session.state);
  }

  // 3b. POPULATION CONTRIBUTION (ADR-0012) — the SAME confirmed hum, contributed to the pooled
  //     corpus that retrains the population baseline, ONLY under the dedicated opt-in scope
  //     (distinct from the owner-scoped backup above). Gated off by default; the contributing UI
  //     toggle + IRB sign-off are the governed follow-up, so this is a no-op until granted.
  if (isGranted(session.consent, "population_corpus_contribution") && session.uid) {
    const contribution = buildPopulationContribution({
      example,
      contributorKey: contributorPseudonym(session.localId),
      consentVersion: POPULATION_CONSENT_VERSION,
      contributedAt: pending.capturedAt,
    });
    await appendPopulationContributionCloud(contribution);
  }

  // 4. Retrain the hum-native model(s) when there's enough fresh data.
  await maybeRetrain();
  renderModelLab(session.corpus, session.artifact);
}

// ── Intervention feedback: "did yesterday's suggestion help?" ─────────────────
// Directly updates the intervention bandit arm — no ingestHum, no clinical data.
// Reward values are hard-coded user utility signals, not derived from any inference head.
function onInterventionFeedback(helpful: boolean): void {
  const cat = session.previousIntervention;
  if (!cat || cat === "none") return;
  const reward = helpful ? 0.3 : -0.2;
  // `cat` is a runtime category string; index a plain record (the policy struct keys are typed).
  const policy = { ...(session.state.profile.intervention_policy ?? {}) } as Record<string, ReturnType<typeof updateArm>>;
  policy[cat] = updateArm(policy[cat], reward);
  session.state = {
    ...session.state,
    profile: { ...session.state.profile, intervention_policy: policy },
  };
  session.previousIntervention = null;
  saveStateLocal(session.localId, session.state);
  if (syncEnabled() && session.uid) void saveStateCloud(session.uid, session.state);
}

/** Re-evaluate the hum-native model(s) when ready + enough new labels. Promotion is the goal. */
async function maybeRetrain(): Promise<void> {
  const size = session.corpus.examples.length;
  if (!corpusReadiness(session.corpus).anyReady) return;
  if (session.artifact && size - session.lastRetrainSize < RETRAIN_EVERY) return;
  const wasPromoted = hasPromotedNativeModel(session.artifact);
  try {
    // (a) Axis models (valence/arousal) — the dimensional read.
    session.artifact = buildHumNativeArtifact(session.corpus, nowTs());
    session.lastRetrainSize = size;
    saveArtifactLocal(session.localId, session.artifact);
    if (syncEnabled() && session.uid) void saveArtifactCloud(session.uid, session.artifact);
    if (!wasPromoted && hasPromotedNativeModel(session.artifact)) {
      setCaptureStatus("🎉 Your hum-native model just went live. Your read now uses a model trained on your own hums.");
      setModelStatus();
    }

    // (b) Fusion meta-learner (secondary affect-state read) — promote only if it beats the
    //     default fusion on your held-out hums. The dimensional V-A read is unaffected.
    const hadMeta = session.metaLearner !== null;
    const fusion = await trainFusionMetaLearner(session.corpus);
    if (fusion.decision === "promote" && fusion.params) {
      saveFusionParamsLocal(session.localId, fusion.params);
      session.metaLearner = metaLearnerFromParams(fusion.params);
      if (!hadMeta) setCaptureStatus("🎯 Your hum-native fusion model went live. The affect read is now tuned to you.");
    }
  } catch (err) {
    console.warn("[retrain] failed:", err);
  }
}

async function runSynth(kind: SynthKind): Promise<void> {
  setBusy(true);
  stage?.closeTray();
  setCaptureStatus(`Synthesizing a ${kind} hum…`);
  try {
    const gate = await runOne(() => synthesize(kind), { advance: true });
    setCaptureStatus(gate.accepted ? "" : humAgainMessage(gate.reasonCode));
  } catch (err) {
    setCaptureStatus(`Error: ${(err as Error).message}`);
  } finally {
    setBusy(false);
  }
}

/**
 * The held beat of arrival. The hum landed: the orb blooms into its read colour right where you
 * hummed, then a short pause before the read unfurls — so completion FEELS like an arrival, not a
 * jump cut. Wordless on purpose (the read itself is announced for screen readers a moment later).
 */
async function arrive(abstained: boolean): Promise<void> {
  setHumPhase("settling");
  if (abstained) {
    setCaptureStatus("");
    await delay(360);
    return;
  }
  setCaptureStatus("There you are.");
  orb?.setMode("revealed"); // bloom the orb's colour in place, over the Hum button
  orb?.pulse();
  await delay(700);
}

async function runMic(): Promise<void> {
  setBusy(true);
  stage?.go("hum");
  orb?.setMode("capturing");
  anchorOrbToHumButton();
  // Enter the ritual: the world quiets to listen (the chrome recedes in CSS).
  setHumPhase("listening");
  setCaptureStatus("Listening.", 0);

  // A gentle live read of the room from the SAME telemetry the orb uses — never a level meter.
  // Once we've clearly heard the hum we latch to "listening" (breath pauses won't nag); if nothing
  // carries by a third of the way through, we nudge closer.
  let phaseNow: HumPhase = "listening";
  let voicedRun = 0;
  let heard = false;
  let saidAlmost = false;
  const cue = (p: HumPhase, text: string): void => {
    if (p !== phaseNow) {
      phaseNow = p;
      setHumPhase(p);
    }
    setCaptureStatus(text);
  };

  // A LIVE, responsive read of the hum as it happens — so it feels like the app is genuinely
  // listening, not just flashing "I can hear you" once. We smooth the level + pitch, then surface a
  // short reactive line that reflects what's actually coming through (swelling, steady, bright,
  // low, fading) on a calm ~1.7s cadence so it breathes rather than flickers. The orb's own
  // amplitude/pitch/mote visuals (orb.pushLevel) animate continuously alongside it.
  let emaLevel = 0;
  let emaPitch = 0;
  let lastCueFrac = 0;
  let cueIx = 0;
  const STEADY_CUES = ["That's it — hold it there.", "Lovely. Stay with it.", "I'm right here with you.", "Holding it with you…"];
  const liveLine = (lvl: number, dLvl: number, pitch: number | null, frac: number): string => {
    if (dLvl > 0.06) return "Beautiful — let it open up.";
    if (dLvl < -0.07) return "Stay with it… keep the note carrying.";
    if (pitch && pitch >= 230) return "Bright and clear up there.";
    if (pitch && pitch > 0 && pitch <= 130) return "Nice and low — I feel that.";
    if (lvl > 0.5) return "Strong and steady. Good.";
    const line = STEADY_CUES[cueIx % STEADY_CUES.length]!;
    cueIx += 1;
    void frac;
    return line;
  };

  try {
    const gate = await runOne(
      () =>
        recordHum({
          seconds: 12,
          onProgress: (f) => setCaptureProgress(f), // hairline echo; the orb ring is the hero progress
          onLevel: (level) => {
            orb?.pushLevel(level);
            const prevEma = emaLevel;
            emaLevel = emaLevel * 0.7 + level.level * 0.3;
            if (level.pitchHz) emaPitch = emaPitch === 0 ? level.pitchHz : emaPitch * 0.8 + level.pitchHz * 0.2;
            const dLevel = emaLevel - prevEma;
            if (level.voiced || level.level > 0.07) {
              voicedRun += 1;
              if (voicedRun >= 3 && !heard) {
                heard = true;
                lastCueFrac = level.fraction;
                cue("listening", "There you are — I’ve got it.");
              }
            } else {
              voicedRun = 0;
              if (!heard && level.fraction > 0.3 && phaseNow !== "faint") {
                cue("faint", "A little closer. Let the note carry.");
              }
            }
            // Continuous reactive feedback once we're hearing the hum, on a gentle cadence.
            if (heard && !saidAlmost && level.fraction < 0.82 && level.fraction - lastCueFrac > 0.14) {
              lastCueFrac = level.fraction;
              setCaptureStatus(liveLine(emaLevel, dLevel, level.pitchHz ?? (emaPitch || null), level.fraction));
            }
            if (heard && !saidAlmost && level.fraction >= 0.85) {
              saidAlmost = true;
              setCaptureStatus("Almost there — bring it home.");
            }
          },
        }),
      // Hold the advance: render the read into the (hidden) result window, but let runMic stage the
      // arrival beat before we cross over, so the reveal feels earned.
      { advance: false },
    );
    if (gate.accepted) {
      const abstained = session.lastRead?.userFacing.abstained ?? false;
      await arrive(abstained);
      if (session.lastRead) presentRead(session.lastRead, true);
      setHumPhase("ready");
      setCaptureStatus("");
    } else {
      // A miss is part of the ritual, not an error screen: the chrome returns and the orb settles to
      // its hollow listening ring while we say, plainly and kindly, what to try next.
      setHumPhase("ready");
      setCaptureStatus(humAgainMessage(gate.reasonCode));
    }
  } catch (err) {
    orb?.setMode("resting");
    setHumPhase("ready");
    const msg = (err as Error).message;
    // An interruption / too-short / no-audio outcome is part of the ritual, not a broken mic —
    // surface the kind retry line as-is; only true mic-setup failures point to the simulate path.
    if (/interrupted|too short|no audio/i.test(msg)) {
      setCaptureStatus(msg.charAt(0).toUpperCase() + msg.slice(1));
    } else {
      setCaptureStatus(`Mic unavailable (${msg}). Open the tray to simulate a hum.`);
    }
  } finally {
    orb?.pushLevel(null);
    setBusy(false);
  }
}

async function runWeek(): Promise<void> {
  setBusy(true);
  try {
    for (let i = 0; i < 7; i += 1) {
      setCaptureStatus(`Simulating a week of daily hums… ${i + 1} / 7`);
      await runOne(() => synthesize("clean"), { advance: false });
      await new Promise((r) => setTimeout(r, 120));
    }
    setCaptureStatus("Simulated a week. Watch the baseline and stage advance above.");
  } catch (err) {
    setCaptureStatus(`Error: ${(err as Error).message}`);
  } finally {
    setBusy(false);
  }
}

// Demo seeder: cross the ~20-eligible-hum threshold in one click so an evaluator can SEE
// the longitudinal/diagnostic layer ENGAGE (the enriched trend + provenance panel), instead
// of the cold-start "collecting history" message. Honest: it runs clean synthetic hums through
// the SAME runOne cycle and enables the consent toggle for the demo — it does not fabricate a
// clinical drift/monitoring signal (that needs genuinely worsening input, not synthesized here).
// Lives in the tray's "Simulate & reset" sandbox (clearly labelled a demo, cleared by Reset), so
// the main first-run path still shows the honest cold start.
async function runDemoSeed(): Promise<void> {
  setBusy(true);
  if (!isGranted(session.consent, "clinical_risk_surfacing")) {
    await onConsentChange("clinical_risk_surfacing", true);
    reflectConsentInputs();
  }
  try {
    const total = 24;
    // ONE hum per day, walking back from today, each drawn from the realistic mood palette so the
    // seeded diary spans real days (correct IST timestamps) AND real moods — not 22 identical
    // "restless" hums all stamped the same minute (the "Mon 7:13 pm" + flat-line + pinned-read bug).
    const dayMs = 24 * 60 * 60 * 1000;
    const startMs = Date.now();
    for (let i = 0; i < total; i += 1) {
      setCaptureStatus(`Seeding your diary… ${i + 1} / ${total} daily hums`);
      const daysAgo = total - 1 - i; // oldest first → newest last
      // A gentle hour jitter so same-day stamps aren't identical either.
      const at = asIsoTimestamp(new Date(startMs - daysAgo * dayMs + (i % 5) * 1700_000).toISOString());
      await runOne(() => synthesizeMood(i), { advance: false, capturedAt: at });
      await new Promise((r) => setTimeout(r, 30));
    }
    setCaptureStatus("Seeded a few weeks of demo hums. Your diary of hums is now active on your read screen.");
    revealLongitudinal();
  } catch (err) {
    setCaptureStatus(`Error: ${(err as Error).message}`);
  } finally {
    setBusy(false);
  }
}

/** Reveal the (now-active) diary of hums after a demo seed. The diary lives on the read screen
 *  now (not the tray), so we close the tray, reveal the last read, and scroll the diary into view. */
function revealLongitudinal(): void {
  stage?.closeTray();
  if (session.lastRead) presentRead(session.lastRead, true);
  requestAnimationFrame(() =>
    document.getElementById("longitudinal-card")?.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
}

// ── wire DOM ─────────────────────────────────────────────────────────────────
function wireControls(): void {
  document.getElementById("btn-record")?.addEventListener("click", () => void runMic());
  document.getElementById("btn-clean")?.addEventListener("click", () => void runSynth("clean"));
  document.getElementById("btn-noisy")?.addEventListener("click", () => void runSynth("noisy"));
  document.getElementById("btn-silence")?.addEventListener("click", () => void runSynth("silence"));
  document.getElementById("btn-week")?.addEventListener("click", () => void runWeek());
  document.getElementById("btn-share")?.addEventListener("click", () => void onShare());
  document.getElementById("btn-hum-again")?.addEventListener("click", () => focusHum());
  document.getElementById("btn-tour")?.addEventListener("click", () => {
    stage?.closeTray();
    showOnboarding(onboardingOptions());
  });

  // The longitudinal seeder lives in the tray's sandbox ("Simulate & reset"), so an evaluator
  // can SEE the diagnostic/longitudinal layer engage (one-time vs sustained, trend) without
  // 20 real daily hums. It's clearly labelled a demo and Reset clears it.
  document.getElementById("btn-demo-seed")?.removeAttribute("hidden");
  document.getElementById("btn-demo-seed")?.addEventListener("click", () => void runDemoSeed());

  // ── Diary interactions (delegated; the card's innerHTML is replaced on every render) ──────────
  const diaryCard = document.getElementById("longitudinal-card");
  // The `at` of the hum whose context the chips/note edit (the inspected/focus moment).
  const focusTarget = (): string | null =>
    diaryCard?.querySelector<HTMLElement>(".diary-focus")?.dataset.focusAt ?? null;
  diaryCard?.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    // Inspect a moment — tapping a chart dot or a "recent check-ins" row.
    const pick = el.closest<HTMLElement>("[data-at]");
    if (pick && pick.dataset.at) {
      session.diaryFocus = pick.dataset.at;
      renderDiary(session.lastRead);
      return;
    }
    // Toggle a life-context chip on the inspected hum.
    const chip = el.closest<HTMLElement>("[data-ctx-tag]");
    if (chip && chip.dataset.ctxTag) {
      const at = focusTarget();
      if (!at) return;
      session.diaryContext = toggleEntryTag(session.diaryContext, at, chip.dataset.ctxTag);
      saveDiaryContext(session.localId, session.diaryContext);
      renderDiary(session.lastRead);
    }
  });
  // Save a note on blur/enter (not per keystroke, so the field never re-renders mid-typing).
  diaryCard?.addEventListener("change", (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>("[data-ctx-note]");
    if (!input) return;
    const at = focusTarget();
    if (!at) return;
    session.diaryContext = patchEntryContext(session.diaryContext, at, { note: input.value });
    saveDiaryContext(session.localId, session.diaryContext);
    renderDiary(session.lastRead);
  });

  document
    .getElementById("consent-sync")
    ?.addEventListener("change", (e) => void onConsentChange("derived_feature_sync", (e.target as HTMLInputElement).checked));
  document
    .getElementById("consent-clinical")
    ?.addEventListener("change", (e) => void onConsentChange("clinical_risk_surfacing", (e.target as HTMLInputElement).checked));

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    session.state = newPersonalizationState(asUserId(session.uid ?? session.localId), nowTs(), MODEL_VERSION);
    session.log = [];
    session.lastVisual = null;
    session.lastCaption = null;
    session.lastRead = null;
    session.pending = null;
    session.previousIntervention = null;
    session.recentReads = [];
    session.acousticRing = [];
    clearAcousticRing(session.localId);
    saveStateLocal(session.localId, session.state);
    renderLadderForState(session.state);
    renderHistory(session.log);
    resetReadSurfaces();
    // Return the world to its idle neutral state and re-lock the result windows.
    applyStateVisual(NEUTRAL_VISUAL);
    orb?.setMode("resting");
    setHumPhase("ready");
    showShare(false);
    stage?.closeTray();
    stage?.lock();
    setCaptureStatus("Reset. Baseline cleared on this device.");
  });
}

// ── "Save today's Aura" — mint + share/download the poster (from a user gesture) ──
async function onShare(): Promise<void> {
  if (!session.lastVisual || !session.lastCaption) return;
  const btn = document.getElementById("btn-share") as HTMLButtonElement | null;
  const dateLabel = formatDateIST(Date.now());
  if (btn) btn.disabled = true;
  const outcome = await saveAuraCard({
    visual: session.lastVisual,
    caption: session.lastCaption,
    dateLabel,
  });
  if (btn) {
    btn.textContent = outcome === "failed" ? "Couldn't save, try again" : "Saved ✓";
    setTimeout(() => {
      btn.textContent = "✦ Save today's Aura";
      btn.disabled = false;
    }, 2200);
  }
}

void boot();
