# HumAI Spine — Source Map (Phase 1)

**Pass:** overnight end-to-end integration · **Branch:** `overnight-e2e-integration`
(off `end-to-end-spine-wiring`) · **Date:** 2026-06-20

This maps the files that define the *intended* HumAI AI spine and where each stage is
implemented today. Every nontrivial claim cites a repo file. The spine, as specced in
`docs/adr/0001-architecture-spine.md` and `docs/packages/orchestrator.md`, is:

```
audio → features → quality → domain → experts(+model prior) → fusion
      → personalization → relapse + longitudinal-diagnostic → intervention → safety
```

The single runtime entry that composes the whole spine is
[orchestrator.ts](../../packages/orchestrator/src/orchestrator.ts) (`orchestrateHumRead` /
`orchestrateHumAudio`). The signal-lab runtime bridge
([runtime-bridge.ts](../../packages/signal-lab/src/runtime-bridge.ts)) is THE clean
new-hum path that loads the trained prior and calls that orchestrator.

---

## 1. Feature extraction (contracts)

- **Spec:** `docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md`,
  `docs/packages/audio-features.md`. Deterministic DSP proxies, NOT a trained model.
  Nullable pitch/melodic fields must be **masked, not zeroed** when unvoiced.
- **Code:** `@hum-ai/audio-features` — `computeFeatures(input: AudioInput): AcousticFeatures`
  (`hum-extractor.ts`), `AcousticFeatures` schema (`features.ts`, ~46 fields),
  `metricsFromFeatures`. Signal-lab vectorizes via `feature-schema.ts` `toFeatureVector`
  (58-d) — the SAME contract the neural op-graph asserts against.
- **Status:** IMPLEMENTED. Raw audio is consumed on-device in `orchestrateHumAudio`
  (orchestrator.ts:543) and dropped — only derived `AcousticFeatures` flow downstream.

## 2. Model / pretrained / neural inference

- **Spec:** ADR-0001 (expert late-fusion; v1 = deterministic stubs, target = trained
  models behind the SAME `AffectExpert` contract), ADR-0005 (public data = priors, never
  truth; far-domain penalty 0.45). `research/training/NEURAL_HARNESS.md` defines the
  adapter boundary: a promoted **feature-space** model is exported to a pure-JSON op-graph
  (`model.neural.<target>.json`) that the TS runtime executes natively; a promoted
  **audio** model stays a git-ignored `.pt` for the Python wrapper, TS keeps its classical
  fallback.
- **Code:**
  - Heuristic fallback ensemble: `@hum-ai/expert-ser` `defaultAudioExperts()`.
  - Trained affect prior: `signal-lab/src/expert.ts` `LearnedAffectPriorExpert` (drop-in for
    the `expert-ser:speech-emotion` stub) over `signal-lab/src/model.ts` `LogRegParams`
    (multinomial logreg → `FUSION_LABELS`).
  - Neural op-graph executor: `signal-lab/src/neural-feature-model.ts`
    (`parseNeuralFeatureModel`, `predictNeuralFromFeatures`) — the intended TS adapter
    boundary, asserts the 58-d feature contract.
  - Truncated single-hum report path: `signal-lab/src/inference.ts` `inferFromHum` —
    **manifest-aware** (`InferencePromotion`, `neuralAuxModel`).
  - Full-spine seam: orchestrator.ts:132 `LearnedAffectPrior`, :180 `buildExpertEnsemble`,
    :483 `ModelProvenance`.
- **Artifacts (git-ignored, `data/processed/signal-lab/`):**
  - `model.json` — 6-class `affect_fusion_label` logreg prior. **NOT gate-passed** (47.9%);
    `model_manifest.json` `priorAffectModel.passedGate=false`, role "population_prior — KEPT".
  - `model.arousal_binary.json` — arousal axis, **gate-passed** (83.1%); manifest `promoted`
    block, but note: *"NOT wired to change the runtime affect/intervention read."*
  - `neural/...` — active Python training output (NOT to be touched).

## 3. Affective state / fusion

- **Spec:** ADR-0006 (two-head separation: `BroadAffectHead` benign + consent-gated
  `ClinicalRiskMarkerHead`), ADR-0004 (`ConfidenceModelV1`, `combineCaps` strictest-wins,
  abstention floor), `TRISENSE_ADAPTED_ARCHITECTURE.md` (`FUSION_LABELS`, single-modality
  agreement cap ≤0.7, all-missing → abstain).
- **Code:** `@hum-ai/fusion-engine` `FusionEngine.fuse`, `combineCaps`, `modalityReliability`;
  `@hum-ai/affect-model-contracts` `splitInference`, `toRecommendationView`,
  `MultiHeadAffectInference`, `FUSION_LABELS`, `FUSION_LABEL_AFFECT`. Composed at
  orchestrator.ts:337–359.
- **Status:** IMPLEMENTED.

## 4. Personalization (dual baseline, ladder)

- **Spec:** ADR-0007 (rolling 24 + anchored 180/α0.05/min-20), ADR-0003 (5-stage ladder,
  caps 0.72→0.76→0.82→0.88→0.92), `PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md`.
