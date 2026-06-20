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
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export interface FirebaseHandles {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly db: Firestore;
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
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
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
