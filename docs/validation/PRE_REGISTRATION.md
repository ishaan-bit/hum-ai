# Pre-Registration — Hum Cross-Sectional Depression & Anxiety Screening Pilot

**Status:** DRAFT for filing (OSF / ClinicalTrials.gov-style) · **Status date:** 2026-06-22
**Registration type:** Prospective, observational, diagnostic-accuracy (cross-sectional + longitudinal follow-up)
**Final numbers locked by biostatistics before any data is unblinded.**

**Companion docs:** [IRB_PROTOCOL](./IRB_PROTOCOL.md) · [ANALYSIS_PLAN](./ANALYSIS_PLAN.md) ·
[POWER_ANALYSIS](./POWER_ANALYSIS.md) · [QUADAS2](./QUADAS2.md) · [DATA_DICTIONARY](./DATA_DICTIONARY.md) ·
[VALIDATION_PLAN](./VALIDATION_PLAN.md) · [DIAGNOSTIC_ROADMAP](./DIAGNOSTIC_ROADMAP.md) ·
[CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) · [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md) ·
[NATIVE_HUM_DATA_SPEC](./NATIVE_HUM_DATA_SPEC.md).

> **Honesty posture (binding throughout the pilot).** Hum remains, for the entire data-collection and
> analysis window, **investigational · for research use only · not a diagnosis**. No screening
> probability is shown to any participant (it is *blinded* — computed, never surfaced). The validated
> screening claim is unlocked ONLY after the pre-registered endpoints below are met, governance signs
> off, and `validatedRegulatoryMode` is scoped to the specific validated claim ([CLAIMS_LADDER §5](../claims/CLAIMS_LADDER.md)).

---

## 1. Background & rationale

Voice features distinguish depression from controls at AUC 0.71–0.93 / accuracy 78–96.5% across 12
studies (16,872 participants), but **6/12 studies carry high methodological-bias risk** and
generalizability is unproven [clinical_voice_biomarker_review]. Speech-emotion-recognition work in
mental health is heterogeneous, dimensional valence–arousal is comparatively under-explored, and
QUADAS-2 risk-of-bias is the field's standard control [ser_mental_health_review]. Acoustic features
are language-independent and transferable, and **singing / sustained phonation can substitute for
speech** as a vocal-biomarker source [vocal_biomarker_and_singing_protocol_support] — the scientific
basis for Hum's standardized **12-second sustained hum** [hum_spec].

Hum extracts ~50 derived acoustic features on-device and (in this study) pairs them with the
self-administered PHQ-9 (depression) and GAD-7 (anxiety) reference instruments. No native-hum corpus
labeled with clinical reference instruments currently exists; every shipped model is far-domain acted
speech and fails its own promotion gate ([DIAGNOSTIC_ROADMAP §0](./DIAGNOSTIC_ROADMAP.md)). This pilot
is the first prospective, pre-registered collection of that paired ground truth and the first formal
test of whether a hum-derived signal discriminates the standard screening cut-points.

**Index test:** a hum-derived screening probability from `@hum-ai/screening-model`
(`evaluateScreening`), trained/evaluated by participant-grouped cross-validation. **Reference
standard:** PHQ-9 ≥ 10 (depression) and GAD-7 ≥ 10 (anxiety), the standard "moderate or worse"
screening thresholds (`PHQ9_SCREENING_CUT`, `GAD7_SCREENING_CUT`).

## 2. Objectives & hypotheses

| # | Hypothesis | Endpoint class |
| --- | --- | --- |
| **H1 (co-primary)** | The hum-derived depression signal discriminates PHQ-9 ≥ 10 above chance (AUC > 0.5; pre-registered floor per the promotion gate). | Co-primary |
| **H2 (co-primary)** | The hum-derived anxiety signal discriminates GAD-7 ≥ 10 above chance (AUC > 0.5; pre-registered floor per the promotion gate). | Co-primary |
| **H3 (secondary)** | At the locked operating point, sensitivity/specificity meet the pre-registered bar for each target. | Secondary |
| **H4 (secondary)** | The screening probability is adequately calibrated (binary ECE ≤ the locked cap). | Secondary |
| **H5 (secondary)** | Abstention (poor-capture / OOD) has high recall on unreadable hums with few false abstentions on clean hums. | Secondary |
| **H6 (secondary, longitudinal)** | Within-user hum trajectories track relapse/recovery transitions anchored by repeated PHQ-9/GAD-7. | Secondary |
| **H7 (exploratory)** | Intervention suggestions are rated helpful above a neutral baseline (UCB bandit). | Exploratory |

