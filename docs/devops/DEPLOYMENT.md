# Deployment — Hum AI

## Current state: preview placeholder only

There is **no production deployment** of Hum AI. `apps/web` is a static **preview
placeholder** (see [VERCEL_SETUP.md](VERCEL_SETUP.md)); the product client is not built.
Do not present any deployed URL as the Hum AI product.

| Surface | State | Deployable? |
| --- | --- | --- |
| `packages/*` (intelligence core) | Implemented + tested (heuristic stubs) | Libraries — not deployed directly |
| `apps/web` | Static preview placeholder | **Preview only** (not production) |
| `apps/mobile` | Placeholder | No |
| `apps/ops` | Placeholder | No |

## Deployment gate (do not skip)

Before **any** deploy:

- [ ] `npm run check` is green (typecheck + tests).
- [ ] Privacy scan passes ([PUBLIC_REPO_PRIVACY_CHECKLIST.md](../privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md)) — no secrets/binaries/datasets/weights in the build context.
- [ ] `.vercel/` and `.env` are git-ignored and not in the deploy artifact.

Before **production** (`--prod`) deploy, additionally:

- [ ] A real web client exists (not the placeholder) and has been reviewed.
- [ ] Env vars are set in the Vercel dashboard, not in the repo (see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)).
- [ ] No raw-audio / clinical-label code path can sync without consent (ADR-0006, DATA_GOVERNANCE).

> **Hard rule:** never run `vercel --prod` while `apps/web` is the placeholder. Preview
> deploys of the placeholder are fine and explicitly labeled as such.

## Preview deploy (placeholder, safe)

```bash
vercel deploy --scope ishaans-projects-f5eaf242     # preview URL of the static placeholder
```

## Production deploy (future — only when the real client exists)

```bash
npm run check                                       # must be green
# privacy scan must pass (see checklist)
vercel --prod --scope ishaans-projects-f5eaf242
```

## CI and deploys

CI (`.github/workflows/ci.yml`) builds and tests the **packages**; it does **not**
deploy. Vercel deploys are triggered from Vercel's GitHub integration (preview on PRs)
once the project is linked — and remain previews until a real client and an explicit
production promotion exist.

## Rollback

Vercel keeps prior deployments; promote a previous deployment from the dashboard or
`vercel rollback`. Since there is no production deployment yet, there is nothing to roll
back to in this pass.
