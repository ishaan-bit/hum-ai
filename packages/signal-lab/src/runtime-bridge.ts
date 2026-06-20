import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConsentState, IsoTimestamp, ModelVersion } from "@hum-ai/shared-types";
import type { AcousticFeatures, AudioInput } from "@hum-ai/audio-features";
import {
  orchestrateHumAudio,
  orchestrateHumRead,
  type HumHistory,
  type LearnedAffectPrior,
  type OrchestratedRead,
} from "@hum-ai/orchestrator";
import { artifactPath } from "./paths";
import { deserializeModel, type LogRegParams } from "./model";
import { LearnedAffectPriorExpert } from "./expert";
import { predictNeuralFromFeatures, type NeuralFeatureModel } from "./neural-feature-model";
import { loadNeuralAuxModel, loadPromotionManifest, notEvaluatedPromotion } from "./manifest";
import type { InferencePromotion } from "./inference";

/**
 * RUNTIME BRIDGE — connect the offline-trained affect prior to the full runtime spine.
 *
 * `inferFromHum` (this package) is the SINGLE-HUM evidence-report path (no
 * personalization / longitudinal / relapse). The runtime spine that owns those
 * stages is `@hum-ai/orchestrator`. This bridge lets the SAME trained model flow
 * into that full spine — without the orchestrator ever depending on signal-lab:
 * the trained `LearnedAffectPriorExpert` is loaded HERE and handed across the
 * standard `AffectExpert` contract via `orchestrateHumRead`'s `learnedAffectPrior`
 * seam.
 *
 * MANIFEST-AWARE (parity with `inferFromHum`). The loader also reads the model's
 * co-located `model_manifest.json` and any promoted feature-space NEURAL artifact, so
 * the full-spine read reports promotion-gate status as honestly as the single-hum path:
 *   - the 6-class affect prior is fused whether or not it passed the gate, but the read
 *     records `gatePassed` / `gateNote` so a kept population prior is never mistaken for
 *     a gate-validated model;
 *   - a promoted coarse NEURAL axis (e.g. arousal) is surfaced as an AUXILIARY prior for
 *     transparency only — it never steers the affect head, confidence, or interventions
 *     (ADR-0005). When no neural artifact exists the classical/heuristic path is unchanged.
 *
 * Governance (ADR-0005): the model is a far-domain acted-speech PRIOR, never hum
 * truth. It carries the far-domain penalty cap below and is fused, not trusted.
 * When no artifact exists the bridge returns `null` and the spine runs its honest
 * heuristic fallback — a trained model is never REQUIRED to read a hum.
 *
 * Privacy: read-only. This bridge never trains, never writes, and never tracks an
 * artifact — `model.json` / `model_manifest.json` / `neural/*.json` live under the
 * git-ignored `data/processed/signal-lab/`. A malformed or partway-written artifact
 * degrades to the honest fallback, never an exception that would block reading a hum.
 */

/** ADR-0005 far-domain confidence penalty for an acted-speech affect prior. */
export const AFFECT_PRIOR_FAR_DOMAIN_CAP = 0.45;

export interface RuntimeBridgeOptions {
  /** Env for path resolution (HUM_DATA_DIR override). */
  readonly env?: NodeJS.ProcessEnv;
  /** Explicit model.json path; defaults to the git-ignored signal-lab artifact. */
  readonly modelArtifactPath?: string;
  /** Far-domain confidence cap (ADR-0005). Default {@link AFFECT_PRIOR_FAR_DOMAIN_CAP}. */
  readonly priorDomainPenalty?: number;
  /** Optional sink for soft warnings (e.g. a present-but-unloadable neural artifact). */
  readonly onWarn?: (message: string) => void;
}

/** A co-located promoted feature-space NEURAL aux model (and its artifact path), if any. */
export interface NeuralAuxLoad {
  readonly model: NeuralFeatureModel | null;
  readonly path: string | null;
}

