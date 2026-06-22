# Data Governance & Privacy

Hum's privacy posture is not a policy bolted on after the fact — it is encoded in the type system and enforced at the sync boundary, exactly as the technical specification requires [hum_spec]. This document describes what data exists, where it is allowed to live, what may cross the device boundary, and the consent that gates each transfer. The governing rule throughout: **the hum is the input, but the raw hum is not the product.** The product is derived signal.

See also: [ADR-0004 — Confidence & abstention](../adr/0004-confidence-and-abstention.md), [ADR-0005 — Dataset governance](../adr/0005-public-datasets-as-priors-not-truth.md), [Claims ladder](../claims/CLAIMS_LADDER.md), and the [project README](../../README.md).

## 1. Local-first principle

All processing that produces an affective signal happens on-device by default. Capture, feature extraction (`audio-features`), quality gating (`quality-gate`), domain classification (`domain-classifier`), the SER expert ensemble (`expert-ser`), fusion (`fusion-engine`), the rolling baseline (`personalization-engine`), and within-user relapse comparison (`relapse-engine`) all run locally against locally-held state. The only scope implied by ordinary app use is `local_processing`; nothing leaves the device without an explicit, independently-granted consent scope (Section 4) [hum_spec].

This is also why the personalization and relapse engines are designed as **within-user** comparisons rather than population classifiers: a personal rolling baseline (median / MAD / IQR over a 24-hum window) and within-user paired comparison can be computed entirely on-device, so the user's longitudinal history never needs to be centralized to be useful [hum_spec][longitudinal_voice_treatment_response_source].

## 2. Raw audio is not uploaded by default

The raw 12-second waveform is the most sensitive artifact Hum touches. By default it is **never uploaded**. The PCM input is represented by `AudioInput` (`@hum-ai/audio-features`), whose contract is explicitly ephemeral:

> "This object is EPHEMERAL: it lives only on-device for the duration of extraction and must never be persisted or synced. Downstream code only ever sees `AcousticFeatures`."

`AudioInput` holds `{ sampleRate, samples: Float32Array }`. The extractor consumes it and returns `AcousticFeatures` — a numeric feature summary. After extraction, the sample buffer is intended to be released; no downstream stage accepts `AudioInput`, so the raw signal is structurally prevented from flowing into fusion, storage, or sync. Raw audio upload is possible **only** through a dedicated research channel guarded by the `research_audio_upload` scope, never through the ordinary derived-sync path.

## 3. Derived-data-only sync and the "throws before write" invariant

When sync is enabled (`derived_feature_sync`), only derived data may be transmitted. To make this more than a convention, `@hum-ai/shared-types/privacy` enforces it mechanically:

- **`FORBIDDEN_RAW_AUDIO_FIELDS`** — the exact denylist from `hum_spec` §5.4 plus defensive additions: `audio`, `audioBlob`, `audioBuffer`, `audioData`, `audioBase64`, `rawAudio`, `recording`, `recordingUrl`, `file`, `fileUrl`, `blob`, `waveformRaw`, `microphoneData`, `pcm`, `samples`, `waveform`.
- **`isRawAudioFieldName(name)`** — a case-insensitive **substring** matcher over the tokens `audio`, `waveform`, `rawpcm`, `microphone`, `micblob`, `blob`. It catches variants an exact list would miss: `audioChunk`, `rawWaveformBuffer`, `micBlob` all return `true`, while derived names (`clarity`, `pitchCenterHz`, `signalConfidence`, `qualityDecision`, `valence`) return `false`.
- **`findRawAudioFields(payload)`** — recursively walks objects and arrays, collecting *every* offending key.
- **`assertNoRawAudioFields(payload)`** — the sync-boundary guard. If any offender is found it throws `RawAudioFieldError` listing all offending fields. This is the literal realization of the spec's invariant: *"Raw audio field in Firestore payload → throws before write."* The payload is rejected before it can be persisted or transmitted.

This guard is mandatory on every outbound sync payload. A clean derived payload (`humId`, `qualityDecision`, `signalConfidence`, `pitchCenterHz`, `clarity`, `valence`, `arousal`) passes; anything carrying a raw-audio-like key — at any nesting depth — fails closed.

## 4. Consent model

Consent is explicit, scoped, and independently granted. The `CONSENT_SCOPES` are:

