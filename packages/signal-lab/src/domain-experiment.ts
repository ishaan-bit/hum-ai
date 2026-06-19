import { HeuristicDomainClassifier, HumDomainAdapter } from "@hum-ai/domain-classifier";
import type { DomainClass } from "@hum-ai/shared-types";
import type { ExpertInputMeta } from "@hum-ai/affect-model-contracts";
import type { SignalRow } from "./extract";
import { toFeatureVector, featureVectorNames } from "./feature-schema";
import type { CohortSample } from "./cohort-eval";
import { LearnedAffectPriorExpert } from "./expert";
import type { LogRegParams } from "./model";

/**
 * The genuinely MULTI-DATASET experiment. Only RAVDESS carries affect labels, so
 * the cross-dataset signal is about DOMAIN / OOD, not affect. Two analyses:
 *
 *  A. Cross-corpus domain separability — map each corpus to its `DomainClass`
 *     (RAVDESS→speech, VocalSet→singing, VocalSound→vocal_burst) and ask whether
 *     the hum-feature space separates them, under SPEAKER-grouped CV.
 *     ⚠ Confound: each domain class is a SINGLE corpus, so domain == corpus ==
 *     recording conditions (sample rate 48k/44.1k/16k, mic, codec). A high score
 *     can be corpus fingerprinting, NOT vocalization-type learning. We therefore
 *     (i) never promote this target, and (ii) run an ABLATION that removes the
 *     sample-rate/bandwidth-sensitive spectral features; if separation survives the
 *     ablation it is less attributable to the spectral ceiling.
 *
 *  B. Hum-likeness probe (NO training, NO confound) — run the repo's OWN domain
 *     guard (`HeuristicDomainClassifier` + `HumDomainAdapter`) and the trained
 *     affect prior on each corpus, and report how hum-compatible each scores. This
 *     VALIDATES the existing guard against three labeled corpora: per ADR-0002 /
 *     `DEFAULT_DOMAIN_GAP`, sustained phonation (VocalSet, near) should read more
 *     hum-like than acted speech (RAVDESS, far) or bursts (VocalSound, moderate).
 */

export interface DomainCorpus {
  readonly datasetId: string;
  readonly domainClass: DomainClass;
}

export const DOMAIN_CORPUS: readonly DomainCorpus[] = [
  { datasetId: "ravdess", domainClass: "speech" },
  { datasetId: "vocalset", domainClass: "singing" },
  { datasetId: "vocalsound", domainClass: "vocal_burst" },
];

/** Spectral features whose range is bounded by the corpus sample rate (Nyquist) — the prime confound. */
export const RATE_SENSITIVE_FEATURES: readonly string[] = [
  "spectralCentroidHz",
  "spectralBandwidthHz",
  "spectralRolloffHz",
  "spectralFlatness",
  "spectralFlux",
  "zeroCrossingRate",
];

/** Build domain-labeled samples (label = corpus DomainClass; group = within-corpus speaker). */
export function buildDomainSamples(rowsByDataset: Readonly<Record<string, readonly SignalRow[]>>): CohortSample[] {
  const out: CohortSample[] = [];
  for (const { datasetId, domainClass } of DOMAIN_CORPUS) {
    const rows = rowsByDataset[datasetId] ?? [];
    rows.forEach((r, i) => {
      out.push({
        vector: toFeatureVector(r.features),
        label: domainClass,
        // Speaker group where parsed; else spread across synthetic buckets so one
        // corpus is not a single CV group (which would break grouped folds).
        group: r.group ?? `${datasetId}_bucket_${i % 8}`,
      });
    });
  }
  return out;
}

export interface AblatedSet {
  readonly samples: CohortSample[];
  readonly featureNames: string[];
}

/** Drop the named feature columns (and their `__present` masks) from every sample. */
export function ablateFeatures(samples: readonly CohortSample[], dropFeatures: readonly string[]): AblatedSet {
  const allNames = featureVectorNames();
  const drop = new Set(dropFeatures);
  const keepIdx: number[] = [];
  const featureNames: string[] = [];
  allNames.forEach((name, j) => {
    const base = name.endsWith("__present") ? name.slice(0, -"__present".length) : name;
    if (!drop.has(base)) {
      keepIdx.push(j);
      featureNames.push(name);
    }
  });
  return {
    featureNames,
    samples: samples.map((s) => ({ ...s, vector: keepIdx.map((j) => s.vector[j]!) })),
  };
}

export interface CorpusHumLikeness {
  readonly datasetId: string;
  readonly domainClass: DomainClass;
  readonly registryGap: string;
  readonly n: number;
  /** Heuristic domain guard, mean P(hum) and fraction predicted 'hum'. */
  readonly meanPHum: number;
  readonly predictedHumRate: number;
  /** HumDomainAdapter hum-compatibility (the multiplicative confidence the runtime would apply). */
  readonly meanHumCompatibility: number;
  /** Trained affect prior's mean OOD score + mean domain match on this corpus (if a model is given). */
  readonly affectMeanOod: number | null;
  readonly affectMeanDomainMatch: number | null;
  /** For VocalSound: distribution of nonverbal burst types parsed from filenames. */
  readonly burstTypes?: Readonly<Record<string, number>>;
}

function parseBurstType(name: string): string | null {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const m = base.match(/_([a-z]+)\.wav$/);
  return m ? m[1]! : null;
}

/** Run the repo's domain guard + (optional) affect prior over each corpus's rows — the training-free probe. */
export async function corpusHumLikeness(
  rowsByDataset: Readonly<Record<string, readonly SignalRow[]>>,
  model?: LogRegParams | null,
): Promise<CorpusHumLikeness[]> {
  const classifier = new HeuristicDomainClassifier();
  const adapter = new HumDomainAdapter();
  const expert = model ? new LearnedAffectPriorExpert(model) : null;
  const meta: ExpertInputMeta = { modality: "audio", captureQuality: 0.8 };
  const out: CorpusHumLikeness[] = [];

  for (const { datasetId, domainClass } of DOMAIN_CORPUS) {
    const rows = rowsByDataset[datasetId] ?? [];
    if (rows.length === 0) continue;
    let sumPHum = 0;
    let humPred = 0;
    let sumCompat = 0;
    let sumOod = 0;
    let sumMatch = 0;
    const burstTypes: Record<string, number> = {};
    for (const r of rows) {
      const dc = classifier.classify(r.features);
      sumPHum += dc.probabilities.hum;
      if (dc.predicted === "hum") humPred++;
      const adapt = adapter.scoreCapture(dc);
      sumCompat += adapt.domainMatch;
      if (expert) {
        const ex = await expert.predict(r.features, meta, adapt.domainMatch);
        sumOod += ex.oodScore;
        sumMatch += ex.domainMatch;
      }
      if (datasetId === "vocalsound") {
        const bt = parseBurstType(r.sourceSampleId);
        if (bt) burstTypes[bt] = (burstTypes[bt] ?? 0) + 1;
      }
    }
    const n = rows.length;
    out.push({
      datasetId,
      domainClass,
      registryGap: rows[0]!.domainGap,
      n,
      meanPHum: sumPHum / n,
      predictedHumRate: humPred / n,
      meanHumCompatibility: sumCompat / n,
      affectMeanOod: expert ? sumOod / n : null,
      affectMeanDomainMatch: expert ? sumMatch / n : null,
      burstTypes: datasetId === "vocalsound" ? burstTypes : undefined,
    });
  }
  return out;
}
