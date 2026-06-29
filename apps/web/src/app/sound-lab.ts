/**
 * SOUND LAB — the fifth window. A user-directed grounding companion to the passive
 * "music_regulation" suggestion: it takes the read's valence–arousal steer (settle / steady /
 * gentle lift / keep the thread / momentum), lets the person layer in their own taste
 * (language · genre · flavor), and resolves that to a real, embeddable YouTube track played
 * inside the app.
 *
 * Architecture split:
 *  - the read → steer → search mapping is the PURE `@hum-ai/intervention-engine` plan
 *    (`planSoundLab`), so it stays safety-screened + deterministic;
 *  - this controller owns the DOM, the (impure) YouTube resolve, and the local taste/feedback
 *    store. It self-contains its state so `main.ts` only has to `update(read)` it.
 *
 * SUPPORT, never treatment: every surfaced sentence is reused from the engine's safe copy or is
 * the plain, non-clinical static copy below.
 */
import type { OrchestratedRead } from "@hum-ai/orchestrator";
import {
  planSoundLab,
  MAIN_GENRES,
  MUSIC_FLAVORS,
  MUSIC_LANGUAGES,
  MAX_FLAVORS,
  type MainMusicGenre,
  type MusicFlavor,
  type MusicLanguage,
  type SoundLabPlan,
  type SoundLabPreferences,
} from "@hum-ai/intervention-engine";
import {
  loadSoundLabPrefs,
  saveSoundLabPrefs,
  loadSongHistory,
  pushSongHistory,
  loadSongFeedback,
  saveSongFeedback,
  feedbackQueryNudge,
  SONG_FEEDBACK_OPTIONS,
  type SongFeedback,
} from "./sound-lab-store";
import {
  searchYouTube,
  youtubePlaybackAvailable,
  youtubeEmbedUrl,
  youtubeSearchUrl,
  youtubeWatchUrl,
  type YtVideo,
} from "./sound-lab-youtube";
import { lookupTrackInfo, lastfmAvailable, formatListeners, type LastfmInfo } from "./sound-lab-lastfm";

export interface SoundLabController {
  /** Feed the latest read (or null on reset). Re-derives the steer and clears any stale match. */
  update(read: OrchestratedRead | null): void;
}

export interface SoundLabOptions {
  /** Local user id — keys the taste/history/feedback store (mirrors the diary store). */
  readonly localId: string;
  /** Send the user back to the Hum window from the empty state. */
  readonly onHum?: () => void;
}

type Phase = "empty" | "ready" | "loading" | "result" | "error";

