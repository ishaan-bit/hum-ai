/**
 * Hum AI web client — entry point.
 *
 * Drives the end-to-end cycle on-device and grows a personal baseline across hums:
 * capture/synthesize → full spine (with the trained prior) → safe read → LEARN (ingest)
 * → persist (localStorage always; Firebase when consented + signed in). Local-first and
 * resilient: with no mic, no cloud, or no model artifact, it still runs honestly.
 */
import "./styles.css";
import { newPersonalizationState, stagePolicy, ingestFeedback } from "@hum-ai/personalization-engine";
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
  buildFeedbackRequest,
  applyFeedback,
  type OrchestratedRead,
  type PersonalizationState,
  type AffectAxisPriors,
} from "@hum-ai/orchestrator";
import {
  emptyCorpus,
  appendExample,
  buildHumNativeArtifact,
  axisPriorsFromArtifact,
  corpusReadiness,
  hasPromotedNativeModel,
  combinedFeatureImportance,
  type NativeCorpus,
  type HumNativeArtifact,
} from "@hum-ai/native-corpus";
import { loadConsent, setScope, isGranted, type ToggleableScope } from "./consent";
import { loadBrowserPrior, type LoadedPrior } from "./prior";
import { recordHum, synthesize, type SynthKind } from "./capture";
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
  loadCorpusCloud,
  saveArtifactCloud,
  mergeCorpora,
} from "./corpus-store";
import { signInAnon, getFirebase } from "./firebase";
import { HUM_AGAIN_MESSAGE, type CaptureGateDecision } from "@hum-ai/signal-lab/capture-gate";
import {
  renderRead,
  renderInterventionOfDay,
  renderLadder,
  renderLongitudinal,
  renderProvenance,
  renderPersonalization,
  renderHistory,
  renderCaptureRejected,
  renderFeedbackPrompt,
  clearFeedbackPrompt,
  renderModelLab,
  setCaptureStatus,
  setLiveMeter,
  setSyncStatus,
  setBusy,
  type HistoryEntry,
} from "./render";

const MODEL_VERSION: ModelVersion = asModelVersion(import.meta.env.HUM_AI_MODEL_VERSION ?? "hum-web@0.1.0");

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
  /** HiTL per-feature importance (which features track this user's reported affect). */
  featureImportance: Record<string, number>;
  /** The most recent accepted hum, available for the feedback step. */
  pending: PendingHum | null;
  /** Corpus size at the last retrain — gates how often we re-evaluate promotion. */
  lastRetrainSize: number;
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
  featureImportance: {},
  pending: null,
  lastRetrainSize: 0,
};

/** Re-evaluate the hum-native model after this many new labels (kept cheap + responsive). */
const RETRAIN_EVERY = 4;

/**
 * The axis priors actually fed to the read: a PROMOTED hum-native model (in-domain,
 * no far-domain penalty) takes precedence per axis; otherwise the far-domain acted-speech
 * prior (which abstains OOD on hums) is used. As the user's model is promoted, the read
 * stops leaning on the far-domain prior and starts using their own hum-native one.
 */
function effectiveAxisPriors(): AffectAxisPriors {
  const far = session.prior?.axisPriors ?? {};
  const native = axisPriorsFromArtifact(session.artifact);
  return { valence: native.valence ?? far.valence, arousal: native.arousal ?? far.arousal };
}

function syncEnabled(): boolean {
  return isGranted(session.consent, "derived_feature_sync") && session.uid !== null;
}

