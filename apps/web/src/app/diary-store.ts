/**
 * Diary context — the user's OWN words around a hum (optional life-context chips + a one-line
 * note), keyed by the hum's capture timestamp. This is deliberately LOCAL-ONLY and never synced:
 * it's free-text the person wrote for themselves, so it stays on the device (same spirit as the
 * feature/relapse rings in personalization-engine). The model never reads it; it only enriches
 * what the diary can show the person back to themselves.
 */

const KEY = (id: string): string => `hum.diary.context.v1.${id}`;

/** One hum's optional, self-authored context. Both fields are optional and start empty. */
export interface DiaryEntryContext {
  /** Selected life-context chips (a small curated, non-clinical set — see {@link LIFE_CONTEXT}). */
  readonly tags: readonly string[];
  /** A single free-text line the user can leave. Never shown to the model. */
  readonly note: string;
}

/** capturedAt (ISO) → context. */
export type DiaryContextMap = Readonly<Record<string, DiaryEntryContext>>;

/**
 * The curated life-context chips. Neutral, everyday language — NOT symptoms, NOT clinical.
 * They exist so a person can later recognise "oh, that dip was the week I slept badly", which
 * is the diary's whole point: their context, not the system guessing causes.
 */
export const LIFE_CONTEXT: readonly string[] = [
  "Slept well",
  "Poor sleep",
  "Busy",
  "Stressful",
  "Social",
  "Quiet day",
  "Unwell",
  "Active",
];

export function loadDiaryContext(id: string): DiaryContextMap {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as DiaryContextMap) : {};
  } catch {
    return {};
  }
}

export function saveDiaryContext(id: string, map: DiaryContextMap): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(map));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
}

/** Pure merge: return a new map with `at`'s context patched (drops empty entries). */
export function patchEntryContext(
  map: DiaryContextMap,
  at: string,
  patch: Partial<DiaryEntryContext>,
): DiaryContextMap {
  const prev = map[at] ?? { tags: [], note: "" };
  const next: DiaryEntryContext = {
    tags: patch.tags ?? prev.tags,
    note: patch.note ?? prev.note,
  };
  const next_map = { ...map, [at]: next };
  // Keep the store tidy: an entry with no tags and no note carries nothing, so drop it.
  if (next.tags.length === 0 && next.note.trim() === "") delete next_map[at];
  return next_map;
}

/** Toggle one life-context tag on an entry (pure). */
export function toggleEntryTag(map: DiaryContextMap, at: string, tag: string): DiaryContextMap {
  const prev = map[at]?.tags ?? [];
  const tags = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
  return patchEntryContext(map, at, { tags });
}
