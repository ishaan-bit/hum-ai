import { clamp01 } from "@hum-ai/shared-types";
import { NUMERIC_FEATURE_KEYS, NULLABLE_FEATURE_KEYS } from "@hum-ai/signal-lab/feature-schema";
import { trainableExamples, type NativeCorpus } from "./corpus";
import type { Axis } from "./calibration";

/**
 * PERSONAL FEATURE IMPORTANCE (HiTL-driven personalization).
 *
 * The personalization layer learns per-feature SALIENCE from the user's baseline
 * statistics (informativeness × independence). But the corpus knows something the
 * baseline can't: which of the user's hum features actually TRACK how they say they
 * feel. This computes that — the |correlation| of each derived feature with the user's
 * own reported valence/arousal across their labelled hums — so the personal read can
 * weight the axes that are genuinely predictive FOR THIS PERSON.
 *
 * Honest + cheap: a distribution-free magnitude (|Pearson r|), normalized to [0,1],
 * over the same flat feature names the personalization salience uses. Returns {} below
 * a minimum sample size (never over-trust a handful of labels). Non-clinical.
 */

/** Minimum labelled hums before personal importance is computed (else {}). */
export const IMPORTANCE_MIN_EXAMPLES = 12;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d > 1e-12 ? sxy / d : 0;
}

/** Per-feature |correlation| with the reported axis label, max-normalized to [0,1]. */
export function personalFeatureImportance(corpus: NativeCorpus, axis: Axis): Record<string, number> {
  const rows = trainableExamples(corpus);
  if (rows.length < IMPORTANCE_MIN_EXAMPLES) return {};
  const out: Record<string, number> = {};
  const keys = [...NUMERIC_FEATURE_KEYS, ...NULLABLE_FEATURE_KEYS] as readonly string[];
  for (const key of keys) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of rows) {
      const v = (r.features as unknown as Record<string, number | null>)[key];
      const y = r.label[axis];
      if (typeof v === "number" && Number.isFinite(v) && Number.isFinite(y)) {
        xs.push(v);
        ys.push(y);
      }
    }
    if (xs.length >= IMPORTANCE_MIN_EXAMPLES) {
      const c = Math.abs(pearson(xs, ys));
      if (Number.isFinite(c) && c > 0) out[key] = c;
    }
  }
  const max = Math.max(1e-9, ...Object.values(out));
  for (const k of Object.keys(out)) out[k] = clamp01(out[k]! / max);
  return out;
}

/**
 * Combined personal importance across BOTH axes (per-feature max) — the single salience
 * hint the read uses. Empty until the corpus is large enough. The personalization layer
 * blends this with its own variance-based salience (see `blendSalience`).
 */
export function combinedFeatureImportance(corpus: NativeCorpus): Record<string, number> {
  const v = personalFeatureImportance(corpus, "valence");
  const a = personalFeatureImportance(corpus, "arousal");
  const out: Record<string, number> = { ...v };
  for (const [k, x] of Object.entries(a)) out[k] = Math.max(out[k] ?? 0, x);
  return out;
}
