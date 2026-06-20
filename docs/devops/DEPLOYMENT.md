# Deployment — Hum AI

## Current state: production SPA deployed

`apps/web` is a real **local-first Vite SPA** that runs the full spine client-side
(prior → personalization → longitudinal; the capture acceptance gate, Stage ①, is wired
in) and is **deployed to Vercel production** (`vercel.json` `buildCommand`
`npm run build:web`, `outputDirectory` `apps/web/dist`). Firestore rules/indexes
(`firebase.json` + `firestore.rules`) are deployed to project `humai-core-prod`.

The browser serves the **classical JSON priors** only: `model.json` (6-class, below
gate), `model.arousal_binary.json` (cleared the ~80% experimental gate at ~83%, served
as an auxiliary prior), and `model.valence_binary.json` (below gate, developing). The
newer **mel-CNN hum model** (84.2% arousal on hum) is a Torch checkpoint, Python-CLI
**only**, not browser-servable, and was **not promoted** (84.2% < its 85% gate) — do not
present it as deployed or served in the browser.

| Surface | State | Deployable? |
| --- | --- | --- |
| `packages/*` (intelligence core) | Implemented + tested | Libraries — not deployed directly |
| `apps/web` | Local-first SPA running the full spine; serves the classical JSON priors | **Deployed to production** |
| `apps/mobile` | Placeholder | No |
| `apps/ops` | Placeholder | No |

## Deployment gate (do not skip)

Before **any** deploy:

- [ ] `npm run check` is green (typecheck + tests).
- [ ] Privacy scan passes ([PUBLIC_REPO_PRIVACY_CHECKLIST.md](../privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md)) — no secrets/binaries/datasets/weights in the build context.
- [ ] `.vercel/` and `.env` are git-ignored and not in the deploy artifact.

Before **production** (`--prod`) deploy, additionally:

- [x] A real web client exists (the local-first SPA) and has been reviewed.
- [ ] Env vars are set in the Vercel dashboard, not in the repo (see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)).
- [ ] No raw-audio / clinical-label code path can sync without consent (ADR-0006, DATA_GOVERNANCE).

> **Hard rule:** never run a one-shot `vercel --prod`. The multi-GB git-ignored `data/`
> tree must not upload, so always build locally and deploy the prebuilt artifact:
> `vercel build --prod && vercel deploy --prebuilt --prod`. `.vercelignore` excludes
> `data/`, `research/`, and docs (keeping only the small derived model JSONs the prebuild
> stages into the SPA).

## Preview deploy (safe)

```bash
vercel build && vercel deploy --prebuilt --scope ishaans-projects-f5eaf242   # preview URL
```

## Production deploy

```bash
npm run check                                       # must be green
# privacy scan must pass (see checklist)
vercel build --prod && vercel deploy --prebuilt --prod --scope ishaans-projects-f5eaf242
firebase deploy --only firestore:rules,firestore:indexes --project humai-core-prod
```

## CI and deploys

CI (`.github/workflows/ci.yml`) builds and tests the **packages**; it does **not**
deploy. Production deploys are run from the CLI via the prebuilt-artifact path above
(not a one-shot `vercel --prod`) so the git-ignored `data/` tree is never uploaded.

## Rollback

Vercel keeps prior deployments; promote a previous production deployment from the
dashboard or with `vercel rollback`.
