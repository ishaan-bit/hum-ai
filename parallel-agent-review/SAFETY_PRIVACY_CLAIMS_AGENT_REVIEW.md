# Safety, Privacy, and Claims Agent Review

**Specialist:** Safety, Privacy, and Claims Agent
**Focus:** Raw-audio privacy; consent gating; forbidden clinical claims; confidence rules; abstention; separation of internal research labels from user-facing language
**Date:** 2026-06-18

---

## 1. Raw Audio Privacy

### Source Evidence

[SOURCE: hum_spec] The privacy model is explicit and strong:

**Forbidden Firestore hum fields (from humPayload.ts):**
```
audio, audioBlob, audioBuffer, audioData, audioBase64, rawAudio,
recording, recordingUrl, file, fileUrl, blob, waveformRaw, microphoneData
```

**Current mounted path:** `HumScreen sets audioKey: null and does not store raw audio.`

**Ethical guardrails in spec:**
1. No clinical labels
2. No diagnostic certainty
3. No raw audio upload by default
4. Outputs describe "patterns" and "signals", not disorders
5. Confidence is capped when baseline is immature
6. Firestore rules are owner-scoped

### Assessment

**PASS:** The raw audio privacy model is exceptionally well-specified. The explicit forbidden-field list is a strong enforcement mechanism.

**WARN:** The forbidden-field check must be a **unit-testable, throw-on-violation contract**, not just a convention. The test suite must include a test that:
- Constructs a mock sync payload containing each forbidden field name
- Asserts the payload builder throws before any Firestore write
- Covers both exact field names and substring-matching (e.g., a future field named `humAudioCache` should be caught if it contains "audio")

**WARN:** The raw audio local IndexedDB cache (`lib/audioStorage.ts`) retains up to 20 recordings locally. While not uploaded, this is a privacy surface that requires:
- A documented retention policy
- A clear delete pathway (already noted in hum_spec under "Data delete" test case)
- A user-facing disclosure ("Your hums are stored only on this device and are never uploaded")

---

## 2. Consent Gating

### Required Consent Gates

The following outputs require explicit user consent before activation:

| Output | Consent Gate | Why |
|---|---|---|
| Clinical risk signals (PHQ/GAD-adjacent labels) | `research_mode_consent: true` | These are health-adjacent inferences that users may not expect |
| Relapse drift signals | `longitudinal_monitoring_consent: true` | Longitudinal monitoring of mood requires informed opt-in |
| Research audio upload (future) | `research_audio_upload_consent: true` | Raw audio for model training must be explicit opt-in |
| Sharing derived data with researchers | `research_data_sharing_consent: true` | Even anonymized feature vectors need consent for research use |

### Consent Architecture Requirements

```typescript
interface UserConsentState {
  researchMode: boolean           // enables internal clinical risk signals
  longitudinalMonitoring: boolean // enables relapse drift signals
  researchAudioUpload: boolean    // enables raw audio upload (must default false)
  dataSharing: boolean            // enables derived data for research
  consentVersion: string          // must be re-checked on consent text changes
  consentedAt: number             // epoch ms
}
```

**FAIL if** any clinical risk signal or relapse drift output is emitted to a user who has not explicitly enabled `longitudinalMonitoring`.

**FAIL if** any raw audio is included in a sync payload regardless of consent state — raw audio upload is permanently blocked by the existing forbidden-field contract, which is stronger than a consent gate.

---

## 3. Forbidden Clinical Claims

### Hard Prohibition List

The following statements must never appear in any user-facing string, notification, or API response:

| Forbidden Phrase Pattern | Reason |
|---|---|
| "You have / may have depression" | Diagnosis claim |
| "You have / may have anxiety" | Diagnosis claim |
| "Hum detects depression/anxiety" | Diagnostic capability claim |
| "Clinically validated" | False — no clinical validation exists |
| "Scientifically proven" | Overstates the evidence |
| "Prevents relapse" | Not supported by any evidence |
| "Medical advice" | Not a medical device |
| "See a doctor because your hum shows..." | Implies clinical diagnostic trigger |
| "Your score indicates [DSM condition]" | Diagnostic framing |
| "Treatment tracking" (when implying clinical treatment) | Medical device scope |
| "Your depression is [better/worse]" | Diagnostic claim |
| "Anxiety score", "Depression score" | Clinical scoring language |
| "[X]% chance of depression" | Clinical probability claim |

### @hum-ai/safety-language Package Requirement

The `@hum-ai/safety-language` package must implement:

```typescript
function checkSafetyLanguage(text: string): SafetyLanguageResult {
  // returns: { safe: boolean, violations: string[], severity: 'warn' | 'block' }
}
```

This function must be called on every user-facing string before display.

**FAIL if** `@hum-ai/safety-language` does not exist.
**FAIL if** the forbidden phrase list is not tested via automated tests against a known violation corpus.

---

## 4. Confidence Rules

### Confidence Cap Schedule

[SOURCE: hum_spec] Confidence caps by baseline maturity:

| Stage | Cap |
|---|---|
| First hum | 72% |
| Pre-baseline (1–4 hums) | 76% |
| 5–9 baseline hums | 82% |
| 10–19 baseline hums | 88% |
| Mature (20+ hums) | 90–92% |