/** A loaded prior: the orchestrator-ready descriptor plus the source model + manifest. */
export interface LoadedLearnedAffectPrior extends LearnedAffectPrior {
  readonly expert: LearnedAffectPriorExpert;
  readonly confidenceCap: number;
  readonly capReason: string;
  readonly artifact: string;
  readonly model: LogRegParams;
  /** Honest promotion-gate status from the co-located `model_manifest.json`, if present. */
  readonly promotion?: InferencePromotion;
  /** A co-located promoted feature-space NEURAL aux model (gate-passed coarse axis), if any. */
  readonly neuralAux: NeuralAuxLoad;
}

/** An auxiliary, gate-passed NEURAL prior surfaced for transparency (never steers the read). */
export interface NeuralAuxiliaryPrior {
  readonly target: string;
  readonly family: string;
  readonly topLabel: string;
  readonly probability: number;
  readonly distribution: Readonly<Record<string, number>>;
  readonly balancedAccuracy: number;
  readonly artifact: string | null;
  readonly note: string;
}

/** One honest line about the affect target's promotion-gate outcome (provenance only). */
function gateNoteFrom(p: InferencePromotion): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const verdict = p.affectPassedGate ? "PASSED" : "did NOT pass";
  const ba = p.affectBalancedAccuracy != null ? ` (balanced acc ${pct(p.affectBalancedAccuracy)})` : "";
  return `${p.affectModelRole}; affect target ${verdict} the ${(p.gateThreshold * 100).toFixed(0)}% ${p.gateMetric} gate${ba}.`;
}

function buildNeuralAuxiliary(
  model: NeuralFeatureModel,
  features: AcousticFeatures,
  artifact: string | null,
): NeuralAuxiliaryPrior {
  const pred = predictNeuralFromFeatures(model, features);
  return {
    target: model.target,
    family: model.family,
    topLabel: pred.topLabel,
    probability: pred.probability,
    distribution: pred.distribution,
    balancedAccuracy: model.evidence.balancedAccuracy,
    artifact,
    note:
      "Auxiliary gate-passed NEURAL prior (coarse axis, far-domain acted speech, penalty 0.45). " +
      "Surfaced for transparency; does NOT drive the affect head, confidence, or interventions (ADR-0005).",
  };
}

/**
 * Load the trained affect-PRIOR model artifact (if present) and wrap it as the
 * orchestrator's `LearnedAffectPrior`, ALSO reading the model's co-located
 * `model_manifest.json` (promotion status) and any promoted feature-space NEURAL aux
 * model. Returns `null` when no model artifact exists — the honest fallback. Throws only
 * if a present model artifact is malformed (that is a real error, not a missing model).
 * NEVER trains and NEVER writes.
 */
export function loadLearnedAffectPrior(opts: RuntimeBridgeOptions = {}): LoadedLearnedAffectPrior | null {
  const path = opts.modelArtifactPath ?? artifactPath("model.json", opts.env);
  if (!existsSync(path)) return null;
  const model = deserializeModel(readFileSync(path, "utf8"));
  const penalty = opts.priorDomainPenalty ?? AFFECT_PRIOR_FAR_DOMAIN_CAP;
  const expert = new LearnedAffectPriorExpert(model, { priorDomainPenalty: penalty });

  // Co-locate manifest + neural-aux reads with the model artifact: a model loaded from a
  // temp dir reads only that dir, never the repo. All reads are read-only; absent or
  // unparseable ⇒ honest fallback (no promotion / no aux), never an exception.
  const baseDir = dirname(path);
  const promotion = loadPromotionManifest({ baseDir, onWarn: opts.onWarn });
  const neuralAux = loadNeuralAuxModel({ baseDir, onWarn: opts.onWarn });

  return {
    expert,
    confidenceCap: penalty,
    capReason: `affect-prior far-domain penalty ${penalty.toFixed(2)} (acted speech; ADR-0005)`,
    artifact: path,
    model,
    promotion,
    neuralAux,
    gatePassed: promotion?.affectPassedGate,
    gateNote: promotion ? gateNoteFrom(promotion) : undefined,
  };
}

