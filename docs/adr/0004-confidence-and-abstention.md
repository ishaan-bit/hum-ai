# ADR-0004: Confidence and Abstention

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture, eng leads, clinical reviewers
- **Packages:** `@hum-ai/affect-model-contracts`, `@hum-ai/fusion-engine`, `@hum-ai/personalization-engine`, `@hum-ai/quality-gate`
- **Related:** [TRISENSE_ADAPTED_ARCHITECTURE](../architecture/TRISENSE_ADAPTED_ARCHITECTURE.md) · [PERSONALIZATION_AND_RELAPSE_ARCHITECTURE](../architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) · [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) · [VALIDATION_PLAN](../validation/VALIDATION_PLAN.md)

## Context

Hum reads affect from a standardized 12-second hum. The honest difficulty is that a fused softmax distribution is trivially over-confident: a single noisy or out-of-domain hum can produce a sharp distribution that *looks* certain while resting on no evidence. The literature underwriting this platform is explicit about that hazard. The SER mental-health review notes the field's pathology/architecture/dataset heterogeneity makes direct, reliable assessment hard and that dimensional valence–arousal is under-explored, so per-read uncertainty must be first-class [ser_mental_health_review]. The clinical voice-biomarker review reports strong-looking numbers (AUC 0.71–0.93, accuracy 78–96.5%) yet flags 6 of 12 studies at high methodological-bias risk with unproven generalizability [clinical_voice_biomarker_review]. The architecture-reference fusion gain (MELD streams 18.4/38.0/54.0 → 66.0%) is a TV-dialogue number, never a Hum metric [trisense_architecture]. Two consequences follow: Hum must **not** present any of those figures as its own accuracy, and a confidence number that the user reads as trust must be *earned and calibrated*, not decorative.

The `hum_spec` already constrains the upper bound: confidence caps scale with baseline maturity — 72% on the first hum up to 90–92% only at maturity [hum_spec]. We need a confidence model that (a) blends real evidence signals, (b) is clamped by hard caps from baseline maturity **and** capture quality **and** domain match, and (c) can decline to answer.

## Decision

Confidence is computed by `ConfidenceModelV1` (`@hum-ai/fusion-engine`), implementing the `ConfidenceModel` contract from `@hum-ai/affect-model-contracts`. It blends **eight** evidence signals (`ConfidenceInputs`), applies a maturity and longitudinal-trend temper, then clamps with hard caps (`ConfidenceCaps`). When the clamped result falls below an abstention floor, the system **abstains** with a typed reason (`ABSTAIN_REASONS`).

### 1. The eight evidence signals

| Signal (`ConfidenceInputs`) | Source | Effect |
| --- | --- | --- |
| `modelProbability` | fused top-class prob (`MetaLearner` → `argmax`) | higher → more confident |
| `topClassMargin` | gap to second class | small margin → low confidence |
| `captureQuality` | `evaluateQuality` (`@hum-ai/quality-gate`) | poor capture → low confidence |
| `domainMatch` | `HumDomainAdapter.scoreCapture` | mismatch → reduced confidence |
| `modalityAgreement` | cross-expert support for the top label | conflict → reduced confidence |
| `oodScore` | mean expert OOD score | higher → reduced (enters as `1 - oodScore`) |
| `calibrationMaturity` | `stagePolicy(eligibleHumCount)` [hum_spec §4.8] | grows with eligible hums |
| `longitudinalTrendStrength` | within-user trend backing the read | strengthens a corroborated read |

The v1 blend takes the mean of the first six signals (with `oodScore` inverted), then multiplies by `maturityFactor = 0.6 + 0.4·calibrationMaturity` and `trendFactor = 0.9 + 0.1·longitudinalTrendStrength`, yielding `rawConfidence ∈ [0,1]`. The trend temper is deliberately small (±10%): a single hum that agrees with a 24-hum trend earns a modest boost, never a leap.

### 2. Hard caps win — `combineCaps`

`rawConfidence` is then clamped: `confidence = min(rawConfidence, caps.cap)`. The binding cap is the **intersection (strictest wins)** of the personalization-stage cap and the capture-quality cap. `combineCaps` selects the lowest cap, reports its reason, and takes the **max** of the candidate abstention floors (stricter abstention).

**Personalization-stage caps** (`stagePolicy`, from `hum_spec §4.8`):

| Eligible hums | Stage | Cap | Capabilities |
| --- | --- | --- | --- |
| 0–1 (first hum) | `population_prior` | **0.72** | priors only; no baseline |
| 2–4 | `early_calibration` | **0.76** | pre-baseline |
| 5–9 | `personal_baseline` | **0.82** | baseline active |
| 10–19 | `personalized_fusion` | **0.88** | personalized fusion weights |
| 20+ | `relapse_model` | **0.92** | relapse/change model active |

