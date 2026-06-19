# Next Prompt

Everything is green. Use the prompt below to land the cohesion branch on `main`,
push `main`, and link + preview-build Vercel for `hum-ai` — **without** claiming
clinical validation and **without** a production deploy.

---

## Exact prompt to continue (GREEN path: merge to main + Vercel preview)

```
You are acting as Hum AI's release controller. The cohesion branch is validated and
pushed. Land it on main and set up Vercel preview only. Do not weaken tests, do not
fake ML or clinical validation, do not force push, do not deploy production.

Working directory: c:\Users\Kafka\Documents\humai

State:
- main is at 5d6f421 (== origin/main), untouched.
- cohesion/voice-core-merge is at 905eee4, pushed to origin, and contains the merged
  voice-first Hum AI core. On it: typecheck PASS, npm test 202/202, npm run qa PASS
  (4 gates), npm run demo:voice PASS, privacy clean.
- main is an ancestor of the merge, so the integration is a clean fast-forward.

PHASE A — Integrate to main
1. git checkout main && git pull --ff-only origin main
2. Open a PR from cohesion/voice-core-merge into main (gh pr create) OR, if direct
   merge is intended:
     git merge --ff-only cohesion/voice-core-merge
   (prefer --ff-only; main is an ancestor so no merge commit is needed. If it refuses,
    stop and report — do not force.)
3. Re-validate on main: npm ci && npm run typecheck && npm test && npm run qa &&
   npm run demo:voice
   Expect: typecheck clean, 202/202, qa 4/4, demo PASS.
4. Privacy re-check: git ls-files must show no pdf/docx/audio/weights/.env (except
   .env.example)/.vercel/datasets/credentials. npm run qa forbidden-files must pass.
5. If all green: git push origin main  (NO force push). If the remote has diverged,
   stop and report — do not force.

PHASE B — Vercel link + PREVIEW build only (no production)
Follow docs/devops/VERCEL_SETUP.md exactly:
1. vercel link --scope ishaans-projects-f5eaf242 --project hum-ai --yes
   (Root Directory: apps/web; Framework Preset: Other; no build command; .vercel is
    git-ignored — never commit it.)
2. vercel deploy --scope ishaans-projects-f5eaf242   # PREVIEW URL only
   Do NOT run vercel --prod. apps/web is a preview placeholder, not the product; do
   not present any Vercel URL as the Hum AI product. No production deploy until a real
   reviewed client exists.
3. Confirm .vercel/ is untracked (git status) and no secret/env file was added.

Constraints (unchanged): voice-first only; no camera runtime; no heavy ML/DSP deps;
no datasets/raw-audio/.env/secrets/weights/clinical labels committed; no clinical or
accuracy claims; no faked validation.

Report: whether main was updated and pushed, re-validation results, whether Vercel was
linked, the preview URL (if produced), and confirm no production deploy and no clinical
claims were made.
```

---

## If blockers appear instead

If re-validation on `main` fails, or the remote has diverged, or a privacy check trips,
do **not** force or weaken anything. Use this prompt:

```
Continue the Hum AI cohesion/release pass from
worklog/cohesion-voice-core-merge/FINAL_STATUS.md. A blocker appeared during
PHASE A/B (describe it). Diagnose and apply the smallest correct fix without weakening
tests, faking ML/clinical validation, force-pushing, or committing data/secrets. Re-run
the failed gate until green or a true blocker remains, then update FINAL_STATUS.md and
report.
```

## Optional follow-up (non-blocking hygiene)

```
Archive or clean the pre-ADR-0000 internal scratch note-packs that still use the banned
name "Hum v2" and stale packages/@hum/... paths (parallel-agent-review/,
parallel-research-pass/, and related notes). They are not shipped product surfaces and
the naming-check gate is unaffected, so this is hygiene only — either move them under a
clearly-labelled archive path or delete them, and update any index that references them.
Do not touch shipped packages/apps/docs. Re-run npm run qa afterward.
```