export interface LearnedHumReadInput {
  /** Raw, ephemeral audio (extracted on-device, never persisted). */
  readonly audio?: AudioInput;
  /** OR pre-derived features. Exactly one of `audio` / `features` is required. */
  readonly features?: AcousticFeatures;
  readonly consent: ConsentState;
  readonly modelVersion: ModelVersion;
  readonly now: IsoTimestamp;
  readonly history?: HumHistory;
  /**
   * Pre-loaded prior. Omit to auto-load from the artifact; pass `null` to FORCE
   * the heuristic fallback even if an artifact exists.
   */
  readonly prior?: LoadedLearnedAffectPrior | null;
  /** Options for the auto-load (used only when `prior` is omitted). */
  readonly bridgeOptions?: RuntimeBridgeOptions;
  /** Override the promotion block. Omit to use the prior's (or not-evaluated when none). */
  readonly promotion?: InferencePromotion;
  /**
   * Override the promoted feature-space NEURAL aux model. Omit to use the prior's
   * co-located one; pass `{ model: null }` to force none.
   */
  readonly neuralAux?: { readonly model: NeuralFeatureModel | null; readonly path?: string | null };
}

export interface LearnedHumReadResult {
  readonly read: OrchestratedRead;
  /** True when the trained prior was fused; false on the heuristic fallback. */
  readonly priorUsed: boolean;
  readonly provenance: string;
  /** Honest promotion-gate status for THIS read (not-evaluated when no manifest accompanied the model). */
  readonly promotion: InferencePromotion;
  /** A promoted coarse NEURAL prior surfaced for transparency; never steers the read. `null` when none. */
  readonly neuralAuxiliary: NeuralAuxiliaryPrior | null;
}

/**
 * THE clean end-to-end path for a NEW hum WITH the trained affect prior: load the
 * prior (or honestly fall back to heuristic experts) and run the FULL orchestrator
 * spine —
 *
 *   features/extract → quality → domain → fusion[+learned prior] → personalization
 *   → relapse/longitudinal-diagnostic → intervention → safety → stable read.
 *
 * The trained model is a far-domain prior only (ADR-0005); the spine's confidence
 * caps, two-head clinical separation, and safety boundary are all unchanged. The
 * result also carries the honest `promotion` gate status and any auxiliary neural
 * prior (transparency only) — parity with `inferFromHum`.
 */
export async function orchestrateHumWithLearnedPrior(
  input: LearnedHumReadInput,
): Promise<LearnedHumReadResult> {
  const prior = input.prior !== undefined ? input.prior : loadLearnedAffectPrior(input.bridgeOptions);
  const learnedAffectPrior = prior ?? undefined;

  // Honest gate status: explicit override → the loaded prior's manifest → not-evaluated.
  const promotion = input.promotion ?? prior?.promotion ?? notEvaluatedPromotion({ hasModel: prior !== null });

  // A promoted coarse neural axis, if one is co-located with the model (or supplied).
  const neuralAux = input.neuralAux !== undefined ? input.neuralAux : prior?.neuralAux;

  const common = {
    consent: input.consent,
    modelVersion: input.modelVersion,
    now: input.now,
    history: input.history,
    learnedAffectPrior,
  };

  let read: OrchestratedRead;
  if (input.audio) {
    read = await orchestrateHumAudio({ audio: input.audio, ...common });
  } else if (input.features) {
    read = await orchestrateHumRead({ features: input.features, ...common });
  } else {
    throw new Error("orchestrateHumWithLearnedPrior: provide either `audio` or `features`");
  }

  // The neural aux is computed from the SAME derived features the spine used, and is
  // attached for transparency only — it is deliberately NOT fed into fusion above.
  const neuralAuxiliary = neuralAux?.model
    ? buildNeuralAuxiliary(neuralAux.model, read.internal.features, neuralAux.path ?? null)
    : null;

  return {
    read,
    priorUsed: prior !== null,
    provenance: prior
      ? `learned affect prior @ ${prior.artifact}` +
        (prior.gatePassed === false
          ? " (population prior; affect target did not pass the promotion gate)"
          : "")
      : "heuristic fallback ensemble (no trained model artifact)",
    promotion,
    neuralAuxiliary,
  };
}
