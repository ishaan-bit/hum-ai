import { FUSION_LABEL_AFFECT, type FusionLabel } from "@hum-ai/affect-model-contracts";
import { supportedFusionLabels } from "./labels";

/**
 * Inference TARGETS for the multi-dataset modeling experiment.
 *
 * The repo's primary affect target is the 7-way `FUSION_LABELS` space. That is a
 * hard 6-way problem on far-domain acted speech (RAVDESS supports 6 of 7). To ask
 * the honest question "is ANY inference target separable enough to clear a high
 * support bar?", we ALSO derive two coarser targets DIRECTLY from the contract's
 * Russell V-A anchors (`FUSION_LABEL_AFFECT`) — we invent no new labels:
 *
 *  - `arousal_binary`  — high vs low arousal, from `va.arousal`.
 *  - `valence_binary`  — positive vs negative valence, from `va.valence`.
 *
 * Both use a small dead-band around 0: a label whose anchor sits inside the band is
 * EXCLUDED (not forced to a side). The only label inside the band is
 * `neutral_close_to_usual` (V0/A0), so each binary split is exactly "drop the
 * neutral mid-point, then separate the two poles" — principled, fully traceable,
 * and not cherry-picked. These remain acted-speech PRIORS (ADR-0005), never hum
 * truth; the coarser target only changes the question, not the governance.
 */

/** Dead-band half-width on the V/A axis. Only `neutral_close_to_usual` (0,0) falls inside. */
export const AFFECT_AXIS_DEADBAND = 0.15;

export interface TargetDef {
  readonly id: string;
  readonly description: string;
  readonly classes: readonly string[];
  /** Provenance string for the artifact + tests (no invented labels). */
  readonly source: string;
  /** Map a fusion label to this target's class, or null to EXCLUDE the sample. */
  readonly classOf: (label: FusionLabel) => string | null;
}

/** Primary target: the fusion-label space itself (identity over RAVDESS-supported labels). */
export const AFFECT_FUSION_TARGET: TargetDef = {
  id: "affect_fusion_label",
  description: "7-way fusion affect label (RAVDESS supports 6 of 7; fatigued has no support).",
  classes: supportedFusionLabels(),
  source: "@hum-ai/affect-model-contracts FUSION_LABELS",
  classOf: (label) => (supportedFusionLabels().includes(label) ? label : null),
};

/** Coarse target: high vs low arousal from the contract's V-A anchor. */
export const AROUSAL_BINARY_TARGET: TargetDef = {
  id: "arousal_binary",
  description: "High vs low arousal, derived from FUSION_LABEL_AFFECT.va.arousal (neutral excluded).",
  classes: ["low_arousal", "high_arousal"],
  source: "FUSION_LABEL_AFFECT.va.arousal sign with a ±0.15 dead-band",
  classOf: (label) => {
    const a = FUSION_LABEL_AFFECT[label].va.arousal;
    if (a > AFFECT_AXIS_DEADBAND) return "high_arousal";
    if (a < -AFFECT_AXIS_DEADBAND) return "low_arousal";
    return null; // neutral mid-point
  },
};

/** Coarse target: positive vs negative valence from the contract's V-A anchor. */
export const VALENCE_BINARY_TARGET: TargetDef = {
  id: "valence_binary",
  description: "Positive vs negative valence, derived from FUSION_LABEL_AFFECT.va.valence (neutral excluded).",
  classes: ["negative_valence", "positive_valence"],
  source: "FUSION_LABEL_AFFECT.va.valence sign with a ±0.15 dead-band",
  classOf: (label) => {
    const v = FUSION_LABEL_AFFECT[label].va.valence;
    if (v > AFFECT_AXIS_DEADBAND) return "positive_valence";
    if (v < -AFFECT_AXIS_DEADBAND) return "negative_valence";
    return null; // neutral mid-point
  },
};

export const EXPERIMENT_TARGETS: readonly TargetDef[] = [
  AFFECT_FUSION_TARGET,
  AROUSAL_BINARY_TARGET,
  VALENCE_BINARY_TARGET,
];

/** A serializable, fully-traceable snapshot of every target's label assignment. */
export interface TargetSnapshot {
  readonly id: string;
  readonly description: string;
  readonly classes: readonly string[];
  readonly source: string;
  readonly assignment: Readonly<Record<string, string | "excluded">>;
}

export function targetSnapshot(t: TargetDef): TargetSnapshot {
  const assignment: Record<string, string | "excluded"> = {};
  for (const label of supportedFusionLabels()) assignment[label] = t.classOf(label) ?? "excluded";
  return { id: t.id, description: t.description, classes: t.classes, source: t.source, assignment };
}
