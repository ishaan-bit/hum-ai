# Data Dictionary — Hum Screening Pilot

**Status:** Authoritative field reference (mirrors the TypeScript contracts) · **Status date:** 2026-06-22

**Companion docs:** [PRE_REGISTRATION](./PRE_REGISTRATION.md) · [IRB_PROTOCOL](./IRB_PROTOCOL.md) ·
[ANALYSIS_PLAN](./ANALYSIS_PLAN.md) · [QUADAS2](./QUADAS2.md) · [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md) ·
[NATIVE_HUM_DATA_SPEC](./NATIVE_HUM_DATA_SPEC.md).

This dictionary is the field-level reference for the study's stored records. It **mirrors the actual
TypeScript** — `ClinicalHumExample` / `Phq9Response` / `Gad7Response` / `ClinicalSessionLink` in
[packages/affect-model-contracts/src/clinical-feedback.ts](../../packages/affect-model-contracts/src/clinical-feedback.ts),
`ResearchConsentRecord` in
[packages/shared-types/src/privacy.ts](../../packages/shared-types/src/privacy.ts), and the crisis
audit event in [packages/affect-model-contracts/src/crisis.ts](../../packages/affect-model-contracts/src/crisis.ts).
If the code and this table disagree, the code is authoritative — open a doc fix.

> **Privacy invariants (load-bearing).** `ClinicalHumExample` carries **derived features only**;
> `assertValidClinicalExample` runs `assertNoRawAudioFields` (raw audio at any depth → throws). PHQ-9 /
> GAD-7 scores are **PHI** and live only in this sanctioned clinical channel — never in a derived sync
> payload, never in the benign `native_hum_self_report_corpus`. Pseudonyms must not contain `@` (a crude
> identifier guard).

---

## 1. `ClinicalHumExample` — one paired row of screening ground truth

Source: `clinical-feedback.ts`. Validated by `assertValidClinicalExample`.

| Field | Type | Req. | Description / constraint |
| --- | --- | --- | --- |
| `id` | string | yes | Stable per-capture id (caller-minted). |
| `participantPseudonym` | string | yes | Study-scoped pseudonym; re-identification key lives only in the backend. Rejected if it contains `@`. CV/grouping + deletion key. |
| `studyId` | string | yes | The study this row belongs to. |
| `capturedAt` | `IsoTimestamp` | yes | When the hum was captured. |
| `features` | `AcousticFeatures` | yes | **Derived features only** — the model input. No raw audio (`assertNoRawAudioFields`). |
| `phq` | `Phq9Response` \| null | one of phq/gad | PHQ-9/PHQ-8 administered this session; null if only anxiety collected. |
| `gad` | `Gad7Response` \| null | one of phq/gad | GAD-7 administered this session; null if only depression collected. |
| `captureQualityScore` | `UnitInterval` (0–1) | yes | Capture-quality score; out of [0,1] → throws. |
| `eligible` | boolean | yes | Passed the quality gate (clean enough to train on). `false` → retained as an abstention example, excluded from modeling. |
| `deviceClass` | string | yes | Coarse device class (e.g. `ios_safari`, `android_chrome`) for QUADAS-2 spectrum coverage. |
| `stratum` | string | no | Coarse, non-identifying recruitment stratum (e.g. `adult_general`) for spectrum coverage. |
| `featureSchemaVersion` | string | yes | Feature-vector schema version, so a later schema change can reject/migrate stale rows. |

**Validation (`assertValidClinicalExample`):** non-`@` pseudonym; at least one instrument present;
instrument item ranges/length re-checked (defense in depth); `captureQualityScore` finite ∈ [0,1];
`assertNoRawAudioFields(ex)`. Deliberately does **not** call `assertNoClinicalLeak` — this is the
sanctioned clinical channel.

## 2. `Phq9Response` — PHQ-9 / PHQ-8 administration

Source: `clinical-feedback.ts`. Built + validated by `buildPhq9Response`.

