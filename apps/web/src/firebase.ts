/**
 * Firebase client initializer — web client SDK only, no server-side Admin SDK.
 *
 * All config is loaded from HUM_AI_FIREBASE_* env vars (see .env.example).
 * The service-account JSON is a secret and is NEVER referenced here.
 *
 * In the browser build (Vite / Next), replace process.env reads with
 * import.meta.env / NEXT_PUBLIC_* as appropriate for the bundler.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const ENV: Record<string, string> = {
  apiKey: "HUM_AI_FIREBASE_API_KEY",
  authDomain: "HUM_AI_FIREBASE_AUTH_DOMAIN",
  projectId: "HUM_AI_FIREBASE_PROJECT_ID",
  storageBucket: "HUM_AI_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "HUM_AI_FIREBASE_MESSAGING_SENDER_ID",
  appId: "HUM_AI_FIREBASE_APP_ID",
};

export interface HumFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Read Firebase client config from env vars. Throws on any missing var. */
export function loadFirebaseConfig(): HumFirebaseConfig {
  const missing: string[] = [];
  const result: Record<string, string> = {};
  for (const [key, envName] of Object.entries(ENV)) {
    const val = process.env[envName] ?? "";
    if (!val) missing.push(envName);
    result[key] = val;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missing.join(", ")}\n` +
        "Copy .env.example → .env and fill in the values, or set them in your shell.",
    );
  }
  return result as unknown as HumFirebaseConfig;
}

let _app: FirebaseApp | undefined;

/** Singleton Firebase app — safe to call multiple times. */
export function firebaseApp(): FirebaseApp {
  if (!_app) {
    const config = loadFirebaseConfig();
    _app = getApps()[0] ?? initializeApp(config);
  }
  return _app;
}

/** Firebase Auth client (browser auth, not Admin). */
export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

/** Firestore client. Raw audio and clinical labels must never be written here. */
export function firebaseFirestore(): Firestore {
  return getFirestore(firebaseApp());
}
