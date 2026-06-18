# research/training

Training plan (no training performed in this pass).

## Experts (behind `@hum-ai/affect-model-contracts` `AffectExpert`)
- **HumAcousticExpert / HumEmbeddingExpert** — self-supervised audio (Wav2Vec2 /
  WavLM-style) fine-tuned on `singing_or_sustained_phonation` priors, then on
  native hum data as it accrues. Class-weighted to handle rare states.
- **SpeechEmotion / SpeechClinical** — loaded as priors from off-domain corpora;
  carried at reduced weight via the `HumDomainAdapter` penalty.
- **FER (ViT) / TER (DistilRoBERTa)** — optional companions; trained per TriSense.

## Fusion meta-learner (`@hum-ai/fusion-engine`)
v1 target is a **Logistic-Regression meta-learner** over the concatenated
per-expert probability vectors (`LogisticRegressionParams`). Until fit,
`StubWeightedMetaLearner` provides deterministic reliability-weighted fusion.
v2 roadmap: attention-based / gated mixture-of-experts (see ADR-0001).

## Calibration
Confidence must be **calibrated** (ADR-0004): fit temperature/Platt scaling on a
held-out set and validate with reliability diagrams + ECE before raising any cap.

## Personalization & relapse
- Personal baselines are computed at runtime (`@hum-ai/personalization-engine`),
  not trained centrally.
- The relapse comparator (`@hum-ai/relapse-engine`) is evaluated DVDSA-style
  (within-user paired), per `longitudinal_voice_treatment_response_source`.
