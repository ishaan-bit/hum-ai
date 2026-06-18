# GitHub Bootstrap — Hum AI

Target account: **https://github.com/ishaan-bit**
Target repo: **hum-ai** (public-capable)

This document is the exact, reproducible procedure to initialize git and publish the
Hum AI foundation safely. The actual outcome of the automated pass is recorded at the
bottom under **Bootstrap log**.

> **Owner decision (this pass):** the repo is created **PRIVATE**, and **no `LICENSE`
> is added yet** — the license choice and the public flip are deferred to a later,
> deliberate step. The `--public` commands below are the future path; this pass used
> `--private`. Before flipping to public, complete
> [PUBLIC_REPO_PRIVACY_CHECKLIST.md](../privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md)
> (including the pre-existing-notes warnings) and add a `LICENSE`.

> **Privacy gate first.** Never run the commit/push steps until
> [PUBLIC_REPO_PRIVACY_CHECKLIST.md](../privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md)
> passes and `npm run check` is green.

## 0. Preconditions

```bash
node -v                 # ≥ 22.6
gh --version            # GitHub CLI present
gh auth status          # must show: Logged in to github.com account ishaan-bit
npm run check           # typecheck + tests green
```

## 1. Initialize git (local)

```bash
cd /path/to/humai
git init
git branch -M main
git add -A
git status --short      # review EVERYTHING staged
```

## 2. Privacy scan (BLOCK on any hit)

```bash
# No source binaries / weights / audio tracked:
git ls-files | grep -E '\.(pdf|docx|doc|pptx|wav|mp3|m4a|flac|ogg|webm|opus|ckpt|pt|pth|onnx|safetensors|h5|gguf|bin)$'
# No .env (other than .env.example):
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'
# No secrets / vercel metadata:
git ls-files | grep -E 'serviceAccount|firebase-adminsdk|gcp-.*\.json|\.vercel/'
# No clinical labels:
git ls-files | grep -Ei 'phq|gad|clinical_labels'
# Source binaries confirmed ignored (should list nothing):
git ls-files docs/source/ | grep -Ei '\.(pdf|docx)$'
```

Every command above must print **nothing**. If any prints a path, stop and remove it
(`git rm --cached <path>`), fix `.gitignore`, and re-scan.

## 3. Commit

```bash
git commit -m "chore: bootstrap Hum AI foundation"
```

## 4a. Create + push — gh authenticated (automated path)

```bash
# Create the PUBLIC repo under ishaan-bit and push main, setting origin.
gh repo create ishaan-bit/hum-ai \
  --public \
  --source=. \
  --remote=origin \
  --description "Hum AI — domain-aware, personalized, voice-first affective modeling around a standardized 12-second hum (non-clinical, research-stage)." \
  --push
```

If the repo **already exists**, do **not** force-push. Link the remote only if it is
safe and points at the intended repo:

```bash
git remote add origin https://github.com/ishaan-bit/hum-ai.git   # if no origin yet
git remote -v                                                     # verify it is the intended repo
git push -u origin main                                           # only if histories are compatible (no overwrite)
```

If histories diverge or the existing repo has content you do not recognize, **stop**
and resolve manually — never `--force`.

## 4b. Create + push — gh NOT authenticated (manual fallback)

1. Create the repo in the browser: https://github.com/new → owner `ishaan-bit`,
   name `hum-ai`, **Public**, do **not** initialize with README/license/.gitignore
   (this repo already has them).
2. Then:

```bash
git remote add origin https://github.com/ishaan-bit/hum-ai.git
git push -u origin main
```

(Authenticate when prompted, or run `gh auth login` first.)

## 5. Post-push

- Apply branch protection — see [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md).
- Confirm Actions ran: `gh run list` (CI + privacy-check).
- Keep the repo private until the **"before flipping to public"** checklist passes.

---

## Bootstrap log

_Filled in by the automated pass:_

- **gh auth:** _(see FINAL_STATUS.md)_
- **git init / branch / commit:** _(see FINAL_STATUS.md)_
- **Privacy scan result:** _(see VALIDATION_REPORT.md)_
- **Repo created / linked:** _(see FINAL_STATUS.md)_
- **Push result:** _(see FINAL_STATUS.md)_
