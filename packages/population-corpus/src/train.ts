import type { IsoTimestamp } from "@hum-ai/shared-types";
import {
  buildHumNativeArtifact,
  hasPromotedNativeModel,
  parseArtifact,
  type HumNativeArtifact,
} from "@hum-ai/native-corpus";
import type { PopulationContribution } from "@hum-ai/affect-model-contracts";
import type { PopulationOceanNorms } from "@hum-ai/personality-signature";
import { poolContributions } from "./pool";
import { computePopulationOceanNorms } from "./ocean-norms";

/**
 * THE POPULATION RETRAIN (ADR-0012) — train a population BASELINE valence/arousal model + OCEAN
 * norms from the pooled, consented contributions, with GROUP-BY-CONTRIBUTOR cross-validation and
 * a contributor-diversity guard. Reuses the EXACT honest promotion gate the within-user retrain
 * uses (`buildHumNativeArtifact`), so a population model earns its place by the same rule: beat
 * the transparent acoustic backbone on held-out hums, significantly, well-calibrated — just
 * evaluated grouped by contributor and across many people instead of one.
 *
 * Pure (no clock, no I/O): `now` is injected and the pool is supplied by the caller (apps/ops
 * reads the offline file or the server-only collection and runs the consent guard first).
 */

export const POPULATION_ARTIFACT_VERSION = "population-artifact-v1";

/**
 * Minimum DISTINCT contributors before a population axis model may steer any user's read. A
 * model fit on a handful of people is not a "population" baseline — it would just be a few
 * users' idiosyncrasies imposed on everyone. Below this the artifact is still built (for
 * provenance + OCEAN norms) but its axis priors are withheld.
 */
export const POPULATION_MIN_CONTRIBUTORS = 8;

export interface PopulationArtifact {
  readonly version: string;
  readonly builtAt: IsoTimestamp;
  readonly contributorCount: number;
  readonly exampleCount: number;
  readonly featureSchemaVersion: string;
  /** Contributor-diversity guard: axis priors only steer a read when this is true. */
  readonly eligibleForPromotion: boolean;
  /** Population axis models + honest manifest, built with group-by-contributor CV. */
  readonly axes: HumNativeArtifact;
  /** Data-grounded OCEAN windows (empty until enough pooled samples per cue). */
  readonly oceanNorms: PopulationOceanNorms;
  /** Per-key sample support behind each OCEAN window (audit/provenance). */
  readonly oceanNormSupport: Record<string, number>;
  readonly provenance: {
    readonly groupedCV: true;
    readonly minContributors: number;
    readonly note: string;
  };
}

export function trainPopulationArtifact(
  pool: readonly PopulationContribution[],
  now: IsoTimestamp,
): PopulationArtifact {
  const pooled = poolContributions(pool);
  // The within-user gate, run with group-by-contributor CV folds AND per-contributor within-person
  // timbre standardization (v11): each contributor's IDENTITY (timbre) features are emitted as
  // deviations from THEIR OWN usual before pooling, so the pooled model learns the population's
  // shared MOOD mapping rather than a blend of everyone's voice identities. `baselineKey` shares the
  // contributor grouping with `foldKey` — the same pseudonym keeps a person's hums together for both
  // the CV split and their standardization reference.
  const axes = buildHumNativeArtifact(pooled.corpus, now, {
    foldKey: pooled.foldKey,
    baselineKey: pooled.foldKey,
  });
  const ocean = computePopulationOceanNorms(pooled.corpus.examples);
  const eligibleForPromotion = pooled.contributorCount >= POPULATION_MIN_CONTRIBUTORS;
  const last = pooled.corpus.examples[pooled.corpus.examples.length - 1];

  return {
    version: POPULATION_ARTIFACT_VERSION,
    builtAt: now,
    contributorCount: pooled.contributorCount,
    exampleCount: pooled.corpus.examples.length,
    featureSchemaVersion: last?.featureSchemaVersion ?? "unknown",
    eligibleForPromotion,
    axes,
    oceanNorms: ocean.norms,
    oceanNormSupport: ocean.support,
    provenance: {
      groupedCV: true,
      minContributors: POPULATION_MIN_CONTRIBUTORS,
      note: eligibleForPromotion
        ? `Population baseline from ${pooled.contributorCount} contributors / ${pooled.corpus.examples.length} hums; group-by-contributor CV; same honest promotion gate as the within-user retrain. Non-clinical (ADR-0012).`
        : `Population corpus too thin to promote axis priors (${pooled.contributorCount} contributors < ${POPULATION_MIN_CONTRIBUTORS}); OCEAN norms + manifest recorded for provenance only.`,
    },
  };
}

/** A population baseline may steer reads only when contributor-diverse AND it cleared the axis gate. */
export function hasPromotedPopulationModel(artifact: PopulationArtifact | null): boolean {
  return !!artifact && artifact.eligibleForPromotion && hasPromotedNativeModel(artifact.axes);
}

export function serializePopulationArtifact(artifact: PopulationArtifact): string {
  return JSON.stringify(artifact);
}

/** Parse a persisted population artifact; null on any malformation (honest fallback). */
export function parsePopulationArtifact(json: string | null | undefined): PopulationArtifact | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as PopulationArtifact;
    if (!raw || raw.version !== POPULATION_ARTIFACT_VERSION) return null;
    // Re-validate the embedded axis artifact through native-corpus' own parser (validates models).
    const axes = parseArtifact(JSON.stringify(raw.axes));
    if (!axes) return null;
    return { ...raw, axes };
  } catch {
    return null;
  }
}
