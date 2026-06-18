# Model Card — <model name> v<version>

> Use this template for every model/stub Hum ships. Cards are required (ADR-0004).

## Overview
- **Name / version:**
- **Status:** stub | trained | calibrated
- **Owner / date:**
- **Contract implemented:** (e.g. `AffectExpert`, `MetaLearner`, `ConfidenceModel`)

## Intended use
- What it does, and where it sits in the pipeline.
- **Out of scope / must not be used for:** (diagnosis, clinical decisions, …)

## Inputs & outputs
- Input modality/features; output label space or contract type.

## Training data & priors
- Datasets used, each with its `@hum-ai/dataset-registry` id and `allowed_model_use`.
- Domain gap to hum and the penalty applied.

## Evaluation
- Metrics (calibration first). **No fabricated numbers** — write "not yet
  evaluated" if untrained.

## Limitations & risks
- Domain gaps, bias, failure modes, abstention behavior.

## Safety & privacy
- Risk-marker handling; user-facing language constraints; raw-audio posture.
