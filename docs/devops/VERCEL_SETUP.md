# Vercel Setup — Hum AI

Target team/workspace: **https://vercel.com/ishaans-projects-f5eaf242**
Target project: **hum-ai**

## Deployability status (current pass)

`apps/web` is a **preview placeholder**, not a production app. It contains a single
static `index.html` clearly marked "preview placeholder — not the product." There is
**no product UI, no framework, and no build step** this pass (the intelligence core is
the `packages/*` workspaces). Therefore:

- **No production deployment is performed or implied.** Do not present any Vercel URL
  as the Hum AI product.
- The static placeholder exists only so the project can be **linked and preview-built**
  without fabricating a product.

## Recommended Vercel project settings

Configure these in the Vercel dashboard (or accept them at `vercel link` time):

| Setting | Value |
| --- | --- |
| Project name | `hum-ai` |
| Team / scope | `ishaans-projects-f5eaf242` |
| Root Directory | `apps/web` |
| Framework Preset | **Other** |
| Build Command | *(none — leave empty; static)* |
| Output Directory | *(default; serves `apps/web/index.html`)* |
| Install Command | *(none required for the static placeholder)* |
| Node.js version | 22.x |

> **Do not** point the Root Directory at the monorepo root and do not add a build
> command that runs `npm test`/`tsc` — there is nothing to build for the web surface
> yet. Keep it static until the real client is built. We intentionally ship **no
> `vercel.json`** so Vercel's zero-config static serving applies; add one only when a
> real build pipeline exists, and make it correct then.

## Link / create the project — CLI (authenticated)

`vercel whoami` shows the logged-in user. To create + link without deploying product UI:

```bash
# From the repo root:
vercel link --scope ishaans-projects-f5eaf242 --project hum-ai --yes
#   ^ creates the project if missing and writes .vercel/ (GIT-IGNORED — never commit it)

# When prompted for "In which directory is your code located?", choose: apps/web
```

To produce a **preview** (NOT production) build of the placeholder:

```bash
vercel deploy --scope ishaans-projects-f5eaf242        # preview URL (safe; placeholder only)
# Do NOT run `vercel --prod` until the real client exists and is reviewed.
```

## Link / create — manual (dashboard)

1. https://vercel.com/new → import `ishaan-bit/hum-ai` (the GitHub repo).
2. Team: `ishaans-projects-f5eaf242`. Project name: `hum-ai`.
3. **Root Directory:** `apps/web`. **Framework Preset:** Other. Build Command: empty.
4. Add environment variables — see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).
5. Deploy → this yields a **preview** of the placeholder. Keep production undefined
   until the real client ships.

## Privacy

- `.vercel/` is **git-ignored** — it holds local project/org ids and must never be
  committed.
- No secrets in the repo: configure all env vars in the Vercel dashboard (see
  [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)).
- See [DEPLOYMENT.md](DEPLOYMENT.md) for the gate that prevents deploying the
  placeholder as production.

## Status of the automated pass

Whether the project was linked/created in the automated pass (and why/why not) is
recorded in `worklog/massive-qa-git-vercel-pass/LANE_E_VERCEL_BOOTSTRAP.md` and
`FINAL_STATUS.md`.
