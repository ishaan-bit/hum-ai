import { clamp01, mean as meanOf } from "@hum-ai/shared-types";
import type { NativeHumExample } from "@hum-ai/affect-model-contracts";
import { acousticAffectAxes } from "@hum-ai/orchestrator";
import { trainableExamples, type NativeCorpus } from "./corpus";
import { CALIBRATION_DEADZONE, type Axis } from "./calibration";

/**
 * PERSONALIZATION BENEFIT — the smallest HONEST counterfactual: "is personalizing the
 * read actually helping, measured against the user's own benign self-reports?"
 *
 * For every labelled hum we already have three things, all on-device, all benign:
 *  - the BACKBONE prediction: `acousticAffectAxes(features)` — the transparent acoustic
 *    valence/arousal the read would give with NO personalization at all (recomputed fresh,
 *    deterministic from the stored derived features);
 *  - the PERSONALIZED prediction the user actually saw: `example.predicted` — the axis read
 *    AFTER the user's HiTL axis calibration was applied (`orchestrator` `internal.axis.dimensional`);
 *  - the TRUTH: `example.label` — the user's benign valence/arousal self-report.
 *
 * We compare mean-absolute-error of the personalized read vs the backbone read against the
 * self-reports. If personalizing tracks the user's stated feeling MEANINGFULLY better, that's
 * `personalization_helping`; meaningfully worse is `personalization_worsening`; a small/noisy
 * gap is `neutral_or_unclear`; too little data is `insufficient_evidence` (we abstain).
 *
 * HONESTY GUARDRAILS:
 *  - This is NOT an accuracy claim and NOT clinical. It is within-user convergent validity
 *    of the personalization layer against self-reports, reported as a coarse category.
 *  - It is RETROSPECTIVE: `example.predicted` carries the calibration that was live when that
 *    hum was read, so a fresh corpus with no calibration engaged will (correctly) read as
 *    `neutral_or_unclear` — personalization that has done nothing shows no benefit.
 *  - No new model is fit; no clinical label is read or required (the label space is the benign
 *    valence/arousal `HumLabel`, guarded at mint time by `assertValidNativeHumExample`).
 *  - Below `BENEFIT_MIN_EXAMPLES` it abstains rather than guess.
 */

export type PersonalizationBenefit =
  | "insufficient_evidence"
  | "personalization_helping"
  | "neutral_or_unclear"
  | "personalization_worsening";

/** Minimum non-ambiguous labelled hums before any benefit verdict (else abstain). */
export const BENEFIT_MIN_EXAMPLES = 12;
/** |Δ MAE| (over the [-1,1] axes, averaged across valence+arousal) below which the call is "unclear". */
export const BENEFIT_MAE_DEADBAND = 0.03;

export interface PersonalizationBenefitAssessment {
  readonly status: PersonalizationBenefit;
  /** Number of (example × axis) non-ambiguous comparisons scored (the evidence base). */
  readonly n: number;
  /** Mean |backbone − reported| over both axes, [0,2]; null when below threshold. */
  readonly backboneMae: number | null;
  /** Mean |personalized − reported| over both axes, [0,2]; null when below threshold. */
  readonly personalizedMae: number | null;
  /** backboneMae − personalizedMae (positive ⇒ personalization is closer to the truth). */
  readonly improvement: number | null;
  /** Plain, non-clinical reasons for the verdict. */
  readonly reasons: readonly string[];
}

/** Per-example, per-axis error against the self-report (only over non-ambiguous reports). */
function axisErrors(examples: readonly NativeHumExample[], axis: Axis): { backbone: number[]; personalized: number[] } {
  const backbone: number[] = [];
  const personalized: number[] = [];
  for (const ex of examples) {
    const reported = ex.label[axis];
    if (!Number.isFinite(reported)) continue;
    // Skip ambiguous (near-zero) self-reports — no informative target to score against.
    if (Math.abs(reported) < CALIBRATION_DEADZONE) continue;
    const back = acousticAffectAxes(ex.features)[axis];
    const pers = ex.predicted[axis];
    if (!Number.isFinite(back) || !Number.isFinite(pers)) continue;
    backbone.push(Math.abs(back - reported));
    personalized.push(Math.abs(pers - reported));
  }
  return { backbone, personalized };
}

/**
 * Assess whether personalization is helping the read track the user's self-reports, over the
 * eligible non-ambiguous labelled hums. Pure; no I/O; abstains below `BENEFIT_MIN_EXAMPLES`.
 */
export function assessPersonalizationBenefit(corpus: NativeCorpus): PersonalizationBenefitAssessment {
  const examples = trainableExamples(corpus);
  const v = axisErrors(examples, "valence");
  const a = axisErrors(examples, "arousal");
  const backboneErrs = [...v.backbone, ...a.backbone];
  const personalizedErrs = [...v.personalized, ...a.personalized];
  const n = backboneErrs.length; // total (example × axis) non-ambiguous comparisons

  if (n < BENEFIT_MIN_EXAMPLES) {
    return {
      status: "insufficient_evidence",
      n,
      backboneMae: null,
      personalizedMae: null,
      improvement: null,
      reasons: [`needs ≥${BENEFIT_MIN_EXAMPLES} clear labelled comparisons (have ${n})`],
    };
  }

  const backboneMae = meanOf(backboneErrs);
  const personalizedMae = meanOf(personalizedErrs);
  const improvement = backboneMae - personalizedMae;

  let status: PersonalizationBenefit;
  const reasons: string[] = [];
  if (improvement > BENEFIT_MAE_DEADBAND) {
    status = "personalization_helping";
    reasons.push(`personalized read is closer to your self-reports (MAE ${personalizedMae.toFixed(2)} vs ${backboneMae.toFixed(2)} backbone)`);
  } else if (improvement < -BENEFIT_MAE_DEADBAND) {
    status = "personalization_worsening";
    reasons.push(`personalized read is further from your self-reports than the backbone (MAE ${personalizedMae.toFixed(2)} vs ${backboneMae.toFixed(2)})`);
  } else {
    status = "neutral_or_unclear";
    reasons.push(`personalized and backbone track your self-reports about equally (MAE ${personalizedMae.toFixed(2)} vs ${backboneMae.toFixed(2)})`);
  }

  return { status, n, backboneMae, personalizedMae, improvement, reasons };
}
