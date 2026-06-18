# Parallel Agent Pass — Worklog

State at completion: foundation + orchestrator wired and green. `npm test` **163/163**,
typecheck clean, `npm run qa` clean, privacy scan clean, naming check clean. Merged to
local `main` (8 commits ahead of `origin/main`); **not pushed** pending review. Repo stays
private. No LICENSE added.

## What changed (by lane)

### Lane A — End-to-end orchestrator (merge-captain lane)
New package `@hum-ai/orchestrator` composing the full read path over DERIVED features only:
`audio-features → quality-gate → domain-classifier → expert-ser → fusion-engine →
personalization (dual baseline) → relapse-engine → intervention-engine → safety-language`.

Enforces the three closed decisions at the seams:
- **Two-head separation (ADR-0006):** `splitInference(inf, consent)` at the output boundary;
  only `toRecommendationView(inf)` reaches the intervention engine; `assertNoClinicalLeak`
  guards both the recommendation view and the user-facing object. The relapse `riskScore` is
  collapsed from the clinical head **in the orchestrator** (`clinicalRiskScore`), so the
  relapse engine receives only an opaque scalar — never raw labels.
- **Dual baseline (ADR-0007):** `buildDualBaseline` from eligible-hum features; `baselineDivergence`
  informs both the `relapse_drift` head and `longitudinalTrendStrength` (which tempers fusion
  confidence). Divergence is `undefined` (not zero-faked) until the anchor is active.
- **Qualitative confidence (ADR-0008):** `userFacingConfidence` only; every user-facing string is
  screened with `validateUserFacingText` + `isConfidenceCopySafe`. No raw number is ever exposed.
- **Voice-first (ADR-0009):** audio-derived features only; raw audio never enters the orchestrator.

Output is split into `userFacing` (safe to render), `recommendationView` (exactly what the engine
saw), and `internal` (full inference + consent-gated clinical head, never for UI). Clinical-risk
surfacing stays consent-gated; **recommendations work without consent**.

Files: `packages/orchestrator/{package.json, src/{index,orchestrator,risk,copy}.ts,
test/{fixtures,orchestrator.test}.ts}`; `tsconfig.json` path entry. **+9 tests.**

### Lane C — Adversarial QA / privacy / clinical-leak / voice-first gates
New package `@hum-ai/qa-gates` — pure-Node, cross-platform (Windows + CI) checks, runnable via
`npm run qa`:
1. `no-clinical-leak` — `toRecommendationView` + `assertNoClinicalLeak` over the real projection.
2. `no-camera-deps` — denylist scan of every `package.json` dep map; FER stays a placeholder (ADR-0009).
3. `no-raw-confidence-copy` — sweeps `userFacingConfidence` through `isConfidenceCopySafe`.
4. `forbidden-files` — Node port of `privacy-check.yml` (binaries/audio/weights/.env/creds/.vercel/
   keys/dataset dirs/clinical-label data), same careful anchoring (zero false positives verified).
Files: `packages/qa-gates/**`; root `qa`/`qa:all` scripts; `tsconfig.json` path. **+17 tests.**

### Lane B — Dataset harness (local-only ingestion scaffold)
New package `@hum-ai/dataset-harness`: data-dir convention (`HUM_DATA_DIR`, default `../hum-ai-data`),
RAVDESS filename parser, manifest builder that **refuses to write inside the repo** (`assertOutsideRepo`),
graceful validation CLI. No data, audio, or manifests are tracked. Files: `packages/dataset-harness/**`,
`docs/research-datasets.md`, `.gitignore` (+`data/`,`raw_data/`,`processed_data/`,`features/`,`models/`,
`hum-ai-data/`,`**/.manifests/`,`*.manifest.json`), `.env.example` (`HUM_DATA_DIR=`), root `data:*`
scripts. **+28 tests.**

### Lane D — Web preview + Vercel readiness
`apps/web/index.html` rewritten into a structured, honest preview placeholder (voice ritual, voice-first
modeling, local-first privacy, research-stage, explicit "what it is not": no diagnosis, not clinically
validated, not a medical device, not FDA-cleared, not deployed). Pure static HTML/CSS — no deps, no build,
no `.vercel/`, no `vercel.json`. `VERCEL_SETUP.md` reviewed, already accurate (left unchanged). No smoke
test added (no existing web test harness to extend).

## Validation (from merged `main`)
- `npm run typecheck` — clean
- `npm test` — **163 pass / 0 fail / 0 skipped** (109 baseline + 9 A + 28 B + 17 C; no existing test weakened)
- `npm run qa` — 4/4 gates pass
- privacy-check.yml bash scan — PASS (no forbidden content tracked)
- `checkNaming` — 0 violations

## Merge order used
`C → B → A → D` (as recommended). Conflicts were trivial and additive:
- `package.json` scripts (C `qa`/`qa:all` ∪ B `data:*`) — union.
- `tsconfig.json` paths (A `orchestrator`, B `dataset-harness`, C `qa-gates`) — union.
Lanes C and D merged with no conflicts.

## Risks / caveats
- `@hum-ai/orchestrator` is the integration layer over **stub** experts/extractor; numbers are
  deterministic placeholders, not trained-model outputs. The seams (consent gate, sanitization,
  qualitative confidence) are the durable part.
- Dataset harness wires **RAVDESS** parsing only; other corpora scan files but record `emotion: unknown`.
- `npm run qa` is not yet wired into CI (left to a deliberate follow-up). Suggested: add
  `run: npm ci && npm run qa` to `.github/workflows/ci.yml` or a sibling job.
- Merged lane branches `lane-{a,b,c,d}-*` are retained locally (fully merged; safe to delete).

## Not done (out of scope / deferred)
- No push to `origin` (awaiting review).
- Public-flip carry-over from the prior NEXT_PROMPT (path/username scrub, LICENSE, history review) untouched.
- CI wiring of `qa` (above).
