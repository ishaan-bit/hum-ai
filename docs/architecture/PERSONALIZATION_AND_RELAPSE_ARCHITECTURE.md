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
[ADR-0004](../adr/0004-confidence-and-abstention.md),
[ADR-0007](../adr/0007-dual-baseline-rolling-and-anchored.md).

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

## Dual baseline (ADR-0007)

A single rolling baseline cannot do two opposite jobs at once — adapt fast enough to
track genuine change, yet stay stable enough to be a trustworthy relapse reference — so
Hum keeps **two** baselines (`buildDualBaseline` in `dual-baseline.ts`):

- **Rolling short-term baseline.** `buildBaselineVector(samplesByFeature, rollingWindow = ROLLING_WINDOW)`
  mirrors `hum_spec` §4.6: for each feature it takes the **last `ROLLING_WINDOW` (24)**
  eligible-hum samples and computes `RobustStats` via `computeRobustStats`: `median`
  (robust center), `mad`, `iqr` (p75 − p25), and `robustStd = MAD × 1.4826` (`MAD_TO_STD`,
  the normal-consistent estimator) [hum_spec]. Robust estimators are used instead of
  mean/SD because early baselines are small and fragile and must not be hijacked by a
  single outlier hum. This is "your recent usual" and what z-deltas are computed against.
- **Anchored long-term baseline.** A slowly-updated, drift-resistant reference built by
  `buildAnchoredBaseline` over `ANCHOR_LONG_WINDOW` (180) samples and nudged online by a
  small-α EMA (`ANCHOR_EMA_ALPHA` = 0.05, `updateAnchoredCenter`). It activates only once
  the account is mature — `ANCHOR_MIN_HUMS` (20) eligible hums, the same boundary at which
  the ladder's `relapse_model` stage turns on. This is "your established usual".

The **divergence** between the two (`baselineDivergence`, rolling center vs anchored
center in anchored-σ units) is itself the signal: a rolling center that has drifted far
from the anchor is exactly the short-vs-long-term separation the relapse-drift head needs.
The orchestrator clamps it into a longitudinal-trend strength (`longitudinalTrend`) that
informs — but does not directly become — the `relapse_drift` head, which is what prevents
a slow slide being silently absorbed into "your usual" (the masking failure ADR-0007 cites).

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

## The personalization engine — apply and learn

The ladder, profile and dual baseline above are the *state*; two engine steps turn that
state into an individual read and keep it growing. Both are pure functions in
`@hum-ai/personalization-engine` and are wired into the runtime read by
`@hum-ai/orchestrator` (the population-prior fusion output is re-referenced *before* the
relapse, intervention and safety stages run).

### Apply — making a read individual (`personalize.ts`)

A population prior reads a hum against a crowd; `applyPersonalization(prior, zDeltas, policy)`
reads it against the *user's own* baseline. It asks one disciplined question —
`personalDeviation` reduces the per-feature z-deltas to a `selfNormality ∈ (0,1]`, the
robust (median-of-|z|) answer to *how usual is this hum for this person?* — and then:

- pulls the dimensional V-A point toward the user's neutral (origin) in proportion to how
  usual the hum is, so a naturally low/breathy/quiet hummer's *normal* reads as their
  normal rather than as the population's "low mood";
- raises `neutral_close_to_usual` toward `selfNormality`, mildly lifts `calm_regulated`,
  and damps every other state activation **by the same factor** — risk markers are never
  selectively suppressed;
- preserves the population prior when the hum *departs* from the user's baseline
  (`selfNormality → 0`), so a genuine personal change is not smoothed away.

The strength is `personalizationWeight(policy)` — λ derived from the ladder gates so it
cannot desync: `0` while `baselineActive` is false (priors must own the cold start), then
`0.30 → 0.55 → 0.70` across `personal_baseline → personalized_fusion → relapse_model`.
The effective re-reference `pull = λ × coverage × selfNormality` is additionally scaled by
per-feature **coverage** (`support / MIN_SUPPORT_FOR_FULL`) — thin baselines barely move
the read. Personalization re-references and damps; it never *manufactures* affect or risk
beyond what the prior carries (amplifying personal deviations in a validated direction is
the trained model's job, not this layer's). Confidence, abstention and the longitudinal
heads are left untouched — the ladder owns confidence ceilings, the relapse engine owns the
longitudinal heads. `personalizedExpertWeight` (in `@hum-ai/fusion-engine`) is the matching
hook for blending the learned `modality_reliability_vector` into fusion weights once a user
reaches `personalizedFusionActive`.

### Learn — accumulating the per-user model (`update.ts`, `state.ts`, `signatures.ts`)