- **Code:** `@hum-ai/personalization-engine` `buildDualBaseline`, `baselineDivergence`,
  `stagePolicy`, `zDeltasAgainstBaseline`, `applyPersonalization`, `signatureAlignment`,
  `ingestHum`. Composed at orchestrator.ts:309–374 (step "6b"). λ = 0 until `baselineActive`.
- **Status:** IMPLEMENTED. Re-references/damps only; never manufactures affect.

## 5. Longitudinal / adaptive state

- **Spec:** ADR-0007 divergence; `PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md`; the internal
  `LongitudinalDiagnosticState` model (memory: longitudinal-diagnostic-layer).
- **Code:** `@hum-ai/relapse-engine` `assessLongitudinalState` (`longitudinal.ts`),
  `assessRelapse`. Composed at orchestrator.ts:435–449 (step "8b"); min-3-consecutive-drift
  rule threaded via `priorConsecutiveDriftHums`. Lives in `InternalRead.longitudinal` —
  never rendered/synced.
- **Status:** IMPLEMENTED.

## 6. Diagnostic / medical hypothesis

- **Spec:** ADR-0006 (clinical separation, consent gate), `claims.ts`
  `CLINICAL_RISK_CONFIDENCE_CAP = 0.88` hard cap regardless of maturity, abstention on
  insufficient evidence (`insufficient_data` until baseline active). NON-diagnostic
  (`isDiagnostic: false`).
- **Code:** `relapse-engine` `LongitudinalDiagnosticState` (`RiskHypothesis`,
  `RelapseDriftSignal`, confidence ≤ 0.88). Consent gate via `splitInference`
  (orchestrator.ts:452). `evidenceSources` provenance.
- **Status:** IMPLEMENTED. Internal-only; surfacing is consent-gated AND safety-screened.

## 7. Intervention selection

- **Spec:** ADR-0006 (engine sees only sanitized `RecommendationView`),
  `MUSIC_INTERVENTION_REQUIREMENTS.md` (support-not-treatment; V-A steer), escalation
  double-gated on persistent-risk-pattern AND consent; never on an abstained read.
- **Code:** `@hum-ai/intervention-engine` `selectInterventionFromView`. Composed at
  orchestrator.ts:398–414; `assertNoClinicalLeak(recommendationView)` before the engine;
  `safetyAllowsEscalation = hasConsent(consent, "clinical_risk_surfacing")`.
- **Status:** IMPLEMENTED.

## 8. Safety / claim-boundary

- **Spec:** `docs/claims/CLAIMS_LADDER.md` (tier 4/5 unreachable; `FORBIDDEN_PHRASES`),
  ADR-0008 (qualitative confidence only — no raw %).
- **Code:** `@hum-ai/safety-language` `assertSafeUserFacingText`, `isConfidenceCopySafe`,
  `userFacingConfidence`, `INTERNAL_TO_USER_FACING`; `affect-model-contracts`
  `assertNoClinicalLeak`; `shared-types/privacy.ts` `assertNoRawAudioFields` /
  `isRawAudioFieldName`. Screen at orchestrator.ts:454–481; sync guards at :657–682.
- **Status:** IMPLEMENTED + enforced by `npm run qa` (no-clinical-leak, no-raw-confidence-copy).

## 9. Runtime / orchestrator output contract

- **Spec:** `docs/packages/orchestrator.md`. Output `OrchestratedRead` = `{ userFacing
  (safe to render), recommendationView (sanitized bands), internal (full inference, two-head,
  quality, domain, baseline, relapse, longitudinal, modelProvenance, derived features) }`.
  Sync projection via `buildHumSyncPayload` (derived-only, double-guarded).
- **Code:** orchestrator.ts:200–257 (`UserFacingRead`, `InternalRead`, `OrchestratedRead`),
  :628–682 (`HumSyncPayload`, `buildHumSyncPayload`). The clean new-hum path:
  `runtime-bridge.ts` `orchestrateHumWithLearnedPrior` → `LearnedHumReadResult`.
- **Status:** IMPLEMENTED.

## 10. Tests & QA gates protecting the spine

- **Tests:** 339 across `packages/**/test`. Spine-relevant: `orchestrator/test/audio-path.test.ts`
  (raw-audio key scan over EVERY returned key), `learned-prior.test.ts` (prior seam + cap-binds
  + claim boundary), `signal-lab/test/runtime-bridge.test.ts`, `inference-promotion.test.ts`,
  `inference-neural-aux.test.ts`, `neural-feature-model.test.ts`, plus fusion/personalization/
  relapse/safety suites.
- **QA gates (`npm run qa`):** `no-clinical-leak`, `no-camera-deps`, `no-raw-confidence-copy`,
  `forbidden-files` — `packages/qa-gates/src/`.
- **Validation plan:** `docs/validation/VALIDATION_PLAN.md` — empirical calibration/abstention
  studies are future work; constants are principled design defaults, not tuned on native hums.

---

### Verified baseline (this branch, this tree)
`npm run typecheck` ✅ · `npm test` ✅ **339 pass / 0 fail** · `npm run qa` ✅ 4/4 ·
`git ls-files data/` → **0**.
