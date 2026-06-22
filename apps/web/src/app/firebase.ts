/**
 * Browser Firebase init — web client SDK only (no Admin), resilient & lazy.
 *
 * Public web-client config is read from Vite env (`import.meta.env.HUM_AI_FIREBASE_*`,
 * sourced from the repo-root `.env`). These are PUBLIC identifiers (safe to embed in a
 * static bundle); the service-account secret is never referenced here.
 *
 * Everything degrades gracefully: if config is absent, or anonymous auth is not enabled
 * on the project, `getFirebase()` / `signInAnon()` return null and the app stays fully
 * functional in local-first mode (localStorage only). Cloud sync is strictly opt-in via
 * the `derived_feature_sync` consent scope and is never required to read a hum.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut,
  type Auth,
  type User,
  type ParsedToken,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

export interface FirebaseHandles {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly db: Firestore;
  /**
   * Firebase Storage — the ONLY sanctioned raw-audio egress (research-upload channel),
   * physically isolated from the derived-sync Firestore paths. See research-upload.ts.
   */
  readonly storage: FirebaseStorage;
}

interface ClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readConfig(): ClientConfig | null {
  const env = import.meta.env;
  const cfg: ClientConfig = {
    apiKey: env.HUM_AI_FIREBASE_API_KEY ?? "",
    authDomain: env.HUM_AI_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.HUM_AI_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.HUM_AI_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: env.HUM_AI_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: env.HUM_AI_FIREBASE_APP_ID ?? "",
  };
  // Minimum viable config: without an apiKey + projectId there is no backend to reach.
  if (!cfg.apiKey || !cfg.projectId) return null;
  return cfg;
}

let cached: FirebaseHandles | null | undefined;

/** Returns Firebase handles, or null when no client config is present. Memoized. */
export function getFirebase(): FirebaseHandles | null {
  if (cached !== undefined) return cached;
  const config = readConfig();
  if (!config) {
    cached = null;
    return cached;
  }
  try {
    const app = getApps()[0] ?? initializeApp(config);
    cached = { app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
  } catch (err) {
    console.warn("[firebase] init failed — staying local-only:", err);
    cached = null;
  }
  return cached;
}

let signInPromise: Promise<string | null> | undefined;

/**
 * Sign in anonymously and resolve the uid, or null if Firebase is unavailable or
 * anonymous auth is disabled on the project. Memoized for the session.
 */
export function signInAnon(): Promise<string | null> {
  if (signInPromise) return signInPromise;
  signInPromise = (async () => {
    const fb = getFirebase();
    if (!fb) return null;
    try {
      if (fb.auth.currentUser) return fb.auth.currentUser.uid;
      const cred = await signInAnonymously(fb.auth);
      return cred.user.uid;
    } catch (err) {
      console.warn("[firebase] anonymous sign-in unavailable — staying local-only:", err);
      return null;
    }
  })();
  return signInPromise;
}

// ── DURABLE PARTICIPANT IDENTITY (study path) ─────────────────────────────────
// Consumers stay on anonymous auth (above). Study participants need a STABLE
// identity for longitudinal linkage + right-to-deletion, so we add an email-link
// (passwordless) path on top of the SAME Auth instance. The email is the account
// identity only; the study data is keyed by a client-minted pseudonym (participant.ts),
// never the email — the re-identification map lives in the participant-management backend.

/** localStorage key for the email being verified across the email-link round-trip. */
const EMAIL_LINK_KEY = "hum.study.emailForSignIn.v1";

/**
 * Send a passwordless sign-in link to a study participant's email. The link returns
 * to the current page; completeEmailLinkSignIn() finishes the round-trip on return.
 * Returns false (never throws) when Firebase/auth is unavailable so callers can degrade.
 */
export async function sendStudySignInLink(email: string): Promise<boolean> {
  const fb = getFirebase();
  if (!fb) return false;
  try {
    const url = typeof window !== "undefined" ? window.location.href : "";
    await sendSignInLinkToEmail(fb.auth, email, { url, handleCodeInApp: true });
    try {
      localStorage.setItem(EMAIL_LINK_KEY, email);
    } catch {
      /* private mode — caller may re-prompt for the email on return */
    }
    return true;
  } catch (err) {
    console.warn("[firebase] study email-link send failed:", err);
    return false;
  }
}

/** True when the current URL is a returning email-sign-in link. */
export function isReturningEmailLink(): boolean {
  const fb = getFirebase();
  if (!fb || typeof window === "undefined") return false;
  try {
    return isSignInWithEmailLink(fb.auth, window.location.href);
  } catch {
    return false;
  }
}

/**
 * Complete an email-link sign-in on page return. `promptedEmail` is used when the
 * email wasn't stashed (e.g. opened on a different device / private mode). Resolves
 * the durable uid, or null if not a valid link / unavailable.
 */
export async function completeEmailLinkSignIn(promptedEmail?: string): Promise<string | null> {
  const fb = getFirebase();
  if (!fb || typeof window === "undefined") return null;
  if (!isReturningEmailLink()) return null;
  let email = promptedEmail ?? null;
  if (!email) {
    try {
      email = localStorage.getItem(EMAIL_LINK_KEY);
    } catch {
      email = null;
    }
  }
  if (!email) return null;
  try {
    const cred = await signInWithEmailLink(fb.auth, email, window.location.href);
    try {
      localStorage.removeItem(EMAIL_LINK_KEY);
    } catch {
      /* ignore */
    }
    return cred.user.uid;
  } catch (err) {
    console.warn("[firebase] study email-link completion failed:", err);
    return null;
  }
}

/** The currently signed-in user (any provider), or null. */
export function currentUser(): User | null {
  return getFirebase()?.auth.currentUser ?? null;
}

/** Subscribe to auth-state changes; returns an unsubscribe fn (no-op when unavailable). */
export function onAuth(cb: (user: User | null) => void): () => void {
  const fb = getFirebase();
  if (!fb) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(fb.auth, cb);
}

/**
 * Read the current user's custom claims (studyParticipant, clinician, studyAdmin,
 * studyId, pseudonym). Claims are minted server-side by the participant-management
 * backend; the client only READS them to gate study/clinician surfaces. `forceRefresh`
 * re-fetches a freshly-minted token after enrollment. Returns {} when unavailable.
 */
export async function getClaims(forceRefresh = false): Promise<ParsedToken> {
  const user = currentUser();
  if (!user) return {};
  try {
    const res = await user.getIdTokenResult(forceRefresh);
    return res.claims;
  } catch (err) {
    console.warn("[firebase] claims read failed:", err);
    return {};
  }
}

/** Sign the study participant out (used on withdrawal). No-op when unavailable. */
export async function signOutStudy(): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    await signOut(fb.auth);
  } catch (err) {
    console.warn("[firebase] sign-out failed:", err);
  }
}
