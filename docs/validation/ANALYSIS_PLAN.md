# Statistical Analysis Plan (SAP) — Hum Screening Pilot

**Status:** DRAFT, locked by biostatistics before unblinding · **Status date:** 2026-06-22
**Final thresholds, N, and multiplicity method are biostatistics-locked in [PRE_REGISTRATION](./PRE_REGISTRATION.md).**

**Companion docs:** [PRE_REGISTRATION](./PRE_REGISTRATION.md) · [IRB_PROTOCOL](./IRB_PROTOCOL.md) ·
[POWER_ANALYSIS](./POWER_ANALYSIS.md) · [QUADAS2](./QUADAS2.md) · [DATA_DICTIONARY](./DATA_DICTIONARY.md) ·
[VALIDATION_PLAN](./VALIDATION_PLAN.md).

> This statistical analysis plan is pre-specified and frozen before the analysis cut. The screening
> probability is **blinded** during collection; all operating-point and calibration computations happen
> only on the locked cut, on out-of-fold scores. Implemented by `@hum-ai/screening-model`
> (`evaluateScreening`, `assessScreeningPromotion`) over `@hum-ai/signal-lab/evaluate-binary` and the
> metric primitives in `@hum-ai/shared-types/metrics.ts`.

---

## 1. Analysis populations

| Population | Definition |
| --- | --- |
| **Enrolled** | All participants with a valid enrolment `ResearchConsentRecord`. |
| **Analysis set (per target)** | Eligible `ClinicalHumExample` rows (`eligible = true`, passed the quality gate) carrying the relevant instrument: PHQ-9 for depression, GAD-7 for anxiety (`buildScreeningSamples` filters to `trainableClinicalExamples`). |
| **Abstention set** | Rows the model abstains on (poor-capture / domain-mismatch / OOD) — analyzed separately for abstention precision/recall, not scored for AUC. |
| **Withdrawn** | Excluded entirely (deletion propagated; [IRB_PROTOCOL §8](./IRB_PROTOCOL.md)). |

The two co-primary targets are analyzed on their **own instrument subsets**; a participant with only
one instrument contributes only to that target.

## 2. Participant-grouped cross-validation

- **k-fold CV with group key = `participantPseudonym`** (`groupFolds`): one participant's rows never
  split across train/test, so within-participant correlation cannot leak optimism into the estimate.
  This is the study analog of RAVDESS actor-grouping.
- Default **k = 5** folds (`evaluateBinary` default), set finally by biostatistics with N.
- A fold whose **training split is single-class** cannot learn a boundary and is **skipped honestly**
  (its rows are reported as unscored in `notes`), never imputed to chance.
- Model: the deterministic logistic-regression backbone from `@hum-ai/signal-lab` over the canonical
  feature vector (`toFeatureVector` / `featureVectorNames`), retrained per fold.

## 3. Co-primary: discrimination (AUC) with 95% CI

- **AUC** = ROC AUC on pooled out-of-fold P(positive) scores via the rank (Mann–Whitney U) identity with
  tie-aware average ranks (`rocAuc`). AUC is **NaN-honest**: undefined (single-class) is surfaced, never
  defaulted to 0.5.
- **95% CI:** **participant-grouped percentile bootstrap** — resample *whole participants* with
  replacement, recompute AUC each iteration, take the 2.5/97.5 percentiles (`groupedBootstrapAucCI`,
  default 500 iterations). Grouping the bootstrap by participant keeps the CI honest under repeated
  within-participant measures.
- **Decision bar:** both the AUC point estimate **and** the CI lower bound must clear the pre-registered
  gate (`minAuc`, `minAucCiLower`) — the CI lower bound is the conservative floor.

## 4. Significance test

- **Label-permutation null over the same grouped CV:** shuffle the positive labels, rerun the full
  grouped-CV scoring, recompute AUC; repeat (default 100 permutations). Empirical p-value =
  `(count[null AUC at least observed] + 1) / (permutations + 1)` (`significance.pValue`). This tests
  discrimination above chance without distributional assumptions and respects the grouping.

## 5. Operating-point selection

- **Youden index** (`youdenJ = sensitivity + specificity − 1`) maximized over candidate thresholds on
  out-of-fold scores (`bestYoudenThreshold` → `atYoudenThreshold`). Report at that point:
  **sensitivity, specificity, PPV, NPV, accuracy, balanced accuracy, F1** (`BinaryClassificationMetrics`).
- Metrics at the default 0.5 threshold (`atDefaultThreshold`) are reported alongside for transparency.
- **PPV/NPV caveat:** PPV/NPV depend on prevalence; because the cohort is self-recruited (spectrum bias),
  PPV/NPV are reported *at the cohort prevalence* and explicitly **not** projected to a general-population
  prevalence without external replication ([QUADAS2](./QUADAS2.md)).

## 6. Calibration assessment

