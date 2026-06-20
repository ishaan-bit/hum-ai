# HumAI Spine — Gap Audit (Phase 2)

**Pass:** overnight end-to-end integration · **Branch:** `overnight-e2e-integration`
**Method:** specs (ADRs, architecture, claims, validation, model cards, manifests) vs. code,
cross-checked against `parallel-agent-review/` and `parallel-research-pass/`.

## Summary

The spine is **fully wired and green** (339 tests, 4 qa gates). Every stage from features →
safety is connected, including the model-inference seam added on `end-to-end-spine-wiring`.
The audit found **one genuine, repo-supported gap** plus confirmation that the historical
`parallel-agent-review` FAILs are resolved. No redesign is warranted.

## The one genuine gap: the full-spine bridge is NOT manifest-aware

The repo has TWO model-inference paths:

| Path | File | Manifest-aware? |
|---|---|---|
| Truncated single-hum evidence report | `signal-lab/src/inference.ts` `inferFromHum` | **YES** — takes `InferencePromotion` (gate status from `model_manifest.json`) + optional `neuralAuxModel` (promoted feature-space op-graph), and warns honestly when the affect target did not pass the 80% gate. |
| **Full runtime spine (the clean new-hum path)** | `signal-lab/src/runtime-bridge.ts` `loadLearnedAffectPrior` / `orchestrateHumWithLearnedPrior` | **NO** — loads `model.json` blindly. No `model_manifest.json` read, no promotion/gate status, no promoted-neural-model adapter. |

Why this is a real gap, traceable to the repo (not invented):
1. **Asymmetry with the repo's own code.** `inferFromHum` already establishes the intended
   honest-promotion + neural-aux contract; the full-spine bridge — same author, same purpose,
   wider reach — conspicuously lacks it.
2. **Task/governance fit.** The integration brief: *"If a promoted model artifact/manifest
   exists, wire it only through the repo's intended adapter boundary. If the neural model is
   still unfinished or unpromoted, keep the manifest-aware fallback path intact."* The
   feature-space op-graph (`neural-feature-model.ts`) IS that boundary; `model_manifest.json`
   IS the promotion source of truth (`NEURAL_HARNESS.md`, `model_manifest.json`).
3. **Honesty hole.** Without the manifest, the full-spine read cannot state that the fused
   6-class affect prior **failed the 80% gate** (it is a kept population prior). The
   single-hum path can; the spine path can't.

The manifest readers exist but are **private** to `cli.ts` (`loadPromotion`, `loadNeuralAux`),
so the bridge cannot reuse them → they must be extracted.

### Fix (implemented in Phase 3/4)
- Extract `loadPromotionManifest` / `loadNeuralAuxModel` / `notEvaluatedPromotion` into a
  reusable `signal-lab/src/manifest.ts`; `cli.ts` and the bridge both consume them (DRY).
- Make `loadLearnedAffectPrior` read the manifest and attach the honest `promotion` +
  orchestrator-facing `gatePassed` / `gateNote`.
- `orchestrateHumWithLearnedPrior` returns `promotion` and a transparency-only
  `neuralAuxiliary` (a promoted coarse axis, surfaced but **never** steering the read,
  exactly as `inferFromHum` does — ADR-0005).
- Carry `gatePassed` / `gateNote` into `OrchestratorInput.learnedAffectPrior` →
  `InternalRead.modelProvenance` (decoupled: only data crosses the seam; the orchestrator
  never imports signal-lab). The promoted neural artifact is read-only and gate-checked; when
  absent/unpromoted the classical + heuristic fallback is unchanged.

## Confirmed NON-gaps (historical FAILs already resolved)

The `parallel-agent-review/*` FAIL/WARN list predates the foundation
(`POST_FOUNDATION_INTEGRATION_PROMPT.md`). Spot-checked against current code:

| Historical FAIL | Status now | Evidence |
|---|---|---|
| `@hum-ai/safety-language` missing | RESOLVED | package exists; `no-clinical-leak`/`no-raw-confidence-copy` qa gates pass |
| 88% relapse/clinical hard cap not a constant/tested | RESOLVED | `shared-types/claims.ts` `CLINICAL_RISK_CONFIDENCE_CAP=0.88`; relapse/longitudinal tests |
| Raw-audio throw-on-violation untested | RESOLVED | `shared-types/privacy.ts` + `orchestrator/test/audio-path.test.ts` scans every returned key |
| Dataset-registry forbidden uses | RESOLVED | `dataset-registry` + `rules.test.ts` |
| Two-head separation / no clinical labels to engine | RESOLVED | `splitInference`/`toRecommendationView`/`assertNoClinicalLeak`; `no-clinical-leak` gate |
| Domain-gap penalty in confidence path | RESOLVED | `domain-classifier` `HumDomainAdapter` + `combineCaps` (orchestrator.ts:337) |
| BaselineStage / 5-stage ladder | RESOLVED | `personalization-engine` `stagePolicy` |
| Min-consecutive-hum relapse gate | RESOLVED | `relapse-engine` `MIN_CONSECUTIVE_DRIFT_HUMS`, threaded in orchestrator |
| Missing-modality fusion | RESOLVED | `fusion-engine` abstain-when-none; tested |

## Out of scope / deliberately deferred (reported, not actioned)

- **Face/Text experts** (`expert-fer`/`expert-ter`) — deferred by ADR-0009 (voice-first);
  `no-camera-deps` gate enforces it. Not wired by design.
- **Promoted arousal_binary as runtime affect driver** — manifest explicitly says it is NOT
  wired to steer the affect/intervention read. We surface it only as auxiliary/transparency.
- **Personalization LEARN persistence** — `ingestHum` is caller-driven by design (bridge reads;
  it does not persist state). Documented + tested already.
- **Empirical calibration / native-hum validation** — future per `VALIDATION_PLAN.md`. Out of
  scope for wiring.

## Risk posture
The fix is read-only and additive: no thresholds invented, no caps weakened, no clinical
language exposed, no dependency added (manifest is JSON, op-graph executor already exists),
no runtime dependence on active training, no GPU. Fallback stays honest when artifacts are
absent or unpromoted.