// ── bootstrap ─────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  session.consent = loadConsent();
  session.localId = localUserId();
  reflectConsentInputs();

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

  renderLadderForState(session.state);
  renderHistory(session.log);
  updateSyncStatus();
  // Render the longitudinal panel up front (locked when consent is off) so it's
  // discoverable from the first visit, before any hum. The data stays consent-gated.
  renderLongitudinal(null, session.consent, session.state.eligibleHumCount);

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
  session.lastRetrainSize = session.corpus.examples.length;
  renderModelLab(session.corpus, session.artifact);

  // Load the trained prior (non-blocking for the rest of the UI).
  session.prior = await loadBrowserPrior();
  setModelStatus();

  wireControls();
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
      "A hum-native model trained on YOUR confirmed hums is now steering your read — in-domain, no far-domain penalty. It keeps improving as you give feedback. Non-clinical.";
    return;
  }
  if (session.prior) {
    const meta = session.prior.axisMeta;
    // Qualitative provenance only — no accuracy % in user copy (ADR-0008).
    const axisBits: string[] = [];
    if (meta.arousal) axisBits.push(`arousal${meta.arousal.passedGate ? " (gate-passed)" : ""}`);
    if (meta.valence) axisBits.push(`valence${meta.valence.passedGate ? " (gate-passed)" : ""}`);
    const axes = axisBits.length ? `Trained axis priors loaded (${axisBits.join(", ")}) — far-domain acted speech, used only when in-domain. ` : "";
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
    renderLongitudinal(
      session.lastRead,
      session.consent,
      session.lastRead?.internal.eligibleHumCount ?? session.state.eligibleHumCount,
    );
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
    setSyncStatus("Local-only — enable derived-feature sync to back up to the cloud.");
  } else if (session.uid) {
    setSyncStatus("Cloud backup on — derived-only summaries sync to your private space.");
  } else {
    setSyncStatus("Cloud unavailable (anonymous sign-in is off for this project) — staying local.");
  }
}

