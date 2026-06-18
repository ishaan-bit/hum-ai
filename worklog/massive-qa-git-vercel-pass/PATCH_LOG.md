# Patch Log — Massive QA / Git / Vercel Pass

Chronological record of every change. Build kept green throughout (validated after each code module and after the hardening patches).

## New code (Lane B)

| # | File | Change |
| --- | --- | --- |
| 1 | `packages/shared-types/src/privacy.ts` | Added consent scope `clinical_risk_surfacing` (default consent unchanged → withheld by default). |
| 2 | `packages/affect-model-contracts/src/two-head.ts` | **New.** Two-head split, consent gate, `RecommendationView`, `assertNoClinicalLeak`/`ClinicalLeakError`. |
| 3 | `packages/affect-model-contracts/src/index.ts` | Export `./two-head`. |
| 4 | `packages/affect-model-contracts/test/two-head.test.ts` | **New.** 6 tests. |
| 5 | `packages/intervention-engine/src/index.ts` | Refactor: engine consumes sanitized `RecommendationView` via `toRecommendationView`; added `selectInterventionFromView`. No raw clinical labels read. Existing tests unchanged + passing. |
| 6 | `packages/personalization-engine/src/dual-baseline.ts` | **New.** Rolling + anchored baselines, `baselineDivergence`, `updateAnchoredCenter`. |
| 7 | `packages/personalization-engine/src/index.ts` | Export `./dual-baseline`. |
| 8 | `packages/personalization-engine/src/profile.ts` | Added optional `anchored_baseline_vector` (defaults `{}`); doc'd rolling vs anchored. Non-breaking. |
| 9 | `packages/personalization-engine/test/dual-baseline.test.ts` | **New.** 7 tests. |
| 10 | `packages/safety-language/src/confidence-language.ts` | **New.** `userFacingConfidence` + evidence-level helpers + `isConfidenceCopySafe`. |
| 11 | `packages/safety-language/src/index.ts` | Export `./confidence-language`. |
| 12 | `packages/safety-language/test/confidence-language.test.ts` | **New.** 7 tests. |

## Hardening patches (from adversarial audit)

| # | File | Change | Source finding |
| --- | --- | --- | --- |
| H1 | `packages/safety-language/src/labels.ts` | `userFacingLabel` now consults `isInternalOnly` → internal-only labels never surface, even as placeholder copy. | clinical-leak warning |
| H2 | `.github/workflows/privacy-check.yml` (gate 3) | Anchored credential-name match to `.json` (no false-positive on `serviceAccountHelper.ts`). | ci-workflow warning |
| H3 | `.github/workflows/privacy-check.yml` (gate 7) | Boundary-anchored portable ERE; skips `gadget.json`, catches `phq9.csv`/`clinical_labels.parquet`. | ci-workflow warning |
| H4 | `packages/expert-fer/src/index.ts` | Clarifying comment: the `available:true` branch is a synthetic fusion-path exercise, not FER inference. | voice-first nit |

## Docs / decisions

| File | Change |
| --- | --- |
| `docs/adr/0006-…`, `0007-…`, `0008-…`, `0009-…` | **New** ADRs (Accepted). |
| `docs/architecture/VOICE_FIRST_ROADMAP.md` | **New.** |
| `docs/source/README.md` | **New** — private-materials policy. |
| `docs/privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md` | **New.** |
| `docs/devops/GITHUB_BOOTSTRAP.md`, `BRANCH_PROTECTION.md`, `VERCEL_SETUP.md`, `DEPLOYMENT.md`, `ENVIRONMENT_VARIABLES.md` | **New.** |
| `SECURITY.md`, `CONTRIBUTING.md` | **New.** |
| `.gitignore` | Rewritten — privacy gates (source binaries, datasets, audio, weights, secrets, `.vercel`, `.claude` local). |
| `.env.example` | **New** — `HUM_AI_`-prefixed template. |
| `apps/web/index.html` | **New** — static preview placeholder (no product UI). |
| `README.md` | Fixed duplicate "Next steps" bullet (#4); refreshed docs index (ADR-0006..0009, roadmap, devops, privacy checklist). |
| `.github/workflows/ci.yml`, `privacy-check.yml` | **New** (Lane F). |
| `worklog/massive-qa-git-vercel-pass/*` | **New** — this report set. |

## Repo hygiene

- Untracked `.claude/scheduled_tasks.lock` (and ignored `.claude/settings.local.json`) — local tool config kept out of the repo.

## Deferred / flagged (NOT changed this pass)

These are in **pre-existing internal note packs** (`parallel-agent-review/`, `parallel-research-pass/`, prior `worklog/plan-build-validate/`), not shipped product code. Repo is **private**, so non-blocking; listed in the public-repo checklist for action **before** any public flip:

- Absolute path `c:\Users\Kafka\…` leaks the Windows username in two prior notes.
- `docs/source/INDEX.md` names "Prof. Arvind Sahay" + private-draft framing.
- "Hum v2" (banned name) used throughout the old note packs; one stale script references dead `packages/@hum/…` paths.

No tests were weakened or skipped at any point.
