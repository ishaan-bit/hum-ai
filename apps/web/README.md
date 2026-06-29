# apps/web — Hum AI web client

A real, **local-first Vite SPA** that runs the entire hum read spine **client-side** and is
**deployed to Vercel production** (public: **https://hum-ai-beige.vercel.app**). No server, no
backend inference — the browser does everything: capture → Stage ① acceptance gate → on-device
features → quality/domain → experts → late fusion → valence/arousal axis read → personalization →
within-user longitudinal → intervention → non-diagnostic render. Raw audio never leaves the device
by default; only derived summaries sync (Firebase), and only under explicit, scoped consent.

Non-clinical, research-stage, not a diagnosis.

## The experience: one orb, five windows

A single persistent **AURA orb** (one GPU-cheap Canvas) *is* your inner state and travels beneath a
windowed flow. Navigation is redundant by design (swipe · tappable dots · Next/Back · arrow keys):

| Window | What it is |
| --- | --- |
| **Hum** | The 12-second capture ritual. The whole screen quiets to listen; progress lives in the orb's timer ring. |
| **State** | The read — leads with the **valence + arousal** axes (from hum #1), plus the within-hum temporal trajectory, richer diagnostics, and the within-you Big Five signature. A HiTL mood-field lets you confirm/adjust the read (one row of native-hum truth). |
| **Today** | The **Intervention of the Day** — one gentle, optional, safety-screened regulation step matched to your read (breath · grounding · movement · rest · music · …). |
| **Diary** | Your **pattern over time** (consent-gated): the longitudinal mood/risk chart, early-signal noticing, and your own life-context notes per hum (local-only). |
| **Sound Lab** | Turns the read into a **grounding song you can play**. See below. |

The deeper instrument surfaces (baseline, model lab, history, privacy/consent, research study, the
simulate/reset sandbox) live in a pull-up **instrument tray**.

## Sound Lab

The Sound Lab steers a real, embeddable track from where you are + what you like:

1. The read's **valence/arousal** picks a regulation *steer* — settle · steady · gentle lift · keep
   the thread · momentum (the pure `planSoundLab` from `@hum-ai/intervention-engine`; the same
   de-Witte-grounded "may help you unwind" register as the passive music step — support, never
   treatment).
2. You layer in taste: **Language** (Hindi · English · Surprise me) · **Genre** (Bollywood … Devotional)
   · **Flavor** (Acoustic · Lo-fi · Electronic · Ambient, ×2).
3. That becomes a music search resolved via the **YouTube Data API v3** to an embeddable track played
   in-app, with **Try another**, "did it fit?" feedback (which nudges the next search), and
   recently-played de-duping. A **Last.fm** "about this song" panel adds genre/mood tags, listener
   reach, and a short description.

Both providers are **optional** and key-gated (`HUM_AI_YOUTUBE_API_KEY`, `HUM_AI_LASTFM_API_KEY`).
With no key the tab still works — in-app playback degrades to an "Open on YouTube" link and the
info panel is simply omitted. The read→steer→search mapping is pure + safety-screened in the engine;
this app owns the DOM, the network calls, and the local taste/feedback store. External titles, tags,
and summaries are escaped before they reach the DOM.

## Run it

From the repo root:

```bash
npm run dev:web        # vite dev server (HMR) — http://localhost:5173
npm run build:web      # production bundle → apps/web/dist
npm run typecheck:web  # tsc --noEmit -p apps/web/tsconfig.json (DOM lib)
```

The `@hum-ai/*` spine packages are bundled **from TypeScript source** (Vite aliases each to its
`src/index.ts`); there is no per-package build step. Only browser-safe packages are aliased — the
offline/Node-only libraries (e.g. `signal-lab`'s barrel) are reached only via their pure deep
modules, so no Node builtin enters the bundle.

### Headless pipeline demo (no mic, no browser)

```bash
npm run demo:voice   # synth hums → orchestrateHumAudio → safe read + derived sync payload
```

`demo/voice-core-demo.ts` synthesizes hums in code (clean / noisy / near-silence — no recording),
runs each through the full pipeline, and prints only the safe user-facing read plus a short internal
summary. Non-clinical, not validated.

## Configuration (Vite env)

Env vars use the **`HUM_AI_`** prefix and are read from the **repo-root** `.env` (see
[`.env.example`](../../.env.example); `envDir` is the repo root, `envPrefix` is `["VITE_","HUM_AI_"]`).
All are **public, build-time-inlined** identifiers, safe to embed in a static bundle.

| Variable | Purpose |
| --- | --- |
| `HUM_AI_FIREBASE_*` | Public Firebase web-client config (Auth + Firestore) for optional derived-only cloud sync. |
| `HUM_AI_YOUTUBE_API_KEY` | *(optional)* Referrer-restricted YouTube Data API v3 key for the Sound Lab's in-app player. |
| `HUM_AI_LASTFM_API_KEY` | *(optional)* Read-only Last.fm key for the Sound Lab's "about this song" panel. |
| `HUM_AI_MODEL_VERSION` | Build-time model-version stamp. |
| `HUM_AI_STUDY_ID` | *(optional)* Research-study id for the (gated) study UI. |

> **Prebuilt deploys build locally**, so the local `.env` / gitignored `.env.local` are what Vite
> inlines — Vercel **dashboard** env vars apply to *remote* builds. Restrict the public keys by HTTP
> referrer in the provider console. `.env*.local` are gitignored; never commit a key file.

## Deploy

Production deploys to the Vercel **`hum-ai`** project via the **prebuilt** path (a plain remote build
chokes on the multi-GB git-ignored `data/` tree; prebuilt sidesteps the upload):

```bash
npx vercel build --prod --yes
npx vercel deploy --prebuilt --prod --scope <scope> --yes
```

`vercel.json`: `buildCommand` `npm run build:web`, `outputDirectory` `apps/web/dist`. The public
alias `hum-ai-beige.vercel.app` returns 200; per-deployment URLs are protected (401 to the public).
See [docs/devops/](../../docs/devops/) for the full setup.

## Persistence & privacy

- **Local-first:** `PersonalizationState`, the diary context, the acoustic re-reference ring, and the
  Sound Lab taste/history/feedback all live in `localStorage` (the diary + Sound Lab stores are
  **never synced** — they're the user's own notes/taste).
- **Cloud (opt-in):** with `derived_feature_sync` consent + anonymous sign-in, only **derived** summaries
  sync to Firestore; every sync payload passes `assertNoRawAudioFields`. Raw audio is never uploaded by
  default. See [DATA_GOVERNANCE](../../docs/privacy/DATA_GOVERNANCE.md).
