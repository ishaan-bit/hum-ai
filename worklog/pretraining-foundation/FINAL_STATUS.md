# Pretraining / Eval / Inference Foundation — FINAL STATUS

**Date:** 2026-06-19 · **Branch:** cohesion/voice-core-merge
**Package added:** `@hum-ai/signal-lab` (`packages/signal-lab/`), pure TypeScript, **zero new runtime deps**.

## What now exists (the pipeline)

```
data/manifests + data/raw (zip-direct, git-ignored)
 → dataset availability + manifest reconciliation (datasets.ts)
 → feature extraction via computeFeatures (extract.ts — REAL extractor, reused)
 → label harmonization RAVDESS emotion → FUSION_LABELS (labels.ts, traceable)
 → baseline multinomial LogReg affect-prior (model.ts)
 → evaluation: actor-grouped CV + permutation significance + ECE + evidence tiers (evaluate.ts)
 → LearnedAffectPriorExpert: drop-in AffectExpert (expert.ts)
 → inferFromHum: quality-gate → domain-classifier → fusion(+combineCaps) → intervention (inference.ts)
 → artifacts + reports (report.ts), CLI (cli.ts), orchestration (pipeline.ts)
```

CLI / npm: `signal:availability`, `signal:extract`, `signal:train`, `signal:infer`, `signal:all`.

## Real run results (latest `npm run signal:train`)

- **Data available locally:** `ravdess`, `vocalset`, `vocalsound` (WAV inside zips, read zip-direct).
  Incomplete: `deam` (annotations only), `mtg_jamendo` (metadata only), `crema_d` (AudioWAV empty — LFS not pulled).
- **Extraction (RAVDESS):** 2452 rows, **0 decode failures**, 2068 labeled, 384 excluded by mapping (disgust+surprised).
- **Features extracted:** the real `AcousticFeatures` schema (~46 fields + null-mask channels). No invented features.
- **Targets supported:** 6 of 7 `FUSION_LABELS` (no `fatigued` in RAVDESS — reported as a gap).
- **Baseline:** class-weighted LogReg, affect-PRIOR only (far domain, penalty 0.45).
- **Evaluation (actor-grouped 5-fold CV):** accuracy **44.9%** (95% CI 42.8–47.1%) vs majority chance **18.2%**
  (lift 26.7pp); macro-F1 **0.446**; ECE **0.112**; label-permutation **p = 0.010** → evidence tier **supported**.
- **Inference demo (synthetic hum):** model `learned_logreg`, domain heard 'hum' (match 0.81), dominant
  `calm_regulated` (V 0.40 / A −0.30), confidence capped at **0.45** (far-domain penalty), stage `population_prior`,
  qualitative "Early baseline · Based on your first clean hum", intervention `music_recommendation`, with
  top supporting-feature attribution.

## How each requirement is met

1. **Source of truth** — see `SOURCE_OF_TRUTH.md`. Built only on repo contracts/governance.
2. **Dataset manifest/availability** — honest per-dataset status; never fails on incomplete data.
3. **Feature extraction** — reuses `computeFeatures`; extracts only real `AcousticFeatures`; nulls masked, not zeroed.
4. **Label harmonization** — RAVDESS → `FUSION_LABELS`, every mapping traceable; ambiguous emotions excluded, not forced.
5. **Baseline training** — trained (LogReg), clearly affect-prior; no faked artifacts; no heavy deps.
6. **Confidence/uncertainty/significance** — reuses `ConfidenceModelV1`/`combineCaps`; permutation p-value + ECE +
   chance baselines; honest tiers (supported/moderate/weak/insufficient).
7. **Inference adapter** — `inferFromHum(audio|features)`; reports model/artifact used, fallback flag, features,
   inferred state + candidates, confidence/uncertainty, abstention, support, intervention, warnings.
8. **Intervention** — reuses `selectInterventionFromView` over the sanitized `RecommendationView`; only when not abstained.
9. **Artifacts/reports** — availability, feature schema, label mapping, feature tables, extraction summary, model,
   evaluation report, model card, readiness report, inference demo — **all git-ignored** under `data/processed/signal-lab/`.
10. **Tests/gates** — 38 new tests; **252 total pass**; `npm run typecheck` clean; `npm run qa` 4/4 green.

## What remains unproven / blocked / intentionally not done

- **Unproven:** any statement about a real user's hum. All signal is far-/near-domain PRIOR (ADR-0005). No native hum corpus.
- **Blocked/missing data:** CREMA-D audio (git-LFS not pulled), DEAM/MTG-Jamendo audio (large separate downloads),
  clinical/access-pending corpora (no local bytes).
- **Intentionally not done:** heavy SSL training (torch/transformers/librosa), the trained LogReg *meta-learner*
  (kept as `StubWeightedMetaLearner`), calibration cap-raising, and a trained domain classifier — all deferred to the
  Python `research/` scaffold per `research/training/README.md` (new heavy deps need explicit approval).
- **Known limitation:** the prior's softmax is overconfident on out-of-distribution inputs (12 s hum vs ~3 s acted
  speech); mitigated by the capped final confidence + abstention, not by the raw distribution.

## Incidental fix

`packages/dataset-harness/src/cli.ts` `isMain()` was matching any entrypoint ending in `cli.ts` (it fired as an
import side effect when another package's `cli.ts` ran). Tightened to an exact resolved-path comparison so
`@hum-ai/dataset-harness` can be safely imported. `data:manifest`/`data:validate` and its tests are unaffected.

## Privacy / tracking confirmation

`git ls-files data/` is empty; `git check-ignore` confirms `model.json` + `features.*.jsonl` are ignored;
no raw audio, archives, weights, feature matrices, or credentials are tracked. Reproduce everything with
`npm run signal:train && npm run signal:infer`.
