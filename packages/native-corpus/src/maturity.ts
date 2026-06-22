import type { NativeCorpus } from "./corpus";
import { corpusStats } from "./corpus";
import { calibrationTrend, type TrendDirection } from "./calibration";
import { assessPersonalizationBenefit, type PersonalizationBenefit } from "./benefit";
import { corpusReadiness } from "./active-learning";
import { hasPromotedNativeModel, type HumNativeArtifact } from "./manifest";

/**
 * NATIVE-HUM MATURITY VIEW (Part D) — one sanitized, view-model the "Your hum model"
 * panel (and any internal surface) can render TRUTHFULLY.
 *
 * It answers, honestly and without overclaiming, "where is my hum model in its lifecycle?":
 *  - how many eligible hums the baseline has seen, and how many were actually labelled;
 *  - whether each hum-native axis model is PROMOTED (steering the read) or still TRAINING;
 *  - whether the read is getting better against the user's self-reports (calibration trend);
 *  - whether personalization is HELPING / UNCLEAR / WORSENING / INSUFFICIENT (the §C metric).
 *
 * HONESTY GUARDRAILS (by construction):
 *  - No raw accuracy percentage and no clinical label appears in this object — only counts
 *    (hum/label counts, which are not confidence/accuracy figures) and coarse enums. A
 *    renderer can show it verbatim under the ADR-0008 "no raw % in user copy" rule.
 *  - It is descriptive of the LIFECYCLE, never a diagnosis or a validated-accuracy claim.
 *  - Derived purely from the local corpus + artifact + the caller's eligible-hum count.
 */

export interface NativeMaturityView {
  /** Eligible (quality-gated) hums the baseline has accumulated (from the personalization state). */
  readonly eligibleHumCount: number;
  /** Total labelled native-hum examples in the corpus (confirm + adjust). */
  readonly labelledExamples: number;
  /** Eligible labelled examples (the ones that can train / score the model). */
  readonly trainableExamples: number;
  /** How many of the 4 mood-energy regions have ≥1 eligible labelled example [0,4]. */
  readonly quadrantsCovered: number;
  /** Per-axis lifecycle: a promoted model steers the read; otherwise it is still training. */
  readonly valenceModel: "promoted" | "training";
  readonly arousalModel: "promoted" | "training";
  /** True when at least one axis model is promoted (steering the read in-domain). */
  readonly anyPromoted: boolean;
  /** Enough fresh, balanced data to attempt a retrain (active-learning readiness). */
  readonly readyToRetrain: boolean;
  /** Is the read tracking the user's self-reports better over time? (per axis). */
  readonly calibrationTrend: { readonly valence: TrendDirection; readonly arousal: TrendDirection };
  /** Is personalizing the read actually helping vs the bare backbone? (§C, abstains when thin). */
  readonly personalizationBenefit: PersonalizationBenefit;
  /** One plain, non-clinical headline summarising the stage (safe to render). */
  readonly summary: string;
}

export interface MaturityInput {
  readonly corpus: NativeCorpus;
  readonly artifact: HumNativeArtifact | null;
  /** Eligible-hum count from the personalization state (NOT derivable from the corpus alone). */
  readonly eligibleHumCount: number;
}

function summarise(v: NativeMaturityView): string {
  if (v.anyPromoted) {
    return "A hum-native model trained on your own confirmed hums is steering your read. It keeps refining as you give feedback. Non-clinical.";
  }
  if (v.labelledExamples === 0) {
    return "Your model is just getting started — confirm a few reads to begin teaching it.";
  }
  const benefitNote =
    v.personalizationBenefit === "personalization_helping"
      ? " Personalizing is already tracking your self-reports more closely than the generic read."
      : "";
  return `Your hum model is still training (${v.labelledExamples} labelled hum${v.labelledExamples === 1 ? "" : "s"}, ${v.quadrantsCovered}/4 regions covered).${benefitNote} Non-clinical.`;
}

/**
 * Build the sanitized maturity view from the local corpus + artifact + the eligible-hum count.
 * Pure; no I/O. Carries no raw accuracy % and no clinical label.
 */
export function buildNativeMaturityView(input: MaturityInput): NativeMaturityView {
  const { corpus, artifact, eligibleHumCount } = input;
  const stats = corpusStats(corpus);
  const ready = corpusReadiness(corpus);
  const valencePromoted = !!artifact && artifact.manifest.valence.decision === "promote";
  const arousalPromoted = !!artifact && artifact.manifest.arousal.decision === "promote";

  const view: Omit<NativeMaturityView, "summary"> = {
    eligibleHumCount: Math.max(0, Math.floor(eligibleHumCount)),
    labelledExamples: stats.total,
    trainableExamples: stats.eligible,
    quadrantsCovered: stats.quadrantsCovered,
    valenceModel: valencePromoted ? "promoted" : "training",
    arousalModel: arousalPromoted ? "promoted" : "training",
    anyPromoted: hasPromotedNativeModel(artifact),
    readyToRetrain: ready.anyReady,
    calibrationTrend: {
      valence: calibrationTrend(corpus, "valence").direction,
      arousal: calibrationTrend(corpus, "arousal").direction,
    },
    personalizationBenefit: assessPersonalizationBenefit(corpus).status,
  };
  return { ...view, summary: summarise(view as NativeMaturityView) };
}