| Scope | Grants | Default |
| --- | --- | --- |
| `local_processing` | On-device feature extraction & baseline | Granted (implied by use) |
| `derived_feature_sync` | Upload derived feature summaries only — no raw audio | Off |
| `research_audio_upload` | Upload raw audio for research, via the dedicated channel | Off |
| `clinical_label_capture` | Capture PHQ / GAD / CES-DC labels for research | Off |
| `clinical_risk_surfacing` | Surface clinical-risk markers + the longitudinal panel (ADR-0006) | Off |

`ConsentState` is `{ grantedScopes: ConsentScope[], updatedAt: IsoTimestamp }`. `hasConsent(state, scope)` is a pure membership check. `defaultConsent(now)` returns `{ grantedScopes: ["local_processing"] }` — a new user is local-only until they opt in. Absence of a scope means *not granted*; there is no implicit escalation between scopes.

### Clinical labels require explicit research consent

Self-report instruments — PHQ-9, GAD-7, and the CES-DC used in adolescent longitudinal work [longitudinal_voice_treatment_response_source] — are sensitive health data and serve only as research/evaluation labels, never as something Hum returns to the user. Capturing them requires the dedicated `clinical_label_capture` scope, which is separate from and additional to `derived_feature_sync`. A user may sync derived features without ever exposing a clinical label, and may grant clinical-label capture without granting raw-audio upload. The four scopes never collapse into one.

## 5. What may be stored or synced — and what never

| Data category | Stored locally | Synced (with `derived_feature_sync`) | Consent required to leave device |
| --- | --- | --- | --- |
| Raw audio / `AudioInput.samples` (PCM, waveform) | No (ephemeral, in-memory only) | **Never** | `research_audio_upload` (dedicated channel only) |
| `AcousticFeatures` summaries (pitch center, clarity, spectral, perturbation) | Yes | Yes | `derived_feature_sync` |
| Quality metadata (`QualityDecision`, `CaptureQuality`, baseline eligibility) | Yes | Yes | `derived_feature_sync` |
| Affect inference (valence/arousal, head outputs, confidence, abstain reason) | Yes | Yes | `derived_feature_sync` |
| Rolling baseline / `UserModelProfile` (robust stats, z-deltas) | Yes | Yes (derived only) | `derived_feature_sync` |
| Relapse verdict / read metadata (timestamps, `ModelVersion`, hum count) | Yes | Yes | `derived_feature_sync` |
| Clinical labels (PHQ / GAD / CES-DC) | Only if granted | Only if granted | `clinical_label_capture` |
| Clinical-risk surfacing + longitudinal panel (computed on-device from derived stats; surfaced to user) | Only if granted | n/a (surfaced locally, not a sync category) | `clinical_risk_surfacing` (ADR-0006) |
| Consent state | Yes | Yes (audit) | — |
| **Study — `ResearchConsentRecord`** (versioned, append-only consent log) | Yes | Written to `studies/{id}/consentRecords` (immutable) | `clinical_label_capture` (study enrollment) |
| **Study — `ClinicalHumExample`** (derived features + PHQ-9/GAD-7, pseudonymised) | Yes (clinical-store.ts) | Written to `studies/{id}/clinicalExamples` (sanctioned clinical channel) | `clinical_label_capture` |
| **Study — `Phq9Response` / `Gad7Response`** (instrument scores; item-9 first-class) | Yes | Written to `studies/{id}/phqResponses` · `gad7Responses` | `clinical_label_capture` |
| **Study — raw-audio model-dev subset** (12-second waveform) | No (ephemeral) | **Firebase Storage only**, never Firestore | `research_audio_upload` (dedicated channel) |
| **Study — audit events** (consent, access, export, deletion, item-9 escalation) | n/a | Written to `studies/{id}/auditLog` (append-only) | study operation (gated to study-admin/clinician reads) |
| **Study — clinician read-projection** (`clinicianViews/{pseudonym}`) | n/a | Materialised server-side; clinician read-only | `clinician` claim scoped to `studyId` |

**Derived data that may be stored/synced:** feature summaries, quality decisions and capture grades, affect/confidence outputs, baseline statistics, relapse verdicts, and read metadata (hum id, model version, ISO timestamps). **Data that is never stored or synced under the default posture:** raw audio, PCM sample arrays, waveform buffers, microphone streams, or any reconstructable representation of the signal. The substring matcher (Section 3) is deliberately broad so that future fields cannot accidentally smuggle reconstructable audio into a derived payload.

## 6. Retention, operational constraints, and deletion

