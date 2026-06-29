/**
 * YouTube resolver for the Sound Lab — turns a music SEARCH (built by the engine from the
 * read + the user's taste) into a real, embeddable track played inside the app.
 *
 * The old build proxied this through a Next.js API route; the new app is a static SPA, so the
 * call is made directly from the browser against the YouTube Data API v3 with a PUBLIC,
 * referrer-restricted key (`HUM_AI_YOUTUBE_API_KEY`, read from Vite env). When no key is
 * configured the Sound Lab still works end-to-end: it degrades to an "Open on YouTube" search
 * link (no broken player, no hard dependency). We only ever request EMBEDDABLE videos so a
 * resolved result is actually playable in the iframe.
 */

/** One resolved, embeddable track. */
export interface YtVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
}

export type YtResult =
  | { readonly status: "ok"; readonly videos: readonly YtVideo[] }
  | { readonly status: "no-key" }
  | { readonly status: "error"; readonly message: string };

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const MAX_RESULTS = 10;

/** The configured public API key, or null when in-app playback isn't set up. */
export function youtubeApiKey(): string | null {
  const key = import.meta.env.HUM_AI_YOUTUBE_API_KEY;
  return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
}

/** True when in-app playback is available (a key is configured). */
export function youtubePlaybackAvailable(): boolean {
  return youtubeApiKey() !== null;
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

/**
 * Resolve a music search to a ranked list of embeddable videos. Returns `no-key` when playback
 * isn't configured, `error` on any network/quota failure (the caller then offers the search
 * link), and `ok` with up to {@link MAX_RESULTS} videos otherwise.
 */
export async function searchYouTube(query: string): Promise<YtResult> {
  const key = youtubeApiKey();
  if (!key) return { status: "no-key" };

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoCategoryId", "10"); // Music
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("maxResults", String(MAX_RESULTS));
  url.searchParams.set("q", query);
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: response.status === 403 ? "quota_or_key" : `http_${response.status}` };
    }
    const payload = (await response.json()) as { items?: YouTubeSearchItem[] };
    const videos: YtVideo[] = (payload.items ?? [])
      .map((it) => ({
        videoId: it.id?.videoId ?? "",
        title: it.snippet?.title ?? "Untitled",
        channelTitle: it.snippet?.channelTitle ?? "",
      }))
      .filter((v) => v.videoId !== "");
    return { status: "ok", videos };
  } catch {
    return { status: "error", message: "network" };
  }
}

/** The privacy-enhanced embed URL for a resolved video (in-app player). */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?playsinline=1&rel=0`;
}

/** A plain YouTube search URL — the always-available fallback ("Open on YouTube"). */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** A direct watch URL for a resolved video (opening the exact track outside the app). */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
