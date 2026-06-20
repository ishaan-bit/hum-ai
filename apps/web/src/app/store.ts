/**
 * Persistence — local-first, with optional cloud backup.
 *
 * The carrier of the personal baseline across hums is the full `PersonalizationState`
 * (profile + featureWindows + relapseHistory + eligibleHumCount + consecutiveDriftHums).
 * It is plain JSON, so it round-trips losslessly. We ALWAYS persist it to localStorage
 * (device-local). When the user has granted `derived_feature_sync` AND is signed in, we
 * ALSO back up the state and append the per-hum derived `HumSyncPayload` to Firestore —
 * derived-only, owner-scoped by Firestore rules, never raw audio (the payload already
 * passed `assertNoRawAudioFields` + `assertNoClinicalLeak` when it was built).
 */
import { doc, collection, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import type { HumSyncPayload, PersonalizationState } from "@hum-ai/orchestrator";
import { getFirebase } from "./firebase";

const LOCAL_ID_KEY = "hum.localUserId.v1";
const stateKey = (userId: string) => `hum.state.v1.${userId}`;

/** Stable per-install id used to namespace local state and seed a fresh model when offline. */
export function localUserId(): string {
  try {
    let id = localStorage.getItem(LOCAL_ID_KEY);
    if (!id) {
      id = `local-${crypto.randomUUID()}`;
      localStorage.setItem(LOCAL_ID_KEY, id);
    }
    return id;
  } catch {
    return "local-anon";
  }
}

/** Strip undefined / class instances so the object is Firestore- and JSON-safe. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadStateLocal(userId: string): PersonalizationState | null {
  try {
    const raw = localStorage.getItem(stateKey(userId));
    return raw ? (JSON.parse(raw) as PersonalizationState) : null;
  } catch {
    return null;
  }
}

export function saveStateLocal(userId: string, state: PersonalizationState): void {
  try {
    localStorage.setItem(stateKey(userId), JSON.stringify(state));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
}

/** Load a backed-up state from Firestore for a signed-in uid, or null. */
export async function loadStateCloud(uid: string): Promise<PersonalizationState | null> {
  const fb = getFirebase();
  if (!fb) return null;
  try {
    const snap = await getDoc(doc(fb.db, "users", uid));
    const data = snap.data();
    if (data && data.state) return data.state as PersonalizationState;
    return null;
  } catch (err) {
    console.warn("[store] cloud state load failed — using local:", err);
    return null;
  }
}

/** Back up the full state to Firestore (owner-scoped). No-op when unavailable. */
export async function saveStateCloud(uid: string, state: PersonalizationState): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    await setDoc(
      doc(fb.db, "users", uid),
      { state: plain(state), eligibleHumCount: state.eligibleHumCount, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.warn("[store] cloud state save failed:", err);
  }
}

/** Append one derived-only hum summary to Firestore. No-op when unavailable. */
export async function appendHumCloud(uid: string, payload: HumSyncPayload): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    const ref = doc(collection(fb.db, "users", uid, "hums"), crypto.randomUUID());
    await setDoc(ref, { ...plain(payload), syncedAt: serverTimestamp() });
  } catch (err) {
    console.warn("[store] cloud hum append failed:", err);
  }
}
