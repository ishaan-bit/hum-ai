# Main Repo Acceptance Criteria

**Produced by:** Multi-agent adversarial review
**Date:** 2026-06-18
**How to use:** Run CHECK_ACCEPTANCE_CRITERIA.sh against the main foundation output. Review each FAIL or WARN item before integration.

Criteria: **PASS** (present and correct) | **WARN** (present but incomplete) | **FAIL** (absent or incorrect)

---

## Section 1: Architecture Documentation

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| A01 | `docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md` exists | File present, >500 words | File present, <500 words | File absent |
| A02 | TriSense expert separation documented | FER/SER/TER (or HAE variant) each described as independent expert | Only fusion described, experts glossed | Not mentioned |
| A03 | Late fusion is first-class | Logistic regression meta-learner described with probability vectors from each expert | Fusion described vaguely | Fusion absent |
| A04 | FER slot treatment documented | Explicit statement: FER absent, null-padded, or future TER | Mentioned in passing | Not addressed |
| A05 | Rule-based→neural expert semantic gap addressed | Explains how dimension z-scores become probability-equivalent vectors | Acknowledges gap but no resolution | No mention of gap |
| A06 | Attention/gated fusion roadmap documented | Phase 1 (LR) → Phase 2 (gated) → Phase 3 (attention) documented | Future scope mentioned vaguely | No roadmap |
| A07 | `docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md` exists | File present, >500 words | File present, <500 words | File absent |
| A08 | Hum vs speech domain distinction documented | Explicit taxonomy: native_hum, sung_phonation, speech_leak, vocal_burst | Only "hum" described | No domain distinction |
| A09 | Domain classifier specified | Interface/spec included | Mentioned as future work | Not mentioned |
| A10 | HumDomainAdapter specified | Interface included | Mentioned as future work | Not mentioned |
| A11 | Public datasets-as-priors policy stated | Explicit: MELD/RAVDESS/DAIC-WOZ are priors not hum-ground-truth | Implied | Not stated |
| A12 | `docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md` exists | File present, >500 words | File present, <500 words | File absent |
| A13 | Dual baseline (rolling + anchored) documented | Both baselines described with different purposes | Only rolling baseline | No baseline architecture |
| A14 | Calibration ladder stages documented | All 6 stages with confidence caps | Partial stages | Not documented |

---

## Section 2: Claims and Validation

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| C01 | `docs/claims/CLAIMS_LADDER.md` exists | File present with permitted/forbidden columns | File present, incomplete | File absent |
| C02 | MELD accuracy not claimed as Hum accuracy | Explicit prohibition statement | Implicit in design | No mention |
| C03 | Clinical voice biomarker AUC not claimed as Hum AUC | Explicit prohibition, cites domain gap | Implied | Not addressed |
| C04 | Confidence reframed as signal quality | Copy example: "signal clarity" not "prediction accuracy" | Noted as risk | Numeric % shown as accuracy |
| C05 | Forbidden clinical phrases listed | Complete list in claims doc or safety-language | Partial list | No list |
| C06 | Screening signal vs diagnosis distinction enforced | Explicit "screening signal" framing | Mentioned | Uses diagnostic language |
| C07 | Relapse monitoring vs prevention distinction | Explicit: "monitoring" not "prevention" | Mentioned | Uses "prevents" language |
| C08 | `docs/validation/VALIDATION_PLAN.md` exists | File present | File present but thin | File absent |
| C09 | Evidence limitations acknowledged | Briganti 2025 bias (6/12 studies), domain gap, n=48 adolescent sample | Partially acknowledged | Not acknowledged |

---

## Section 3: Privacy and Governance

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| P01 | `docs/privacy/DATA_GOVERNANCE.md` exists | File present | File present, thin | File absent |
| P02 | Raw audio upload blocked by default | Forbidden-field list documented and tested | Documented, not tested | Not documented |
| P03 | Research audio opt-in gate reserved | `researchAudioUpload` field in UserConsentState | Mentioned as future | Not mentioned |
| P04 | PHQ/GAD label consent gate specified | `researchMode` consent gate in UserConsentState | Mentioned | Not specified |
| P05 | Firestore sync derived-data-only documented | Explicit list of synced fields; forbidden fields listed | Partial | Not documented |

---