**Capture-quality caps** (`CAPTURE_QUALITY_CONFIDENCE_CAP`, `@hum-ai/quality-gate`): `good 0.95 · usable 0.90 · soft_usable 0.70 · poor 0.50 · rejected 0.30`.

Three invariants this guarantees:

1. **A first hum can never report > 72%.** The `population_prior` cap binds regardless of how sharp the distribution is, because the system has no personal evidence yet — only cold-start priors that public datasets and the clinical/singing literature supply [clinical_voice_biomarker_review][vocal_biomarker_and_singing_protocol_support].
2. **Poor capture caps confidence low.** A `poor` capture caps at 0.50 even on a mature account; `soft_usable` at 0.70. The strictest of stage-cap ∩ quality-cap wins.
3. **Domain mismatch reduces confidence.** A clinical-read-speech or generic-speech-like capture lowers `domainMatch`, dragging the blended evidence down and (below threshold) triggering abstention — enforcing the rule that clinical-speech evidence is a *prior*, never hum truth [clinical_voice_biomarker_review] (see [HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE](../architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md)).

### 3. Abstention

If `confidence < caps.abstainBelow` (default floor 0.45, raised by the strictest input), the read abstains rather than render a low-quality state label. The `ConfidenceReport` carries `abstained` and a typed `abstainReason ∈ ABSTAIN_REASONS`:

`poor_capture_quality · domain_mismatch · out_of_distribution · insufficient_baseline · low_margin · modality_conflict · first_hum · none`

`FusionEngine.fuse` also abstains structurally when **no** modality is available (returns a neutral inference with `abstainReason = "poor_capture_quality"`), satisfying the TriSense modality-dominance requirement: a dead channel must not be laundered into a confident read [trisense_architecture]. Abstention is the mechanism that keeps the [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) honest — a read that cannot clear its tier's bar declines instead of overclaiming, consistent with the uncertainty discipline the SER review calls for [ser_mental_health_review].

## Consequences

**Positive**

- Honest UX. `confidencePercent` provably never exceeds `appliedCap × 100`; users see numbers the system has earned, with a `capReason` string explaining the bound.
- Fewer confident-but-wrong reads. Low margin, expert conflict, OOD, poor capture, or domain mismatch each pull confidence down or trigger abstention before a misleading label renders.
- Auditable. Caps are named constants (`stagePolicy`, `CAPTURE_QUALITY_CONFIDENCE_CAP`), not scattered magic numbers; every binding cap is traceable to `hum_spec` and testable.

**Negative / costs**

- **Some reads abstain** — by design. Early-account, noisy, or off-protocol hums may return no state label. This is the intended trade against false confidence.
- The v1 blend (a tempered mean) is a deliberately simple, inspectable calibrator, not a learned reliability model. True post-hoc calibration (e.g. temperature scaling against held-out reliability) is deferred to the [VALIDATION_PLAN](../validation/VALIDATION_PLAN.md).
- The displayed percent is a **calibrated internal confidence, not a clinical accuracy**. Hum is non-clinical and **not clinically validated**; no confidence number implies diagnostic validity.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **Raw softmax confidence** | Rejected | Uncalibrated and over-confident; ignores capture quality, domain match, baseline maturity, and cross-modal agreement. A sharp distribution on a noisy first hum would read as near-certainty. |
| **Fixed accuracy display** (e.g. show "66%" or a clinical-review figure) | Rejected | Fabricated as a Hum metric. MELD 66.0% is TV-dialogue architecture-reference [trisense_architecture]; AUC 0.71–0.93 is clinical read speech under high bias risk [clinical_voice_biomarker_review]. Presenting either as Hum's accuracy would be a false claim. |
| **No abstention** (always emit a best guess) | Rejected | Forces a label when evidence is absent — exactly the overclaiming the SER and clinical reviews warn against [ser_mental_health_review][clinical_voice_biomarker_review]. Abstention is required to keep risk-marker copy non-diagnostic. |

## Sources

- [hum_spec] — Hum technical spec: 12s protocol, baseline maturity, confidence caps 72/76/82/88/90–92% (§4.8), quality gate.
- [trisense_architecture] — IJERT TriSense: late fusion, modality-dominance handling; MELD numbers are architecture-reference only, never Hum metrics.
- [clinical_voice_biomarker_review] — Briganti & Lechien, *J Voice* 2025: depression voice biomarkers AUC 0.71–0.93, 6/12 high bias risk; clinical prior only.
- [ser_mental_health_review] — Jordan et al., *JMIR Ment Health* 2025: dimensional V-A under-explored; supports multi-head + abstention discipline.
- [vocal_biomarker_and_singing_protocol_support] — Rodrigo & Duñabeitia, *Brain Sci* 2025: singing/sustained phonation as a language-independent vocal-biomarker source; the public bridge for cold-start priors.