// ── run a hum ───────────────────────────────────────────────────────────────────
async function runOne(getAudio: () => AudioInput | Promise<AudioInput>): Promise<CaptureGateDecision> {
  const audio = await getAudio();
  const result = await runHumCycle({
    audio,
    state: session.state,
    consent: session.consent,
    modelVersion: MODEL_VERSION,
    prior: session.prior?.prior ?? null,
    // A promoted hum-native axis model takes precedence over the far-domain prior.
    axisPriors: effectiveAxisPriors(),
    // Personalize which features the read leans on, from the user's own labels.
    featureImportance: session.featureImportance,
  });

  // STAGE ① — a rejected capture is never read for affect. Show "hum again", surface NO
  // affect, and persist/learn nothing (the state came back unchanged). ADR-0005.
  if (!result.accepted) {
    session.state = result.nextState;
    session.lastRead = null;
    session.pending = null;
    renderCaptureRejected(result.captureGate);
    return result.captureGate;
  }

  session.state = result.nextState;
  session.lastRead = result.read;

  renderRead(result.read);
  renderInterventionOfDay(result.read);
  renderPersonalization(result.read);
  renderLadder(result.read.internal.stage, result.read.internal.eligibleHumCount);
  renderLongitudinal(result.read, session.consent, result.read.internal.eligibleHumCount);
  renderProvenance(result.read, session.prior, syncEnabled());

  // HiTL: stash this hum and ask whether the read matched, so a confirm/adjust mints a
  // native-hum training row + a personal calibration correction (ADR-0011).
  session.pending = { id: safeUuid(), capturedAt: result.now, read: result.read };
  if (!result.read.userFacing.abstained) {
    renderFeedbackPrompt(result.read, buildFeedbackRequest(result.read), (report) => void onFeedback(report));
  } else {
    clearFeedbackPrompt();
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

  // 4. Retrain the hum-native model when there's enough fresh data.
  maybeRetrain();
  renderModelLab(session.corpus, session.artifact);
}

/** Re-evaluate the hum-native model when ready + enough new labels. Promotion is the goal. */
function maybeRetrain(): void {
  const size = session.corpus.examples.length;
  if (!corpusReadiness(session.corpus).anyReady) return;
  if (session.artifact && size - session.lastRetrainSize < RETRAIN_EVERY) return;
  const wasPromoted = hasPromotedNativeModel(session.artifact);
  try {
    session.artifact = buildHumNativeArtifact(session.corpus, nowTs());
    session.lastRetrainSize = size;
    saveArtifactLocal(session.localId, session.artifact);
    if (syncEnabled() && session.uid) void saveArtifactCloud(session.uid, session.artifact);
    if (!wasPromoted && hasPromotedNativeModel(session.artifact)) {
      setCaptureStatus("🎉 Your hum-native model just went live — your read now uses a model trained on your own hums.");
      setModelStatus();
    }
  } catch (err) {
    console.warn("[retrain] failed:", err);
  }
}

async function runSynth(kind: SynthKind): Promise<void> {
  setBusy(true);
  setCaptureStatus(`Synthesizing a ${kind} hum…`);
  try {
    const gate = await runOne(() => synthesize(kind));
    setCaptureStatus(gate.accepted ? "Ready for the next hum." : HUM_AGAIN_MESSAGE);
  } catch (err) {
    setCaptureStatus(`Error: ${(err as Error).message}`);
  } finally {
    setBusy(false);
  }
}

async function runMic(): Promise<void> {
  setBusy(true);
  setCaptureStatus("Recording — hum steadily for 12 seconds…", 0);
  try {
    const gate = await runOne(() =>
      recordHum({
        seconds: 12,
        onProgress: (f) => setCaptureStatus(`Recording — hum steadily… ${Math.round(f * 12)}s / 12s`, f),
        onLevel: (level) => setLiveMeter(level),
      }),
    );
    setCaptureStatus(gate.accepted ? "Done — read updated above." : HUM_AGAIN_MESSAGE);
  } catch (err) {
    setCaptureStatus(`Mic unavailable (${(err as Error).message}). Try a simulated hum instead.`);
  } finally {
    setLiveMeter(null);
    setBusy(false);
  }
}

async function runWeek(): Promise<void> {
  setBusy(true);
  try {
    for (let i = 0; i < 7; i += 1) {
      setCaptureStatus(`Simulating a week of daily hums… ${i + 1} / 7`);
      await runOne(() => synthesize("clean"));
      await new Promise((r) => setTimeout(r, 120));
    }
    setCaptureStatus("Simulated a week — watch the baseline and stage advance above.");
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
// Gated behind ?demo so first-time real visitors still get the honest cold start.
async function runDemoSeed(): Promise<void> {
  setBusy(true);
  if (!isGranted(session.consent, "clinical_risk_surfacing")) {
    await onConsentChange("clinical_risk_surfacing", true);
    reflectConsentInputs();
  }
  try {
    const total = 22;
    for (let i = 0; i < total; i += 1) {
      setCaptureStatus(`Seeding longitudinal demo… ${i + 1} / ${total} daily hums`);
      await runOne(() => synthesize("clean"));
      await new Promise((r) => setTimeout(r, 50));
    }
    setCaptureStatus("Seeded ~22 hums — the longitudinal model is now active above (demo data).");
  } catch (err) {
    setCaptureStatus(`Error: ${(err as Error).message}`);
  } finally {
    setBusy(false);
  }
}

// ── wire DOM ─────────────────────────────────────────────────────────────────
function wireControls(): void {
  document.getElementById("btn-record")?.addEventListener("click", () => void runMic());
  document.getElementById("btn-clean")?.addEventListener("click", () => void runSynth("clean"));
  document.getElementById("btn-noisy")?.addEventListener("click", () => void runSynth("noisy"));
  document.getElementById("btn-silence")?.addEventListener("click", () => void runSynth("silence"));
  document.getElementById("btn-week")?.addEventListener("click", () => void runWeek());

  // ?demo reveals the longitudinal seeder (kept off the default first-visit surface).
  if (new URLSearchParams(location.search).has("demo")) {
    document.getElementById("btn-demo-seed")?.removeAttribute("hidden");
    document.getElementById("btn-demo-seed")?.addEventListener("click", () => void runDemoSeed());
  }

  document
    .getElementById("consent-sync")
    ?.addEventListener("change", (e) => void onConsentChange("derived_feature_sync", (e.target as HTMLInputElement).checked));
  document
    .getElementById("consent-clinical")
    ?.addEventListener("change", (e) => void onConsentChange("clinical_risk_surfacing", (e.target as HTMLInputElement).checked));

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    session.state = newPersonalizationState(asUserId(session.uid ?? session.localId), nowTs(), MODEL_VERSION);
    session.log = [];
    saveStateLocal(session.localId, session.state);
    renderLadderForState(session.state);
    renderHistory(session.log);
    setCaptureStatus("Reset — baseline cleared on this device.");
  });
}

void boot();
