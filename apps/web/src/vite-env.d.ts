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
  /**
   * Public, referrer-restricted YouTube Data API v3 key for the Sound Lab's in-app player.
   * Optional: with no key the Sound Lab degrades to an "Open on YouTube" search link.
   */
  readonly HUM_AI_YOUTUBE_API_KEY?: string;
  /**
   * Public Last.fm API key for the Sound Lab's "about this song" panel (read-only metadata).
   * Optional: with no key the song-info panel is simply omitted.
   */
  readonly HUM_AI_LASTFM_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
