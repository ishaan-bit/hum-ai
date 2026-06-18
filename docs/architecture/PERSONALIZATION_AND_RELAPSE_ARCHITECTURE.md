# Personalization and Relapse Architecture

How Hum stops being a stranger. A first hum can only be read against public-dataset
priors and a clinical literature that was never built on hums; every subsequent
eligible hum shifts weight away from those priors and toward the user's own rolling
baseline and within-user change models. This document specifies that progression — the
`@hum-ai/personalization-engine` ladder and profile, the robust baseline math, and the
`@hum-ai/relapse-engine` paired-comparison model — and the discipline that keeps a
non-clinical signal honest.

See also [Fusion and Confidence Architecture](./TRISENSE_ADAPTED_ARCHITECTURE.md),
[Affect Contracts](../../packages/affect-model-contracts/), and the
[Claims Ladder](../claims/CLAIMS_LADDER.md). Decisions: [ADR-0003](../adr/0003-personalization-and-relapse-model.md),
[ADR-0004](../adr/0004-confidence-and-abstention.md).

## The personalization ladder

`PERSONALIZATION_STAGES` is a five-rung ladder keyed to the count of **eligible** hums
(quality-gated captures that passed `@hum-ai/quality-gate`). `stagePolicy(n)` maps that
count to a `StagePolicy`: a confidence cap from `hum_spec` §4.8, a `calibrationMaturity`
factor for the confidence model, and three feature gates. The cap rises only as the
model earns the right to be confident — never above it [hum_spec].

| Eligible hums | `stage` | `confidenceCap` | `calibrationMaturity` | `baselineActive` | `personalizedFusionActive` | `relapseModelActive` |
| --- | --- | --- | --- | --- | --- | --- |
| 0–1 | `population_prior` | 0.72 | 0.45 | false | false | false |
| 2–4 | `early_calibration` | 0.76 | 0.52 | false | false | false |
| 5–9 | `personal_baseline` | 0.82 | 0.66 | **true** | false | false |
| 10–19 | `personalized_fusion` | 0.88 | 0.78 | true | **true** | false |
| 20+ | `relapse_model` | 0.92 | 0.90 | true | true | **true** |

The cap (and `calibrationMaturity`) are inputs to `ConfidenceModelV1` in
`@hum-ai/fusion-engine`; the personalization cap is one of several combined via
`combineCaps` (alongside the capture-quality cap from `CAPTURE_QUALITY_CONFIDENCE_CAP`),
so the effective ceiling is always the minimum. The thresholds (5 / 10 / 20) are the
same boundaries that activate the baseline, personalized fusion weights, and the relapse
model — the ladder is a single source of truth for "what is allowed to be on yet."

## `UserModelProfile`

The per-user model is **derived data only** — no raw audio, no per-session feature
history beyond what the rolling baseline retains. `assertNoRawAudioFields`
(`@hum-ai/shared-types`) guards anything synced. Fields:

| Field | Type | Role |
| --- | --- | --- |
| `user_id` | `UserId` | Owner. |
| `baseline_vector` | `BaselineVector` (`Record<string, RobustStats>`) | Robust center+scale per feature. |
| `feature_distribution_summary` | `Record<string, number>` | Compact n/coverage summary for quick checks. |
| `modality_reliability_vector` | `ModalityReliability` | Learned per-modality (audio/face/text) trust. |
| `domain_reliability_vector` | `Partial<Record<DomainClass, number>>` | Trust per audio domain. |
| `recovery_signature_vector` | `Record<string, number>` | Centroid of feature z-deltas in recovered/stable periods. |
| `high_risk_signature_vector` | `Record<string, number>` | Centroid of feature z-deltas in high-risk periods. |
| `intervention_response_vector` | `Partial<Record<InterventionType, number>>` | How each intervention tends to move this user. |
| `calibration_maturity` / `confidence_cap` | `UnitInterval` | Current `StagePolicy` values. |
| `last_updated_at` / `model_version` | `IsoTimestamp` / `ModelVersion` | Provenance. |

`newUserProfile(user_id, now, model_version)` seeds an empty profile at stage
`population_prior`: empty vectors, zeroed reliabilities, cap 0.72.

## Robust rolling baseline

`buildBaselineVector(samplesByFeature, rollingWindow = 24)` mirrors `hum_spec` §4.6.
For each feature it takes the **last 24** eligible-hum samples (`values.slice(-24)`) and
computes `RobustStats` via `computeRobustStats`: `median` (robust center), `mad`, `iqr`
(p75 − p25), and `robustStd = MAD × 1.4826` (`MAD_TO_STD`, the normal-consistent
estimator) [hum_spec]. Robust estimators are used instead of mean/SD because early
baselines are small and fragile and must not be hijacked by a single outlier hum.

`zDeltasAgainstBaseline(current, baseline)` scores the current capture per feature as
`zDelta = (current − median) / max(robustStd, ε)`, with `ε = 1e-6` flooring the
denominator so near-constant features don't explode. Features absent from the baseline,
or with `n = 0`, are skipped — the engine never invents a delta against a center it has
not earned. `featureRatio` (`current / median`, defined only when `median > 0`)
supplements z-deltas for scale-relevant features.

