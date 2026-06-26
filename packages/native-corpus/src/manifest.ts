import type { IsoTimestamp } from "@hum-ai/shared-types";
import type { AffectAxisPriors } from "@hum-ai/orchestrator";
import type { LogRegParams } from "@hum-ai/signal-lab/model";
import { deserializeModel } from "@hum-ai/signal-lab/model";
import type { FeatureBaseline } from "@hum-ai/signal-lab/feature-schema";
import type { NativeCorpus } from "./corpus";
import { buildHumNativeAxisPrior } from "./prior";
import { retrainNativeAxes, type AxisPromotion, type RetrainResult, type RetrainOptions } from "./train";
import type { Axis } from "./calibration";

/**
 * THE HONEST RECORD of the hum-native retraining loop: per-axis promotion status +
 * the promoted models, serializable for localStorage / the user's private cloud. A
 * promoted native model is never presented as more than it is — the manifest carries
 * its held-out accuracy, its margin over the acoustic backbone, and the plain reasons
 * for the decision, exactly as the far-domain `model_manifest.json` does.
 */

export const HUM_NATIVE_MANIFEST_VERSION = "hum-native-manifest-v1";

export interface HumNativeAxisStatus {
  readonly axis: Axis;
  readonly decision: "promote" | "hold";
  readonly n: number;
  readonly classCounts: { readonly low: number; readonly high: number };
  readonly challengerBalancedAccuracy: number;
  readonly backboneBalancedAccuracy: number;
  readonly margin: number;
  /** Label-permutation p-value on the held-out accuracy (null when not computed). */
  readonly pValue: number | null;
  /** Held-out calibration error (null when not computed). */
  readonly ece: number | null;
  /** Bootstrap 95% CI on the held-out balanced accuracy (null when not computed). */
  readonly accuracyCI95: { readonly lo: number; readonly hi: number } | null;
  readonly reasons: readonly string[];
  /** One honest provenance line for the read/UI. */
  readonly note: string;
}

export interface HumNativeManifest {
  readonly version: string;
  readonly updatedAt: IsoTimestamp;
  readonly featureSchemaVersion: string;
  readonly corpusSize: number;
  readonly valence: HumNativeAxisStatus;
  readonly arousal: HumNativeAxisStatus;
}

/** The full artifact: the manifest plus any promoted models (null when held). */
export interface HumNativeArtifact {
  readonly manifest: HumNativeManifest;
  readonly valenceModel: LogRegParams | null;
  readonly arousalModel: LogRegParams | null;
}

function statusFrom(p: AxisPromotion): HumNativeAxisStatus {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const ci = p.accuracyCI95 ? ` (95% CI ${pct(p.accuracyCI95.lo)}–${pct(p.accuracyCI95.hi)})` : "";
  const sig = p.pValue != null ? `, significant (p<${p.pValue < 0.05 ? "0.05" : p.pValue.toFixed(2)})` : "";
  const note =
    p.decision === "promote"
      ? `Hum-native ${p.axis} model active — learned from ${p.n} of your confirmed hums; ${pct(p.challengerBalancedAccuracy)} held-out${ci} vs ${pct(p.backboneBalancedAccuracy)} for the acoustic read${sig}. Non-clinical.`
      : `Hum-native ${p.axis} model not yet promoted: ${p.reasons.join("; ") || "insufficient data"}.`;
  return {
    axis: p.axis,
    decision: p.decision,
    n: p.n,
    classCounts: p.classCounts,
    challengerBalancedAccuracy: p.challengerBalancedAccuracy,
    backboneBalancedAccuracy: p.backboneBalancedAccuracy,
    margin: p.margin,
    pValue: p.pValue,
    ece: p.ece,
    accuracyCI95: p.accuracyCI95,
    reasons: p.reasons,
    note,
  };
}

/**
 * Run the retrain and build the full artifact (manifest + promoted models) from the
 * current corpus. `now` is injected (the package is pure — no clock). The feature
 * schema version is taken from the most recent example so a later schema change is
 * recorded with the models trained under it.
 */
export function buildHumNativeArtifact(corpus: NativeCorpus, now: IsoTimestamp, opts: RetrainOptions = {}): HumNativeArtifact {
  const retrain: RetrainResult = retrainNativeAxes(corpus, opts);
  const last = corpus.examples[corpus.examples.length - 1];
  const manifest: HumNativeManifest = {
    version: HUM_NATIVE_MANIFEST_VERSION,
    updatedAt: now,
    featureSchemaVersion: last?.featureSchemaVersion ?? "unknown",
    corpusSize: corpus.examples.length,
    valence: statusFrom(retrain.valence),
    arousal: statusFrom(retrain.arousal),
  };
  return {
    manifest,
    valenceModel: retrain.valence.model,
    arousalModel: retrain.arousal.model,
  };
}

export function serializeArtifact(artifact: HumNativeArtifact): string {
  return JSON.stringify(artifact);
}

/** Parse a persisted artifact; returns null on any malformation (honest fallback). */
export function parseArtifact(json: string | null | undefined): HumNativeArtifact | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as HumNativeArtifact;
    if (!raw || !raw.manifest || raw.manifest.version !== HUM_NATIVE_MANIFEST_VERSION) return null;
    // Validate the embedded models if present (deserializeModel throws on malformed).
    const valenceModel = raw.valenceModel ? deserializeModel(JSON.stringify(raw.valenceModel)) : null;
    const arousalModel = raw.arousalModel ? deserializeModel(JSON.stringify(raw.arousalModel)) : null;
    return { manifest: raw.manifest, valenceModel, arousalModel };
  } catch {
    return null;
  }
}

/**
 * Build the orchestrator-ready `AffectAxisPriors` from a promoted artifact — the
 * deployment seam. A promoted axis becomes an in-domain hum-native prior; a held
 * axis is simply absent (the read falls back to the transparent acoustic backbone,
 * optionally refined by the far-domain prior). Zero orchestrator change: these flow
 * straight into `orchestrateHumRead`'s `axisPriors`.
 */
export function axisPriorsFromArtifact(
  artifact: HumNativeArtifact | null,
  baseline?: FeatureBaseline,
): AffectAxisPriors {
  if (!artifact) return {};
  const priors: { valence?: ReturnType<typeof buildHumNativeAxisPrior>; arousal?: ReturnType<typeof buildHumNativeAxisPrior> } = {};
  if (artifact.valenceModel && artifact.manifest.valence.decision === "promote") {
    priors.valence = buildHumNativeAxisPrior(artifact.valenceModel, {
      axis: "valence",
      balancedAccuracy: artifact.manifest.valence.challengerBalancedAccuracy,
    }, baseline);
  }
  if (artifact.arousalModel && artifact.manifest.arousal.decision === "promote") {
    priors.arousal = buildHumNativeAxisPrior(artifact.arousalModel, {
      axis: "arousal",
      balancedAccuracy: artifact.manifest.arousal.challengerBalancedAccuracy,
    }, baseline);
  }
  return priors;
}

/** True when at least one axis has a promoted hum-native model. */
export function hasPromotedNativeModel(artifact: HumNativeArtifact | null): boolean {
  return (
    !!artifact &&
    (artifact.manifest.valence.decision === "promote" || artifact.manifest.arousal.decision === "promote")
  );
}
