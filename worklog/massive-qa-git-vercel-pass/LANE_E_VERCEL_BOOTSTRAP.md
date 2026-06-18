# Lane E — Vercel Bootstrap

**Outcome: documented and prepared, NOT auto-linked/deployed.** No fake deployment. The web surface is a preview placeholder, and project linking is intentionally left as a deliberate manual step — consistent with the owner's "hold / keep private" posture this pass.

## Deployability decision

`apps/web` is a **preview placeholder**, not a product:
- Added the smallest safe shell: `apps/web/index.html` — a static page explicitly badged "Preview placeholder", with no product UI, no framework, no build step.
- The intelligence core remains the `packages/*` workspaces (libraries, not deployed directly).
- **No production deployment is performed or implied.**

## Files created

- `docs/devops/VERCEL_SETUP.md` — recommended project settings (Root Directory `apps/web`, framework Other, no build command), CLI + dashboard link/create steps, the rule against a wrong `vercel.json` (none shipped), `.vercel/` git-ignored.
- `docs/devops/DEPLOYMENT.md` — deployment gate; preview-only state; hard rule "never `vercel --prod` while `apps/web` is the placeholder".
- `docs/devops/ENVIRONMENT_VARIABLES.md` — `HUM_AI_`-prefixed vars, secrets-never-in-repo, per-environment setup.

## Why linking was NOT auto-executed

`vercel whoami` confirmed authentication as **ishaan-bit** (team target `ishaans-projects-f5eaf242`), so an automated `vercel link` was *possible*. It was deliberately **not** run because:

1. The web app is a placeholder — creating a Vercel project now would build a placeholder, and the owner just chose the conservative "hold / private" path (deferring the public flip and license).
2. Auto-creating cloud project resources + choosing monorepo root/build settings is a decision better confirmed explicitly than performed silently.
3. The brief forbids faking a deployment and pretending production is ready — deferring keeps that bright line.

This matches the brief's fallback philosophy: where linking is not unambiguously safe/desired, write the exact manual steps and leave the project ready. No `.vercel/` metadata was created (and it is git-ignored regardless), and **no `vercel.json`** was added (avoiding a wrong one).

## Ready-to-run (when desired)

```bash
vercel link --scope ishaans-projects-f5eaf242 --project hum-ai --yes   # choose apps/web as the dir
vercel deploy --scope ishaans-projects-f5eaf242                        # PREVIEW of the placeholder (safe)
# Never `vercel --prod` until a real client exists and is reviewed.
```

| Item | State |
| --- | --- |
| Vercel CLI auth | ✅ ishaan-bit |
| Project `hum-ai` created/linked | **No** (deferred — documented manual steps) |
| Production deploy | **No** (placeholder; would be dishonest) |
| `vercel.json` | none (intentional) |
| `.vercel/` committed | no (git-ignored) |
