/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase public web-client config (safe to expose; see .env.example). */
  readonly HUM_AI_FIREBASE_API_KEY?: string;
  readonly HUM_AI_FIREBASE_AUTH_DOMAIN?: string;
  readonly HUM_AI_FIREBASE_PROJECT_ID?: string;
  readonly HUM_AI_FIREBASE_STORAGE_BUCKET?: string;
  readonly HUM_AI_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly HUM_AI_FIREBASE_APP_ID?: string;
  /** Build-time model version stamp. */
  readonly HUM_AI_MODEL_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
