# Model Card — signal-lab arousal-axis prior (LogReg) v0

> Required per ADR-0004. Numbers from the latest local `npm run signal:experiment`
> run; reproduce to refresh (artifacts git-ignored under `data/processed/signal-lab/`).
> This is the ONE target that cleared the experimental 80% gate — read the limits.

## Overview
- **Name / version:** `signal-lab-arousal_binary/0.1.0`
- **Status:** trained (cleared the EXPERIMENTAL promotion gate; far-domain prior)
- **Owner / date:** signal-lab multi-dataset modeling pass, 2026-06-19
- **Contract:** binary classifier over a contract-derived arousal axis (not a runtime
  drop-in; see "Intended use"). Artifact: `model.arousal_binary.json` (git-ignored).

## Intended use
- An **experimental evidence finding**: with the existing DSP `AcousticFeatures`, the
  high-vs-low **arousal** axis (derived from `FUSION_LABEL_AFFECT.va.arousal`) is the
  one inference target that reaches the experimental ≥80% balanced-accuracy bar on
  acted speech under actor-grouped CV.
- **Out of scope / must NOT be used for:** driving the runtime affect head or
  interventions, diagnosis, clinical decisions, hum truth, personalization, relapse
  tracking (ADR-0005). It is NOT wired into inference: it is acted-speech, far-domain
  (penalty 0.45), a coarse axis, and not hum truth. It is surfaced only as an
  honest, gate-passed auxiliary prior in `model_manifest.json` + the inference report.

## Inputs & outputs
- **Input:** `AcousticFeatures` → standardized vector with null-mask channels (same
  schema as the affect prior).
- **Output:** P(`high_arousal`) vs P(`low_arousal`). `neutral_close_to_usual` (A=0)
  is excluded by a ±0.15 dead-band — the split is "drop the neutral mid-point, then
  separate the two poles", not a force-fit.

## Training data & priors
- **Dataset:** `ravdess` (`acted_speech_emotion`), registry domain gap **far**,
  penalty **0.45**. The only locally-available affect-labelled corpus.
- **Label derivation:** RAVDESS emotion → fusion label → arousal pole via the
  contract's V-A anchor. high = {positive_activation, high_arousal_negative,
  tense_anxious}; low = {calm_regulated, low_mood}; neutral excluded. ~1880 samples.

## Evaluation
- Actor-**grouped** 5-fold CV (no speaker leakage), model cohort of 8 families:
  - **Balanced accuracy 83.1%** (best = plain LogReg; random forest / L2-LogReg within
    ~0.5pp) vs balanced chance **50%**. Macro-F1 0.829. Top-class **ECE 0.032**.
  - Label-permutation significance (linear null-reference, 150 perms): **p = 0.007**.
  - Selective prediction: at confidence ≥0.80, **68.7%** coverage at **90.3%** balanced
    accuracy; ≥0.90 → 52.4% coverage at 92.7% — the abstention architecture sharpens it.
  - **Gate verdict: PASS** (balanced acc ≥80% ∧ p<0.01 ∧ ECE≤0.15).
- Contrast (same protocol, did NOT pass): 6-way `affect_fusion_label` **47.9%**;
  `valence_binary` **69.4%**. Valence is acoustically harder than arousal, as expected.
- These are PRIOR-domain metrics on **acted speech**, NOT Hum metrics, NOT clinical.

## Limitations & risks
- Far domain gap to a hum; acted (performed) arousal, not lived; a coarse 2-way axis,
  not the 7-way affect space the product targets.
- "80%" is an **experimental** bar (the repo defines none); balanced accuracy chosen so
  a skewed prior cannot inflate it. Passing it is evidence the arousal axis is
  separable in this corpus — NOT evidence about a real user's hum.
- Overconfident softmax off-distribution is mitigated only by capped final confidence +
  abstention, never by the raw distribution.

## Safety & privacy
- Not surfaced as user copy; not wired to interventions. The runtime confidence stays
  capped by the strictest of stage / capture / domain / far-domain penalty (ADR-0004).
- Weights live git-ignored under `data/processed/signal-lab/`, never tracked; raw audio
  is ephemeral; only derived features are stored.