| Field | Type | Description / constraint |
| --- | --- | --- |
| `instrument` | `"PHQ-9"` \| `"PHQ-8"` | Which variant was administered. |
| `items` | readonly number[] | Per-item 0–3 Likert (`INSTRUMENT_ITEM_MIN`=0 … `INSTRUMENT_ITEM_MAX`=3). Length 9 (`PHQ9_ITEM_COUNT`) for PHQ-9, 8 (`PHQ8_ITEM_COUNT`) for PHQ-8. |
| `item9` | number \| null | **Suicidality item, first-class** (`PHQ9_ITEM9_INDEX`=8). 0–3 for PHQ-9; **null** for PHQ-8 (which omits it). Drives the crisis pathway. |
| `total` | number | Sum of items, 0–`PHQ9_MAX_TOTAL` (27). |
| `severityBand` | `DepressionSeverityBand` | `minimal` (0–4) · `mild` (5–9) · `moderate` (10–14) · `moderately_severe` (15–19) · `severe` (20–27), from `depressionSeverityBand(total)`. |
| `administeredAt` | `IsoTimestamp` | When the instrument was completed. |

**Screening label:** `phqToBinaryLabel(phq, cut = PHQ9_SCREENING_CUT=10)` → `screen_positive` iff
`total ≥ cut`, else `screen_negative`. **Crisis:** `assessCrisisFromPhq(phq)` keys on `item9` (§5).

## 3. `Gad7Response` — GAD-7 administration

Source: `clinical-feedback.ts`. Built + validated by `buildGad7Response`.

| Field | Type | Description / constraint |
| --- | --- | --- |
| `instrument` | `"GAD-7"` | Always GAD-7. |
| `items` | readonly number[] | 7 items (`GAD7_ITEM_COUNT`), each 0–3. |
| `total` | number | Sum of items, 0–`GAD7_MAX_TOTAL` (21). |
| `severityBand` | `AnxietySeverityBand` | `minimal` (0–4) · `mild` (5–9) · `moderate` (10–14) · `severe` (15–21), from `anxietySeverityBand(total)`. |
| `administeredAt` | `IsoTimestamp` | When the instrument was completed. |

**Screening label:** `gadToBinaryLabel(gad, cut = GAD7_SCREENING_CUT=10)` → `screen_positive` iff
`total ≥ cut`, else `screen_negative`.

## 4. `ClinicalSessionLink` — hum↔instrument pairing

Source: `clinical-feedback.ts`. Pairs a capture to an administration when they are minutes apart.

| Field | Type | Description / constraint |
| --- | --- | --- |
| `participantPseudonym` | string | Owning participant. |
| `studyId` | string | Study scope. |
| `humCaptureId` | string | The `ClinicalHumExample.id` paired here. |
| `humCapturedAt` | `IsoTimestamp` | Hum capture time. |
| `instrumentAdministeredAt` | `IsoTimestamp` | Instrument completion time. |
| `gapMinutes` | number | Minutes between capture and administration. A tight gap is a **pre-registered inclusion criterion** ([QUADAS2 §5](./QUADAS2.md)). |

## 5. `ResearchConsentRecord` — versioned, append-only consent

Source: `privacy.ts`. Validated by `assertValidConsentRecord`. Written to
`studies/{id}/consentRecords`, where Firestore rules **deny update/delete** (immutable = the audit
guarantee).

| Field | Type | Description / constraint |
| --- | --- | --- |
| `recordId` | string | Stable record id (required). |
| `participantPseudonym` | string | Non-`@` pseudonym (required). |
| `studyId` | string | Study scope (required). |
| `consentVersion` | string | Version of the consent document acknowledged (required). |
| `consentDocHash` | string | Hash of the exact consent text shown, so the agreed wording stays auditable (required). |
| `grantedScopes` | readonly `ConsentScope`[] | Scopes granted at signing; each must be a `CONSENT_SCOPES` member. |
| `signedAt` | `IsoTimestamp` | When signed. |
| `kind` | `"enrol"` \| `"withdraw"` | `enrol` grants; `withdraw` revokes. |
| `withdrawsRecordId` | string \| null | For a `withdraw`: the `recordId` revoked (required for withdraw, must be null for enrol). |