### Additional Confidence Caps (Required Beyond Spec)

| Trigger | Cap | Rationale |
|---|---|---|
| Poor capture quality (`captureQuality: 'poor'`) | 72% | Poor capture degrades all features |
| Domain mismatch (speech detected) | 60% | Domain gap penalty (see Audio Domain Agent) |
| First hum of the day after 7+ day gap | 82% | Staleness penalty — baseline drift possible |
| Relapse drift signals | 88% (hard cap) | Safety ceiling on high-stakes outputs |
| Missing modality (only 1 of 2+ experts active) | –10% relative reduction | Fusion uncertainty |

### Abstention Rule

**Required:** The system must abstain from emitting a user-facing label when:
1. `confidence < 60%` (too uncertain to show anything useful)
2. `captureQuality == 'rejected'` (quality gate already handles this)
3. `domainClassifier == 'noise_dominant' OR 'vocal_burst'`
4. `baselineStage == 'cold_start'` AND `labelType == 'relapse'`

```typescript
interface AbstractionPolicy {
  abstain: boolean
  reason: 'low_confidence' | 'poor_capture' | 'domain_mismatch' | 'insufficient_baseline'
  fallbackMessage: string  // safe non-alarming message to show user
}
```

**FAIL if** the system emits a user-facing affect label when `confidence < 60%` or when `captureQuality == 'rejected'`.

---

## 5. Top-Class Margin and Modality Agreement

### Top-Class Margin

The margin between the top predicted class and the runner-up is a critical safety signal. A narrow margin indicates the model is uncertain which class applies.

**Required rule:** If `topClassMargin < 0.15`, the system must:
- NOT display the top class name
- Display a "close to your usual pattern" or "unclear pattern today" message
- Cap confidence to 70% regardless of other caps

### Modality Agreement

When multiple experts are active (e.g., hum audio + journal TER), disagreement between experts is a safety signal.

**Required rule:** If `modalityAgreement < 0.6` (experts disagree substantially):
- Cap confidence by –15%
- Emit a low-certainty label ("Something feels a bit different today — we're not quite sure what")

---

## 6. Separation of Internal vs User-Facing Labels

### Internal Research Labels

The following labels are INTERNAL ONLY and must never appear in user-facing output:

| Internal Label | User-Facing Equivalent |
|---|---|
| `low_activation_depression_risk` | "A bit quieter than your usual pattern" |
| `anxiety_arousal_marker` | "More activated or tense than your usual" |
| `relapse_drift_worsening` | "Your patterns have shifted outside your usual range" |
| `recovery_trajectory` | "Steadier patterns than recently" |
| `PHQ_risk_elevated` | Not shown to user; consent-gated research only |
| `GAD_risk_marker` | Not shown to user; consent-gated research only |

### Package Boundary Enforcement

```
@hum-ai/affect-model-contracts
  → exports: InternalAffectLabel (research use)
  → exports: UserFacingAffectCopy (user-visible)
  → Rule: InternalAffectLabel MUST be translated before reaching any UI component
  → Rule: UserFacingAffectCopy must pass @hum-ai/safety-language check
```

**FAIL if** any component renders an `InternalAffectLabel` directly without translation through the safety language layer.

---

## 7. Safety, Privacy, and Claims Agent Summary

| Check | Status | Notes |
|---|---|---|
| Raw audio blocked by default | PASS | Explicit forbidden-field list in hum_spec |
| Forbidden-field throw-on-violation test | WARN | Must be unit-tested, not just documented |
| Research audio opt-in | PASS | Not implemented = not available; explicit when added |
| PHQ/GAD consent-gated | WARN | Consent gate contract must be typed and enforced |
| Forbidden clinical claims list | PASS | Fully specified above |
| @hum-ai/safety-language package | FAIL | Package must exist with automated test coverage |
| Confidence cap schedule | PASS | Documented in hum_spec |
| First-hum confidence cap | PASS | 72% cap defined |
| Poor-capture confidence cap | PASS | 72% cap defined |
| Domain-mismatch confidence cap | FAIL | Not yet in any cap schedule |
| Abstention policy | WARN | Not yet a typed contract |
| Top-class margin rule | FAIL | Not specified anywhere |
| Modality agreement rule | FAIL | Not specified anywhere |
| Internal vs user-facing label separation | WARN | Architecture requires but not yet enforced at package boundary |

---

## Safety, Privacy, and Claims Agent Top 3 Findings

1. **@hum-ai/safety-language does not exist as a testable contract.** The product's entire safety guarantee depends on this package. Without it, any string can reach the user without a forbidden-phrase check. This is the single highest-severity safety gap.

2. **Top-class margin and modality agreement rules are missing.** Without these, the system can emit a high-confidence label based on a 51%-vs-49% prediction and single-expert agreement. Both rules are required for any honest confidence output.

3. **Domain-mismatch confidence cap is absent from the current cap schedule.** The cap schedule governs baseline maturity, but a user who hums while speaking, or whose capture is borderline speech-contaminated, receives an inflated confidence score. The domain classifier + HumDomainAdapter must feed into the cap schedule.
