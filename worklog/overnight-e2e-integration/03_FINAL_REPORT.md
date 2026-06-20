# HumAI Overnight End-to-End Integration — FINAL REPORT

**Date:** 2026-06-20 · **Model:** Opus, maximum reasoning effort

## 1. Branch / worktree
`overnight-e2e-integration`, branched off `end-to-end-spine-wiring` (carrying that
branch's uncommitted spine-wiring WIP forward). Worked **in-place** rather than a fresh git
worktree, on purpose: a fresh worktree would lack `node_modules` (heavy monorepo install) and
the git-ignored `data/processed/signal-lab/model.json`, forcing fallback-only and discarding
the WIP. The active training run is a separate **Python** process (`python.exe`, ~775 MB)
writing only to git-ignored `data/.../neural/`; this pass touches only TypeScript source, runs
`tsc --noEmit` (no build artifacts) and tmpdir-only tests, and treats `data/` as read-only — so
it cannot disturb training. Nothing was committed (no commit was requested).

## 2. Source docs / files used
ADRs 0001–0009; `docs/architecture/*`; `docs/claims/CLAIMS_LADDER.md`;
`docs/validation/VALIDATION_PLAN.md`; `docs/packages/{orchestrator,audio-features}.md`;
`parallel-agent-review/*`; `parallel-research-pass/*`; `research/training/NEURAL_HARNESS.md`;
`data/processed/signal-lab/{MODEL_CARD.md,MODEL_READINESS_REPORT.md,model_manifest.json,
MULTIDATASET_EXPERIMENT.md}`; and the code contracts in `@hum-ai/{orchestrator, signal-lab,
fusion-engine, affect-model-contracts, personalization-engine, relapse-engine,
intervention-engine, safety-language, shared-types, audio-features, quality-gate,
domain-classifier, expert-ser}`. Full map: `01_SOURCE_MAP.md`; audit: `02_GAP_AUDIT.md`.

## 3. What the repo already had
A fully wired spine. `orchestrateHumRead`/`orchestrateHumAudio` already compose every stage —
features → quality → domain → experts(+optional learned affect prior) → fusion(+caps) →
personalization → relapse + `assessLongitudinalState` → intervention → safety — and the
signal-lab runtime bridge already provided a single clean new-hum path. Two-head separation,
the 88% clinical cap, qualitative-only confidence, raw-audio guard, and the 4 qa gates were all
in place. Baseline at session start: typecheck ✓, **339 tests** ✓, qa 4/4 ✓.

## 4. What was missing or disconnected
**One genuine, repo-supported gap:** the full-spine runtime bridge was **not manifest-aware**.
The repo's *other* inference path, `inferFromHum` (`signal-lab/src/inference.ts`), already reads
`model_manifest.json` into an honest `InferencePromotion` and surfaces a promoted feature-space
NEURAL model as an auxiliary prior. The bridge (`runtime-bridge.ts`) loaded `model.json`
**blind** — no manifest, no gate status, no neural-aux. So the full-spine read could not state
that the fused 6-class affect prior **failed the 80% promotion gate** (it is a kept population
prior, manifest `passedGate=false`, 47.9%). The manifest readers existed but were **private** to
`cli.ts`, so the bridge could not reuse them. (Historical `parallel-agent-review` FAILs —
safety-language, 88% cap, dataset-registry, two-head, domain penalties, min-consecutive relapse,
missing-modality fusion — were spot-checked and are all already RESOLVED; see `02_GAP_AUDIT.md`.)

## 5. What was implemented (only the missing wiring)
- **`packages/signal-lab/src/manifest.ts` (new):** reusable readers extracted from `cli.ts` —
  `loadPromotionManifest`, `loadNeuralAuxModel`, `notEvaluatedPromotion`, with `baseDir`
  scoping so reads co-locate with the model artifact. `cli.ts` and `inference.ts` now consume
  them (DRY; behavior identical).
- **`runtime-bridge.ts` (manifest-aware):** `loadLearnedAffectPrior` now also reads the model's
  co-located `model_manifest.json` (honest `promotion` + `gatePassed`/`gateNote`) and any
  promoted feature-space NEURAL artifact (`neuralAux`). `orchestrateHumWithLearnedPrior` returns
  `promotion` and a transparency-only `neuralAuxiliary` (computed from the spine's own derived
  features, **never** fused).
- **`orchestrator.ts` (decoupled honesty metadata):** `LearnedAffectPrior` gained optional
  `gatePassed?`/`gateNote?`; `ModelProvenance` gained `gatePassed`/`gateNote` (`null` when
  unknown / heuristic). The orchestrator still never imports signal-lab — only data crosses the
  seam.
- **`full-spine-demo.ts`:** prints promotion-gate status and any neural-aux line.

No thresholds/labels/architecture invented; no dependency added; no GPU; no runtime dependence
on training.

## 6. How the new-hum end-to-end path now works
```
orchestrateHumWithLearnedPrior({ audio|features, consent, modelVersion, now, history })
  └─ loadLearnedAffectPrior()  → model.json (or null → honest heuristic fallback)
        + co-located model_manifest.json → InferencePromotion (gatePassed/gateNote)
        + co-located neural/model.neural.*.json → promoted NEURAL aux (if present)
  └─ orchestrateHumAudio/Read({ …, learnedAffectPrior })
        computeFeatures → quality-gate → domain-classifier
        → experts: heuristic ensemble with the trained prior dropped into the
          speech-emotion slot (pretrained/model inference)
        → fusion (+caps incl. 0.45 far-domain prior penalty; strictest wins)
        → personalization (dual-baseline re-reference)
        → relapse + assessLongitudinalState (88% clinical hard cap)
        → intervention (sanitized RecommendationView only)
        → safety-language screen → stable UserFacingRead + sync-safe payload
  └─ result = { read, priorUsed, provenance, promotion, neuralAuxiliary }
        neuralAuxiliary computed from the read's derived features — transparency only,
        NEVER fused into the affect head/confidence/intervention.
```

## 7. Which model artifacts are used vs fall back
- **Affect read (fused):** `data/processed/signal-lab/model.json` — 6-class logreg affect prior,
  RAVDESS acted speech, far-domain penalty 0.45. Manifest `passedGate=false` (47.9%) → kept as a
  penalized **population prior**, reported honestly via `gatePassed=false`. Absent ⇒ heuristic
  ensemble (`priorUsed=false`).
- **Promotion status:** `model_manifest.json` (read-only). Absent ⇒ `promotion.evaluated=false`,
  `gatePassed=null` (no false validation claim).
- **Neural aux:** `neural/model.neural.{arousal,valence}_binary.json` via the pure-TS op-graph
  executor (`neural-feature-model.ts`, the intended NEURAL_HARNESS adapter boundary). Surfaced as
  transparency-only when a gate-passed artifact exists; absent/unfinished/unpromoted ⇒ `null`,
  classical+heuristic path unchanged. The gate-passed `arousal_binary` axis is, per the manifest's
  own instruction, **never** wired to steer the affect/intervention read.

## 8. How personalization is connected
Unchanged and already wired: orchestrator step "6b" re-references the fused read against the
user's own rolling baseline (`applyPersonalization`), λ=0 until `baselineActive`, growing up the
ladder. The bridge reads; the LEARN loop (`ingestHum`) stays caller-driven by design.

## 9. How longitudinal / adaptive state is connected
Unchanged and already wired: step "8b" `assessLongitudinalState` synthesizes trend / risk
hypothesis / relapse-drift+recovery (≤88%) / monitoring flag / provenance, consuming signature
alignments; min-3-consecutive-drift rule threaded via `priorConsecutiveDriftHums`. Internal-only.

## 10. How diagnostic / medical hypotheses are handled
Per ADR-0006 + `claims.ts`: `isDiagnostic:false`, consent-gated, hard-capped at
`CLINICAL_RISK_CONFIDENCE_CAP=0.88` regardless of maturity, abstains (`insufficient_data`) until
the personal baseline is active. Lives only in `InternalRead.longitudinal`; never rendered/synced.
This pass changed nothing here — the new gate-status metadata is non-clinical and internal.

## 11. How safety / claim boundaries are enforced
Unchanged: `assertSafeUserFacingText` + `isConfidenceCopySafe` screen every user string;
`assertNoClinicalLeak` guards the recommendation view + user-facing output;
`assertNoRawAudioFields` guards the sync payload. The new `gateNote`/`gatePassed` live in the
internal, never-synced `modelProvenance` (no clinical or raw-audio token; verified by
`audio-path.test` key-scan + new tests). qa `no-clinical-leak`/`no-raw-confidence-copy` pass.

## 12. How intervention is selected
Unchanged: `selectInterventionFromView` over the sanitized `RecommendationView`; escalation
double-gated on persistent-risk-pattern AND `clinical_risk_surfacing` consent; never on an
abstained read. The neural aux cannot reach it (it is never fused).

## 13. Files changed
- New: `packages/signal-lab/src/manifest.ts`,
  `packages/signal-lab/test/runtime-bridge-manifest.test.ts`,
  `worklog/overnight-e2e-integration/{01_SOURCE_MAP,02_GAP_AUDIT,03_FINAL_REPORT}.md`.
- Modified: `packages/signal-lab/src/{runtime-bridge,cli,inference,index}.ts`;
  `packages/orchestrator/src/orchestrator.ts`;
  `packages/orchestrator/test/learned-prior.test.ts`; `apps/web/demo/full-spine-demo.ts`.
- (Pre-existing WIP carried in from `end-to-end-spine-wiring`, also part of this branch:
  `runtime-bridge.ts`, `learned-prior.test.ts`, `runtime-bridge.test.ts`, the demo, and the
  `package.json` dep edits.)

## 14. Tests added
- `signal-lab/test/runtime-bridge-manifest.test.ts` (6): manifest → honest gate status;
  no-manifest → unknown (no false validation); full-spine read carries gate status + no clinical
  leak; not-evaluated promotion + null provenance; forced fallback honesty; promoted neural aux
  surfaced **but read byte-identical with/without it** (proves it never steers).
- `orchestrator/test/learned-prior.test.ts` (+1): manifest gate status flows into
  `ModelProvenance` without changing the inference; heuristic/ungated → null; no raw-audio key.

## 15. Final gate results
- `npm run typecheck` ✅
- `npm test` ✅ **346 pass / 0 fail** (339 baseline + 7 new)
- `npm run qa` ✅ 4/4 (no-clinical-leak, no-camera-deps, no-raw-confidence-copy, forbidden-files)
- `git ls-files data/` → **0**; no weights/audio/datasets/checkpoints/.env/keys/.vercel tracked.

## 16. What remains blocked / underspecified (reported, not invented)
- The fused affect model is a far-domain acted-speech PRIOR (47.9% 6-way) — never hum truth,
  never clinical; stays penalized + capped. Unchanged by this pass.
- Neural model is unfinished/unpromoted in this tree; the manifest-aware path keeps the honest
  fallback until a gate-passed feature-space artifact exists.
- Face/Text experts deferred by ADR-0009 (voice-first); enforced by `no-camera-deps`.
- Confidence/λ/τ/threshold constants are principled design defaults, NOT calibrated on native
  hums (per `VALIDATION_PLAN.md`); empirical calibration/abstention/within-user studies are future.
- The active **Python** neural training run produced `research/training/signal_neural/train.py`
  (modified) and `research/model-cards/signal-lab-neural-affect-prior-v0.md` (new) DURING this
  pass. These are the training run's own artifacts and were left **strictly untouched** (not read,
  staged, committed, or reverted).

## 17. Privacy / hygiene confirmation
No raw audio, datasets, feature matrices, neural tensors, weights/checkpoints, credentials, env
files, private keys, Firebase secrets, or `.vercel` were tracked or created. All model/manifest
reads are read-only against the git-ignored `data/` tree; all test artifacts go to the OS tmpdir,
never the repo. `git ls-files data/` = 0.