### Consent scopes (`CONSENT_SCOPES`)

| Scope | Default | Governs |
| --- | --- | --- |
| `local_processing` | on (implied by use) | on-device feature extraction & baseline; no upload |
| `derived_feature_sync` | off | upload **derived** feature summaries only (no raw audio) |
| `research_audio_upload` | off | **raw hum audio** → research storage via the dedicated channel — never the derived payload |
| `clinical_label_capture` | off | capture of PHQ-9 / GAD-7 / CES-DC (PHI) |
| `clinical_risk_surfacing` | off | whether risk markers are surfaced back to the user (ADR-0006) |

## 6. Audit-log events (`studies/{id}/auditLog`, append-only)

The audit log is append-only and reads are gated to study-admin / clinician claims ([IRB_PROTOCOL §7](./IRB_PROTOCOL.md)).
The first event is **implemented in code today**; the rest are the governance events the study backend
appends (Workstream 2).

| Event | Source | Payload (pseudonymous) | Trigger |
| --- | --- | --- | --- |
| `phq9_item9_endorsed` | `crisis.ts` `CrisisAssessment.auditEvent` | pseudonym + timestamp + item-9 band (`elevated`=item9≥1, `active`=item9≥2) | PHQ-9 item 9 ≥ 1 — the crisis pathway fired (the IRB requires evidence). |
| `consent_granted` | study backend | pseudonym + `consentVersion` + `grantedScopes` | A new `enrol` `ResearchConsentRecord` is written. |
| `consent_revoked` | study backend | pseudonym + `withdrawsRecordId` | A `withdraw` record is written. |
| `data_accessed` | study backend | actor claim + pseudonym + collection | A study-admin / clinician reads clinical rows or the audit log. |
| `data_exported` | study backend | actor + pseudonym + scope | A participant data-export request is fulfilled. |
| `data_deleted` | study backend | pseudonym + scope | `withdrawParticipant(pseudonym)` deleted data across Firestore + Storage. |

### `CrisisAssessment` (the rule output behind `phq9_item9_endorsed`)

Source: `crisis.ts` `assessCrisisFromPhq(phq)`.

| Field | Type | Description |
| --- | --- | --- |
| `level` | `"none"` \| `"elevated"` \| `"active"` | `none` (item9 = 0 / PHQ-8); `elevated` (item9 = 1); `active` (item9 ≥ 2). |
| `item9` | number \| null | The triggering item-9 score (null for PHQ-8). |
| `requiresInterstitial` | boolean | True whenever `level !== "none"` — the surface MUST be non-dismissable. |
| `auditEvent` | `"phq9_item9_endorsed"` \| null | The event appended to `auditLog` (null when `none`). |
| `message` | string | Direct, non-euphemistic copy for the surface (plain, not softened). |

## 7. Channel & store map (where each record physically lives)

| Record | Channel / store | Consent scope | Privacy guard |
| --- | --- | --- | --- |
| `ClinicalHumExample` (derived) | `studies/{id}/clinicalExamples` (clinical-store) | `clinical_label_capture` | `assertValidClinicalExample` → `assertNoRawAudioFields` |
| `Phq9Response` / `Gad7Response` | `studies/{id}/phqResponses` / `gad7Responses` | `clinical_label_capture` | PHI; never in `users/{uid}` or `native_hum_self_report_corpus` |
| Raw audio (model-dev subset) | Firebase Storage study bucket, keyed by pseudonym | `research_audio_upload` (separate opt-in) | dedicated `research-upload.ts` channel, physically isolated from derived sync |
| `ResearchConsentRecord` | `studies/{id}/consentRecords` | n/a (the consent itself) | append-only; update/delete denied by rules |
| Audit events | `studies/{id}/auditLog` | n/a | append-only; reads gated to admin/clinician claim |

Registered as the `native_hum_clinical_screening_corpus` dataset
([packages/dataset-registry/src/entries.ts](../../packages/dataset-registry/src/entries.ts),
`clinical_status: "clinical"`).

---

### Sources

[hum_spec]. Full facts in [docs/source/INDEX.md](../source/INDEX.md).
