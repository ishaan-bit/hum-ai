# Model Card — DomainClassifier v1 (`@hum-ai/domain-classifier`)

## Overview
- **Name / version:** HeuristicDomainClassifier v1 + HumDomainAdapter
- **Status:** stub (transparent rule-based; untrained)
- **Contract implemented:** `DomainClassifier`

## Intended use
Decide what Hum is actually listening to (`speech | singing | hum | vocal_burst
| music | silence | invalid | noisy_unknown`) before trusting any affect head,
and score how hum-compatible the capture is. Central to the domain-aware thesis
(ADR-0002): "a hum is not speech, not music, not necessarily singing."
- **Must not be used for:** affect/diagnosis; it only classifies signal type.

## Inputs & outputs
- **In:** `AcousticFeatures`.
- **Out:** `DomainClassification` (predicted class, probabilities, confidence).
- **Adapter:** `HumDomainAdapter.adaptPrior(domain)` (penalize off-domain priors)
  and `.scoreCapture(classification)` (penalize non-hum captures).

## Training data & priors
- None (stub). Trained version uses labeled multi-domain audio; penalties derive
  from `DEFAULT_DOMAIN_GAP` × `DOMAIN_GAP_PENALTY` (`@hum-ai/shared-types`).

## Evaluation
- **Not yet evaluated.** Heuristics are interpretable placeholders.

## Limitations & risks
- Rule thresholds are hand-set; a trained classifier replaces them behind the
  same interface.

## Safety & privacy
- Domain mismatch reduces downstream confidence (ADR-0004). Operates on derived
  features only.
