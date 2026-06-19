# Cohesion Fixes

Post-merge cohesion audit against the Phase 4 checklist. Most items were already
coherent in the merged tree (the overnight branch was self-consistent); the only
code/doc change required was the root README, which the overnight diff did not touch.

## A. Package / workspace cohesion — PASS (no change)

- `workspaces`: `packages/*`, `apps/*` globs — every package included automatically.
- `tsconfig.json` `paths`: includes all 19 packages, incl. the voice-core ones
  (`audio-features`, `orchestrator`, `domain-classifier`, `quality-gate`).
- Package scopes: all `@hum-ai/*` (22 manifests); root is `hum-ai`. No duplicates.
  No `@hum/` (legacy scope) in any shipped `package.json` (enforced by naming-check).
- `index.ts` exports: `audio-features` cleanly re-exports `hum-extractor`, `synth`,
  `DSP_PARAMS`, and FFT utils; `NotImplementedExtractor` still exported. No broken exports.
- npm scripts present: `test`, `typecheck`, `qa`, `check`, `qa:all`, **`demo:voice`**.
- CI (`.github/workflows/ci.yml`) runs `npm ci` → `typecheck` → `test` → **`npm run qa`**
  → `build --if-present`. Installs dev-deps only; needs **no local data/audio** (tests
  use in-code synthetic signals). `privacy-check.yml` mirrors the forbidden-files gate.

## B. Voice-core cohesion — PASS (no change)

- `@hum-ai/audio-features`: `HumDspExtractor` / `computeFeatures` exported as the real
  deterministic DSP path. `NotImplementedExtractor` retained but not on the default
  path. `synth.ts` generators are deterministic, in-code (no audio files). No heavy
  DSP/ML deps added (`package-lock.json` diff is internal workspace links only).
- `@hum-ai/quality-gate`: real extractor wired via `metricsFromFeatures`; legacy
  thresholds unchanged; `threshold-sync` test pins `DSP_PARAMS` ↔ `HUM_THRESHOLDS`;
  silence/faint/interrupted/clipped/poor-voicing covered (`extractor-integration`,
  `hum-extractor` tests).
- `@hum-ai/domain-classifier`: graded, margin-aware heuristics over real features;
  transparent hum-vs-not-hum guard — no faked ML certainty.
- `@hum-ai/orchestrator`: `orchestrateHumAudio(buffer)` exists and is tested
  (`audio-path.test.ts`). Output separates `userFacing` / `recommendationView` /
  `internal`. `assertNoClinicalLeak` guards both the recommendation view and the
  user-facing object; `assertNoRawAudioFields` + `assertNoClinicalLeak` run inside
  `buildHumSyncPayload` **before** the payload is returned. Confidence caps combined
  via `combineCaps` (stage ∧ quality ∧ domain). Relapse stage-gated (inactive before
  20 eligible hums). User-facing confidence is qualitative (`userFacingConfidence`);
  every user string passes `assertSafeUserFacingText` + `isConfidenceCopySafe`.

## C. Architecture / docs cohesion — PATCHED (README only)

- `docs/architecture/VOICE_FIRST_ROADMAP.md`: Phase 1 (current) already documents the
  real deterministic DSP extractor as "honest signal processing, not a trained or
  clinically validated model." Accurate — no change.
- `docs/packages/audio-features.md`, `docs/packages/orchestrator.md`: accurate; honesty
  grep found no overclaiming phrases. No change.
- `docs/devops/DEPENDENCY_POLICY.md`: heavy ML/DSP libs remain future/Phase-2-only and
  partly QA-enforced; honesty clause present. No change.
- `docs/devops/VERCEL_SETUP.md`: states `apps/web` is a preview placeholder, "no
  production deployment is performed or implied." Accurate — no change.
- **`README.md` — PATCHED** (overnight diff did not touch it; it was stale):
  1. `audio-features` table row now lists the real `HumDspExtractor`/`computeFeatures`
     deterministic DSP pipeline (was only `NotImplementedExtractor`).
  2. Status section reworded: voice core is real deterministic DSP (**not trained, not
     clinically validated**); downstream affect/embedding experts remain heuristic
     stubs; no models trained. Links the voice-first roadmap.
  3. Quickstart adds `npm run qa` and `npm run demo:voice`.
  4. Next-step 5 updated: the orchestrator + audio entry point are already wired; the
     remaining work is a real browser audio capture surface (no camera).

## D. Public-repo privacy — PASS (no change)

- `git ls-files` forbidden-pattern sweep on the merged tree: only `.env.example` tracked.
- `docs/source/*.pdf|*.docx` git-ignored (only `INDEX.md`/`README.md` tracked there).
- No datasets/raw-audio/recordings/weights/credentials/.vercel/.env tracked.

## E. No camera implementation — PASS (no change)

- No camera/CV/face dependency in any tracked `package.json`.
- No `getUserMedia`/`navigator.mediaDevices`/video capture in any source.
- `@hum-ai/expert-fer` `FaceEmotionExpert` is a missing-modality stub (no visual
  inference; explicitly documents "no camera/FER model exists this pass").
- Camera appears only in roadmap/ADR-0009 language and in the `no-camera-deps` gate
  that forbids it. The `demo:voice` and `apps/web` copy explicitly say "no camera."

## Flagged (pre-existing on main, out of scope for this merge)

- Tracked scratch note-packs `parallel-agent-review/`, `parallel-research-pass/`,
  `research/`-adjacent notes contain the banned name "Hum v2" and stale `packages/@hum/…`
  paths. These are pre-ADR-0000 internal scratch, **not** shipped product surfaces, and
  were already flagged-as-deferred by `worklog/massive-qa-git-vercel-pass`. The
  naming-check gate (which scans `packages/*` manifests) is unaffected and green.
  Left untouched here to keep this pass scoped to the voice-core merge; recorded in
  NEXT_PROMPT.md as a candidate cleanup/archive.