- **Retention.** Local store retains what the engines need: the rolling baseline window (24 eligible hums) plus per-hum derived records for trend display. Older raw inputs do not exist to retain — they were never persisted. Synced derived data follows the user's active scopes; revoking a scope stops new transfer of that category.
- **Operational constraints.** Sync runs through the single guarded boundary that calls `assertNoRawAudioFields`; there is no second, unguarded write path. The `research_audio_upload` channel is physically separate from derived sync and is the *only* route by which raw audio may leave the device, and only with that explicit scope. Dataset-side governance is enforced independently in `dataset-registry` (`DOMAIN_FORBIDDEN_USES`, `isUseAllowed`): clinical-speech corpora may inform clinical priors but are forbidden for `hum_finetune`/`personalization`, so clinical recordings can never be treated as hum truth (see [ADR-0005](../adr/0005-public-datasets-as-priors-not-truth.md)) [clinical_voice_biomarker_review][longitudinal_voice_treatment_response_source].
- **Deletion.** Because processing is local-first, deletion is primarily local: clearing the on-device store removes baseline, history, and consent state. For synced derived data, deletion propagates to the remote store keyed by `UserId`/`HumId`. Revoking `local_processing` ends all processing. Deletion of derived records does not require reconstructing or touching raw audio, because none was ever retained.

## 7. Research study backend (investigational pilot)

The consumer posture in Sections 1–6 is **unchanged**. The validation pilot adds a **parallel, partner-pluggable study backend** that lives alongside — never inside — the consumer `users/{uid}` model. It exists only for consented, enrolled study participants; a non-participant never touches any of it. Every invariant below is enforced in [`firestore.rules`](../../firestore.rules) (deny-by-default, then explicit allow, with a final catch-all deny) and in the upstream contracts.

**The two firewalls are unchanged and still load-bearing.** The consumer raw-audio firewall (`assertNoRawAudioFields`, Section 3) and the two-head clinical/affect separation (`assertNoClinicalLeak`, ADR-0006) are not modified by the study backend. Raw audio still **never** enters Firestore — for any user, consumer or participant. Clinical instrument scores still **never** enter the consumer `users/{uid}` space. The study backend adds new *sanctioned* channels; it does not weaken or bypass the existing guards.

### 7.1 Pseudonymisation scheme

A study participant is identified throughout the study backend by a **pseudonym** minted client-side (`apps/web/src/app/participant.ts`) — never by email, name, or auth UID. The **re-identification key** (pseudonym → durable identity) is held **only** in the participant-management backend and is never written into any `studies/` document or into the corpus (`@hum-ai/clinical-corpus`). `assertValidConsentRecord` enforces that a `participantPseudonym` is non-identifying (rejects any value containing `@`, so an email can never be used as a pseudonym). The Firestore rules scope every participant-owned write to `request.auth.token.pseudonym`, so a participant can only act under their own pseudonym.

### 7.2 The `studies/` schema

```
studies/{studyId}                         protocol metadata, version, status
  participants/{pseudonym}                enrollment, active consent version, schedule, withdrawal
  consentRecords/{recordId}               ResearchConsentRecord — APPEND-ONLY, versioned
  clinicalExamples/{exampleId}            ClinicalHumExample — DERIVED FEATURES + PHQ-9/GAD-7 (sanctioned clinical channel)
  phqResponses/{responseId}               Phq9Response (item 9 broken out as a first-class field)
  gad7Responses/{responseId}              Gad7Response
  auditLog/{eventId}                      APPEND-ONLY audit trail (create-only; reads gated)
clinicianViews/{pseudonym}                read-only projection for a partner clinician
```

Role-based access uses `request.auth.token` custom claims: `studyAdmin`, `clinician`, `studyParticipant`, each scoped to a single `studyId`, plus the participant's `pseudonym`. Absence of a claim means *not granted*. `studies/{studyId}` protocol metadata is readable by any authenticated user (participants need the active consent version) but writable only by a study-admin. Each participant-owned collection (`participants`, `clinicalExamples`, `phqResponses`, `gad7Responses`) is readable/writable by the matching participant or a study-admin, and readable by a scoped clinician. **`clinicalExamples` carry derived features only** — the same `assertNoRawAudioFields` guard that protects derived sync also protects this write path; raw audio for the model-development subset travels the separate `research_audio_upload` channel (Section 7.6), never this row.

### 7.3 Versioned consent records (`ResearchConsentRecord`)

