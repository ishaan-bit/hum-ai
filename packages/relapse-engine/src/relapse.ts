import { clamp01, mean, type IsoTimestamp, type ValenceArousal } from "@hum-ai/shared-types";
import type { DvdsaClass } from "@hum-ai/affect-model-contracts";

/**
 * Relapse / recovery engine. Inspired by the DVDSA method of
 * `longitudinal_voice_treatment_response_source`: a PERSONALIZED, WITHIN-USER,
 * paired comparison of voice samples — not a group-level classifier. We compare
 * the current hum against four kinds of personal reference and synthesize one
 * verdict. See ADR-0003.
 */

/** A compact, comparable summary of one hum's risk-relevant affect. */
export interface RelapseSample {
  readonly capturedAt: IsoTimestamp;
  readonly dimensional: ValenceArousal;
  /**
   * Composite risk score in [0,1] (higher = more concerning): a blend of the
   * depressive/anxiety/stress/instability heads. The orchestrator computes this
   * from a `MultiHeadAffectInference`; the engine stays agnostic to its makeup.
   */
  readonly riskScore: number;
}

export const RELAPSE_REFERENCE_KINDS = [
  "previous_stable", // a previously stable/recovered hum
  "previous_high_risk", // a previously high-risk hum
  "baseline_7d", // last 7-day personal baseline
  "baseline_30d", // last 30-day personal baseline
] as const;
export type RelapseReferenceKind = (typeof RELAPSE_REFERENCE_KINDS)[number];

export const RELAPSE_CLASSES = ["recovery", "stable", "worsening", "relapse_drift", "uncertain"] as const;
export type RelapseClass = (typeof RELAPSE_CLASSES)[number];

export interface PairwiseComparison {
  readonly kind: RelapseReferenceKind;
  /** Signed risk change vs the reference (positive = worse). */
  readonly riskDelta: number;
  readonly class: RelapseClass;
}

export interface RelapseVerdict {
  readonly class: RelapseClass;
  /** Drift toward a high-risk signature in [0,1]. */
  readonly drift: number;
  readonly comparisons: readonly PairwiseComparison[];
  /** Maps to the affect contract's `recovery_worsening_unchanged` head. */
  readonly dvdsa: DvdsaClass | null;
  readonly rationale: string;
}

export interface RelapseOptions {
  /** Risk-delta band within which a change is considered "stable/unchanged". */
  readonly stableBand?: number;
}

const DEFAULT_STABLE_BAND = 0.12;

/** Classify a single paired comparison. Semantics depend on the reference kind. */
export function classifyComparison(
  current: RelapseSample,
  reference: RelapseSample,
  kind: RelapseReferenceKind,
  options: RelapseOptions = {},
): PairwiseComparison {
  const band = options.stableBand ?? DEFAULT_STABLE_BAND;
  const riskDelta = current.riskScore - reference.riskScore;

  let cls: RelapseClass;
  if (kind === "previous_high_risk") {
    // Moving AWAY from a known high-risk sample is recovery; staying ≈ concerning-stable.
    if (riskDelta <= -band) cls = "recovery";
    else if (riskDelta >= band) cls = "worsening";
    else cls = current.riskScore >= 0.6 ? "relapse_drift" : "stable";
  } else {
    // vs stable / recent baseline: rising risk is worsening or drift.
    if (riskDelta >= 2 * band) cls = "relapse_drift";
    else if (riskDelta >= band) cls = "worsening";
    else if (riskDelta <= -band) cls = "recovery";
    else cls = "stable";
  }
  return { kind, riskDelta, class: cls };
}

const RELAPSE_TO_DVDSA: Record<RelapseClass, DvdsaClass | null> = {
  recovery: "recovery",
  stable: "unchanged",
  worsening: "worsening",
  relapse_drift: "worsening",
  uncertain: null,
};

/**
 * Synthesize the four paired comparisons into one verdict. Requires at least
 * one reference; otherwise abstains as `uncertain` (we never guess a relapse
 * with no history).
 */
export function assessRelapse(
  current: RelapseSample,
  references: Partial<Record<RelapseReferenceKind, RelapseSample>>,
  options: RelapseOptions = {},
): RelapseVerdict {
  const comparisons: PairwiseComparison[] = [];
  for (const kind of RELAPSE_REFERENCE_KINDS) {
    const ref = references[kind];
    if (ref) comparisons.push(classifyComparison(current, ref, kind, options));
  }

  if (comparisons.length === 0) {
    return {
      class: "uncertain",
      drift: 0,
      comparisons,
      dvdsa: null,
      rationale: "no personal reference available — cannot assess within-user change",
    };
  }

  const counts = {} as Record<RelapseClass, number>;
  for (const c of comparisons) counts[c.class] = (counts[c.class] ?? 0) + 1;

  // Drift = average of POSITIVE risk deltas (worsening pressure), normalized.
  const positiveDeltas = comparisons.map((c) => Math.max(0, c.riskDelta));
  const drift = clamp01(mean(positiveDeltas) / 0.5);

  const worseningVotes = (counts.worsening ?? 0) + (counts.relapse_drift ?? 0);
  const recoveryVotes = counts.recovery ?? 0;
  const stableVotes = counts.stable ?? 0;

  let cls: RelapseClass;
  let rationale: string;
  if ((counts.relapse_drift ?? 0) >= 2 || ((counts.relapse_drift ?? 0) >= 1 && drift >= 0.5)) {
    cls = "relapse_drift";
    rationale = "multiple references show sustained drift toward a high-risk signature";
  } else if (worseningVotes > recoveryVotes && worseningVotes > stableVotes) {
    cls = "worsening";
    rationale = "more references indicate worsening than recovery/stability";
  } else if (recoveryVotes > worseningVotes && recoveryVotes >= stableVotes) {
    cls = "recovery";
    rationale = "references indicate movement toward recovery";
  } else if (stableVotes >= worseningVotes && stableVotes >= recoveryVotes && worseningVotes === recoveryVotes) {
    cls = "stable";
    rationale = "references indicate the user is close to their usual pattern";
  } else {
    cls = "uncertain";
    rationale = "references conflict — not enough agreement to commit";
  }

  return { class: cls, drift, comparisons, dvdsa: RELAPSE_TO_DVDSA[cls], rationale };
}
