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
| Consent state | Yes | Yes (audit) | — |

**Derived data that may be stored/synced:** feature summaries, quality decisions and capture grades, affect/confidence outputs, baseline statistics, relapse verdicts, and read metadata (hum id, model version, ISO timestamps). **Data that is never stored or synced under the default posture:** raw audio, PCM sample arrays, waveform buffers, microphone streams, or any reconstructable representation of the signal. The substring matcher (Section 3) is deliberately broad so that future fields cannot accidentally smuggle reconstructable audio into a derived payload.

## 6. Retention, operational constraints, and deletion

- **Retention.** Local store retains what the engines need: the rolling baseline window (24 eligible hums) plus per-hum derived records for trend display. Older raw inputs do not exist to retain — they were never persisted. Synced derived data follows the user's active scopes; revoking a scope stops new transfer of that category.
- **Operational constraints.** Sync runs through the single guarded boundary that calls `assertNoRawAudioFields`; there is no second, unguarded write path. The `research_audio_upload` channel is physically separate from derived sync and is the *only* route by which raw audio may leave the device, and only with that explicit scope. Dataset-side governance is enforced independently in `dataset-registry` (`DOMAIN_FORBIDDEN_USES`, `isUseAllowed`): clinical-speech corpora may inform clinical priors but are forbidden for `hum_finetune`/`personalization`, so clinical recordings can never be treated as hum truth (see [ADR-0005](../adr/0005-public-datasets-as-priors-not-truth.md)) [clinical_voice_biomarker_review][longitudinal_voice_treatment_response_source].
- **Deletion.** Because processing is local-first, deletion is primarily local: clearing the on-device store removes baseline, history, and consent state. For synced derived data, deletion propagates to the remote store keyed by `UserId`/`HumId`. Revoking `local_processing` ends all processing. Deletion of derived records does not require reconstructing or touching raw audio, because none was ever retained.

## 7. Non-claim

Nothing in this governance model implies clinical validity. Hum is **non-clinical and not clinically validated**, not a medical device, and not FDA-cleared. Clinical labels captured under `clinical_label_capture` exist solely as research/evaluation ground truth and are never returned to the user as a diagnosis. See [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) for the full claim boundaries.
