/**
 * Display time — pinned to IST (Asia/Kolkata).
 *
 * Hums are STORED as UTC ISO timestamps (`new Date().toISOString()`), which is correct and
 * timezone-neutral. The bug was on DISPLAY: `toLocaleTimeString([])` formats in whatever timezone
 * the *runtime* happens to be in, which is not guaranteed to be IST (UTC build/preview hosts, a
 * device with the wrong clock, travel). So a hum logged at 9pm IST could render as 3:30pm.
 *
 * Hum's audience is in India, so every user-facing time/date is pinned to IST here. Storage is
 * untouched (still UTC ISO); only the rendered label is forced to IST, which makes the timestamp
 * read correctly no matter where the code runs. One module so there's a single source of truth.
 */
export const DISPLAY_TZ = "Asia/Kolkata";
const LOCALE = "en-IN";

const fmtTime = new Intl.DateTimeFormat(LOCALE, { timeZone: DISPLAY_TZ, hour: "numeric", minute: "2-digit" });
const fmtTimeSec = new Intl.DateTimeFormat(LOCALE, {
  timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const fmtWeekday = new Intl.DateTimeFormat(LOCALE, { timeZone: DISPLAY_TZ, weekday: "long" });
const fmtMonthDay = new Intl.DateTimeFormat(LOCALE, { timeZone: DISPLAY_TZ, month: "short", day: "numeric" });
const fmtFullDate = new Intl.DateTimeFormat(LOCALE, {
  timeZone: DISPLAY_TZ, day: "numeric", month: "long", year: "numeric",
});
// en-CA gives a sortable YYYY-MM-DD — used to compare CALENDAR days in IST (so "Today"/"Yesterday"
// flip at IST midnight, not the runtime's midnight).
const fmtIsoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;

function ms(at: string | number): number {
  return typeof at === "number" ? at : Date.parse(at);
}

/** "9:42 pm" (IST). With seconds: "21:42:07". */
export function formatTimeIST(at: string | number, withSeconds = false): string {
  const t = ms(at);
  if (!Number.isFinite(t)) return "";
  return (withSeconds ? fmtTimeSec : fmtTime).format(t);
}

/** "24 June 2026" (IST). */
export function formatDateIST(at: string | number): string {
  const t = ms(at);
  if (!Number.isFinite(t)) return "";
  return fmtFullDate.format(t);
}

/** The IST calendar date as "YYYY-MM-DD" — the basis for day-difference math. */
export function istDateKey(at: string | number): string {
  const t = ms(at);
  if (!Number.isFinite(t)) return "";
  return fmtIsoDate.format(t);
}

/** Whole IST calendar days between two instants (now − at), rounded. */
function istDayDiff(at: string | number, now: number): number {
  const a = istDateKey(at);
  const b = istDateKey(now);
  if (!a || !b) return NaN;
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/**
 * "Today" / "Yesterday" / a weekday ("Monday") within the week / else a short date ("12 Jun"),
 * all in IST. Future-dated samples fall back to "Today".
 */
export function relativeDayIST(at: string | number, now: number): string {
  const days = istDayDiff(at, now);
  if (!Number.isFinite(days)) return "A recent hum";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return days < 7 ? fmtWeekday.format(ms(at)) : fmtMonthDay.format(ms(at));
}

/** "Today, 9:42 pm" — relative day + IST time, the diary's per-moment stamp. */
export function whenLabelIST(at: string | number, now: number): string {
  const t = ms(at);
  if (!Number.isFinite(t)) return "A recent hum";
  return `${relativeDayIST(at, now)}, ${formatTimeIST(t)}`;
}
