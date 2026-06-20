import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { artifactPath } from "./paths";
import type { InferencePromotion } from "./inference";
import { parseNeuralFeatureModel, type NeuralFeatureModel } from "./neural-feature-model";

/**
 * MODEL-MANIFEST READERS — the single, reusable place that turns the git-ignored
 * signal-lab artifacts into honest promotion / neural-aux descriptors.
 *
 * Both the CLI (`inferFromHum`) and the runtime bridge (`orchestrateHumWithLearnedPrior`,
 * the full-spine new-hum path) consume these, so the spine reports promotion status the
 * SAME way the single-hum evidence report does. Governance (ADR-0005): a promoted artifact
 * is a far-domain acted-speech PRIOR — surfaced honestly, never trusted as hum truth.
 *
 * Privacy / safety: read-only. Nothing here trains, writes, or tracks an artifact —
 * `model_manifest.json` and `neural/model.neural.*.json` live under the git-ignored
 * `data/processed/signal-lab/`. Malformed/partway-written files degrade to the honest
 * fallback (null / not-evaluated), never an exception that would block reading a hum.
 */

export interface ManifestReaderOptions {
  /** Env for path resolution (HUM_DATA_DIR override). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Resolve artifacts relative to THIS directory instead of the env-derived
   * `data/processed/signal-lab`. Scoping reads to a model's own directory keeps the
   * promotion / neural-aux load co-located with the model artifact (so a model loaded
   * from a temp dir reads only that dir, never the repo).
   */
  readonly baseDir?: string;
  /** Explicit manifest path; overrides `baseDir`/`env` resolution. */
  readonly manifestPath?: string;
  /** Optional sink for soft warnings (e.g. a present-but-unloadable neural artifact). */
  readonly onWarn?: (message: string) => void;
}

/** Resolve a named artifact under `baseDir` when given, else the env-derived artifacts dir. */
function resolveArtifact(name: string, opts: ManifestReaderOptions): string {
  return opts.baseDir ? join(opts.baseDir, name) : artifactPath(name, opts.env);
}

/**
 * An honest "no gate manifest was supplied" promotion block. Used when no
 * `model_manifest.json` exists so a consumer never mistakes an unvalidated population
 * prior (or heuristic fallback) for a gate-validated model.
 */
export function notEvaluatedPromotion(opts: { readonly hasModel: boolean }): InferencePromotion {
  return {
    evaluated: false,
    gateMetric: "balanced_accuracy",
    gateThreshold: 0.8,
    affectTargetId: "affect_fusion_label",
    affectBalancedAccuracy: null,
    affectPassedGate: false,
    affectModelRole: opts.hasModel
      ? "learned 6-class affect prior used as a population prior (no gate manifest supplied)"
      : "heuristic fallback (no learned model)",
    promotedAuxTarget: null,
    promotedAuxBalancedAccuracy: null,
    datasetsUsed: opts.hasModel ? ["ravdess"] : [],
    note: "No promotion-gate manifest supplied; the affect read is a population prior (or fallback), not a gate-validated model.",
  };
}

/**
 * Load the experiment's gate manifest (`model_manifest.json`) into an honest promotion
 * block. Returns `undefined` when the manifest is absent or unparseable — the caller
 * then falls back to {@link notEvaluatedPromotion}.
 */
export function loadPromotionManifest(opts: ManifestReaderOptions = {}): InferencePromotion | undefined {
  const p = opts.manifestPath ?? resolveArtifact("model_manifest.json", opts);
  if (!existsSync(p)) return undefined;
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    return {
      evaluated: true,
      gateMetric: m.gate?.metric ?? "balanced_accuracy",
      gateThreshold: m.gate?.threshold ?? 0.8,
      affectTargetId: m.priorAffectModel?.target ?? "affect_fusion_label",
      affectBalancedAccuracy: m.priorAffectModel?.balancedAccuracy ?? null,
      affectPassedGate: m.priorAffectModel?.passedGate ?? false,
      affectModelRole: m.priorAffectModel?.role ?? "population prior",
      promotedAuxTarget: m.promoted?.targetId ?? null,
      promotedAuxBalancedAccuracy: m.promoted?.balancedAccuracy ?? null,
      datasetsUsed: m.datasets?.supervised ?? [],
      note: m.inferenceImpact ?? "",
    };
  } catch (e) {
    opts.onWarn?.(`model_manifest.json present but not parseable at ${p}: ${(e as Error).message}`);
    return undefined;
  }
}

/** The feature-space neural artifacts the TS runtime can execute (gate-passed coarse axes). */
export const NEURAL_AUX_ARTIFACT_NAMES: readonly string[] = [
  "neural/model.neural.arousal_binary.json",
  "neural/model.neural.valence_binary.json",
];

/**
 * Load a promoted feature-space NEURAL model (gate-passed coarse prior) if its git-ignored
 * artifact exists. Pure-TS op-graph — no Python/ONNX/GPU at runtime (NEURAL_HARNESS.md
 * adapter boundary). Returns `{ model: null }` (so the runtime keeps its classical/fallback
 * behavior) when the artifact is absent, partway-written, or the feature contract has drifted.
 */
export function loadNeuralAuxModel(
  opts: ManifestReaderOptions = {},
): { readonly model: NeuralFeatureModel | null; readonly path: string | null } {
  for (const name of NEURAL_AUX_ARTIFACT_NAMES) {
    const p = resolveArtifact(name, opts);
    if (existsSync(p)) {
      try {
        return { model: parseNeuralFeatureModel(readFileSync(p, "utf8")), path: p };
      } catch (e) {
        opts.onWarn?.(`neural aux model at ${p} not loadable: ${(e as Error).message}`);
      }
    }
  }
  return { model: null, path: null };
}
