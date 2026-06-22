# QUADAS-2 Alignment — Hum Screening Pilot

**Status:** DRAFT (risk-of-bias plan; the scored review runs at the Phase-2 analysis gate) · **Status date:** 2026-06-22

**Companion docs:** [PRE_REGISTRATION](./PRE_REGISTRATION.md) · [IRB_PROTOCOL](./IRB_PROTOCOL.md) ·
[ANALYSIS_PLAN](./ANALYSIS_PLAN.md) · [POWER_ANALYSIS](./POWER_ANALYSIS.md) ·
[DATA_DICTIONARY](./DATA_DICTIONARY.md) · [VALIDATION_PLAN](./VALIDATION_PLAN.md) ·
[CLAIMS_LADDER](../claims/CLAIMS_LADDER.md).

QUADAS-2 is the standard risk-of-bias tool for diagnostic-accuracy studies and is the field's expected
control for voice-based mental-health work [ser_mental_health_review]; the depression voice-biomarker
literature is explicitly flagged because **6/12 studies carry high methodological-bias risk**
[clinical_voice_biomarker_review]. This document maps the four QUADAS-2 domains to the Hum pilot design
**up front**, names where the design is at risk, and states the mitigation. It is the pre-commitment a
scored QUADAS-2 review is run against at the Phase-2 gate ([PRE_REGISTRATION §9](./PRE_REGISTRATION.md)).

---

## 1. Domain summary

Each domain is assessed for **risk of bias** and **applicability**. Anticipated ratings are honest
self-assessments before data; the Phase-2 review re-scores them on the actual cohort.

| Domain | Risk of bias (anticipated) | Applicability concern |
| --- | --- | --- |
| 1. Patient selection | **HIGH** — self-recruited remote cohort | High — spectrum may not match a target screening population |
| 2. Index test | Low | Low |
| 3. Reference standard | Moderate — self-administered PHQ-9/GAD-7 (not clinician interview) | Low for a *screening* claim |
| 4. Flow & timing | Low | Low |

## 2. Domain 1 — Patient selection

**Signalling questions.** Was a consecutive or random sample enrolled? Was a case-control design
avoided? Were inappropriate exclusions avoided?

**Design mapping.** The pilot is a **self-recruited remote cohort** with in-app enrolment
([IRB_PROTOCOL §3](./IRB_PROTOCOL.md)), recruited to span the symptom range (minimal → severe) so both
screening cuts (PHQ-9 ≥ 10, GAD-7 ≥ 10) are represented. Coarse, non-identifying strata
(`ClinicalHumExample.stratum`, e.g. `adult_general`) and `deviceClass` are recorded to audit spectrum
coverage; `@hum-ai/clinical-corpus` `clinicalCorpusStats` reports class balance at each cut and
per-device / per-stratum counts.

**Named bias.** **Self-recruited-cohort spectrum bias (HIGH).** The sample is neither consecutive nor
random; volunteers may differ systematically (e.g. tech-comfort, symptom awareness), and prevalence is
not the target-population prevalence. This is the single largest risk in the study and is **declared up
front** in the pre-registration ([PRE_REGISTRATION §9](./PRE_REGISTRATION.md)) and the
`evaluate-binary` standing caveats.

**Mitigation.** Participant-grouped CV + permutation/bootstrap (no leakage, honest CIs); recruitment to
cover the symptom + demographic + device spectrum; PPV/NPV reported only at cohort prevalence, never
projected to a general population; and **external, independent replication required** before any
validated claim ([CLAIMS_LADDER §5](../claims/CLAIMS_LADDER.md) condition 2).

## 3. Domain 2 — Index test

**Signalling questions.** Were index-test results interpreted without knowledge of the reference
standard? Was a threshold pre-specified?

**Design mapping.** The index test is the hum-derived screening probability (`evaluateScreening`,
`@hum-ai/screening-model`). It is computed **deterministically from derived `AcousticFeatures`** and is
**blinded** during collection — never shown to the participant, never reaching the consumer read path
(firewalled from `apps/web`/orchestrator/render per ADR-0006). The operating-point threshold is
**pre-specified by the analysis method** (Youden on out-of-fold scores, [ANALYSIS_PLAN §5](./ANALYSIS_PLAN.md)),
not chosen after seeing accuracy.

**Risk: LOW.** The index test cannot be influenced by knowledge of the reference standard (it is a fixed
function of features), and the threshold rule is locked in the SAP before unblinding.

## 4. Domain 3 — Reference standard

**Signalling questions.** Is the reference standard likely to classify the target condition correctly?
Were reference results interpreted without knowledge of the index test?

**Design mapping.** The reference standard is **PHQ-9 ≥ 10 (depression)** and **GAD-7 ≥ 10 (anxiety)** —
the standard, validated "moderate or worse" screening cut-points (`PHQ9_SCREENING_CUT`,
`GAD7_SCREENING_CUT`), scored deterministically (`buildPhq9Response`/`buildGad7Response`). They are
self-administered. The reference is interpreted **independently of the index test** (the probability is
blinded), so there is no incorporation bias.

**Risk: MODERATE (and bounded by the claim).** A self-report screening instrument is **not** a
diagnostic gold standard (a structured clinical interview would be). This is acceptable *because the
claim is bounded to screening, never diagnosis* — the validated target is literally "an investigational
screening signal validated against PHQ-9 ≥ 10 / GAD-7 ≥ 10," not "detects depression." The applicability
concern for a screening claim is therefore **low**.

## 5. Domain 4 — Flow & timing

**Signalling questions.** Was there an appropriate interval between index test and reference standard?
Did all patients get the same reference standard? Were all patients included in the analysis?

**Design mapping.** Hum capture and instrument administration occur **in the same session** within a
tight, pre-registered interval, recorded explicitly as `ClinicalSessionLink.gapMinutes` — a too-large
gap is an **exclusion criterion**, removing the risk that mood changed between index and reference.
Every analyzed participant receives the **same** reference standard for the target. Flow is fully
accounted: ineligible captures are retained as abstention examples (not silently dropped), degenerate
folds are reported in `notes`, and withdrawn participants are excluded with deletion propagated
([ANALYSIS_PLAN §1, §7, §8](./ANALYSIS_PLAN.md); [IRB_PROTOCOL §8](./IRB_PROTOCOL.md)).

**Risk: LOW.**

## 6. How the QUADAS-2 review gates the claim

The scored QUADAS-2 review is a **Phase-2 gate condition**: the co-primary endpoints being met is *not*
sufficient — the review must also pass (patient-selection bias acknowledged and mitigated, not
disqualifying) and a clinician-collaborative review must concur before the screening claim is even
considered ([PRE_REGISTRATION §10](./PRE_REGISTRATION.md), [CLAIMS_LADDER §5](../claims/CLAIMS_LADDER.md)).
The HIGH patient-selection rating is precisely why **external replication** is a hard, separate unlock
condition and why `validatedRegulatoryMode` stays `false` after a single self-recruited pilot.

---

### Sources

[ser_mental_health_review] · [clinical_voice_biomarker_review] · [hum_spec] ·
[longitudinal_voice_treatment_response_source]. Full facts in [docs/source/INDEX.md](../source/INDEX.md).
