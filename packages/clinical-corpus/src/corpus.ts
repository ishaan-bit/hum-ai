import { clamp01 } from "@hum-ai/shared-types";
import {
  assertValidClinicalExample,
  gadToBinaryLabel,
  GAD7_SCREENING_CUT,
  phqToBinaryLabel,
  PHQ9_SCREENING_CUT,
  type ClinicalHumExample,
} from "@hum-ai/affect-model-contracts";

/**
 * THE CLINICAL SCREENING CORPUS — paired (hum features, reference instrument)
 * rows, the ground truth the depression/anxiety screening model is validated
 * against. It is the SANCTIONED clinical channel, separate from the benign
 * `@hum-ai/native-corpus` (which `assertNoClinicalLeak` keeps PHQ/GAD scores out
 * of). Every row is re-validated against `assertValidClinicalExample` on the way
 * in (derived features only, ≥1 instrument, in-range scores), so a malformed or
 * raw-audio-bearing row can never enter the store.
 *
 * Pure + serializable: round-trips through JSON for the local-first-then-cloud
 * study store. The corpus is keyed by `participantPseudonym`, so withdrawal can
 * delete a participant's rows and CV folds can be grouped by participant.
 */
export interface ClinicalCorpus {
  readonly version: string;
  readonly examples: readonly ClinicalHumExample[];
}

export const CLINICAL_CORPUS_VERSION = "clinical-corpus-v1";

/** Bounded local ring — a long-lived device cannot grow the corpus without limit. */
export const CLINICAL_CORPUS_LIMIT = 5000;

export function emptyClinicalCorpus(): ClinicalCorpus {
  return { version: CLINICAL_CORPUS_VERSION, examples: [] };
}

/**
 * Append (or REPLACE, by id) one example. The guard runs first — an invalid row
 * (raw-audio-like field, out-of-range instrument score, no instrument) throws and
 * never enters the store. Re-recording the same capture overwrites its prior row.
 * The ring is trimmed oldest-first at the limit.
 */
export function appendClinicalExample(corpus: ClinicalCorpus, example: ClinicalHumExample): ClinicalCorpus {
  assertValidClinicalExample(example);
  const kept = corpus.examples.filter((e) => e.id !== example.id);
  const next = [...kept, example];
  const trimmed = next.length > CLINICAL_CORPUS_LIMIT ? next.slice(next.length - CLINICAL_CORPUS_LIMIT) : next;
  return { version: corpus.version, examples: trimmed };
}

/** Remove every row for a withdrawn participant (right-to-deletion, local side). */
export function dropParticipant(corpus: ClinicalCorpus, participantPseudonym: string): ClinicalCorpus {
  return { version: corpus.version, examples: corpus.examples.filter((e) => e.participantPseudonym !== participantPseudonym) };
}

/** Parse a persisted corpus, re-validating every row; returns an empty corpus on any failure. */
export function parseClinicalCorpus(json: string | null | undefined): ClinicalCorpus {
  if (!json) return emptyClinicalCorpus();
  try {
    const raw = JSON.parse(json) as ClinicalCorpus;
    if (!raw || !Array.isArray(raw.examples)) return emptyClinicalCorpus();
    let corpus = emptyClinicalCorpus();
    for (const ex of raw.examples) {
      try {
        corpus = appendClinicalExample(corpus, ex);
      } catch {
        /* drop a single malformed row rather than losing the whole corpus */
      }
    }
    return corpus;
  } catch {
    return emptyClinicalCorpus();
  }
}

/** Only eligible (quality-gated) examples may train/validate a model. */
export function trainableClinicalExamples(corpus: ClinicalCorpus): readonly ClinicalHumExample[] {
  return corpus.examples.filter((e) => e.eligible);
}

/** Per-target class balance at the screening cut (only over eligible rows that carry that instrument). */
export interface ScreeningBalance {
  /** Eligible rows that carry this instrument. */
  readonly labeled: number;
  readonly positive: number;
  readonly negative: number;
  /** Observed positive prevalence among labeled rows [0,1]; null when none. */
  readonly prevalence: number | null;
}

export interface ClinicalCorpusStats {
  readonly total: number;
  readonly eligible: number;
  /** Distinct participants — the unit folds are grouped by. */
  readonly participants: number;
  readonly meanCaptureQuality: number;
  readonly depression: ScreeningBalance;
  readonly anxiety: ScreeningBalance;
  /** Eligible-row counts per coarse device class (QUADAS-2 index-test spectrum). */
  readonly deviceCoverage: Readonly<Record<string, number>>;
  /** Eligible-row counts per recruitment stratum (QUADAS-2 patient-selection spectrum). */
  readonly stratumCoverage: Readonly<Record<string, number>>;
  /**
   * Count of rows where PHQ-9 item 9 (suicidality) was endorsed (≥1). Surfaced for
   * the audit/safety summary only — NEVER a screening signal.
   */
  readonly item9Endorsed: number;
}

function balanceFor(
  examples: readonly ClinicalHumExample[],
  pick: (e: ClinicalHumExample) => "screen_positive" | "screen_negative" | null,
): ScreeningBalance {
  let positive = 0;
  let negative = 0;
  for (const e of examples) {
    const label = pick(e);
    if (label === "screen_positive") positive++;
    else if (label === "screen_negative") negative++;
  }
  const labeled = positive + negative;
  return { labeled, positive, negative, prevalence: labeled > 0 ? positive / labeled : null };
}

export function clinicalCorpusStats(
  corpus: ClinicalCorpus,
  opts: { phqCut?: number; gadCut?: number } = {},
): ClinicalCorpusStats {
  const phqCut = opts.phqCut ?? PHQ9_SCREENING_CUT;
  const gadCut = opts.gadCut ?? GAD7_SCREENING_CUT;
  const examples = corpus.examples;
  const eligibleEx = examples.filter((e) => e.eligible);
  const deviceCoverage: Record<string, number> = {};
  const stratumCoverage: Record<string, number> = {};
  let qSum = 0;
  let item9Endorsed = 0;
  for (const e of examples) {
    qSum += e.captureQualityScore;
    if (e.phq?.item9 != null && e.phq.item9 >= 1) item9Endorsed++;
  }
  for (const e of eligibleEx) {
    deviceCoverage[e.deviceClass] = (deviceCoverage[e.deviceClass] ?? 0) + 1;
    const stratum = e.stratum ?? "unspecified";
    stratumCoverage[stratum] = (stratumCoverage[stratum] ?? 0) + 1;
  }
  return {
    total: examples.length,
    eligible: eligibleEx.length,
    participants: new Set(examples.map((e) => e.participantPseudonym)).size,
    meanCaptureQuality: examples.length > 0 ? clamp01(qSum / examples.length) : 0,
    depression: balanceFor(eligibleEx, (e) => (e.phq ? phqToBinaryLabel(e.phq, phqCut) : null)),
    anxiety: balanceFor(eligibleEx, (e) => (e.gad ? gadToBinaryLabel(e.gad, gadCut) : null)),
    deviceCoverage,
    stratumCoverage,
    item9Endorsed,
  };
}
