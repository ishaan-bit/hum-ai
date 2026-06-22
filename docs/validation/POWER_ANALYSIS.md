# Power & Sample-Size Reasoning — Hum Screening Pilot

**Status:** DRAFT (indicative sizing) · **Status date:** 2026-06-22
**Final N, assumptions, and power are BIOSTATISTICS-LOCKED in [PRE_REGISTRATION](./PRE_REGISTRATION.md) before enrolment.**

**Companion docs:** [PRE_REGISTRATION](./PRE_REGISTRATION.md) · [ANALYSIS_PLAN](./ANALYSIS_PLAN.md) ·
[IRB_PROTOCOL](./IRB_PROTOCOL.md) · [QUADAS2](./QUADAS2.md) · [NATIVE_HUM_DATA_SPEC](./NATIVE_HUM_DATA_SPEC.md).

> The numbers below are **indicative engineering-sizing targets**, not a finalized power calculation.
> They exist to size the consent, storage, and recruitment infrastructure and to justify the
> `@hum-ai/screening-model` `DEFAULT_SCREENING_GATE` minimums. Final effect-size assumptions,
> prevalence, and target N are set by the biostatistics collaborator and locked in the pre-registration.

---

## 1. What must be powered

The **two co-primary endpoints** ([PRE_REGISTRATION §3.1](./PRE_REGISTRATION.md)):

1. AUC of the hum **depression** signal vs **PHQ-9 ≥ 10**.
2. AUC of the hum **anxiety** signal vs **GAD-7 ≥ 10**.

The sizing must give adequate power to (a) reject AUC = 0.5 at the multiplicity-adjusted alpha, and
(b) — the binding constraint — return an AUC **95% CI lower bound** above the pre-registered floor
(`minAucCiLower`), since the gate requires the *conservative* bound to clear ([ANALYSIS_PLAN §3](./ANALYSIS_PLAN.md)).

## 2. Assumptions (indicative; biostatistics-locked before enrolment)

| Assumption | Indicative value | Basis |
| --- | --- | --- |
| Expected AUC (alternative) | **0.75–0.80** | conservative lower-middle of the [clinical_voice_biomarker_review] 0.71–0.93 voice→depression band, discounted for the speech→hum domain gap |
| Null AUC | 0.50 | no discrimination |
| Screen-positive prevalence (each cut) | **~0.30–0.40** | recruitment deliberately covers the symptom range so both classes are well represented; not a general-population prevalence (spectrum bias, [QUADAS2](./QUADAS2.md)) |
| Two-sided alpha (per endpoint, multiplicity-adjusted) | **0.025** | α = 0.05 split across two co-primaries by Holm–Bonferroni ([ANALYSIS_PLAN §9](./ANALYSIS_PLAN.md)) |
| Power (1 − β) | **0.80–0.90** | conventional |
| Clustering | repeated within-participant hums | inflates variance → participant-grouped bootstrap CI; sizing counts **participants**, not just rows |

## 3. Indicative sample size

For a single AUC vs 0.5 (Hanley–McNeil-style sizing) at AUC ≈ 0.75, balanced-ish classes, two-sided
α = 0.025 and 80–90% power, the required number of **independent labelled cases is on the order of a few
hundred rows split across the two outcome classes**. Two practical consequences:

- Because measures are clustered within participant, the binding unit is the **participant count**, not
  the row count: repeated hums from one person add less independent information than the raw row count
  suggests. Sizing therefore targets participants and treats extra within-participant rows as a
  reliability bonus, not as independent power.
- Two co-primaries at α = 0.025 each cost slightly more than a single endpoint at α = 0.05 — the
  multiplicity penalty is modest but real and is folded into the locked N.

**Indicative target (consistent with `DEFAULT_SCREENING_GATE`):**

| Quantity | Indicative target | Maps to gate field |
| --- | --- | --- |
| Labelled rows (each target) | **≥ 200** | `minRows = 200` |
| Distinct participants | **≥ 100** | `minParticipants = 100` |
| Per-class minimum (each cut) | enough that neither screen-positive nor screen-negative is sparse | supports a stable AUC + Youden point |

These match the cross-sectional **C1** starting target in [NATIVE_HUM_DATA_SPEC §3](./NATIVE_HUM_DATA_SPEC.md)
(~200–400 participants, one labelled session each, balanced across the affect/symptom range and
demographics/devices). The longitudinal **C2** cohort (~50–150 participants, daily hums ≥ 3 months) is
sized for the *within-user* secondary relapse endpoint, which is powered per-participant, not by the
cross-sectional AUC logic.

## 4. Why these are the gate minimums

`DEFAULT_SCREENING_GATE` encodes `minRows = 200` / `minParticipants = 100` as the **floor below which
the result is not even eligible for promotion** — `assessScreeningPromotion` returns `hold` with a
`needs ≥200 labeled rows` / `needs ≥100 participants` reason otherwise, and `evaluate-binary` itself
rates < 60 rows as an `insufficient` evidence tier. The power target sits at or above this floor; the
gate is a hard pre-condition, the power analysis is what justifies aiming higher when the locked
effect-size assumption demands it.

## 5. Sensitivity / specificity power

Beyond AUC, the gate also requires sensitivity ≥ `minSensitivity` (0.80) and specificity ≥
`minSpecificity` (0.70) at the Youden point. Estimating each proportion to a useful CI width needs
adequate counts in each class; the per-class minimum in §3 is chosen so the sensitivity CI (computed on
screen-positives) and specificity CI (on screen-negatives) are both informative. If recruitment yields
a skewed class balance, biostatistics may raise N for the minority class rather than report a wide,
uninformative interval.

## 6. Limitations of this sizing

- Effect size is **assumed**, not measured; the true hum→screening AUC is unknown (no native-hum clinical
  corpus has ever been evaluated). The pre-registration locks a **conservative** assumption.
- Spectrum bias ([QUADAS2 §2](./QUADAS2.md)) means the achieved prevalence and case-mix may differ from
  assumptions; the participant-grouped bootstrap CI, not a closed-form formula, is the reported
  uncertainty, and external replication remains required regardless of N.
- This is a **single pilot**; it cannot equally power four pillars. Depression + anxiety screening are
  the powered co-primaries; relapse is a secondary within-user endpoint and intervention helpfulness is
  exploratory ([PRE_REGISTRATION §2](./PRE_REGISTRATION.md)).

---

### Sources

[clinical_voice_biomarker_review] · [longitudinal_voice_treatment_response_source] · [hum_spec].
Full facts in [docs/source/INDEX.md](../source/INDEX.md).
