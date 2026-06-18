# Model Card — HumAcousticExpert v1 (`@hum-ai/expert-ser`)

## Overview
- **Name / version:** HumAcousticExpert v1 (+ HumEmbedding, SingingPhonation,
  VocalBurst, SpeechEmotion, SpeechClinical conceptual experts)
- **Status:** stub (deterministic, untrained)
- **Contract implemented:** `AffectExpert`

## Intended use
The audio stream's interpretable, hum-native expert. Tilts the `FUSION_LABELS`
space directly from spec acoustic dimensions (energy→arousal, clarity→valence).
Part of an ensemble ordered by hum-domain proximity, so off-domain speech
experts are down-weighted by the `HumDomainAdapter`.
- **Must not be used for:** standalone affect claims; diagnosis.

## Inputs & outputs
- **In:** `AcousticFeatures` (derived; no raw audio) + `ExpertInputMeta`.
- **Out:** `ExpertOutput` (distribution over `FUSION_LABELS`, low self-confidence,
  per-expert `domainMatch` and `oodScore`).

## Training data & priors
- None (stub). Trained version: self-supervised audio fine-tuned on
  `singing_or_sustained_phonation` priors → native hum (`hum_finetune`).

## Evaluation
- **Not yet evaluated.** Stub `selfConfidence` is hard-capped at 0.35 so it can
  never masquerade as a trained model.

## Limitations & risks
- Heuristic tilt only; no learned representation yet.
- SpeechClinicalExpert is the most off-domain (domainMatch 0.35) and is gated
  downstream by `@hum-ai/safety-language` (never diagnosis).

## Safety & privacy
- Risk-leaning labels feed risk *markers*, surfaced only via safe copy. Raw audio
  never enters the expert beyond on-device feature extraction.
