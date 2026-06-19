# Cohesion Plan — Voice-Core Merge

**Branch:** `cohesion/voice-core-merge` (forked from `main` @ `5d6f421`)
**Goal:** Merge `overnight/voice-core-implementation` (`387fe9e`) into the
already-pushed public-safe foundation, validate everything, fix cohesion gaps,
prepare a clean release state. Do **not** touch `main` directly; do **not** push
`main`; do **not** force push; do **not** deploy.

## What `main` currently contains

- Monorepo foundation: 19 `@hum-ai/*` workspace packages (`packages/*`) plus
  `apps/{web,mobile,ops}`.
- Architecture closed via ADRs 0000–0009 (`docs/adr/`), incl. ADR-0009
  voice-first / camera-later.
- QA gates (`@hum-ai/qa-gates`, `npm run qa`): `no-clinical-leak`,
  `no-camera-deps`, `no-raw-confidence-copy`, `forbidden-files`.
- GitHub CI wired to run the QA gates (`.github/`).
- Privacy hygiene: `docs/source/*.pdf|*.docx` are git-ignored (only `INDEX.md` /
  `README.md` tracked there); only `.env.example` tracked; 217 tracked files.
- Green on `npm test` (baseline 163), `npm run typecheck`, `npm run qa`, privacy.

## What the overnight branch adds (`387fe9e`)

Deterministic, pure-TypeScript DSP voice core behind the existing contracts —
**no ML, no heavy DSP libs, no camera, no fake inference, no clinical claims.**

- **`@hum-ai/audio-features`**: `HumDspExtractor` / `computeFeatures`
  (`src/hum-extractor.ts`, `src/dsp/{fft,params,pitch,signal,spectral}.ts`),
  deterministic synthetic signal generators (`src/synth.ts`).
  `NotImplementedExtractor` retained. New exports in `src/index.ts`.
- **`@hum-ai/quality-gate`**: real extractor wired through `metricsFromFeatures`;
  legacy thresholds unchanged; `threshold-sync` test pins shared constants.
- **`@hum-ai/domain-classifier`**: graded, margin-aware heuristics over real
  features (still a transparent hum-vs-not-hum guard).
- **`@hum-ai/orchestrator`**: `orchestrateHumAudio(buffer)` entry;
  `buildHumSyncPayload` runs `assertNoRawAudioFields` + `assertNoClinicalLeak`.
- **`apps/web`**: safe Node demo (`npm run demo:voice`); no mic, no camera.
- **Docs**: VOICE_FIRST_ROADMAP patched; DEPENDENCY_POLICY, audio-features,
  orchestrator docs added.
- **package.json**: adds `demo:voice` script. **package-lock.json**: internal
  `@hum-ai/*` workspace links only — no external deps.
- Tests: +39 (163 → 202).

## Merge risk areas

| Area | Risk | Assessment |
| --- | --- | --- |
| File overlap with `main`'s extra commit | **None** | `main` advanced by exactly one commit (`5d6f421`) adding only `worklog/pre-push-gate/FINAL_STATUS.md`; `comm -12` over the two change sets is empty. |
| New external/ML/camera deps | **None** | `package-lock.json` diff is internal workspace links only. |
| New binaries / source docs / secrets | **None** | Diff is `.ts` / `.md` / lockfile only. |
| Naming drift (`@hum` vs `@hum-ai`) | Low | Verify post-merge with naming-check / grep. |
| Doc accuracy (DSP is deterministic, not ML) | Low | Patch in Phase 4C if any doc overclaims. |

## Files likely to conflict

**None expected.** Merge base `4c03609`; the only `main`-side change since fork
(`worklog/pre-push-gate/FINAL_STATUS.md`) is untouched by the overnight branch,
so a 3-way merge keeps it. If `git diff main` shows that file as a "deletion" it
is only because the overnight branch predates it — the merge preserves it.

## Validation plan (Phase 5)

1. `npm install` (lockfile-consistent; no heavy deps expected).
2. `npm run typecheck` — expect clean.
3. `npm test` — expect 202 (163 baseline + 39).
4. `npm run qa` — expect 4 gates green.
5. `npm run demo:voice` — expect end-to-end safe reads.
6. Privacy: `git ls-files` forbidden-pattern sweep + `forbidden-files` gate.
7. `git status --short` — clean.

Fix the smallest correct thing on any failure; never weaken tests or bypass
privacy/safety gates. Stop only on a true blocker (destructive op, unfixable
privacy/test/safety failure, diverged remote, missing overnight branch, or a
conflict needing a product decision).
