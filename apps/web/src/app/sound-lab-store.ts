/**
 * Sound Lab persistence — the user's music taste, their recently-played tracks, and their
 * last "did it fit?" feedback. Deliberately LOCAL-ONLY and never synced (same spirit as the
 * diary context store): it's a personal preference, not a derived clinical summary, so it
 * stays on the device. The read engine never sees any of it.
 */
import {
  defaultSoundLabPreferences,
  MAIN_GENRES,
  MUSIC_FLAVORS,
  MUSIC_LANGUAGES,
  type MainMusicGenre,
  type MusicFlavor,
  type SoundLabPreferences,
} from "@hum-ai/intervention-engine";

const PREFS_KEY = (id: string): string => `hum.sound-lab.prefs.v1.${id}`;
const HISTORY_KEY = (id: string): string => `hum.sound-lab.history.v1.${id}`;
const FEEDBACK_KEY = (id: string): string => `hum.sound-lab.feedback.v1.${id}`;

/** How many recently-played video ids we remember, to avoid serving the same track twice. */
const HISTORY_MAX = 24;

// ── preferences ───────────────────────────────────────────────────────────────────

/** Re-validate a parsed prefs object so a corrupt/partial blob can't poison the UI. */
function sanitizePrefs(raw: unknown): SoundLabPreferences {
  const base = defaultSoundLabPreferences();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Record<keyof SoundLabPreferences, unknown>>;
  const language = MUSIC_LANGUAGES.includes(r.language as never)
    ? (r.language as SoundLabPreferences["language"])
    : base.language;
  const genre = MAIN_GENRES.includes(r.genre as never) ? (r.genre as MainMusicGenre) : null;
  const flavors = Array.isArray(r.flavors)
    ? (r.flavors.filter((f): f is MusicFlavor => MUSIC_FLAVORS.includes(f as never)).slice(0, 2))
    : [];
  return { language, genre, flavors };
}

export function loadSoundLabPrefs(id: string): SoundLabPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY(id));
    return raw ? sanitizePrefs(JSON.parse(raw)) : defaultSoundLabPreferences();
  } catch {
    return defaultSoundLabPreferences();
  }
}

export function saveSoundLabPrefs(id: string, prefs: SoundLabPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY(id), JSON.stringify(prefs));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
}

// ── recently-played (avoid repeats) ─────────────────────────────────────────────────

export function loadSongHistory(id: string): readonly string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(id));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Record a played video id (most-recent first), capped. Returns the new list. */
export function pushSongHistory(id: string, videoId: string): readonly string[] {
  const next = [videoId, ...loadSongHistory(id).filter((v) => v !== videoId)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY(id), JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

// ── feedback ("did this fit?") ──────────────────────────────────────────────────────

/** The five fit-feedback values (mirror the old Sound Match feedback set). */
export type SongFeedback = "good_match" | "wrong_vibe" | "too_intense" | "too_soft" | "wrong_genre";

export const SONG_FEEDBACK_OPTIONS: ReadonlyArray<{ value: SongFeedback; label: string }> = [
  { value: "good_match", label: "Good match" },
  { value: "wrong_vibe", label: "Wrong vibe" },
  { value: "too_intense", label: "Too intense" },
  { value: "too_soft", label: "Too soft" },
  { value: "wrong_genre", label: "Wrong genre" },
];

export function loadSongFeedback(id: string): SongFeedback | null {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY(id));
    const ok = SONG_FEEDBACK_OPTIONS.some((o) => o.value === raw);
    return ok ? (raw as SongFeedback) : null;
  } catch {
    return null;
  }
}

export function saveSongFeedback(id: string, feedback: SongFeedback): void {
  try {
    localStorage.setItem(FEEDBACK_KEY(id), feedback);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Turn the last feedback into a light SEARCH nudge for the next match (extra query terms only —
 * never changes the read-derived steer or the safe copy). "Too intense" leans calmer, "too soft"
 * leans a touch more lively; "wrong vibe" widens; genre is re-picked by the user, so no nudge.
 */
export function feedbackQueryNudge(feedback: SongFeedback | null): readonly string[] {
  switch (feedback) {
    case "too_intense":
      return ["slow", "calm"];
    case "too_soft":
      return ["uplifting"];
    case "wrong_vibe":
      return ["instrumental"];
    default:
      return [];
  }
}

export { type SoundLabPreferences };
