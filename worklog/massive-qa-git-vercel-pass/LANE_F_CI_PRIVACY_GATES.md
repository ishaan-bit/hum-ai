# Lane F — CI / Privacy Gates

Two GitHub Actions workflows created and audited. Both are valid YAML, correctly wired for this npm monorepo, and pass on the current clean tree.

## `.github/workflows/ci.yml` — job `build-and-test`

- Triggers: push + PR to `main`; concurrency-cancels superseded runs.
- `actions/checkout@v4` → `actions/setup-node@v4` with `node-version-file: .nvmrc` (22.20.0) + `cache: npm`.
- **Detected package manager: npm** (`package-lock.json` present) → `npm ci` (installs dev-deps only: `tsx`, `typescript`, `@types/node` — **no heavy ML deps**).
- `npm run typecheck --if-present` · `npm test --if-present` · `npm run build --if-present` (build is a no-op until a build script exists).

## `.github/workflows/privacy-check.yml` — job `privacy-check`

Bash scan over `git ls-files` (tracked files only — ignored files can't leak). Fails the build on any hit, with `::error::` annotations. Eight gates:

1. Source docs / model weights / audio binaries (pdf, docx, doc, pptx, wav, mp3, m4a, flac, ogg, aac, webm, opus, ckpt, pt, pth, onnx, safetensors, h5, pb, tflite, gguf, bin)
2. `.env` (allows only `.env.example`)
3. Service-account / cloud-credential JSON (anchored to `.json`)
4. Vercel local metadata (`.vercel`)
5. Private keys / tokens (`.pem`, `.key`, `.p12`, `.pfx`, `*.token`)
6. Dataset / raw-recording dirs (`datasets/`, `recordings/`, `raw_audio/`)
7. Clinical-label / PHQ-GAD data files (boundary-anchored)
8. Explicit: `docs/source/*.{pdf,docx,doc,pptx}` must never be tracked

## Audit findings (acted on)

The CI auditor verified **all 8 regexes match zero tracked files today** (no false-positive blocks the current build), and the two job names exactly match the required status checks in `docs/devops/BRANCH_PROTECTION.md`. It flagged two over-broad regexes for latent false-positive risk on **future** filenames; both were **hardened this pass** (see PATCH_LOG #5):

- **Gate 3 (creds):** restricted the credential-name alternatives to `.json` so legit code/docs like `serviceAccountHelper.ts` / `service-account-setup.md` don't false-positive.
- **Gate 7 (clinical):** rewritten as a portable boundary-anchored ERE (no PCRE dependency) so `gadget.json` / `badge.csv` are skipped while `phq9.csv`, `gad-7.csv`, `clinical_labels.parquet`, `phq.csv`, `ces-dc.csv` still trip. Verified against positive + false-positive fixtures.

A nit (extension-only `.key`/`.bin`/`.pt` breadth) was left as-is: for a privacy gate, erring toward blocking unknown binaries is the intended fail-closed direction.

## ⚠️ Runtime status: Actions can't start on this private repo (owner action)

Both workflows are valid and registered `active`, but **no run ever starts** —
every push yields a generic `startup_failure` (`path: BuildFailed`, 0s, no jobs).
An **isolation test** (a trivial `name: hello / run: echo hello` workflow) failed
**identically**, proving the workflow files are not the cause. Repo-level Actions are
`enabled: true, allowed_actions: all`. This is the account-level **Actions
billing / spending-limit** symptom for **private** repos.

**Resolution (owner):** set an Actions spending limit / add a payment method at
github.com/settings/billing, **or** make the repo public (Actions free for public
repos). The workflows will then run unchanged. Validated locally instead this pass:
`npm run check` green; privacy `git ls-files` scan clean on all 8 gates.

## Branch protection

`docs/devops/BRANCH_PROTECTION.md` documents requiring `build-and-test` + `privacy-check` as status checks, blocking force-push/deletion. Applied **after** the first push (the check contexts must exist first); UI + `gh api` procedures both provided.
