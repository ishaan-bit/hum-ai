/** Small shared app-layer utilities (single source for cross-file UI/storage helpers). */

/** Strip undefined / class instances so an object is Firestore- and JSON-safe. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Render a snake_case enum id as a human label ("low_mood" → "low mood"). */
export function formatEnumLabel(s: string): string {
  return s.replace(/_/g, " ");
}
