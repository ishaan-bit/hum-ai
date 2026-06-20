import { clamp01 } from "@hum-ai/shared-types";
import { assertValidNativeHumExample, type NativeHumExample } from "@hum-ai/affect-model-contracts";

/**
 * THE NATIVE-HUM CORPUS — the asset the whole product is shaped to grow.
 *
 * Every trained model in the repo today is a far-domain ACTED-SPEECH prior that
 * saturates / abstains OOD on real hums (ADR-0005/0010); there is no hum-validated
 * model because there is no hum-truth data. This is that data, accumulated one
 * human confirmation at a time: a bounded, local-first store of
 * `NativeHumExample` rows (derived features + a benign self-report label, NEVER raw
 * audio). It is the on-device seed of the `native_hum` dataset the
 * `DIAGNOSTIC_ROADMAP` is blocked on; with `derived_feature_sync` consent the same
 * rows back up to the user's own private space (and become poolable, IRB-permitting,
 * into a global corpus — a separate backend step, never done here).
 *
 * Pure + serializable: round-trips losslessly through JSON for localStorage /
 * Firestore. Every row is re-validated against the privacy + clinical-leak guards on
 * the way in, so a malformed row can never enter the store.
 */

export interface NativeCorpus {
  readonly version: string;
  readonly examples: readonly NativeHumExample[];
}

export const NATIVE_CORPUS_VERSION = "native-corpus-v1";

/** Bounded local ring — a long-lived device cannot grow the corpus without limit. */
export const NATIVE_CORPUS_LIMIT = 2000;

export function emptyCorpus(): NativeCorpus {
  return { version: NATIVE_CORPUS_VERSION, examples: [] };
}

/**
 * Append (or REPLACE, by id) one example. The guard runs first — an invalid row
 * (raw-audio-like field, clinical-risk leak, out-of-range label) throws and never
 * enters the store. Re-labelling the same hum overwrites its prior row rather than
 * double-counting it. The ring is trimmed oldest-first at the limit.
 */
export function appendExample(corpus: NativeCorpus, example: NativeHumExample): NativeCorpus {
  assertValidNativeHumExample(example);
  const kept = corpus.examples.filter((e) => e.id !== example.id);
  const next = [...kept, example];
  const trimmed = next.length > NATIVE_CORPUS_LIMIT ? next.slice(next.length - NATIVE_CORPUS_LIMIT) : next;
  return { version: corpus.version, examples: trimmed };
}

/** Parse a persisted corpus, re-validating every row; returns an empty corpus on any failure. */
export function parseCorpus(json: string | null | undefined): NativeCorpus {
  if (!json) return emptyCorpus();
  try {
    const raw = JSON.parse(json) as NativeCorpus;
    if (!raw || !Array.isArray(raw.examples)) return emptyCorpus();
    let corpus = emptyCorpus();
    for (const ex of raw.examples) {
      try {
        corpus = appendExample(corpus, ex);
      } catch {
        /* drop a single malformed row rather than losing the whole corpus */
      }
    }
    return corpus;
  } catch {
    return emptyCorpus();
  }
}

/** Only eligible (quality-gated) examples may train a model — same discipline as the ladder. */
export function trainableExamples(corpus: NativeCorpus): readonly NativeHumExample[] {
  return corpus.examples.filter((e) => e.eligible);
}

/** A V×A quadrant key for coverage reporting. */
function quadrant(valence: number, arousal: number): "pleasant_high" | "pleasant_low" | "subdued_high" | "subdued_low" {
  const v = valence >= 0 ? "pleasant" : "subdued";
  const a = arousal >= 0 ? "high" : "low";
  return `${v}_${a}` as ReturnType<typeof quadrant>;
}

export interface CorpusStats {
  readonly total: number;
  readonly eligible: number;
  readonly confirmed: number;
  readonly adjusted: number;
  /** Fraction of examples where the user agreed the read already matched. */
  readonly agreementRate: number;
  readonly meanCaptureQuality: number;
  /** Count of eligible examples whose self-report falls in each V×A quadrant. */
  readonly quadrantCoverage: Readonly<Record<ReturnType<typeof quadrant>, number>>;
  /** How many of the four quadrants have at least one eligible example [0,4]. */
  readonly quadrantsCovered: number;
  /** Eligible label balance per axis (low/high at threshold 0). */
  readonly axisBalance: Readonly<Record<"valence" | "arousal", { low: number; high: number }>>;
}

export function corpusStats(corpus: NativeCorpus): CorpusStats {
  const examples = corpus.examples;
  const eligibleEx = examples.filter((e) => e.eligible);
  const quadrantCoverage = { pleasant_high: 0, pleasant_low: 0, subdued_high: 0, subdued_low: 0 };
  const axisBalance = { valence: { low: 0, high: 0 }, arousal: { low: 0, high: 0 } };
  let qSum = 0;
  let agreed = 0;
  for (const e of examples) {
    qSum += e.captureQualityScore;
    if (e.agreedWithRead) agreed++;
  }
  for (const e of eligibleEx) {
    quadrantCoverage[quadrant(e.label.valence, e.label.arousal)]++;
    axisBalance.valence[e.label.valence >= 0 ? "high" : "low"]++;
    axisBalance.arousal[e.label.arousal >= 0 ? "high" : "low"]++;
  }
  return {
    total: examples.length,
    eligible: eligibleEx.length,
    confirmed: examples.filter((e) => e.source === "self_report_confirm").length,
    adjusted: examples.filter((e) => e.source === "self_report_adjust").length,
    agreementRate: examples.length > 0 ? clamp01(agreed / examples.length) : 0,
    meanCaptureQuality: examples.length > 0 ? qSum / examples.length : 0,
    quadrantCoverage,
    quadrantsCovered: Object.values(quadrantCoverage).filter((n) => n > 0).length,
    axisBalance,
  };
}