Hypotheses are **directional but not effect-sized as claims**: the pilot tests whether the signal
clears a pre-registered floor, not a specific headline accuracy. No accuracy/sensitivity figure is
asserted anywhere until the study reads out.

## 3. Endpoints

### 3.1 Co-primary endpoints
- **Depression discrimination:** ROC **AUC** of the hum depression probability vs **PHQ-9 ≥ 10**, with
  a participant-grouped bootstrap 95% CI (`evaluateBinary.aucCI95`).
- **Anxiety discrimination:** ROC **AUC** of the hum anxiety probability vs **GAD-7 ≥ 10**, same CI
  construction.

Both must clear the pre-registered gate (see §6). The two co-primaries are evaluated **independently**
on their respective instrument subsets; multiplicity is controlled per §7.

### 3.2 Secondary endpoints
- **Sensitivity / specificity / PPV / NPV** at the locked operating point (Youden-selected on
  out-of-fold scores), per `atYoudenThreshold`.
- **Calibration:** reliability diagram + **binary ECE** of the screening probability vs the observed
  positive rate (`reliabilityDiagram`).
- **Abstention precision/recall:** on adversarial poor-capture / domain-mismatch / OOD hums, against
  `ABSTAIN_REASONS` ([VALIDATION_PLAN §3c](./VALIDATION_PLAN.md)).
- **Longitudinal relapse/deterioration:** within-user agreement of the relapse engine
  (`recovery | stable | worsening | relapse_drift | uncertain`) against repeated-instrument
  transitions, evaluated **within-user, not group-accuracy** [longitudinal_voice_treatment_response_source].

### 3.3 Exploratory endpoints
- Intervention helpfulness (UCB bandit reward) above a neutral baseline.
- Construct/convergent correlations between dimensional V-A outputs and continuous PHQ-9/GAD-7 totals.

## 4. Design

- **Cross-sectional cohort (co-primary):** each participant completes one labelled session — a
  12-second hum paired with PHQ-9 + GAD-7 administered in the same session within a tight time gap
  (`ClinicalSessionLink.gapMinutes`, a pre-registered inclusion criterion). Repeated within-sitting
  hums (3–5) support capture reliability.
- **Longitudinal follow-up cohort (secondary):** a subset contributes daily/periodic hums with repeated
  PHQ-9/GAD-7 over a multi-month horizon (the DVDSA inspiration spans ~107 days
  [longitudinal_voice_treatment_response_source]) to anchor the within-user relapse endpoint.
- **Setting:** self-recruited remote cohort with in-app versioned e-consent and self-administered
  instruments; backend designed so an academic/clinical **partner site can plug in later** (clinician
  view, audit, administration). See [IRB_PROTOCOL](./IRB_PROTOCOL.md).
- **Raw audio:** derived features always; raw audio only for a model-development subset under the
  separate `research_audio_upload` opt-in, via the dedicated channel — never the derived sync payload
  ([DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md)).

## 5. Blinding

The screening probability is **blinded during the entire collection window**: it is computed and
stored as a study artifact but **never rendered to the participant** and never reaches the consumer
read path (`@hum-ai/screening-model` is firewalled from `apps/web`/orchestrator/render per ADR-0006).
Participants see only the existing reflective read + a study-status surface. Reference instruments are
self-administered and scored deterministically; the analyst computing AUC does not influence
instrument responses. Operating-point selection and calibration are computed only after collection
closes for the analysis cut, on out-of-fold scores.

## 6. Analysis summary

Full detail in [ANALYSIS_PLAN](./ANALYSIS_PLAN.md). In brief:

- **Participant-grouped k-fold CV** (group key = `participantPseudonym`) → zero participant leakage
  across folds (`groupFolds`, the study analog of RAVDESS actor-grouping).
- **Discrimination:** ROC AUC on pooled out-of-fold scores; participant-grouped percentile bootstrap
  95% CI (resample whole participants).
