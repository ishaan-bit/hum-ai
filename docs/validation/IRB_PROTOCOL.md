# IRB / Ethics Protocol — Hum Depression & Anxiety Screening Pilot

**Status:** DRAFT for IRB submission · **Status date:** 2026-06-22
**Study type:** Prospective, observational, minimal-risk-with-a-mandatory-safety-pathway diagnostic-accuracy pilot.
**Final population sizes, inclusion criteria, and site list locked with clinical + biostatistics + ethics collaborators.**

**Companion docs:** [PRE_REGISTRATION](./PRE_REGISTRATION.md) · [ANALYSIS_PLAN](./ANALYSIS_PLAN.md) ·
[POWER_ANALYSIS](./POWER_ANALYSIS.md) · [QUADAS2](./QUADAS2.md) · [DATA_DICTIONARY](./DATA_DICTIONARY.md) ·
[DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md) · [NATIVE_HUM_DATA_SPEC](./NATIVE_HUM_DATA_SPEC.md) ·
[CLAIMS_LADDER](../claims/CLAIMS_LADDER.md).

> Hum is **investigational · for research use only · not a diagnosis** throughout. Research
> participation is **not** consent to be diagnosed. The screening probability is **blinded** for the
> entire study ([PRE_REGISTRATION §5](./PRE_REGISTRATION.md)).

---

## 1. Purpose & summary

To collect, under informed consent and IRB oversight, paired 12-second hum captures and validated
self-report screening instruments (PHQ-9, GAD-7), and to evaluate whether a hum-derived signal
discriminates the standard screening cut-points (PHQ-9 ≥ 10, GAD-7 ≥ 10). The deliverable is a
pre-registered diagnostic-accuracy read-out, not a deployed screening tool.

## 2. Population

| Item | Specification |
| --- | --- |
| **Eligibility** | Adults (≥ 18). English-capable for the consent + instrument language in this phase (instruments are language-independent acoustically [vocal_biomarker_and_singing_protocol_support], but instrument *text* is validated per language). |
| **Target condition** | Depression **and** anxiety symptom range, spanning minimal → severe so both screening cuts are represented. Recruitment deliberately seeks symptom-range coverage, not only symptomatic participants, for spectrum balance. |
| **Exclusion** | Inability to provide informed consent; device/environment that cannot meet the capture protocol; pre-registered protocol violations ([NATIVE_HUM_DATA_SPEC §8](./NATIVE_HUM_DATA_SPEC.md)). |
| **Vulnerable populations** | Minors (CES-DC age-appropriate work) are **out of scope** for this phase; any later inclusion is a separate amendment. |

A consequence — declared in [PRE_REGISTRATION §9](./PRE_REGISTRATION.md) and [QUADAS2](./QUADAS2.md) — is
**self-recruited-cohort spectrum bias** (QUADAS-2 patient-selection): not a consecutive/random clinical
sample.

## 3. Recruitment

- **Primary:** self-recruited remote cohort via the app's in-app study-enrolment surface
  (`apps/web` study-consent → enrolment → pseudonym mint). No clinical referral required.
- **Partner-site pluggable:** the backend supports an academic/clinical partner site plugging in later
  (clinician view gated by a `clinician` claim, audit, instrument administration) without changing the
  consumer privacy posture ([DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md)). Partner-site recruitment
  is added by amendment with that site's local IRB.
- No deceptive recruitment; the investigational, non-diagnostic nature is stated in recruitment
  material and re-stated in consent.

## 4. Informed consent (versioned e-consent)

- **Mechanism:** in-app **clinical-grade informed e-consent** (`apps/web/src/app/study-consent.ts`),
  separate from the lightweight consumer onboarding. Reuses the onboarding focus-trap / `inert` / a11y
  scaffolding.