## Section 4: Package Structure

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| PKG01 | `packages/shared-types` exists | Directory with index.ts exporting core types | Directory exists, empty | Absent |
| PKG02 | `BaselineStage` enum in shared-types | Exported enum with ≥5 stages | Partial enum | Absent |
| PKG03 | `FusionOutput` type includes `abstain`, `topClassMargin`, `modalityAgreement` | All three fields present and typed | Some fields | None of the three |
| PKG04 | `InternalAffectLabel` and `UserFacingAffectCopy` are distinct types | Type incompatibility enforced | Same type with different name | Single type for both |
| PKG05 | `UserConsentState` includes `researchMode`, `longitudinalMonitoring`, `researchAudioUpload` | All three flags present | Some flags | No consent state type |
| PKG06 | `packages/dataset-registry` exists | Directory with registry contract | Directory exists, empty | Absent |
| PKG07 | Dataset registry has `permittedUse` and `forbiddenUse` per dataset | Both fields on all entries | Partial | Absent |
| PKG08 | `packages/affect-model-contracts` exists | Directory with multi-head affect output type | Directory exists, empty | Absent |
| PKG09 | Multi-head affect contract (discrete + dimensional) | Both heads in AffectOutput type | Single-head only | No affect output type |
| PKG10 | `packages/fusion-engine` exists | Directory with fusion engine contract | Directory exists, empty | Absent |
| PKG11 | `packages/personalization-engine` exists | Directory with PersonalizationState and UserFusionProfile | Directory exists, partial types | Absent |
| PKG12 | `packages/relapse-engine` exists | Directory with RelapseDriftSignal type and engine contract | Directory exists, empty | Absent |
| PKG13 | `packages/safety-language` exists | Directory with `checkSafetyLanguage` function | Directory exists, stub | Absent |
| PKG14 | `packages/quality-gate` exists | Directory with quality gate types and v2 domain classifier spec | Directory exists, partial | Absent |

---

## Section 5: ADRs

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| ADR01 | `docs/adr/` directory exists | Directory exists, ≥3 ADR files | Directory exists, <3 ADR files | Directory absent |
| ADR02 | ADR for hum domain adaptation | ADR for speech→hum domain gap and HumDomainAdapter | Mentioned in another doc | Absent |
| ADR03 | ADR for claims ladder / forbidden phrases | ADR for claim safety approach | Mentioned in claims doc | Absent |
| ADR04 | ADR for dual baseline | ADR for rolling vs anchored baseline | Mentioned in personalization doc | Absent |

---

## Section 6: Test Coverage

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| T01 | Confidence cap schedule unit tests | Tests for all 5 maturity stages | Tests for some stages | No tests |
| T02 | Relapse hard cap test (88%) | Test present and passes | Test present but commented out | No test |
| T03 | Relapse minimum-hum gate tests | Tests for cold_start, early, nascent stages | Partial | No tests |
| T04 | Raw audio privacy throw-on-violation tests | Tests for all 12 forbidden field names | Tests for some | No tests |
| T05 | Safety language forbidden phrase tests | Tests for ≥10 forbidden phrases | Tests for <10 | No tests |
| T06 | Missing-modality fusion tests | Tests for audio-only, all-absent cases | Audio-only tested | No tests |
| T07 | Domain classifier tests (native_hum, speech_leak, vocal_burst) | All three domains tested | One domain tested | No tests |
| T08 | Domain gap confidence penalty tests | At least 3 penalty scenarios tested | One scenario | No tests |
| T09 | Personalization stage policy tests | Cold start, early, nascent stages tested | One stage | No tests |
| T10 | Intervention claim guardrail tests | Recommendation input/output safety tested | Partial | No tests |

---

## Section 7: Integration Readiness

| # | Criterion | PASS Condition | WARN Condition | FAIL Condition |
|---|---|---|---|---|
| I01 | All must-fix risks (R01–R18 selected) addressed | Evidence for all 12 must-fix items | 8–11 items addressed | <8 items addressed |
| I02 | No cross-agent conflicts unresolved | All 8 conflicts have explicit resolution strategy | 5–7 resolved | <5 resolved |
| I03 | Foundation passes its own CHECK_ACCEPTANCE_CRITERIA.sh | Script runs with ≤2 FAILs | Script runs with 3–5 FAILs | Script fails to run |
| I04 | Legacy Hum audio features salvageable | `LEGACY_HUM_FEATURES_TO_SALVAGE.md` read and features confirmed compatible | Not all features reviewed | No compatibility review |

---

## Acceptance Gate

- **DEMO READY:** All Section 6 T01–T10 tests pass; all CRITICAL risks (R01, R02, R03, R07, R18) mitigated; ≤3 FAIL items across all sections
- **NOT DEMO READY:** Any CRITICAL risk unmitigated; Section 6 tests T01, T02, T04, T05 failing; >5 FAIL items in Sections 1–5
