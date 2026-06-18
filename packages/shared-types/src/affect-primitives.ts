import { clamp } from "./numeric";

/**
 * Russell's circumplex coordinates (`trisense_architecture` ref [7]).
 * Both axes are in [-1, 1]:
 *  - `valence`: unpleasant (−1) → pleasant (+1)
 *  - `arousal`: deactivated/calm (−1) → activated/energised (+1)
 *
 * Valence–Arousal is the shared interlingua between the affect heads and the
 * intervention engine: interventions are selected by where the user sits in
 * V-A space and where we want to nudge them.
 */
export interface ValenceArousal {
  valence: number;
  arousal: number;
}

export function clampValenceArousal(va: ValenceArousal): ValenceArousal {
  return {
    valence: clamp(va.valence, -1, 1),
    arousal: clamp(va.arousal, -1, 1),
  };
}

/** Euclidean distance in V-A space (max ≈ 2.83). */
export function vaDistance(a: ValenceArousal, b: ValenceArousal): number {
  const dv = a.valence - b.valence;
  const da = a.arousal - b.arousal;
  return Math.sqrt(dv * dv + da * da);
}