- **Disclosed:** study purpose; what is collected (derived features **always**; PHQ-9/GAD-7 under
  `clinical_label_capture`; raw audio under the separate `research_audio_upload` opt-in); retention;
  withdrawal & right-to-deletion; the explicit **non-clinical, does-not-diagnose-or-treat** statement;
  and the **crisis-resources notice** (§6).
- **Recorded:** a **versioned, append-only `ResearchConsentRecord`** (`@hum-ai/shared-types/privacy.ts`)
  capturing `consentVersion`, `consentDocHash` (hash of the exact text shown), `grantedScopes`,
  `signedAt`, `kind: "enrol"`. Written to `studies/{id}/consentRecords`, where Firestore rules **deny
  update/delete** so the record is immutable by construction (the audit guarantee).
- **Granular & revocable:** scopes are independently granted and OFF by default except `local_processing`
  ([NATIVE_HUM_DATA_SPEC §4](./NATIVE_HUM_DATA_SPEC.md)). Raw-audio upload is a distinct, additional
  opt-in, never bundled.
- **Re-consent:** a new consent version requires re-acknowledgment before further data collection.

## 5. Instrument schedule

| Instrument | Items / scoring | Cadence | Stored as |
| --- | --- | --- | --- |
| **PHQ-9** (depression) | 9 items, 0–3 (`INSTRUMENT_ITEM_MIN`/`MAX`), total 0–27, 2-week recall framing; **item 9** broken out (`PHQ9_ITEM9_INDEX = 8`) | Cross-sectional: once per labelled session. Longitudinal: repeated on schedule. | `Phq9Response` (`buildPhq9Response`) |
| **GAD-7** (anxiety) | 7 items, 0–3, total 0–21 | Same session as PHQ-9 | `Gad7Response` (`buildGad7Response`) |

Administration is via `apps/web/src/app/phq-admin.ts`; on submit it computes totals/bands
(`depressionSeverityBand`/`anxietySeverityBand`) and, **on item 9 ≥ 1, synchronously invokes the crisis
pathway before navigation** (§6). A hum capture is paired to the administration via `ClinicalSessionLink`
within a tight `gapMinutes` (a pre-registered inclusion criterion).

## 6. MANDATORY crisis / safety-escalation protocol

This is the hard IRB gate. It is implemented and unit-tested **before** the study opens (the protocol
describes it; it must exist). Implementing artifacts: **`@hum-ai/affect-model-contracts` `crisis.ts`**
(the pure deterministic rule) and the **`apps/web` crisis surface** (the DOM-bound, non-dismissable UI
routed through the `render.ts` `copy()`/`esc()` chokepoint).

| Item 9 response | `assessCrisisFromPhq` level | Action |
| --- | --- | --- |
| 0 (or PHQ-8, no item) | `none` | No escalation. `auditEvent` = null. |
| 1 ("several days") | `elevated` | **Non-dismissable** crisis surface with region-aware resources (one-tap call/text); `requiresInterstitial = true`. |
| 2–3 ("more than half the days" / "nearly every day") | `active` | **Stronger interstitial**; same resources plus immediate-danger guidance. |

Protocol requirements:
- **Synchronous, pre-navigation, model-free:** the rule fires on `Phq9Response.item9` the instant the
  item is answered, before any model runs or backend round-trip — which is *why* item 9 is a
  first-class field.
- **Region-aware resources:** `crisisResources(region)` with `DEFAULT_CRISIS_RESOURCES` (US 988 Suicide
  & Crisis Lifeline; international directory fallback). A study site configures its own per its
  IRB-approved safety plan.
- **Non-dismissable:** the surface cannot be skipped until resources are seen (`requiresInterstitial`).
- **Audit-logged:** every firing appends an immutable `auditLog` event (`"phq9_item9_endorsed"`) with
  pseudonym + timestamp + score band — the IRB requires durable evidence the pathway fired. If a
  partner site is plugged in, the event also flags `clinicianViews/{pseudonym}`.
