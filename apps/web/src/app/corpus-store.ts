/**
 * NATIVE-HUM CORPUS + MODEL PERSISTENCE — local-first, with optional owner-scoped
 * cloud backup.
 *
 * The corpus (derived features + benign self-report labels) and the retrained
 * hum-native model artifact are the user's own. They ALWAYS persist to localStorage
 * (device-local, `local_processing`). With `derived_feature_sync` granted + signed in,
 * each new label ALSO appends to the user's private Firestore space (`users/{uid}/labels`)
 * and the small model artifact backs up onto the user doc. Raw audio never enters either
 * path — every row passed `assertValidNativeHumExample` when it was minted.
 */
import { doc, collection, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { assertValidPopulationContribution, type NativeHumExample, type PopulationContribution } from "@hum-ai/affect-model-contracts";
import type { LogisticRegressionParams } from "@hum-ai/fusion-engine";
import { plain } from "./util";
import {
  appendExample,
  emptyCorpus,
  parseCorpus,
  serializeArtifact,
  parseArtifact,
  type NativeCorpus,
  type HumNativeArtifact,
} from "@hum-ai/native-corpus";
import { getFirebase } from "./firebase";

const corpusKey = (userId: string) => `hum.corpus.v1.${userId}`;
const artifactKey = (userId: string) => `hum.nativeModel.v1.${userId}`;
const fusionKey = (userId: string) => `hum.fusionMeta.v1.${userId}`;

// ── corpus (localStorage) ─────────────────────────────────────────────────────
export function loadCorpusLocal(userId: string): NativeCorpus {
  try {
    return parseCorpus(localStorage.getItem(corpusKey(userId)));
  } catch {
    return emptyCorpus();
  }
}

export function saveCorpusLocal(userId: string, corpus: NativeCorpus): void {
  try {
    localStorage.setItem(corpusKey(userId), JSON.stringify(corpus));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
}

// ── model artifact (localStorage) ─────────────────────────────────────────────
export function loadArtifactLocal(userId: string): HumNativeArtifact | null {
  try {
    return parseArtifact(localStorage.getItem(artifactKey(userId)));
  } catch {
    return null;
  }
}

export function saveArtifactLocal(userId: string, artifact: HumNativeArtifact): void {
  try {
    localStorage.setItem(artifactKey(userId), serializeArtifact(artifact));
  } catch {
    /* ignore */
  }
}

// ── fusion meta-learner params (localStorage) ─────────────────────────────────
export function loadFusionParamsLocal(userId: string): LogisticRegressionParams | null {
  try {
    const raw = localStorage.getItem(fusionKey(userId));
    return raw ? (JSON.parse(raw) as LogisticRegressionParams) : null;
  } catch {
    return null;
  }
}

export function saveFusionParamsLocal(userId: string, params: LogisticRegressionParams): void {
  try {
    localStorage.setItem(fusionKey(userId), JSON.stringify(params));
  } catch {
    /* ignore */
  }
}

// ── cloud (owner-scoped, derived-only) ────────────────────────────────────────
/** Append one native-hum label row to the user's private space. No-op when unavailable. */
export async function appendLabelCloud(uid: string, example: NativeHumExample): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "users", uid, "labels"), example.id);
    await setDoc(ref, { ...plain(example), syncedAt: serverTimestamp() });
  } catch (err) {
    console.warn("[corpus-store] cloud label append failed:", err);
  }
}

/** Load the user's backed-up label corpus (rebuilt + re-validated). No-op → empty. */
export async function loadCorpusCloud(uid: string): Promise<NativeCorpus> {
  const fb = getFirebase();
  if (!fb) return emptyCorpus();
  try {
    const snap = await getDocs(collection(fb.db, "users", uid, "labels"));
    let corpus = emptyCorpus();
    snap.forEach((d) => {
      try {
        corpus = appendExample(corpus, d.data() as NativeHumExample);
      } catch {
        /* skip a malformed cloud row */
      }
    });
    return corpus;
  } catch (err) {
    console.warn("[corpus-store] cloud corpus load failed:", err);
    return emptyCorpus();
  }
}

/**
 * Contribute one derived, pseudonymous native-hum row to the POOLED population corpus (ADR-0012)
 * — the cross-user analogue of `appendLabelCloud`. Re-validates the contribution (no raw audio,
 * no clinical leak, pseudonymous key) before any write; the collection is server/aggregator-readable
 * only and append-only (firestore.rules → populationContributions). No-op when Firebase is
 * unavailable. The CALLER gates this on `population_corpus_contribution` consent.
 */
export async function appendPopulationContributionCloud(contribution: PopulationContribution): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    assertValidPopulationContribution(contribution); // never write an unsafe row to the shared pool
    const ref = doc(collection(fb.db, "populationContributions"), contribution.contributionId);
    await setDoc(ref, { ...plain(contribution), syncedAt: serverTimestamp() });
  } catch (err) {
    console.warn("[corpus-store] population contribution append failed:", err);
  }
}

/** Back up the (small) hum-native model artifact onto the user doc. No-op when unavailable. */
export async function saveArtifactCloud(uid: string, artifact: HumNativeArtifact): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    await setDoc(
      doc(fb.db, "users", uid),
      { nativeArtifact: plain(artifact), nativeArtifactUpdatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn("[corpus-store] cloud artifact save failed:", err);
  }
}

/**
 * Merge two corpora, de-duplicating by example id. The FIRST argument wins on conflict
 * (`appendExample` replaces by id, so the base is `b` and `a` is appended last → `a` wins).
 * Called as `mergeCorpora(local, cloud)`, so the local copy is authoritative — a stale or
 * partial cloud sync can never clobber a fresher local correction (local-first).
 */
export function mergeCorpora(a: NativeCorpus, b: NativeCorpus): NativeCorpus {
  let merged = b;
  for (const ex of a.examples) {
    try {
      merged = appendExample(merged, ex);
    } catch {
      /* skip invalid */
    }
  }
  return merged;
}
