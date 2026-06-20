# Vercel Setup — Hum AI

Target team/workspace: **https://vercel.com/ishaans-projects-f5eaf242**
Target project: **hum-ai**

## Deployability status (current pass)

`apps/web` is a **real, local-first Vite SPA** that runs the full Hum AI spine
client-side (prior → personalization → longitudinal) and is **deployed to Vercel
production**. The build is driven by the committed root `vercel.json` (`buildCommand`
`npm run build:web`, `outputDirectory` `apps/web/dist`), and a `prebuild` step
(`apps/web/scripts/copy-model.mjs`) stages the trained JSON priors into
`apps/web/public/models/`. Therefore:

- **A production deployment exists.** The SPA serves the **classical JSON priors**:
  `model.json` (6-class affect, below gate), `model.arousal_binary.json` (cleared the
  ~80% experimental gate at ~83%), and `model.valence_binary.json` (below-gate,
  developing). The Stage ① capture acceptance gate is wired into the SPA.
- The browser does **not** serve the newer mel-CNN hum model. That model (84.2% arousal
  on hum) is a torch checkpoint, Python-CLI only, not browser-servable, and was **not
  promoted** (84.2% < its 85% gate). Do not present it as deployed/served in the browser.
- Raw audio never leaves the browser; features are computed on-device and the full
  spine runs client-side.

## Vercel project settings (match the committed `vercel.json`)

The committed root `vercel.json` is the source of truth; these settings mirror it.

| Setting | Value |
| --- | --- |
| Project name | `hum-ai` |
| Team / scope | `ishaans-projects-f5eaf242` |
| Framework Preset | **null** (`"framework": null` — no preset) |
| Install Command | `npm install` |
| Build Command | `npm run build:web` (runs `apps/web` `prebuild` → `vite build`) |
| Output Directory | `apps/web/dist` |
| Node.js version | 22.x |

> The `prebuild` (`apps/web/scripts/copy-model.mjs`) copies the small derived prior
> JSONs from git-ignored `data/processed/signal-lab/` into `apps/web/public/models/`
> (also git-ignored) so the built SPA `fetch`es and runs the real trained priors. If
> the artifacts are absent (e.g. a clean CI checkout), the client degrades to the
> honest heuristic fallback — nothing in the prebuild is required to build.

> **Prebuilt deploy is required**, and a `.vercelignore` is committed. The git-ignored
> `data/` model files and local `.env` config exist only on the dev machine, and a plain
> remote build (`vercel --prod`) uploads the whole repo tree (it does not honor
> `.gitignore`) — which hits Vercel's 100 MB per-file limit on the multi-GB `data/`
> tree. The `.vercelignore` excludes `data/` (keeping only the 4 derived
> `data/processed/signal-lab/*.json` priors), `research/`, `docs/`, and scratch; the
> prebuilt path (`vercel build` locally, then `vercel deploy --prebuilt`) sidesteps the
> upload entirely and is the safe default.

## Link / create the project — CLI (authenticated)

`vercel whoami` shows the logged-in user. To create + link the project:

```bash
# From the repo root:
vercel link --scope ishaans-projects-f5eaf242 --project hum-ai --yes
#   ^ creates the project if missing and writes .vercel/ (GIT-IGNORED — never commit it)
```

Deploy via the **prebuilt** path (required — see the deployability note above):

```bash
# Preview:
vercel build && vercel deploy --prebuilt --scope ishaans-projects-f5eaf242

# Production:
vercel build --prod && vercel deploy --prebuilt --prod --scope ishaans-projects-f5eaf242
```

## Link / create — manual (dashboard)

1. https://vercel.com/new → import `ishaan-bit/hum-ai` (the GitHub repo).
2. Team: `ishaans-projects-f5eaf242`. Project name: `hum-ai`.
3. The committed root `vercel.json` supplies the framework (null), install/build
   commands, and output directory — accept them rather than overriding in the dashboard.
4. Add environment variables — see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).
5. Deploy via the prebuilt path (above). A remote build will fail on the `data/` tree
   size, so build locally and `vercel deploy --prebuilt`.

## Two manual gotchas (cannot be done via CLI)

1. **Deployment Protection / Vercel Authentication** is ON by default, so the production
   URL returns **401** to the public. Make it public in Project Settings → Deployment
   Protection.
2. Firebase **Anonymous sign-in** must be enabled in the Firebase Console (Authentication
   → Sign-in method) for cloud sync. Until then the SPA degrades to local-first
   gracefully (Firestore rules + indexes are already deployed to `humai-core-prod`).

## Privacy

- `.vercel/` is **git-ignored** — it holds local project/org ids and must never be
  committed.
- No secrets in the repo: configure all env vars in the Vercel dashboard (see
  [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)).
- See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deploy flow and production status.

## Status of the automated pass

Whether the project was linked/created in the automated pass (and why/why not) is
recorded in `worklog/massive-qa-git-vercel-pass/LANE_E_VERCEL_BOOTSTRAP.md` and
`FINAL_STATUS.md`.
