import type { NativeHumExample } from "@hum-ai/affect-model-contracts";
import { type FusionLabel } from "@hum-ai/affect-model-contracts";
import { defaultAudioExperts } from "@hum-ai/expert-ser";
import {
  fitMetaLearner,
  LogisticRegressionMetaLearner,
  StubWeightedMetaLearner,
  argmax,
  type MetaLearner,
  type MetaLearnerSample,
  type LogisticRegressionParams,
} from "@hum-ai/fusion-engine";
import { trainableExamples, type NativeCorpus } from "./corpus";

/**
 * FUSION META-LEARNER TRAINING — close the end-to-end learned-accuracy loop on-device.
 *
 * The `LogisticRegressionMetaLearner` is built and tested but dormant; the live fusion
 * uses the hand-weighted `StubWeightedMetaLearner`. This fits the trained meta-learner on
 * the user's OWN confirmed hums and promotes it ONLY when it beats the stub on held-out
 * data — exactly the backbone-floor discipline of the axis retrain (`train.ts`).
 *
 * Pipeline (pure-ish; the experts' `predict` is async): for each labelled hum, run the
 * deterministic expert ensemble on its features → expert outputs, and map the user's
 * BENIGN self-report valence/arousal to a benign FUSION_LABEL quadrant (never a clinical
 * label). Fit, cross-validate vs the stub, promote if it clears a floor AND beats the stub.
 *
 * GOVERNANCE: the V-A → label map emits ONLY benign affect states (the same labels the
 * heuristic experts already produce); it never emits a clinical-risk marker. The trained
 * meta-learner only sharpens the SECONDARY affect/state read + confidence — the dimensional
 * valence/arousal read still leads from the transparent acoustic backbone (ADR-0010).
 */

/** Self-reports inside this dead-zone of 0 on BOTH axes read as "close to usual". */
export const FUSION_QUADRANT_DEADZONE = 0.2;
/** Minimum labelled hums before a fusion retrain is attempted. */
export const FUSION_MIN_EXAMPLES = 32;
/** 5-fold CV. */
export const FUSION_CV_FOLDS = 5;
/** Absolute held-out accuracy floor the challenger must clear (7-way; chance ≈ 0.14). */
export const FUSION_ABS_FLOOR = 0.45;
/** Margin by which the trained meta-learner must beat the stub to be promoted. */
export const FUSION_PROMOTE_MARGIN = 0.04;
/** Cap on examples fed to a fusion retrain (most-recent window) — keeps it responsive. */
export const FUSION_TRAIN_MAX_ROWS = 400;

/** Transparent benign V-A → FUSION_LABEL quadrant. Never a clinical-risk marker. */
export function fusionLabelFromVA(valence: number, arousal: number): FusionLabel {
  if (Math.abs(valence) < FUSION_QUADRANT_DEADZONE && Math.abs(arousal) < FUSION_QUADRANT_DEADZONE) {
    return "neutral_close_to_usual";
  }
  if (valence > 0 && arousal > 0) return "positive_activation"; // pleasant + activated
  if (valence > 0) return "calm_regulated"; // pleasant + settled
  if (arousal > 0) return "tense_anxious"; // unpleasant + activated
  return "low_mood"; // unpleasant + settled
}

/** Capture meta for the experts (they gate on captureQuality > 0 + non-silent). */
const EXPERT_META = { modality: "audio" as const, captureQuality: 0.8 };

/** Run the deterministic expert ensemble over the corpus → labelled meta-learner samples. */
export async function buildMetaLearnerSamples(corpus: NativeCorpus): Promise<MetaLearnerSample[]> {
  const experts = defaultAudioExperts();
  const all = trainableExamples(corpus);
  const rows = all.length > FUSION_TRAIN_MAX_ROWS ? all.slice(all.length - FUSION_TRAIN_MAX_ROWS) : all;
  return Promise.all(
    rows.map(async (ex: NativeHumExample): Promise<MetaLearnerSample> => {
      const outputs = await Promise.all(experts.map((e) => e.predict(ex.features, EXPERT_META)));
      return { experts: outputs, label: fusionLabelFromVA(ex.label.valence, ex.label.arousal) };
    }),
  );
}