`PersonalizationState` carries the syncable `UserModelProfile` plus two **local-only**
bounded rings: the per-feature derived-value windows the dual baseline is computed from
(≤ `FEATURE_HISTORY_LIMIT` = `ANCHOR_LONG_WINDOW`) and a small ring of relapse summaries.
`ingestHum(state, observation)` folds one *eligible* hum in — rebuilding the rolling and
anchored baselines, EMA-nudging the learned per-modality and per-domain reliability toward
what fusion actually trusted, extending the `recovery_signature_vector` /
`high_risk_signature_vector` (centroids of the hum's z-deltas, routed by its risk band, and
only once the baseline is active), learning the `intervention_response_vector`, and
advancing the stage so `calibration_maturity` / `confidence_cap` track the ladder.
Ineligible hums are returned unchanged: only quality-gated hums shape the model.

Only `syncableProfile(state)` ever leaves the device — the derived profile, with the
raw-audio guard run over its free-form feature-keyed maps (the fixed `audio | face | text`
modality keys are channels, not raw audio, and are not name-scanned). The orchestrator
closes the loop with `humHistoryFromState` (state → read-time `HumHistory`) and
`observationFromRead` (read → learning `HumObservation`):

```text
state ─humHistoryFromState─► orchestrateHumRead ──► read (re-referenced, individual)
  ▲                                                   │
  └────────── ingestHum ◄── observationFromRead ◄─────┘   (learn from this hum)
```

## Adaptive personal affect model (v2)

v1 re-references the read against a flat median-of-|z| deviation under a single
ladder λ. v2 makes the personal model genuinely individual — it learns *which* axes
carry this person's signal, how much each is earned, when their normal has changed,
and what helps them — while keeping every v1 guarantee (honest, non-clinical,
derived-only, abstention-safe; v2 is a strict superset, and `applyPersonalization`
falls back to v1 byte-for-byte when no model context is supplied).

- **Per-feature salience (`salience.ts`).** A learned weight per feature =
  evidence coverage (`n/(n+K)`) × a **redundancy decorrelation** discount
  (`1/(1+Σ|corr|)`) so a cluster of co-moving features — e.g. the loudness-linked
  energy features — can't dominate. The read leans on the user's reliable, *independent*
  axes instead of every DSP feature equally. A cheap, stable stand-in for an
  inverse-covariance (Mahalanobis) weighting on small, ragged real-user samples.
- **Empirical-Bayes shrinkage (`shrinkage.ts`).** The prior→personal handoff is
  per-feature and evidence-driven (`evidenceWeight = n/(n+K)`, James–Stein flavor),
  not one global λ: a feature seen cleanly ten times earns more personal trust than
  one seen twice.
- **Salience/evidence-weighted deviation (`deviation.ts`).** `personalDeviationV2`
  aggregates **winsorized** z-deltas weighted by salience × evidence → a robust
  `selfNormality`, and reports the **top contributors** — *which* features drove the
  departure from the user's usual ("what's different about your hum today"). A
  deviation only on a low-salience axis correctly reads as still-usual.
- **Online regime detection (`changepoint.ts`).** A two-sided **Page–Hinkley** test
  on the per-hum signed drift catches a *sustained* shift in the user's baseline
  (recovery, a hard stretch, a new normal), reports its direction, and lifts the
  `adaptation_rate` so the model re-centers on the new normal instead of silently
  absorbing or fighting it. The read becomes regime-aware (`REGIME_ADAPTATION_BOOST`).
- **Personalized intervention policy (`bandit.ts`).** A contextual bandit over the
  user's own intervention outcomes — per-arm reward + uncertainty (Welford), with
  deterministic **UCB** and optional seeded **Thompson sampling** — balances
  exploiting what has worked for this person against exploring what is under-tried.
  It is **wired into selection**: `selectInterventionFromView` stays the single
  safety authority (it owns the V-A region and the gated `escalation` / `none` /
  abstain decisions), and the bandit chooses only among that region's safe
  `supportiveCandidates` — and only once the user is established
  (`personalizedFusionActive`) and has real intervention history. The safety gates
  are never overridden.
- **Circadian context (`context.ts`).** Per-time-of-day feature centers
  (`contextual_centers`, EMA per bucket) let the read be re-referenced against
  "your usual *at this time of day*" once a bucket is well-sampled
  (`contextAdjustedBaseline`); it falls back to the global baseline otherwise. Only
  centers are kept (spread is borrowed), so the synced footprint stays small.

These are learned in `ingestHum` (cached on the profile: `salience_vector`, `regime`,
`intervention_policy`, `adaptation_rate`, `contextual_centers`) and consumed cheaply at
inference; the orchestrator passes salience + the (circadian-adjusted) rolling baseline +
recent regime shift + the intervention policy into the read via `HumHistory`. Constants
(`K`, `τ`, Page–Hinkley `δ`/`λ`, the bandit explore weight, circadian `minN`) are
principled defaults, not yet tuned on native hums — revisit under the
[VALIDATION_PLAN](../validation/VALIDATION_PLAN.md). Recency-/quality-weighted baseline
construction remains the one designed-in extension still deferred.

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
