# Public Repo Privacy Checklist

Hum AI **may become public**. This checklist is the gate that runs before every push
and before flipping the repo to public. CI enforces a subset
([`.github/workflows/privacy-check.yml`](../../.github/workflows/privacy-check.yml));
the rest is human judgment. **If any item fails, do not push.**

## Never-commit list

These must never be tracked or staged. Each is covered by `.gitignore` and most by CI:

- [ ] **Source materials** — `docs/source/*.pdf`, `*.docx`, `*.doc`, `*.pptx`
- [ ] **`.env` and secrets** — `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.token`
- [ ] **Firebase service-account JSON** — `*serviceAccount*.json`, `firebase-adminsdk*.json`, `gcp-*.json`
- [ ] **Vercel metadata/tokens** — `.vercel/`
- [ ] **Datasets** — `datasets/`, `data/raw/`
- [ ] **Raw audio / recordings** — `*.wav`, `*.mp3`, `*.m4a`, `*.flac`, `*.ogg`, `*.webm`, `**/recordings/`
- [ ] **Model weights / checkpoints** — `*.ckpt`, `*.pt`, `*.pth`, `*.onnx`, `*.safetensors`, `*.h5`, `*.gguf`, `*.bin`, `checkpoints/`
- [ ] **Clinical labels / user data** — `*phq*.csv`, `*gad*.csv`, `*clinical_labels*.csv`, `**/user-data/`
- [ ] **Notebook outputs** — `.ipynb_checkpoints/`, executed-notebook artifacts
- [ ] **Extraction scratch** — `.extract/`

## Pre-push procedure

Run from the repo root, in order. **Stop if any step fails.**

```bash
# 1. What is staged?
git status --short

# 2. Privacy scan — fails (non-empty output) if anything sensitive is tracked.
git ls-files | grep -E '\.(pdf|docx|doc|pptx|wav|mp3|m4a|flac|ogg|webm|opus|ckpt|pt|pth|onnx|safetensors|h5|gguf|bin)$' && echo "BLOCK: binary/source/weight tracked" || echo "ok: no binaries"
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' && echo "BLOCK: .env tracked" || echo "ok: no .env"
git ls-files | grep -E 'serviceAccount|firebase-adminsdk|gcp-.*\.json|\.vercel/' && echo "BLOCK: secret/vercel tracked" || echo "ok: no secrets"
git ls-files | grep -Ei 'phq|gad|clinical_labels' && echo "BLOCK: clinical labels tracked" || echo "ok: no clinical labels"

# 3. Confirm the source binaries are ignored (should print nothing tracked).
git ls-files docs/source/ | grep -Ei '\.(pdf|docx)$' && echo "BLOCK: source docs tracked" || echo "ok: source docs ignored"

# 4. Tests + typecheck green.
npm run check
```

A clean run prints only `ok:` lines and a green `npm run check`.

## Confirm `.gitignore` is effective

```bash
# These should report the files as ignored (git check-ignore exits 0 and echoes the path).
git check-ignore -v docs/source/*.pdf docs/source/*.docx 2>/dev/null
git check-ignore -v .env .vercel 2>/dev/null
```

If a sensitive file is **already tracked**, `.gitignore` will not retroactively remove
it — untrack it first: `git rm --cached <file>` (keeps the local copy), then commit.

## Before flipping the repo to public

- [ ] Full git history reviewed — no secret/binary was ever committed (history is public too).
      If one was: scrub with `git filter-repo` / BFG and rotate any exposed credential **before** going public.
- [ ] `INDEX.md` cites sources by `id`; no source binary is present in any commit.
- [ ] No internal clinical labels, user identifiers, or PHI anywhere in the tree or history.
- [ ] `SECURITY.md` reporting path is correct.
- [ ] README non-claims section intact (non-clinical, not validated, not a medical device).

## If a secret was exposed

1. **Rotate it immediately** (new Firebase key / Vercel token) — assume it is compromised.
2. Remove from the working tree and history (filter-repo/BFG), force-push to a private repo.
3. Only then consider making the repo public.