Device-local `ConsentState` (Section 4) is a mutable snapshot of currently-granted scopes — sufficient for the consumer product. An IRB needs more: an **append-only, versioned, timestamped** record of exactly what a participant agreed to and when. `ResearchConsentRecord` (`@hum-ai/shared-types/privacy`) carries `{ recordId, participantPseudonym, studyId, consentVersion, consentDocHash, grantedScopes, signedAt, kind, withdrawsRecordId }`:

- `consentVersion` + `consentDocHash` bind the record to the exact consent document the participant saw, so the agreed wording stays auditable even if the document is later revised.
- `kind` is `"enrol"` or `"withdraw"`. **A withdrawal is a new record that references (`withdrawsRecordId`) the enrolment it revokes — never an edit or delete of the original.** `assertValidConsentRecord` enforces this directionality and validates that every granted scope is a known `CONSENT_SCOPES` member.
- The Firestore rules allow `create` (by the participant or a study-admin) but **deny `update` and `delete`**. The record is immutable by construction; **immutability is the audit guarantee.**

### 7.4 Append-only audit trail

`studies/{studyId}/auditLog/{eventId}` records consent grant/revoke, data access, export, deletion, and — critically for the IRB — **PHQ-9 item-9 (suicidality) escalations** (pseudonym + timestamp + score band; never the raw item text). The rules permit `create` only (by the participant, study-admin, or clinician) and **deny `update`/`delete`**, so the trail cannot be rewritten. Reads are gated to a study-admin or scoped clinician. This is the evidence the crisis pathway fired and that every privileged access is accounted for.

### 7.5 Retention windows

- **Consent records & audit log:** retained for the full regulatory retention window required by the IRB protocol (typically the study duration plus the mandated archival period), because they are the compliance record. They are append-only for that entire window.
- **Clinical examples & instrument responses:** retained for the analysis window defined in the IRB protocol and pre-registration; deleted on withdrawal (Section 7.7) or at end-of-retention.
- **Raw-audio model-dev subset (Storage):** retained only as long as the pre-registered model-development use requires, then deleted; it is the most sensitive artifact and has the tightest window.
- **Consumer data is unaffected** — its retention follows Section 6 unchanged (the rolling 24-hum baseline window plus derived per-hum records; no raw audio was ever persisted).

### 7.6 Export format & deletion propagation

- **Export.** A participant (or a study-admin on their behalf) can request a data export: a pseudonymous bundle of that pseudonym's `ResearchConsentRecord` history, `ClinicalHumExample` derived rows, `Phq9Response`/`Gad7Response` instrument responses, and audit summary, serialised as structured JSON (the same shapes the corpus parses via `parseClinicalCorpus`). The export carries the pseudonym only — never the re-identification key — and the export event itself is written to the audit log.
- **Deletion (right-to-withdrawal).** `withdrawParticipant(pseudonym)` (Workstream 1) (1) stops further capture, (2) writes a `kind: "withdraw"` consent record (the consent log stays append-only — the prior grant is *revoked*, not erased), (3) deletes the participant's `clinicalExamples` / `phqResponses` / `gad7Responses` across **Firestore** and `dropParticipant`s them from the corpus, (4) deletes the participant's raw-audio subset in **Firebase Storage**, and (5) records the deletion in the audit log. Deletion spans both stores because raw audio lives only in Storage and derived/clinical records live only in Firestore — neither store retains the other's data. The append-only consent and audit records survive deletion deliberately: they are the proof the withdrawal was honoured.

### 7.7 The firewalls are unchanged

To state it explicitly, because it is load-bearing: nothing in this study backend modifies the consumer **raw-audio firewall** (`assertNoRawAudioFields` / `FORBIDDEN_RAW_AUDIO_FIELDS`, Section 3) or the **two-head separation** (`assertNoClinicalLeak`, ADR-0006). Raw audio reaches the cloud only through the dedicated `research_audio_upload` Storage channel and never enters Firestore. Clinical instrument scores live only in the sanctioned `studies/{studyId}/*` clinical channel and are structurally barred from the consumer `users/{uid}` paths. The study backend is additive, deny-by-default, and gated end-to-end by consent + scoped custom claims.

## 8. Non-claim

Nothing in this governance model implies clinical validity. Hum is **non-clinical and not clinically validated**, not a medical device, and not FDA-cleared. Clinical labels captured under `clinical_label_capture` exist solely as research/evaluation ground truth and are never returned to the user as a diagnosis. See [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) for the full claim boundaries.
