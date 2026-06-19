# Model Card — signal-lab affect-prior LogReg v0

> Required per ADR-0004. Numbers below are from the latest local run; reproduce with
> `npm run signal:train` (artifacts land git-ignored under `data/processed/signal-lab/`).
> No fabricated numbers — if the local data changes, re-run to refresh.

## Overview
- **Name / version:** `signal-lab-logreg/0.1.0`
- **Status:** trained (baseline; calibration measured, confidence caps NOT raised)
- **Owner / date:** signal-lab pretraining foundation, 2026-06-19
- **Contract implemented:** `AffectExpert` (`@hum-ai/affect-model-contracts`) via `LearnedAffectPriorExpert`

## Intended use
- Cold-start **affect PRIOR** over the fusion label space, consumed by `FusionEngine`
  and down-weighted by the far-domain penalty (0.45). It slots in where the
  `SpeechEmotionExpert` stub sits in `@hum-ai/expert-ser`.
- **Out of scope / must not be used for:** diagnosis, clinical decisions, hum truth,
  personalization, relapse tracking (ADR-0005). Not a medical device.

## Inputs & outputs
- **Input:** `AcousticFeatures` (`@hum-ai/audio-features`) → standardized vector with
  explicit `<name>__present` null-mask channels (null = not-computable, never 0).
- **Output:** probability distribution over `FUSION_LABELS`. Trained label support:
  `neutral_close_to_usual`, `calm_regulated`, `positive_activation`, `low_mood`,
  `high_arousal_negative`, `tense_anxious`. `fatigued` has **no** RAVDESS support (gap).

## Training data & priors
- **Dataset:** `ravdess` (`acted_speech_emotion`), registry domain gap **far**, penalty **0.45**.
  `allowed_model_use`: pretraining, evaluation, affect_prior. Prohibited: clinical_prior,
  hum_finetune, personalization, relapse_tracking.
- **Harmonization:** RAVDESS emotion → `FUSION_LABELS` (Russell circumplex anchors in
  `FUSION_LABEL_AFFECT`). `disgust` and `surprised` are **excluded** (no clean fusion
  target), not force-fit.
- **Samples:** 2068 labeled (of 2452 extracted) across 24 actors; class-weighted LogReg.

## Evaluation
- Actor-**grouped** 5-fold CV (no speaker leakage):
  - Accuracy **44.9%** (95% CI 42.8–47.1%) vs majority-class chance **18.2%** (lift 26.7pp).
  - Macro-F1 **0.446**. Top-class ECE **0.112**.
  - Label-permutation significance (100 perms): null acc 16.5%±0.9pp, **p = 0.010**.
  - Evidence tier: **supported** — a real but PRIOR-ONLY affect signal.
- These are PRIOR-domain metrics on acted speech, **NOT** Hum metrics and **NOT** a
  clinical accuracy. We never present MELD 66% / voice-depression AUC / DVDSA F1 as Hum's.

## Limitations & risks
- Far domain gap to a hum; acted (performed) affect, not lived.
- No `fatigued` training support. Overconfident softmax on out-of-distribution inputs
  (e.g. a 12 s synthetic hum vs ~3 s acted speech) — mitigated only by the capped
  final confidence + abstention, not by the raw distribution.
- Abstains under poor capture / domain mismatch / low margin via the existing
  `ConfidenceModelV1` + `combineCaps`.

## Safety & privacy
- Risk-marker heads stay behind the two-head / consent boundary; recommendation reads
  only the sanitized `RecommendationView` (ADR-0006). User copy is qualitative only
  (`userFacingConfidence`, ADR-0008).
- Raw audio is ephemeral; only derived features are stored; weights + feature tables
  live git-ignored under `data/processed/signal-lab/` and are never tracked.

## Multi-dataset experiment follow-up (2026-06-19)
- `npm run signal:experiment` evaluated an 8-model cohort over three targets under
  actor-grouped CV + permutation + ECE. The **6-way fusion affect target reaches only
  47.9% balanced accuracy** (best = random forest; real signal, p=0.007, but far below
  the experimental 80% bar) — so this prior is **KEPT as a population prior, NOT
  gate-promoted**. A coarser **arousal axis** does clear the bar (83.1%) — see
  `signal-lab-arousal-axis-prior-v0.md`; it is not wired into the runtime read.
- Multi-dataset use is honest: only RAVDESS carries affect labels (supervised);
  VocalSet (near, sustained phonation) + VocalSound (moderate, bursts) are
  feature-extracted for **domain/OOD calibration only**. The repo's domain guard was
  validated against all three (hum-compatibility VocalSet 0.42 > VocalSound 0.25 >
  RAVDESS 0.14, matching the registry near>moderate>far ordering). The inference
  adapter now reports promotion-gate status (`model_manifest.json`).
