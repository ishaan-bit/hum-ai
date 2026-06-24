import { percentile } from "@hum-ai/shared-types";
import { OCEAN_WINDOWED_FEATURES, type PopulationOceanNorms } from "@hum-ai/personality-signature";
import type { NativeHumExample } from "@hum-ai/affect-model-contracts";

/**
 * POPULATION OCEAN NORMS (ADR-0012) — recompute each windowed OCEAN cue's normalization
 * window from the POOLED distribution's robust percentiles, turning the hardcoded protocol
 * defaults (voice-big-five.md §5: "Ranges are protocol defaults, not population norms") into
 * data-grounded windows. This is how the Big Five read — like the affect read — keeps improving
 * across users: the more hums the population contributes, the better-centred the trait windows.
 *
 * Discipline: a window is only emitted for a cue with ENOUGH pooled samples (`MIN_SAMPLES`),
 * and only when the resulting window is non-degenerate (hi > lo). Cues without enough data
 * simply keep their protocol default (the resolver falls back). Within-user behavior is never
 * touched — these norms apply to the shared population read.
 */

/** Lower / upper percentiles that define a cue's window (robust to outliers). */
export const NORM_LOW_PCTL = 0.1;
export const NORM_HIGH_PCTL = 0.9;
/** A cue needs at least this many pooled finite values before its window is recomputed from data. */
export const MIN_SAMPLES = 30;
/** Minimum window width (in the cue's units, relative) so a near-constant cue can't collapse. */
const MIN_REL_WIDTH = 1e-6;

/** Collect the finite values of one feature across the pooled examples. */
function featureValues(examples: readonly NativeHumExample[], feature: string): number[] {
  const out: number[] = [];
  for (const ex of examples) {
    const v = (ex.features as unknown as Record<string, unknown>)[feature];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export interface OceanNormResult {
  readonly norms: PopulationOceanNorms;
  /** Per-key provenance: how many samples backed each recomputed window (audit). */
  readonly support: Record<string, number>;
  /** Keys that kept their protocol default (too few samples / degenerate window). */
  readonly skipped: readonly string[];
}

/**
 * Compute population OCEAN norms from the pooled examples. Returns the data-grounded windows
 * (keyed "<trait>.<feature>") plus provenance. Pure.
 */
export function computePopulationOceanNorms(examples: readonly NativeHumExample[]): OceanNormResult {
  const norms: PopulationOceanNorms = {};
  const support: Record<string, number> = {};
  const skipped: string[] = [];

  for (const cue of OCEAN_WINDOWED_FEATURES) {
    const values = featureValues(examples, cue.feature);
    support[cue.key] = values.length;
    if (values.length < MIN_SAMPLES) {
      skipped.push(cue.key);
      continue;
    }
    const lo = percentile(values, NORM_LOW_PCTL);
    const hi = percentile(values, NORM_HIGH_PCTL);
    if (!(hi - lo > MIN_REL_WIDTH)) {
      skipped.push(cue.key); // degenerate (near-constant) — keep the protocol default
      continue;
    }
    // The window's [lo,hi] keep their meaning under both `normalize` and `inverseNormalize`
    // (the `invert` flag lives in the trait's compute call, not the window), so one [p10,p90]
    // window serves a cue whether it pushes a trait up or down.
    norms[cue.key] = { lo, hi };
  }

  return { norms, support, skipped };
}
