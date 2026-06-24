import { validContributions, type PopulationContribution } from "@hum-ai/affect-model-contracts";
import { NATIVE_CORPUS_VERSION, type FoldKey, type NativeCorpus } from "@hum-ai/native-corpus";
import type { NativeHumExample } from "@hum-ai/affect-model-contracts";

/**
 * POOLING — turn a set of consented, pseudonymous contributions into the inputs the
 * population retrain needs: a `NativeCorpus` of the embedded examples, a CV fold key that
 * groups by CONTRIBUTOR (so one person's hums never straddle train/test — the leakage that
 * would inflate a population model's held-out accuracy), and the distinct-contributor count
 * that gates whether a population model may be promoted at all.
 *
 * Pure: validates+dedupes; no I/O. The actual reading of a pooled collection (offline file or
 * the server-only Firestore collection) and the consent gate live at the call site (apps/ops).
 */

export interface PooledCorpus {
  /** All valid examples, deduped by id (last write wins). The training + norm source. */
  readonly corpus: NativeCorpus;
  /** CV fold key grouping rows by contributor pseudonym (group-by-contributor CV). */
  readonly foldKey: FoldKey;
  /** Number of DISTINCT contributors (the population promotion guard reads this). */
  readonly contributorCount: number;
  /** The valid contributions (after the guards dropped any unsafe row). */
  readonly contributions: readonly PopulationContribution[];
}

export function poolContributions(pool: readonly PopulationContribution[]): PooledCorpus {
  const valid = validContributions(pool);

  // Dedup examples by id (last contribution wins), and remember each example's contributor.
  const byId = new Map<string, NativeHumExample>();
  const contributorOf = new Map<string, string>();
  for (const c of valid) {
    byId.set(c.example.id, c.example);
    contributorOf.set(c.example.id, c.contributorKey);
  }

  const corpus: NativeCorpus = { version: NATIVE_CORPUS_VERSION, examples: [...byId.values()] };
  const foldKey: FoldKey = (ex) => contributorOf.get(ex.id) ?? ex.id;
  const contributorCount = new Set(valid.map((c) => c.contributorKey)).size;
  return { corpus, foldKey, contributorCount, contributions: valid };
}
