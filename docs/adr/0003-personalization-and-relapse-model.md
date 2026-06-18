# ADR-0003: Personalization and Relapse Model

- **Status:** Accepted
- **Date:** 2026-06-18
- **Packages:** `@hum-ai/personalization-engine`, `@hum-ai/relapse-engine` (with `@hum-ai/shared-types`, `@hum-ai/affect-model-contracts`, `@hum-ai/quality-gate`)
- **Related:** [Personalization and Relapse Architecture](../architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md), [Claims Ladder](../claims/CLAIMS_LADDER.md), [Validation Plan](../validation/VALIDATION_PLAN.md)

## Context

Hum's thesis is that a standardized 12-second hum becomes a *personal* signal. Public datasets and the clinical voice-biomarker literature were never built on hums; they give a cold-start **prior** only and carry a domain gap to sustained phonation. The clinical review reports voice-to-depression AUC 0.71-0.93 and accuracy 78-96.5%, but flags that 6 of 12 studies carry high methodological-bias risk and that generalizability is unproven [clinical_voice_biomarker_review]. None of those numbers are Hum's, and Hum is **not** clinically validated. So the architecture must (a) start from priors, (b) progressively override them with the user's own accumulating data, and (c) detect *change within a person* rather than classify them against a population.

Two empirical findings shape the design:

1. **Within-user comparison beats population norms for this signal.** The DVDSA study performed a within-patient paired pre/post comparison of voice, categorizing intra-patient change as recovery / worsening / unchanged. Deep models captured that intra-patient change (WavLM F1 78.05% binary, 70.58% on DVDSA) far better than classic ML (F1 65.83% ceiling); only F0 was significant at the single-feature, group level (Holm-Bonferroni), over a mean pre-to-post interval of ~107 days [longitudinal_voice_treatment_response_source]. The signal lives in *paired* change, not in absolute group thresholds.
2. **Robust per-user baselines are the spec's center+scale.** `hum_spec` defines a baseline that activates after 5 eligible hums over a rolling window of 24, summarized with median / MAD / IQR, `robustStd = MAD * 1.4826`, `zDelta = (current - center)/max(std, eps)`, and feature ratios [hum_spec]. Median/MAD/IQR resist the outliers that a small, real-world hum history produces.

The SER mental-health review notes that dimensional valence-arousal is comparatively underexplored versus categorical labels and that SER is mostly used indirectly, which is why the relapse engine consumes a multi-head inference (dimensional + risk markers) and is free to abstain rather than force a label [ser_mental_health_review]. The singing/sustained-phonation support gives the scientific basis that hum acoustics are language-independent and transferable, i.e. that a personal hum baseline is a coherent thing to build [vocal_biomarker_and_singing_protocol_support].

## Decision

### 1. Per-user model via a 5-stage personalization ladder

`@hum-ai/personalization-engine` exposes `PERSONALIZATION_STAGES` and `stagePolicy(eligibleHumCount)`, which maps a count of quality-gated eligible hums to a `StagePolicy`. The cap rises only as the model earns the right to be confident; the caps come straight from `hum_spec` §4.8 [hum_spec].

| Eligible hums | `stage` | `confidenceCap` | `calibrationMaturity` | `baselineActive` | `personalizedFusionActive` | `relapseModelActive` |
| --- | --- | --- | --- | --- | --- | --- |
| 0-1 | `population_prior` | 0.72 | 0.45 | false | false | false |
| 2-4 | `early_calibration` | 0.76 | 0.52 | false | false | false |
| 5-9 | `personal_baseline` | 0.82 | 0.66 | **true** | false | false |
| 10-19 | `personalized_fusion` | 0.88 | 0.78 | true | **true** | false |
| 20+ | `relapse_model` | 0.92 | 0.90 | true | true | **true** |

The per-user state is `UserModelProfile`: a `baseline_vector` (`Record<string, RobustStats>`), reliability vectors per modality and per `DomainClass`, learned `recovery_signature_vector` / `high_risk_signature_vector` centroids, an `intervention_response_vector`, plus `calibration_maturity` and `confidence_cap` carried from the stage policy. `newUserProfile` starts empty at `population_prior`. `buildBaselineVector(samplesByFeature, rollingWindow = 24)` calls `computeRobustStats` per feature over the trailing window; `zDeltasAgainstBaseline(current, baseline)` produces the per-feature `zDelta` that downstream experts and the relapse engine read. The profile is **derived data only** — no raw audio, no per-session history beyond the rolling baseline — consistent with the local-first, `FORBIDDEN_RAW_AUDIO_FIELDS` privacy posture in `@hum-ai/shared-types`.