## From public priors to personal dominance

The cold start is borrowed knowledge. The fusion spine — three modality experts into a
late-fusion meta-learner — is adapted from TriSense, whose MELD stream/fusion accuracies
(18.4 / 38.0 / 54.0 → 66.0%) are **architecture-reference numbers on TV dialogue and are
never Hum metrics** [trisense_architecture]. The clinical voice→depression literature
(AUC 0.71–0.93, accuracy 78–96.5%, but 6/12 studies at high methodological-bias risk)
enters strictly as a `clinical_prior`, never as hum truth: clinical read speech is a
different acoustic domain than a sustained hum [clinical_voice_biomarker_review]. The
closest public bridge is sustained phonation / singing, whose acoustic features are
language-independent and transferable, which is what makes a hum a defensible biomarker
substrate at all [vocal_biomarker_and_singing_protocol_support].

Dominance shifts mechanically, not rhetorically. At `population_prior` the baseline is
inactive, so inference leans on priors under a 0.72 cap. At 5 hums the baseline switches
on and z-deltas become available; at 10 the meta-learner uses personalized fusion and
modality-reliability weights; at 20 the relapse model engages. Each rung raises the cap
because the evidence is increasingly the user's own. The dimensional vs. categorical
split in the affect contract (`ALL_AFFECT_HEADS` / `RISK_MARKER_HEADS`) follows the SER
mental-health review, which found dimensional valence–arousal under-explored relative to
categorical labels and SER used only indirectly — hence multi-head outputs plus
abstention rather than one confident classifier [ser_mental_health_review].

## The relapse engine

The relapse engine is a **personalized, within-user, paired comparison** — the DVDSA
method of `longitudinal_voice_treatment_response_source`, not a group-level classifier.
That source paired pre/post-treatment voice within 48 adolescent MDD patients (WavLM F1
78.05% binary, 70.58% on DVDSA; only F0 significant per-feature). We extend its three
classes to five [longitudinal_voice_treatment_response_source].

A `RelapseSample` is a compact, comparable summary of one hum: `capturedAt`, a
`dimensional` `ValenceArousal`, and a composite `riskScore ∈ [0,1]` (higher = more
concerning) that the orchestrator blends from the depressive/anxiety/stress/instability
heads — the engine stays agnostic to its makeup.

`classifyComparison(current, reference, kind)` compares against four
`RELAPSE_REFERENCE_KINDS`. Semantics depend on the kind, because the *meaning* of a risk
delta depends on what you're comparing to:

| `RelapseReferenceKind` | Reference | `classifyComparison` semantics (band = 0.12) |
| --- | --- | --- |
| `previous_stable` | a previously stable/recovered hum | rising risk → `worsening` (≥ band) or `relapse_drift` (≥ 2·band); falling → `recovery`; within band → `stable`. |
| `previous_high_risk` | a previously high-risk hum | moving **away** (≤ −band) → `recovery`; ≥ band → `worsening`; within band → `relapse_drift` if `riskScore ≥ 0.6`, else `stable`. |
| `baseline_7d` | last 7-day personal baseline | same rising-is-worse rule as `previous_stable`. |
| `baseline_30d` | last 30-day personal baseline | same rising-is-worse rule, over a longer horizon. |

`assessRelapse(current, references, options)` synthesizes whichever comparisons exist.
`drift` is the mean of positive risk deltas, normalized to `[0,1]` (`/ 0.5`, clamped) —
sustained worsening pressure across references. The verdict (`RelapseVerdict`) is decided
by vote with a drift override:

- `relapse_drift` — ≥ 2 `relapse_drift` comparisons, or ≥ 1 with `drift ≥ 0.5`
  (sustained drift toward a high-risk signature).
- `worsening` — worsening votes exceed both recovery and stable.
- `recovery` — recovery votes exceed worsening and ≥ stable.
- `stable` — stable dominates and worsening ties recovery.
- `uncertain` — references conflict with no quorum.

The five `RELAPSE_CLASSES` map to the contract's `recovery_worsening_unchanged` head via
`DvdsaClass`: `recovery → recovery`, `stable → unchanged`, `worsening → worsening`,
`relapse_drift → worsening`, `uncertain → null`.

### Why within-user, and when to abstain

Group-level classification would compare a user to a population they may not resemble and
would smuggle in the exact bias the clinical review flagged. Paired within-user
comparison asks a narrower, defensible question: *has this person drifted from their own
references?* This is why `relapseModelActive` is gated to 20+ hums — below that there is
not enough personal history for a stable reference set. When **no** reference is
available, `assessRelapse` returns `uncertain` with `dvdsa: null` and the rationale "no
personal reference available" — Hum never guesses a relapse with no history. All outputs
here are **relapse-risk drift** and **early-warning patterns** for reflection, run
through `@hum-ai/safety-language`; they are non-diagnostic, and Hum is not clinically
validated and not a medical device.