- **Direct language exception:** crisis copy still flows through `copy()`/`esc()` but uses a reviewed
  allow-list so the `@hum-ai/safety-language` matcher does not suppress necessary directness (e.g.
  "suicide" in a resource name). A careful, reviewed exception — never a blanket bypass; covered by the
  safety-copy CI sweep ([VALIDATION_PLAN §3g](./VALIDATION_PLAN.md)).

## 7. Data handling & pseudonymisation

- **Pseudonym, not identity:** a study-scoped `participantPseudonym` is minted client-side; the
  re-identification key lives **only** in the participant-management backend, never in the corpus, never
  in git. `assertValidClinicalExample` rejects a pseudonym containing "@".
- **Derived-only by default:** `ClinicalHumExample` carries **derived `AcousticFeatures` only**;
  `assertNoRawAudioFields` throws on any raw-audio-like field at any depth. Raw audio rides ONLY the
  `research_audio_upload` channel (Firebase Storage, study bucket keyed by pseudonym), physically
  isolated from derived sync ([DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md)).
- **PHI isolation:** PHQ-9/GAD-7 scores are PHI and live ONLY in the sanctioned clinical channel
  (`clinicalExamples`/`phqResponses`/`gad7Responses`), never in the consumer `users/{uid}` paths and
  never in the benign `native_hum_self_report_corpus`. PHI is never tracked in git.
- **Storage & access:** access-controlled, encrypted research storage; reads of clinical rows / audit
  log gated to study-admin / clinician claims via deny-by-default Firestore rules.
- **Registry:** the corpus is registered as `native_hum_clinical_screening_corpus`
  (`@hum-ai/dataset-registry`, `clinical_status: "clinical"`), recording consent basis, IRB ref,
  retention, and pseudonymisation scheme.

## 8. Withdrawal & right-to-deletion

- A participant may withdraw at any time via the study-status surface ("manage/withdraw consent").
- Withdrawal writes a **new** append-only `ResearchConsentRecord` (`kind: "withdraw"`,
  `withdrawsRecordId` referencing the enrolment record) — the original is never edited or deleted.
- `withdrawParticipant(pseudonym)` stops capture and **deletes the participant's data across Firestore +
  Storage**, recording the deletion in the `auditLog`.
- Withdrawn data is excluded from analysis ([PRE_REGISTRATION §8](./PRE_REGISTRATION.md)).

## 9. Risk / benefit

- **Risks:** minimal. The primary foreseeable risk is distress from the instruments (esp. PHQ-9 item 9),
  directly mitigated by the §6 crisis pathway. Privacy risk is mitigated by pseudonymisation, the
  raw-audio firewall, and deny-by-default rules.
- **Benefits:** no direct clinical benefit to participants (the probability is blinded). Societal benefit
  is a research-grade evaluation of a privacy-preserving, low-burden vocal screening signal.

## 10. Mandatory collaborator sign-off

This protocol may not open without recorded sign-off from all three
([NATIVE_HUM_DATA_SPEC §10](./NATIVE_HUM_DATA_SPEC.md)):

| Collaborator | Owns |
| --- | --- |
| **Clinical / psychiatry** | Instrument choice, inclusion/exclusion, the safety-escalation pathway, clinician-event definitions. |
| **Biostatistics** | Final N + power ([POWER_ANALYSIS](./POWER_ANALYSIS.md)), the locked analysis plan + gate ([ANALYSIS_PLAN](./ANALYSIS_PLAN.md)), multiplicity. |
| **Ethics / IRB + privacy/legal** | Approval, consent language, data-protection (PHI), retention, regulatory pathway. |

Sign-off is also the §5 unlock precondition in [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md): the analysis
plan must be co-signed as followed before any validated claim is earned.

---

### Sources

[hum_spec] · [vocal_biomarker_and_singing_protocol_support] · [clinical_voice_biomarker_review] ·
[longitudinal_voice_treatment_response_source]. Full facts in [docs/source/INDEX.md](../source/INDEX.md).
