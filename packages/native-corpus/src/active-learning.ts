import type { NativeCorpus } from "./corpus";
import { buildAxisRows, NATIVE_MIN_EXAMPLES, NATIVE_MIN_PER_CLASS } from "./train";
import type { Axis } from "./calibration";

/**
 * ACTIVE LEARNING — the corpus-side complement to the orchestrator's per-read
 * `buildFeedbackRequest`. The read knows whether THIS hum is informative; this knows
 * what the WHOLE corpus is still missing to unlock (or improve) a retrain, so the app
 * can steer collection toward the gap (e.g. "a few more low-energy hums") instead of
 * collecting redundant easy labels. Pure; no I/O.
 */

export interface RetrainReadiness {
  readonly axis: Axis;
  /** Whether the corpus meets the gate's data prerequisites (a retrain will be attempted). */
  readonly ready: boolean;
  readonly n: number;
  readonly classCounts: { readonly low: number; readonly high: number };
  /** How many more clear labels of each kind to reach the gate prerequisites (0 when met). */
  readonly need: { readonly examples: number; readonly low: number; readonly high: number };
}

export function retrainReadiness(corpus: NativeCorpus, axis: Axis): RetrainReadiness {
  const rows = buildAxisRows(corpus, axis);
  let high = 0;
  for (const r of rows) if (r.high) high++;
  const low = rows.length - high;
  const need = {
    examples: Math.max(0, NATIVE_MIN_EXAMPLES - rows.length),
    low: Math.max(0, NATIVE_MIN_PER_CLASS - low),
    high: Math.max(0, NATIVE_MIN_PER_CLASS - high),
  };
  const ready = rows.length >= NATIVE_MIN_EXAMPLES && low >= NATIVE_MIN_PER_CLASS && high >= NATIVE_MIN_PER_CLASS;
  return { axis, ready, n: rows.length, classCounts: { low, high }, need };
}

export interface CorpusReadiness {
  readonly valence: RetrainReadiness;
  readonly arousal: RetrainReadiness;
  /** True when at least one axis is ready to (re)train. */
  readonly anyReady: boolean;
}

export function corpusReadiness(corpus: NativeCorpus): CorpusReadiness {
  const valence = retrainReadiness(corpus, "valence");
  const arousal = retrainReadiness(corpus, "arousal");
  return { valence, arousal, anyReady: valence.ready || arousal.ready };
}

/**
 * A short, non-diagnostic hint about what to collect next to advance the loop. Returns
 * null once both axes are ready (nothing specific is needed). Never clinical; talks
 * only about the hum's character (more energetic / more settled / brighter / softer).
 */
export function nextCollectionHint(corpus: NativeCorpus): string | null {
  const r = corpusReadiness(corpus);
  if (r.anyReady && r.valence.ready && r.arousal.ready) return null;
  const wants: string[] = [];
  if (r.arousal.need.high > 0) wants.push(`${r.arousal.need.high} more lively, energetic hum${r.arousal.need.high === 1 ? "" : "s"}`);
  if (r.arousal.need.low > 0) wants.push(`${r.arousal.need.low} more calm, settled hum${r.arousal.need.low === 1 ? "" : "s"}`);
  if (r.valence.need.high > 0) wants.push(`${r.valence.need.high} more hum${r.valence.need.high === 1 ? "" : "s"} on a brighter day`);
  if (r.valence.need.low > 0) wants.push(`${r.valence.need.low} more hum${r.valence.need.low === 1 ? "" : "s"} on a flatter day`);
  if (wants.length === 0) return null;
  return `To sharpen your hum-native read, it helps to log ${wants.slice(0, 2).join(" and ")}, telling us how you felt each time.`;
}
