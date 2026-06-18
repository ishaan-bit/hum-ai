# Model Card — Fusion v1 (`@hum-ai/fusion-engine`)

## Overview
- **Name / version:** Hum late-fusion engine v1
- **Status:** stub (deterministic; no trained meta-learner)
- **Contract implemented:** `MetaLearner`, `ConfidenceModel`, `FusionEngine`

## Intended use
Combine independent expert outputs into one `MultiHeadAffectInference` with
calibrated, capped confidence. Adapts the TriSense expert-based **late fusion**
with a **Logistic-Regression meta-learner** target (`trisense_architecture`).
v1 uses `StubWeightedMetaLearner` (reliability-weighted average); the trained
`LogisticRegressionMetaLearner` is the drop-in upgrade.
- **Must not be used for:** diagnosis; any claim of clinical accuracy.

## Inputs & outputs
- **In:** `ExpertOutput[]` over the shared `FUSION_LABELS` + `FusionContext`.
- **Out:** `MultiHeadAffectInference` (dimensional V-A, state heads, uncertainty,
  capped confidence, abstain decision).

## Training data & priors
- None (stub). The trained meta-learner will be fit per `research/training`.

## Evaluation
- **Not yet evaluated.** v1 is a deterministic stand-in. Calibration (ECE,
  reliability diagrams) is required before any cap is raised.

## Limitations & risks
- Reliability weights are heuristic, not learned.
- Handles missing modalities by filtering + renormalizing; abstains when no
  modality is available.

## Safety & privacy
- Confidence is capped by baseline maturity × capture quality × domain match;
  a first hum can never report >72%. Operates on derived features only.