### 2. Relapse engine as a personalized within-user paired comparison

`@hum-ai/relapse-engine` implements DVDSA's idea as a personal, within-user paired comparison rather than a group-level classifier [longitudinal_voice_treatment_response_source]. A `RelapseSample` is a compact, comparable summary `{ capturedAt, dimensional: ValenceArousal, riskScore }`, where `riskScore in [0,1]` is a blend of depressive/anxiety/stress/instability heads computed by the orchestrator from a `MultiHeadAffectInference`; the engine stays agnostic to its makeup.

`classifyComparison(current, reference, kind)` evaluates the current hum against four `RELAPSE_REFERENCE_KINDS`:

| Reference kind | Meaning | Signed `riskDelta` semantics |
| --- | --- | --- |
| `previous_stable` | a previously stable/recovered hum | rising risk -> worsening/`relapse_drift` |
| `previous_high_risk` | a previously high-risk hum | moving *away* -> recovery; staying high -> `relapse_drift` |
| `baseline_7d` | last 7-day personal baseline | rising risk -> worsening/`relapse_drift` |
| `baseline_30d` | last 30-day personal baseline | rising risk -> worsening/`relapse_drift` |

`assessRelapse(current, references, options)` synthesizes the available comparisons into one `RelapseVerdict` over the five `RELAPSE_CLASSES` — `recovery | stable | worsening | relapse_drift | uncertain` — plus a normalized `drift` (mean of positive risk deltas) and a `rationale`. The verdict maps to the affect contract's `recovery_worsening_unchanged` head via `DvdsaClass` (`DVDSA_CLASSES = recovery | worsening | unchanged`): `stable -> unchanged`, `relapse_drift -> worsening`, and `uncertain -> null`. This extends DVDSA's three classes with `stable` and `uncertain` so the engine can decline.

## Consequences

- **Cold-start is handled by priors, then overridden.** At `population_prior` the model reads the hum only against public-dataset priors and clinical priors, capped at 0.72; as eligible hums accumulate the personal baseline and within-user models take over and the cap climbs to 0.92. Priors never become hum truth — the clinical literature is a `clinical_prior` only [clinical_voice_biomarker_review].
- **Relapse requires accumulated history; otherwise it abstains.** `relapseModelActive` is false until 20+ eligible hums, and `assessRelapse` returns `uncertain` (`dvdsa: null`) when no personal reference is available — "we never guess a relapse with no history." Conflicting references also resolve to `uncertain`. This pairs with `ABSTAIN_REASONS` (`insufficient_baseline`, `first_hum`) in the confidence model.
- **Confidence is tied to stage.** `confidenceCap` and `calibrationMaturity` flow from `stagePolicy` into the fusion confidence model, so a low-maturity user can never produce a high-confidence claim. Capture quality imposes a separate ceiling via `CAPTURE_QUALITY_CONFIDENCE_CAP`; effective confidence is the minimum.
- **Outputs stay non-clinical markers.** A `relapse_drift` verdict is surfaced as a *relapse-risk drift* / *early-warning pattern*, never a diagnosis, never a guarantee of prevention. Hum is non-clinical and not clinically validated; all user-facing text passes `@hum-ai/safety-language`.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| Group-level classifier only | Rejected | Not personalized; DVDSA shows within-patient paired change carries the signal, and population classification ignores individual variation [longitudinal_voice_treatment_response_source]. |
| Fixed population thresholds | Rejected | The clinical thresholds are bias-prone and unvalidated on hums; absolute cutoffs misread users whose normal differs from the population [clinical_voice_biomarker_review]. Robust per-user baselines (median/MAD/IQR) replace them [hum_spec]. |
| No longitudinal model | Rejected | Misses the core goals — recovery tracking and relapse-risk prevention require within-user change over time [longitudinal_voice_treatment_response_source]. |

## Sources

- [hum_spec] — Hum technical specification: 12s protocol, robust baseline (median/MAD/IQR, robustStd, zDelta), 5-hum activation, rolling window 24, confidence caps.
- [longitudinal_voice_treatment_response_source] — Kim et al., *Comms Med* 2026: DVDSA within-patient paired comparison; WavLM F1 78.05%/70.58%; only F0 significant.
- [clinical_voice_biomarker_review] — Briganti & Lechien, *J Voice* 2025: AUC 0.71-0.93, 6/12 high bias risk; clinical prior only.
- [ser_mental_health_review] — Jordan et al., *JMIR Ment Health* 2025: dimensional valence-arousal underexplored; abstention discipline.
- [vocal_biomarker_and_singing_protocol_support] — Rodrigo & Duñabeitia, *Brain Sci* 2025: language-independent, transferable acoustic features.
