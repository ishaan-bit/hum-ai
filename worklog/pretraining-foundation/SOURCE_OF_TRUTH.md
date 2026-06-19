# Pretraining Foundation — Source of Truth (repo file map)

The offline pretraining/eval/inference foundation (`@hum-ai/signal-lab`) was built
strictly on the repo's own contracts and governance. Discovery was a 9-area parallel
read of docs/research/code/tests, cross-checked against direct reads. Authoritative
sources used:

## Architecture & governance
- `docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md` — late-fusion spine; experts →
  `FUSION_LABELS` → meta-learner; V-A interlingua.
- `docs/adr/0005-public-datasets-as-priors-not-truth.md` — priors-not-truth, the
  `DOMAIN_FORBIDDEN_USES` table, `DOMAIN_GAP_PENALTY` (near .9 / moderate .7 / far .45).
- `docs/adr/0004-confidence-and-abstention.md` — eight confidence signals, hard caps
  (stage 0.72→0.92; capture-quality caps), abstention floor 0.45, `confidencePercent` floored.
- `docs/adr/0006-...two-head...md`, `docs/adr/0008-user-facing-confidence-language.md` — sanitization + copy rules.
- `docs/validation/VALIDATION_PLAN.md`, `research/{README,training,evaluation,datasets,model-cards}` — calibration-over-accuracy; "no models trained / no heavy deps this pass".

## Feature schema (the extractor contract — reused, never duplicated)
- `packages/audio-features/src/features.ts` — `AcousticFeatures` (~46 fields; nullable = not-computable).
- `packages/audio-features/src/hum-extractor.ts` — `computeFeatures(input: AudioInput): AcousticFeatures` (the real, pure DSP extractor).
- `packages/audio-features/src/extract.ts` — `AudioInput = { sampleRate, samples }`.
- `packages/audio-features/src/synth.ts` — deterministic `synthHum`/`synthSpeechLike`/`synthSilence` (demo inputs; no committed audio).

## Labels / targets / states
- `packages/affect-model-contracts/src/fusion-labels.ts` — `FUSION_LABELS` (7) + `FUSION_LABEL_AFFECT` (V-A anchor + dominantState). **The training/target space.**
- `packages/affect-model-contracts/src/heads.ts` — `AFFECT_STATE_HEADS` (15), risk markers.
- `packages/dataset-harness/src/ravdess.ts` — `parseRavdessOrNull`, `RavdessEmotion` (the dataset's own annotation; reused for harmonization).

## Model / fusion / confidence / intervention (all reused)
- `packages/fusion-engine/src/{fuse,confidence,meta-learner}.ts` — `FusionEngine`, `ConfidenceModelV1`, `combineCaps`, `argmax`.
- `packages/personalization-engine/src/ladder.ts` — `stagePolicy` (population_prior cap 0.72 for a single hum).
- `packages/quality-gate/src/{gate,thresholds}.ts` — `evaluateQuality`, `CAPTURE_QUALITY_CONFIDENCE_CAP`.
- `packages/domain-classifier/src/{classifier,adapter}.ts` — `HeuristicDomainClassifier`, `HumDomainAdapter.scoreCapture`.
- `packages/intervention-engine/src/index.ts` — `selectInterventionFromView`; sanitization in `affect-model-contracts/src/two-head.ts` (`toRecommendationView`, `assertNoClinicalLeak`).
- `packages/safety-language/src/confidence-language.ts` — `userFacingConfidence`, `isConfidenceCopySafe`, evidence levels.

## Datasets / governance / privacy
- `packages/dataset-registry/src/{schema,rules,entries}.ts` — `MODEL_USES`, `DOMAIN_FORBIDDEN_USES`, `isUseAllowed`.
- `packages/shared-types/src/{domain,privacy,numeric,stats}.ts` — `DOMAIN_GAP_PENALTY`, `assertNoRawAudioFields`, consent.
- `data/manifests/*.manifest.json` (git-ignored authored metadata), `data/processed/model-signal-lab/signal_manifest.json` (prior research artifact / signal conventions), `data/raw/*` (the actual zips).
- `packages/qa-gates/src/{clinical-leak,forbidden-files,confidence-copy,camera-deps}.ts`, `.github/workflows/privacy-check.yml`, `.gitignore` — the guardrails the new code respects.

## Existing tests that protect the plan (unchanged, still green)
All `packages/*/test/**` — 252 total pass (38 new in `packages/signal-lab/test/`).
