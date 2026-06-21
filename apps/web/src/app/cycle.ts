/**
 * The per-hum cycle — one pass of the full HumAI spine, on-device.
 *
 *   computeFeatures (on-device)                          ← raw audio consumed here, dropped
 *     → humHistoryFromState(state)                       ← the personal baseline so far
 *       → orchestrateHumRead({ …, learnedAffectPrior })  ← pretrained prior + quality + domain
 *           → experts → fusion(+caps) → personalization  ← re-reference vs the user's baseline
 *           → relapse + longitudinal-diagnostic          ← 88% clinical hard cap, consent-gated
 *           → intervention → safety screen               ← only safe copy reaches userFacing
 *     → observationFromRead(read) → ingestHum(state)     ← LEARN: grow the baseline / ladder
 *   → buildHumSyncPayload(read)                          ← derived-only, guard-checked, syncable
 *
 * The trained prior establishes the population baseline read; `ingestHum` advances the
 * ladder (baseline active at 5 eligible hums, personalized fusion at 10, relapse/
 * longitudinal model at 20) so personalization and the longitudinal-diagnostic layer
 * progressively engage across hums. `nextState` is what the caller persists.
 */
import { computeFeatures, type AudioInput } from "@hum-ai/audio-features";
import {
  orchestrateHumRead,
  humHistoryFromState,
  observationFromRead,
  ingestHum,
  buildHumSyncPayload,
  type OrchestratedRead,
  type PersonalizationState,
  type HumSyncPayload,
  type LearnedAffectPrior,
  type AffectAxisPriors,
  type MetaLearner,
} from "@hum-ai/orchestrator";
import { assessCapture, type CaptureGateDecision } from "@hum-ai/signal-lab/capture-gate";
import { asIsoTimestamp, type ConsentState, type IsoTimestamp, type ModelVersion } from "@hum-ai/shared-types";

export interface HumCycleInput {
  readonly audio: AudioInput;
  readonly state: PersonalizationState;
  readonly consent: ConsentState;
  readonly modelVersion: ModelVersion;
  readonly prior: LearnedAffectPrior | null;
  /** Trained coarse valence / arousal axis priors that refine the axis read (when in-domain). */
  readonly axisPriors?: AffectAxisPriors;
  /** HiTL per-feature importance (which features track this user's reported affect) → salience blend. */
  readonly featureImportance?: Record<string, number>;
  /** Promoted hum-native fusion meta-learner (secondary read only); null ⇒ stub fallback. */
  readonly metaLearner?: MetaLearner | null;
}

export type HumCycleResult =
  | {
      /**
       * Stage ① rejected the capture — it wasn't a usable hum (noise/silence/speech/sigh/
       * whistle). NO affect was computed, and the baseline/ladder is untouched.
       */
      readonly accepted: false;
      readonly captureGate: CaptureGateDecision;
      /** State is unchanged — a non-hum never advances the baseline. */
      readonly nextState: PersonalizationState;
      readonly now: IsoTimestamp;
    }
  | {
      readonly accepted: true;
      readonly captureGate: CaptureGateDecision;
      readonly read: OrchestratedRead;
      /** The state AFTER learning from this hum — persist this. */
      readonly nextState: PersonalizationState;
      /** Derived-only, privacy-guarded summary safe to sync. */
      readonly syncPayload: HumSyncPayload;
      readonly now: IsoTimestamp;
      /** Whether the quality gate counted this hum toward the baseline (advances the ladder). */
      readonly eligible: boolean;
    };

export async function runHumCycle(input: HumCycleInput): Promise<HumCycleResult> {
  const now = asIsoTimestamp(new Date().toISOString());

  // 1. Derive features on-device; the raw audio buffer is not retained past this call.
  const features = computeFeatures(input.audio);

  // 1a. STAGE ① — capture acceptance (ADR-0005). Affect is NEVER read from a capture that
  //     isn't a usable hum. A rejected capture short-circuits BEFORE any affect inference and
  //     never advances the baseline/ladder or syncs — the caller shows "hum again".
  const captureGate = assessCapture(features);
  if (!captureGate.accepted) {
    return { accepted: false, captureGate, nextState: input.state, now };
  }

  // 2. Project the persisted baseline into read-time history, then run the full spine.
  //    The HiTL feature-importance hint (when present) is merged so personalization weights
  //    the features that track this user's reported affect.
  const history = { ...humHistoryFromState(input.state, now), featureImportance: input.featureImportance };
  const read = await orchestrateHumRead({
    features,
    consent: input.consent,
    modelVersion: input.modelVersion,
    now,
    history,
    learnedAffectPrior: input.prior ?? undefined,
    axisPriors: input.axisPriors,
    metaLearner: input.metaLearner ?? undefined,
  });

  // 3. LEARN: fold this hum into the model (no-op for ineligible/low-quality hums).
  const observation = observationFromRead(read, now);
  const nextState = ingestHum(input.state, observation);

  // 4. Build the derived-only payload (runs the raw-audio + clinical-leak guards).
  const syncPayload = buildHumSyncPayload(read, { capturedAt: now, modelVersion: input.modelVersion });

  return { accepted: true, captureGate, read, nextState, syncPayload, now, eligible: observation.eligible };
}