function accuracyOn(ml: MetaLearner, samples: readonly MetaLearnerSample[]): number {
  if (samples.length === 0) return 0;
  let correct = 0;
  for (const s of samples) if (argmax(ml.combine(s.experts)).label === s.label) correct++;
  return correct / samples.length;
}

/** Deterministic fold by index. */
const foldOf = (i: number, k: number): number => i % k;

export interface FusionPromotion {
  readonly decision: "promote" | "hold";
  readonly n: number;
  /** Distinct fusion-label classes present in the corpus. */
  readonly classes: number;
  /** Held-out accuracy of the trained meta-learner [0,1]. */
  readonly challengerAccuracy: number;
  /** Held-out accuracy of the hand-weighted stub on the same folds [0,1]. */
  readonly stubAccuracy: number;
  readonly reasons: readonly string[];
  /** The full-data fit — present ONLY when promoted. */
  readonly params: LogisticRegressionParams | null;
}

/** Evaluate whether the trained meta-learner should replace the stub for this user. */
export function evaluateFusionPromotion(samples: readonly MetaLearnerSample[]): FusionPromotion {
  const n = samples.length;
  const classes = new Set(samples.map((s) => s.label)).size;
  const reasons: string[] = [];
  if (n < FUSION_MIN_EXAMPLES) reasons.push(`needs ≥${FUSION_MIN_EXAMPLES} labelled hums (have ${n})`);
  if (classes < 2) reasons.push("needs at least two distinct affect quadrants");
  if (n < FUSION_MIN_EXAMPLES || classes < 2) {
    return { decision: "hold", n, classes, challengerAccuracy: 0, stubAccuracy: 0, reasons, params: null };
  }

  const stub = new StubWeightedMetaLearner();
  let chCorrect = 0;
  let stubCorrect = 0;
  let total = 0;
  for (let f = 0; f < FUSION_CV_FOLDS; f++) {
    const train = samples.filter((_, i) => foldOf(i, FUSION_CV_FOLDS) !== f);
    const test = samples.filter((_, i) => foldOf(i, FUSION_CV_FOLDS) === f);
    if (test.length === 0 || new Set(train.map((s) => s.label)).size < 2) continue;
    const challenger = new LogisticRegressionMetaLearner(fitMetaLearner(train));
    for (const s of test) {
      total++;
      if (argmax(challenger.combine(s.experts)).label === s.label) chCorrect++;
      if (argmax(stub.combine(s.experts)).label === s.label) stubCorrect++;
    }
  }
  const challengerAccuracy = total > 0 ? chCorrect / total : 0;
  const stubAccuracy = total > 0 ? stubCorrect / total : 0;

  const clearsFloor = challengerAccuracy >= FUSION_ABS_FLOOR;
  const beatsStub = challengerAccuracy - stubAccuracy >= FUSION_PROMOTE_MARGIN;
  if (!clearsFloor) reasons.push(`held-out accuracy ${(challengerAccuracy * 100).toFixed(0)}% below the ${(FUSION_ABS_FLOOR * 100).toFixed(0)}% floor`);
  if (!beatsStub) reasons.push(`does not beat the default fusion by ≥${(FUSION_PROMOTE_MARGIN * 100).toFixed(0)}% (${(challengerAccuracy * 100).toFixed(0)}% vs ${(stubAccuracy * 100).toFixed(0)}%)`);

  const promote = clearsFloor && beatsStub;
  if (promote) reasons.push(`learned fusion beats the default on your hums (${(challengerAccuracy * 100).toFixed(0)}% vs ${(stubAccuracy * 100).toFixed(0)}% held-out)`);

  return {
    decision: promote ? "promote" : "hold",
    n,
    classes,
    challengerAccuracy,
    stubAccuracy,
    reasons,
    params: promote ? fitMetaLearner(samples) : null,
  };
}

/** Train + evaluate the fusion meta-learner from the corpus (async — runs the experts). */
export async function trainFusionMetaLearner(corpus: NativeCorpus): Promise<FusionPromotion> {
  return evaluateFusionPromotion(await buildMetaLearnerSamples(corpus));
}

/** Build a live meta-learner from promoted params (or null → caller uses the stub default). */
export function metaLearnerFromParams(params: LogisticRegressionParams | null | undefined): MetaLearner | null {
  return params ? new LogisticRegressionMetaLearner(params) : null;
}
