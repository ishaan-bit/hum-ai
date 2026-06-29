/**
 * Last.fm song-info resolver for the Sound Lab — enriches the playing track with real metadata
 * (genre/mood tags, listener reach, a short description, and a link to the track page).
 *
 * The Sound Lab resolves a read+taste search to an embeddable YouTube track; Last.fm then answers
 * "what IS this song" — the music-intelligence half the old Hum build used Last.fm for. The call is
 * made directly from the browser against the Last.fm 2.0 API with a PUBLIC key
 * (`HUM_AI_LASTFM_API_KEY`, read from Vite env; Last.fm keys are read-only). With no key, or on any
 * failure, the lookup returns `null` and the UI simply omits the info panel — the player still works.
 *
 * Purely a READ of third-party music metadata (like the YouTube title the player already shows): it
 * never touches the affect read or any clinical surface, and every field it returns is escaped by the
 * caller before it reaches the DOM.
 */

/** Resolved Last.fm info for one track (only the fields the panel surfaces). */
export interface LastfmInfo {
  readonly name: string;
  readonly artist: string;
  /** The track's Last.fm page (the "View on Last.fm" link). */
  readonly url: string;
  /** Global listener count, or null when Last.fm didn't report one. */
  readonly listeners: number | null;
  /** Up to a handful of genre/mood tags (lower-cased descriptors). */
  readonly tags: readonly string[];
  /** A short, plain-text description (HTML stripped + truncated), or null. */
  readonly summary: string | null;
}

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 5;
const SUMMARY_MAX = 220;

/** The configured public Last.fm key, or null when song-info isn't set up. */
export function lastfmApiKey(): string | null {
  const key = import.meta.env.HUM_AI_LASTFM_API_KEY;
  return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
}

/** True when Last.fm song-info is available (a key is configured). */
export function lastfmAvailable(): boolean {
  return lastfmApiKey() !== null;
}

/**
 * Heuristically split a YouTube music title into { artist, title }. Strips the usual decorations
 * ("(Official Video)", "[HD]", "| Label", "feat. …", "lyric video") and splits on the first " - ".
 * When there's no separator the channel title is the best artist guess. Best-effort — Last.fm's
 * `autocorrect` + the `track.search` fallback recover from a rough parse.
 */
export function parseTrack(youtubeTitle: string, channelTitle: string): { artist: string; title: string } {
  let t = youtubeTitle
    .replace(/\((?:[^)]*?(official|video|audio|lyric|lyrics|visualizer|hd|4k|mv|m\/v|remaster[^)]*)[^)]*)\)/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s*\|\s*.*$/, " ") // drop "| Label / channel" tails
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dash = t.indexOf(" - ");
  if (dash > 0) {
    const artist = t.slice(0, dash).trim();
    const title = t.slice(dash + 3).trim();
    if (artist && title) return { artist, title };
  }
  // No "artist - title" form: fall back to the channel as the artist (YouTube "… - Topic" channels).
  const artist = channelTitle.replace(/\s*-\s*Topic$/i, "").trim();
  return { artist, title: t };
}

interface LastfmTrackInfoResponse {
  track?: {
    name?: string;
    url?: string;
    listeners?: string;
    artist?: { name?: string };
    toptags?: { tag?: { name?: string }[] };
    wiki?: { summary?: string };
  };
  error?: number;
}
interface LastfmSearchResponse {
  results?: { trackmatches?: { track?: { name?: string; artist?: string }[] } };
}

function buildUrl(params: Record<string, string>): string {
  const url = new URL(API_ROOT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  return url.toString();
}

/** Strip HTML + collapse whitespace + truncate a Last.fm wiki summary to a plain sentence-ish blurb. */
function cleanSummary(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<a\b[^>]*>.*?<\/a>/gis, " ") // drop "Read more on Last.fm" anchors
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  return `${cut.slice(0, lastStop > 80 ? lastStop : SUMMARY_MAX).trim()}…`;
}

async function fetchInfo(key: string, artist: string, title: string): Promise<LastfmInfo | null> {
  try {
    const res = await fetch(
      buildUrl({ method: "track.getInfo", api_key: key, artist, track: title, autocorrect: "1" }),
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as LastfmTrackInfoResponse;
    const tr = data.track;
    if (!tr || !tr.name) return null;
    const tags = (tr.toptags?.tag ?? [])
      .map((x) => (x.name ?? "").trim().toLowerCase())
      .filter((x) => x.length > 0)
      .slice(0, MAX_TAGS);
    const listeners = tr.listeners && Number.isFinite(Number(tr.listeners)) ? Number(tr.listeners) : null;
    return {
      name: tr.name,
      artist: tr.artist?.name ?? artist,
      url: tr.url ?? "",
      listeners,
      tags,
      summary: cleanSummary(tr.wiki?.summary),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve Last.fm info for a YouTube track. Parses the title, tries `track.getInfo`, and on a miss
 * falls back to `track.search` → `track.getInfo` of the top match. Returns null when no key is set or
 * nothing resolves (the caller then omits the info panel). Never throws.
 */
export async function lookupTrackInfo(youtubeTitle: string, channelTitle: string): Promise<LastfmInfo | null> {
  const key = lastfmApiKey();
  if (!key) return null;
  const { artist, title } = parseTrack(youtubeTitle, channelTitle);
  if (!title) return null;

  if (artist) {
    const direct = await fetchInfo(key, artist, title);
    if (direct) return direct;
  }
  // Fallback: free-text search → take the top match → fetch its full info.
  try {
    const res = await fetch(buildUrl({ method: "track.search", track: title, api_key: key, limit: "1" }), {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LastfmSearchResponse;
    const top = data.results?.trackmatches?.track?.[0];
    if (top?.name && top.artist) return await fetchInfo(key, top.artist, top.name);
  } catch {
    /* fall through to null */
  }
  return null;
}

/** Compact "1.2M" / "12.3k" listener formatting for the info panel. */
export function formatListeners(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