- **Operating point:** Youden's J on out-of-fold scores; report sensitivity/specificity/PPV/NPV.
- **Calibration:** reliability diagram + binary ECE.
- **Significance:** label-permutation null over the same grouped CV → empirical AUC p-value.
- **Pre-registered promotion gate** (`DEFAULT_SCREENING_GATE`, `@hum-ai/screening-model`) — the bar each
  co-primary must clear. **Defaults below are placeholders pending biostatistics sign-off; the locked
  values are set in this pre-registration before unblinding:**

  | Gate field | Placeholder | Meaning |
  | --- | --- | --- |
  | `minRows` | 200 | minimum labelled rows |
  | `minParticipants` | 100 | minimum distinct participants |
  | `minAuc` | 0.80 | AUC point-estimate floor |
  | `minAucCiLower` | 0.70 | AUC 95% CI lower-bound floor (the conservative bar) |
  | `maxPValue` | 0.01 | permutation p-value ceiling |
  | `maxEce` | 0.10 | binary calibration-error ceiling |
  | `minSensitivity` | 0.80 | sensitivity at the operating point |
  | `minSpecificity` | 0.70 | specificity at the operating point |

## 7. Multiplicity control (two co-primaries)

There are **two co-primary endpoints** (depression and anxiety). Family-wise error is controlled at
α = 0.05 across the two co-primaries using a **Holm–Bonferroni** procedure on the permutation p-values
(precedent for Holm-style control in the inspiration source [longitudinal_voice_treatment_response_source]).
Both co-primaries must independently clear the promotion gate (§6) for the screening claim to be
considered; success on one does not earn a claim on the other. Secondary endpoints are reported with
their CIs and are **not** alpha-protected; they are interpreted descriptively as supportive evidence.
The exact multiplicity method and any hierarchy among secondaries are locked by biostatistics here
before unblinding.

## 8. Stopping rules

- **Safety stop:** the crisis/safety-escalation pathway (PHQ-9 item 9 ≥ 1, `assessCrisisFromPhq`) is
  monitored continuously; a failure of the pathway to fire, or any safety signal flagged by the ethics
  collaborator, halts enrolment pending review ([IRB_PROTOCOL §6](./IRB_PROTOCOL.md)).
- **No efficacy interim unblinding:** because the probability is blinded and the analysis is a single
  pre-specified cut, there is **no interim efficacy analysis** and therefore no alpha spending for
  interim looks. Enrolment proceeds to the target N (see [POWER_ANALYSIS](./POWER_ANALYSIS.md)).
- **Futility / quality stop:** if capture reliability (study a) or QUADAS-2 spectrum coverage is
  inadequate at the Phase-1 gate, collection is paused for protocol amendment rather than analyzed.
- **Withdrawal:** any participant may withdraw at any time, triggering deletion across Firestore +
  Storage and an audit-log entry; withdrawn data is excluded from analysis.

## 9. Declared limitations

- **Self-recruited remote cohort → spectrum bias** (QUADAS-2 patient-selection domain): the cohort is
  not a consecutive or random clinical sample, so prevalence and case-mix may not match a target
  screening population. Declared up front; addressed by participant-grouped CV + permutation/bootstrap
  and by required external replication ([QUADAS2](./QUADAS2.md), [CLAIMS_LADDER §5](../claims/CLAIMS_LADDER.md)).
- **Self-administered reference instruments** (PHQ-9/GAD-7 self-report, not clinician interview):
  appropriate for a screening reference but not a diagnostic gold standard; the claim is bounded to
  *screening*, never diagnosis.
- **Single-site, single-time-window collection:** generalization across populations and devices is
  unproven until external replication (a §5 unlock condition).
- **No FDA/CE clearance this phase:** research-grade credibility only; diagnosis / relapse-prevention /
  medical-device claims remain categorically blocked in code.

## 10. Governance & sign-off

This pre-registration is filed before data collection and is co-signed by the mandatory
**clinical + biostatistics + ethics/IRB** collaborators ([NATIVE_HUM_DATA_SPEC §10](./NATIVE_HUM_DATA_SPEC.md)).
Any deviation is documented as a dated amendment. Biostatistics locks the final gate values (§6), N
(see [POWER_ANALYSIS](./POWER_ANALYSIS.md)), and the multiplicity method (§7) prior to unblinding.

---

### Sources

[hum_spec] · [clinical_voice_biomarker_review] · [ser_mental_health_review] ·
[vocal_biomarker_and_singing_protocol_support] · [longitudinal_voice_treatment_response_source].
Full facts in [docs/source/INDEX.md](../source/INDEX.md).