/** Escape dynamic strings — critically, the EXTERNAL YouTube titles/channels. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function initSoundLab(opts: SoundLabOptions): SoundLabController {
  const card = document.getElementById("sound-lab-card");
  const body = document.getElementById("sound-lab-content");

  let read: OrchestratedRead | null = null;
  let prefs: SoundLabPreferences = loadSoundLabPrefs(opts.localId);
  let feedback: SongFeedback | null = loadSongFeedback(opts.localId);

  let phase: Phase = "empty";
  let videos: readonly YtVideo[] = [];
  let idx = 0;
  let lastQuery = "";
  let errorKind = "";

  // ── read helpers ────────────────────────────────────────────────────────────────
  const isAbstained = (): boolean => read === null || read.userFacing.abstained;
  const va = (): { valence: number; arousal: number } =>
    read && !read.userFacing.abstained ? read.internal.axis.dimensional : { valence: 0, arousal: 0 };
  /** The plan for the CURRENT read + taste (genre may be null — direction/copy still resolve). */
  const currentPlan = (): SoundLabPlan => planSoundLab({ va: va(), prefs, extraTerms: feedbackQueryNudge(feedback) });

  // ── header (the read-grounded steer) ──────────────────────────────────────────────
  function renderHeader(): void {
    if (!card) return;
    if (!read) {
      card.innerHTML = `<h3>Sound Lab</h3><p class="muted">Hum first, then I'll tune a song to where you are.</p>`;
      return;
    }
    const plan = currentPlan();
    const stateLine = !isAbstained() && read.userFacing.innerState
      ? `<p class="sl-state">${esc(read.userFacing.innerState)}</p>`
      : `<p class="sl-state muted">The read is still settling — here's a steadying default.</p>`;
    card.innerHTML = `
      <h3>Sound Lab</h3>
      <p class="muted small">A song to ground this moment, tuned to your read and your taste.</p>
      ${stateLine}
      <div class="sl-steer">
        <p class="sl-dir"><span class="sl-dir-tag">Leaning</span> ${esc(plan.directionLabel)} <span class="muted small">· ${esc(plan.tempoBand)}</span></p>
        <p class="sl-copy">${esc(plan.copy)}</p>
        <p class="muted small">Matched to ${esc(plan.basedOn)}.</p>
      </div>`;
  }

  // ── chip groups ───────────────────────────────────────────────────────────────────
  function chipGroup<T extends string>(
    label: string,
    attr: string,
    options: readonly T[],
    isOn: (o: T) => boolean,
    isDisabled: (o: T) => boolean = () => false,
  ): string {
    const chips = options
      .map((o) => {
        const on = isOn(o);
        const dis = isDisabled(o);
        return `<button type="button" class="sl-chip${on ? " is-on" : ""}" data-${attr}="${esc(o)}" aria-pressed="${on}"${dis ? " disabled aria-disabled=\"true\"" : ""}>${esc(o)}</button>`;
      })
      .join("");
    return `<div class="sl-pref"><p class="sl-pref-label">${esc(label)}</p><div class="sl-chips" role="group" aria-label="${esc(label)}">${chips}</div></div>`;
  }

  function preferencePanel(): string {
    const flavorAtLimit = prefs.flavors.length >= MAX_FLAVORS;
    return `
      <div class="sl-prefs">
        ${chipGroup<MusicLanguage>("Language", "lang", MUSIC_LANGUAGES, (l) => prefs.language === l)}
        ${chipGroup<MainMusicGenre>("Main genre", "genre", MAIN_GENRES, (g) => prefs.genre === g)}
        ${chipGroup<MusicFlavor>("Flavor", "flavor", MUSIC_FLAVORS, (f) => prefs.flavors.includes(f), (f) => flavorAtLimit && !prefs.flavors.includes(f))}
        <p class="sl-pref-hint muted small">${flavorAtLimit ? "Two flavors max — tap one off to swap." : "Add up to two textures, if you like."}</p>
      </div>`;
  }

  function vibeChips(plan: SoundLabPlan): string {
    if (!plan.descriptors.length) return "";
    const chips = plan.descriptors.map((d) => `<span class="sl-vibe">${esc(d)}</span>`).join("");
    return `<div class="sl-vibes"><span class="muted small">Vibe</span> ${chips}</div>`;
  }

  // ── result region ──────────────────────────────────────────────────────────────────
  function playerBlock(): string {
    const video = videos[idx];
    if (phase === "loading") {
      return `<div class="sl-player-wrap"><p class="sl-loading" role="status" aria-live="polite">Finding a track…</p></div>`;
    }
    if (phase === "error") {
      const msg =
        errorKind === "quota_or_key"
          ? "In-app search hit a limit just now."
          : "Couldn't reach the music search just now.";
      return `
        <div class="sl-player-wrap">
          <div class="sl-fallback">
            <p>${esc(msg)} You can still open a match on YouTube.</p>
            <a class="btn btn-ghost btn-sm" href="${esc(youtubeSearchUrl(lastQuery))}" target="_blank" rel="noreferrer">Open on YouTube</a>
          </div>
          <div class="sl-actions"><button type="button" class="btn btn-sm" data-action="match">Try again</button></div>
        </div>`;
    }
    if (phase === "result" && video) {
      return `
        <div class="sl-player-wrap">
          <p class="sl-listening muted small">Listening inside Hum</p>
          <div class="sl-embed">
            <iframe
              src="${esc(youtubeEmbedUrl(video.videoId))}"
              title="${esc(video.title)} on YouTube"
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
          <p class="sl-track"><span class="sl-track-title">${esc(video.title)}</span>${video.channelTitle ? `<span class="muted small">${esc(video.channelTitle)}</span>` : ""}</p>
          <div class="sl-actions">
            <button type="button" class="btn btn-sm" data-action="another">Try another</button>
            <a class="btn btn-ghost btn-sm" href="${esc(youtubeWatchUrl(video.videoId))}" target="_blank" rel="noreferrer">Open on YouTube</a>
          </div>
          ${feedbackRow()}
          <div class="sl-songinfo" data-songinfo aria-live="polite"></div>
        </div>`;
    }
    // result phase but no playable video (no-key, or empty result set).
    const reason = !youtubePlaybackAvailable()
      ? "In-app playback isn't set up on this build."
      : "No track came back for that mix.";
    return `
      <div class="sl-player-wrap">
        <div class="sl-fallback">
          <p>${esc(reason)} Open the match on YouTube, or adjust your taste and try again.</p>
          <a class="btn btn-ghost btn-sm" href="${esc(youtubeSearchUrl(lastQuery))}" target="_blank" rel="noreferrer">Open on YouTube</a>
        </div>
        <div class="sl-actions"><button type="button" class="btn btn-sm" data-action="match">Try another mix</button></div>
      </div>`;
  }

  // ── Last.fm song info (enrichment; never blocks playback) ───────────────────────────
  /** Render the escaped "About this song" panel from resolved Last.fm metadata. */
  function renderSongInfo(info: LastfmInfo): string {
    const tags = info.tags.length
      ? `<div class="sl-si-tags">${info.tags.map((t) => `<span class="sl-si-tag">${esc(t)}</span>`).join("")}</div>`
      : "";
    const reach = info.listeners !== null
      ? `<span class="sl-si-reach muted small">${esc(formatListeners(info.listeners))} listeners on Last.fm</span>`
      : "";
    const link = info.url
      ? `<a class="sl-si-link" href="${esc(info.url)}" target="_blank" rel="noreferrer">More on Last.fm ↗</a>`
      : "";
    const sep = reach && link ? ` <span class="muted small">·</span> ` : "";
    const summary = info.summary ? `<p class="sl-si-sum muted small">${esc(info.summary)}</p>` : "";
    return `
      <p class="sl-si-head muted small">About this song</p>
      <p class="sl-si-track"><span class="sl-si-name">${esc(info.name)}</span><span class="muted"> · ${esc(info.artist)}</span></p>
      ${tags}
      ${reach || link ? `<p class="sl-si-meta">${reach}${sep}${link}</p>` : ""}
      ${summary}`;
  }

  /**
   * Fetch + inject the Last.fm info for the CURRENT track, in place (so the iframe never reloads).
   * No-op without a key. Guards against a stale response landing after the user moved to another
   * track (only injects when `video` is still the one showing).
   */
  async function loadSongInfo(video: YtVideo): Promise<void> {
    if (!body || !lastfmAvailable()) return;
    const info = await lookupTrackInfo(video.title, video.channelTitle);
    if (videos[idx]?.videoId !== video.videoId) return; // user moved on — drop the stale result
    const host = body.querySelector<HTMLElement>("[data-songinfo]");
    if (!host) return;
    host.innerHTML = info ? renderSongInfo(info) : "";
  }

  function feedbackRow(): string {
    const opts = SONG_FEEDBACK_OPTIONS.map(
      (o) =>
        `<button type="button" class="sl-fb${feedback === o.value ? " is-on" : ""}" data-feedback="${esc(o.value)}" aria-pressed="${feedback === o.value}">${esc(o.label)}</button>`,
    ).join("");
    const note = feedback ? `<p class="sl-fb-note muted small" data-fb-note>Noted — your next match will lean on that.</p>` : `<p class="sl-fb-note muted small" data-fb-note></p>`;
    return `<div class="sl-feedback"><p class="muted small">Did this fit?</p><div class="sl-fb-row">${opts}</div>${note}</div>`;
  }

  // ── body ────────────────────────────────────────────────────────────────────────────
  function renderBody(): void {
    if (!body) return;
    if (!read) {
      body.innerHTML = `
        <div class="sl-empty">
          <p class="muted">Your Sound Lab tunes a grounding track to your latest hum. Record one to begin.</p>
          <button type="button" class="btn btn-primary btn-sm" data-action="hum">Hum now</button>
        </div>`;
      return;
    }
    const plan = currentPlan();
    const canMatch = prefs.genre !== null;
    const matchLabel = phase === "loading" ? "Finding a track…" : videos.length || phase === "result" || phase === "error" ? "New match" : "Match my song";
    body.innerHTML = `
      ${preferencePanel()}
      ${vibeChips(plan)}
      <div class="sl-cta">
        <button type="button" class="btn btn-primary" data-action="match" ${canMatch && phase !== "loading" ? "" : "disabled"}>${esc(matchLabel)}</button>
        ${canMatch ? "" : `<p class="muted small">Pick a main genre to match a song.</p>`}
      </div>
      <div class="sl-result">${phase === "ready" || phase === "empty" ? "" : playerBlock()}</div>
      <p class="sl-foot muted small">Optional and reflective. A track to take a moment with.</p>`;
  }

  function render(): void {
    renderHeader();
    renderBody();
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────
  async function match(): Promise<void> {
    if (!read || prefs.genre === null) return;
    const plan = currentPlan();
    lastQuery = plan.query;
    phase = "loading";
    renderBody();

    const result = await searchYouTube(plan.query);
    if (result.status === "no-key") {
      videos = [];
      idx = 0;
      phase = "result"; // result phase with no video → shows the graceful fallback card
    } else if (result.status === "error") {
      errorKind = result.message;
      phase = "error";
    } else {
      // Prefer tracks we haven't recently played; fall back to the full list if all are seen.
      const seen = new Set(loadSongHistory(opts.localId));
      const fresh = result.videos.filter((v) => !seen.has(v.videoId));
      videos = fresh.length ? fresh : result.videos;
      idx = 0;
      phase = "result";
      const first = videos[idx];
      if (first) pushSongHistory(opts.localId, first.videoId);
    }
    feedback = null; // a new track resets the fit-feedback
    renderBody();
    const shown = videos[idx];
    if (phase === "result" && shown) void loadSongInfo(shown); // enrich with Last.fm (non-blocking)
  }

  function another(): void {
    if (idx + 1 < videos.length) {
      idx += 1;
      const v = videos[idx];
      if (v) {
        pushSongHistory(opts.localId, v.videoId);
        feedback = null;
        renderBody();
        void loadSongInfo(v); // enrich the new track (non-blocking)
      }
    } else {
      void match(); // exhausted the batch — search afresh (history steers away from repeats)
    }
  }

  function setFeedback(value: SongFeedback): void {
    feedback = value;
    saveSongFeedback(opts.localId, value);
    // Update the feedback row in place so we DON'T reload the iframe (the song keeps playing).
    if (!body) return;
    body.querySelectorAll<HTMLButtonElement>("[data-feedback]").forEach((btn) => {
      const on = btn.dataset.feedback === value;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const note = body.querySelector<HTMLElement>("[data-fb-note]");
    if (note) note.textContent = "Noted — your next match will lean on that.";
  }

  function setLanguage(l: MusicLanguage): void {
    prefs = { ...prefs, language: l };
    saveSoundLabPrefs(opts.localId, prefs);
    resetResult();
  }
  function setGenre(g: MainMusicGenre): void {
    prefs = { ...prefs, genre: prefs.genre === g ? null : g };
    saveSoundLabPrefs(opts.localId, prefs);
    resetResult();
  }
  function toggleFlavor(f: MusicFlavor): void {
    const has = prefs.flavors.includes(f);
    if (!has && prefs.flavors.length >= MAX_FLAVORS) return;
    const flavors = has ? prefs.flavors.filter((x) => x !== f) : [...prefs.flavors, f];
    prefs = { ...prefs, flavors };
    saveSoundLabPrefs(opts.localId, prefs);
    resetResult();
  }

  /** Changing taste invalidates the current match — drop it and re-render the controls. */
  function resetResult(): void {
    videos = [];
    idx = 0;
    phase = "ready";
    render();
  }

  // ── delegated events (the body innerHTML is replaced on most state changes) ──────────
  body?.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const lang = el.closest<HTMLElement>("[data-lang]")?.dataset.lang;
    if (lang && (MUSIC_LANGUAGES as readonly string[]).includes(lang)) return setLanguage(lang as MusicLanguage);
    const genre = el.closest<HTMLElement>("[data-genre]")?.dataset.genre;
    if (genre && (MAIN_GENRES as readonly string[]).includes(genre)) return setGenre(genre as MainMusicGenre);
    const flavor = el.closest<HTMLElement>("[data-flavor]")?.dataset.flavor;
    if (flavor && (MUSIC_FLAVORS as readonly string[]).includes(flavor)) return toggleFlavor(flavor as MusicFlavor);
    const fb = el.closest<HTMLElement>("[data-feedback]")?.dataset.feedback;
    if (fb && SONG_FEEDBACK_OPTIONS.some((o) => o.value === fb)) return setFeedback(fb as SongFeedback);
    const action = el.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "match") return void match();
    if (action === "another") return another();
    if (action === "hum") return opts.onHum?.();
  });

  render();

  return {
    update(next: OrchestratedRead | null): void {
      const changed = next !== read;
      read = next;
      if (changed) {
        // A new read invalidates the old steer + any resolved track; keep the user's taste.
        videos = [];
        idx = 0;
        feedback = null;
        phase = read ? "ready" : "empty";
      }
      render();
    },
  };
}
