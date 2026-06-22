import type { UnitInterval } from "@hum-ai/shared-types";
import { ANCHOR_MIN_HUMS } from "./dual-baseline";

/**
 * The personalization ladder (project brief), with confidence caps from
 * `hum_spec` §4.8. Public-dataset priors dominate at the bottom; the personal
 * baseline and within-user models progressively take over as eligible hums
 * accumulate. The cap rises only as the model earns the right to be confident.
 */
export const PERSONALIZATION_STAGES = [
  "population_prior",
  "early_calibration",
  "personal_baseline",
  "personalized_fusion",
  "relapse_model",
] as const;
export type PersonalizationStage = (typeof PERSONALIZATION_STAGES)[number];

export interface StagePolicy {
  readonly stage: PersonalizationStage;
  readonly confidenceCap: UnitInterval;
  readonly capReason: string;
  /** Maturity factor fed to the confidence model (hum_spec §4.8 baselineMaturity). */
  readonly calibrationMaturity: UnitInterval;
  readonly baselineActive: boolean;
  readonly personalizedFusionActive: boolean;
  readonly relapseModelActive: boolean;
}

/** Map an eligible-hum count to its stage policy. */
export function stagePolicy(eligibleHumCount: number): StagePolicy {
  const n = Math.max(0, Math.floor(eligibleHumCount));
  if (n <= 1) {
    return {
      stage: "population_prior",
      // 0.72 coincides with safety-language's EVIDENCE_BANDS.high but is a DIFFERENT fact
      // (a maturity gate, not a UI evidence band). Deliberately not shared — safety-language is a
      // zero-dep leaf and the two may evolve independently (ADR-0004 / ADR-0008).
      confidenceCap: 0.72,
      capReason: "first-hum cap 0.72 (population prior only)",
      calibrationMaturity: 0.45,
      baselineActive: false,
      personalizedFusionActive: false,
      relapseModelActive: false,
    };
  }
  if (n <= 4) {
    return {
      stage: "early_calibration",
      confidenceCap: 0.76,
      capReason: "pre-baseline cap 0.76 (early calibration, hums 2–4)",
      calibrationMaturity: 0.52,
      baselineActive: false,
      personalizedFusionActive: false,
      relapseModelActive: false,
    };
  }
  if (n <= 9) {
    return {
      stage: "personal_baseline",
      confidenceCap: 0.82,
      capReason: "baseline cap 0.82 (personal baseline active, hums 5–9)",
      calibrationMaturity: 0.66,
      baselineActive: true,
      personalizedFusionActive: false,
      relapseModelActive: false,
    };
  }
  // Relapse model activates exactly when the anchored baseline does
  // (`ANCHOR_MIN_HUMS`); derive the boundary from that constant so the two
  // cannot silently desync (invariant 8).
  if (n < ANCHOR_MIN_HUMS) {
    return {
      stage: "personalized_fusion",
      confidenceCap: 0.88,
      capReason: "personalized cap 0.88 (personalized fusion weights, hums 10–19)",
      calibrationMaturity: 0.78,
      baselineActive: true,
      personalizedFusionActive: true,
      relapseModelActive: false,
    };
  }
  return {
    stage: "relapse_model",
    confidenceCap: 0.92,
    capReason: "mature cap 0.92 (relapse/change model active, hums 20+)",
    calibrationMaturity: 0.9,
    baselineActive: true,
    personalizedFusionActive: true,
    relapseModelActive: true,
  };
}
