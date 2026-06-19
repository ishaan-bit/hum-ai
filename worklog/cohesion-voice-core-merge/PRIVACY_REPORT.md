# Privacy Report

Public-repo privacy posture of the merged `cohesion/voice-core-merge` tree.

## Tracked-file sweep — PASS

`git ls-files` filtered for forbidden patterns returns **only `.env.example`**
(the safe template). None of the following are tracked:

- Source documents: `docs/source/*.pdf`, `docs/source/*.docx` — **git-ignored**
  (only `docs/source/INDEX.md` and `README.md` are tracked).
- Secrets / env: `.env`, `.env.*` (except `.env.example`), credential / service-account
  JSON, private keys.
- Deploy: `.vercel/`.
- Data: `datasets/`, `data/`, raw audio, `recordings/`, audio files
  (`.wav/.mp3/.m4a/.flac/.ogg`).
- Models: weights (`.pt/.pth/.onnx/.safetensors/.bin/.h5/.ckpt/.tflite`).
- Clinical: PHQ/GAD / user clinical-label payloads.

## Gate-enforced — PASS

`npm run qa` `forbidden-files` gate (a Node port of `.github/workflows/privacy-check.yml`)
is green. CI runs the same gate on push/PR to `main`, and `privacy-check.yml` provides
a bash mirror. Synthetic test audio is generated in code (`audio-features/synth.ts`),
never committed as files.

## Diff added nothing unsafe

The overnight merge added only `.ts` / `.md` / lockfile content. No binaries, no
source docs, no secrets, no datasets. Tracked file count 217 → 244 (text only).

## Verdict

**Privacy scan PASSED.** Repo is public-safe; no remediation needed.