- **Reliability diagram** over 10 equal-width probability bins + **binary ECE**
  = Σ (n_b/N)·|observedRate − meanScore| (`reliabilityDiagram`). This asks whether the screening
  probability matches the observed positive rate — the calibration question for a screening probability,
  distinct from top-class multiclass ECE.
- **Bar:** ECE at or below `maxEce` (gate). A discriminating-but-miscalibrated model does **not** clear
  the gate; no operating point is acted on until calibration is adequate.

## 7. Abstention handling

- Abstention (`fusion-engine` caps + `quality-gate`, `ABSTAIN_REASONS`) is a **first-class outcome**, not
  a missing value. A poor-capture / OOD hum must abstain rather than emit a probability.
- Abstained rows are **excluded from the AUC/operating-point analysis** (no probability to score) and
  analyzed in their own endpoint: **abstention precision/recall** on a curated adversarial set
  ([VALIDATION_PLAN §3c](./VALIDATION_PLAN.md)) — high recall on genuinely unreadable input, few false
  abstentions on clean hums.

## 8. Missing-data handling

- **Missing instrument:** a row missing the target instrument is excluded from that target (no imputation
  of a clinical reference).
- **Ineligible captures:** `eligible = false` rows are excluded from modeling and retained as labelled
  abstention examples ([NATIVE_HUM_DATA_SPEC §8](./NATIVE_HUM_DATA_SPEC.md)).
- **Item-level missingness within an instrument:** an instrument with out-of-range or wrong-length items
  fails `buildPhq9Response`/`buildGad7Response` validation and is not scored (no partial-total imputation
  in the primary analysis); sensitivity analyses for item-level missingness are pre-specified by
  biostatistics if non-trivial.
- **Degenerate folds:** handled by the honest single-class skip (§2), reported in `notes`.

## 9. Multiplicity

Two co-primary endpoints (depression, anxiety) → family-wise error controlled at α = 0.05 by
**Holm–Bonferroni** on the two permutation p-values (precedent in
[longitudinal_voice_treatment_response_source]). Both co-primaries must independently clear the gate.
Secondary endpoints are reported descriptively with CIs and are **not** alpha-protected. The exact
method and any secondary hierarchy are locked in [PRE_REGISTRATION §7](./PRE_REGISTRATION.md).

## 10. Pre-registered promotion gate (the analysis bar)

`assessScreeningPromotion` returns `promote` only if **every** criterion clears (never rounds up). These
defaults are placeholders pending biostatistics sign-off; the locked values are set in the
pre-registration before unblinding.

| Criterion | Source field | Placeholder | Rationale |
| --- | --- | --- | --- |
| Min labelled rows | `minRows` | 200 | stable AUC estimate; consistent with `evaluate-binary` "insufficient" tier below 60 |
| Min participants | `minParticipants` | 100 | enough groups for grouped CV + bootstrap |
| AUC floor | `minAuc` | 0.80 | clinically meaningful discrimination, within the [clinical_voice_biomarker_review] 0.71–0.93 band |
| AUC CI lower floor | `minAucCiLower` | 0.70 | conservative honest floor |
| p-value ceiling | `maxPValue` | 0.01 | stricter than the 0.05 evidence-tier screen |
| ECE ceiling | `maxEce` | 0.10 | calibrated screening probability |
| Sensitivity | `minSensitivity` | 0.80 | a screen should miss few true positives |
| Specificity | `minSpecificity` | 0.70 | acceptable false-positive burden for a screen |

The gate is deliberately **far stricter** than the on-device native-axis retrain gate
(`@hum-ai/native-corpus`) because this is a clinical screening claim, not a within-user reflective nudge.

## 11. Secondary & exploratory analyses

- **Longitudinal relapse (secondary):** within-user agreement of the relapse engine output vs
  repeated-instrument transitions, mapped to DVDSA `recovery/unchanged/worsening`
  [longitudinal_voice_treatment_response_source]; reported **per-user**, not group accuracy.
- **Convergent validity (exploratory):** correlation of dimensional V-A outputs with continuous
  PHQ-9/GAD-7 totals (correlation, not classification) ([VALIDATION_PLAN §3e](./VALIDATION_PLAN.md)).
- **Intervention helpfulness (exploratory):** UCB bandit reward vs neutral baseline.

## 12. Reproducibility

- All randomness is seeded (`makeRng`, `seed`); a fixed seed + frozen corpus snapshot reproduces every
  reported number.
- The analysis is dry-run on synthetic labelled data before any real data exists, to confirm grouped-CV /
  AUC / calibration / abstention / gate behavior.
- Evidence tier (`evaluate-binary` `decideBinaryTier`) and the standing caveats (research-stage; not a
  diagnosis; spectrum-biased cohort; calibration required) are reported alongside every result.

---

### Sources

[clinical_voice_biomarker_review] · [longitudinal_voice_treatment_response_source] · [hum_spec].
Full facts in [docs/source/INDEX.md](../source/INDEX.md).
