# Risk Register

**Produced by:** Multi-agent adversarial review
**Date:** 2026-06-18

Severity: **CRITICAL** (ship-blocker) | **HIGH** (pre-demo blocker) | **MEDIUM** (pre-launch) | **LOW** (post-launch)

---

| # | Risk | Severity | Why It Matters | Source / Reasoning | Mitigation | Owner Package/Doc | Must-Fix Before Demo |
|---|---|---|---|---|---|---|---|
| R01 | **Forbidden clinical claims reach users** | CRITICAL | Could constitute unauthorized medical advice; product liability; platform removal | No `@hum-ai/safety-language` package or automated forbidden-phrase tests | Create `@hum-ai/safety-language` with automated test suite; run on every user-facing string in CI | `@hum-ai/safety-language` | **YES** |
| R02 | **Relapse drift signal emitted without hard confidence cap** | CRITICAL | A 92%-confident "you are worsening" signal is a de-facto clinical diagnosis; causes user harm | Cap schedule exists but is not contractually enforced in relapse engine | Add unit test: relapse signals never exceed 88% confidence | `@hum-ai/relapse-engine` + `@hum-ai/shared-types` | **YES** |
| R03 | **Raw audio accidentally included in sync payload** | CRITICAL | Privacy law violation (GDPR, CCPA, PDPA); user trust destruction | Forbidden-field list exists but throw-on-violation is untested | Add throw-on-violation unit test for all 12 forbidden field names | `@hum-ai/shared-types` + privacy tests | **YES** |
| R04 | **MELD/clinical speech accuracy cited as Hum accuracy** | HIGH | Misrepresentation of system capability; regulatory risk; investor deception | INDEX.md warns against this but no automated enforcement | CLAIMS_LADDER.md must explicitly list forbidden accuracy claims; add dataset-registry forbidden-use checks | `@hum-ai/dataset-registry` + `CLAIMS_LADDER.md` | **YES** |
| R05 | **No domain classifier — domain mismatch undetected** | HIGH | User speaks instead of humming; speech model produces garbage probability vectors; confidence is inflated | No domain classifier specified in any current architecture document | Design and implement domain classifier as part of @hum-ai/quality-gate v2 | `@hum-ai/quality-gate` + HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md | **YES** |
| R06 | **FusionOutput contract missing `abstain`, `topClassMargin`, `modalityAgreement`** | HIGH | Downstream safety checks (abstention policy, safety-language gate) cannot function without these fields | Architecture agent identified these as absent from current spec | Add to `@hum-ai/affect-model-contracts` and enforce in fusion engine | `@hum-ai/affect-model-contracts` + `@hum-ai/fusion-engine` | **YES** |
| R07 | **Relapse engine emits signals from cold-start / early-stage baseline** | HIGH | A 1-hum "relapse" signal is meaningless and potentially alarming | No minimum-hum gate documented in relapse engine spec | Add relapse engine rule: minimum 5 nascent baseline hums before any relapse signal | `@hum-ai/relapse-engine` | **YES** |
| R08 | **No per-user fusion weight contract** | MEDIUM | System is within-user by framing but population-norm by implementation; personalization value proposition is weak | Personalization agent identified this gap | Define `UserFusionProfile` type in shared-types; implement weight derivation in personalization engine | `@hum-ai/personalization-engine` | NO (pre-launch) |
| R09 | **Calibration ladder not a typed enum** | MEDIUM | Multiple packages independently re-derive baseline stages; risk of divergence | Personalization agent finding | Add `BaselineStage` enum to `@hum-ai/shared-types` | `@hum-ai/shared-types` | **YES** (demo should show correct stage) |
| R10 | **Dual baseline (rolling vs anchored) not architected** | MEDIUM | Rolling baseline shifts toward "new normal"; relapse detection uses wrong comparison window | Cross-agent conflict 8 | Architecture doc must define two baseline types; implementation deferred but design committed | `@hum-ai/personalization-engine` + `@hum-ai/relapse-engine` | NO (pre-launch) |
| R11 | **HumDomainAdapter not specified** | MEDIUM | When speech-pretrained models are introduced in Phase 2, no adaptation layer exists | Audio domain agent | Document HumDomainAdapter interface in HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md | HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md | NO (pre-Phase-2) |
| R12 | **Multi-head affect contract not implemented (dimensional + discrete)** | MEDIUM | Jordan 2025 evidence mandates dimensional modeling; current rule-based system only has discrete dimension scores | Clinical evidence agent | Define multi-head AffectOutput type in affect-model-contracts | `@hum-ai/affect-model-contracts` | NO (pre-launch) |
| R13 | **Internal vs user-facing label separation not enforced at package boundary** | HIGH | InternalAffectLabel could be rendered directly in UI without safety translation | Safety agent | Add TypeScript type incompatibility between InternalAffectLabel and UserFacingAffectCopy | `@hum-ai/affect-model-contracts` | **YES** |
| R14 | **Numeric confidence percentage shown to users implies prediction accuracy** | MEDIUM | A user reading "88% confident" may believe this is 88% accurate diagnosis probability | Cross-agent conflict 7 | CLAIMS_LADDER.md must decide: show signal quality framing, not numeric %; or reword numeric display | CLAIMS_LADDER.md + UI | NO (pre-launch) |
| R15 | **Research audio upload consent gate not defined** | MEDIUM | Future research mode could inadvertently ship without user consent | Safety agent | Reserve `researchAudioUpload: boolean` in UserConsentState now | DATA_GOVERNANCE.md + `@hum-ai/shared-types` | NO (pre-launch) |
| R16 | **Recommendation engine receives clinical labels** | HIGH | Recommendation using clinical diagnosis to select music is an off-label medical intervention | Architecture agent | Add type check: RecommendationInput must not accept ClinicalLabel type | `@hum-ai/intervention-engine` | **YES** |
| R17 | **ADR for hum-domain adaptation not written** | MEDIUM | Architectural decisions about speech→hum domain gap not documented; future contributors will repeat the decision | Audio domain agent | Write ADR-0005 or equivalent | `docs/adr/` | NO (but pre-launch) |
| R18 | **Relapse signal copy never safety-language checked** | HIGH | Relapse copy may use alarming or clinical language that bypasses the safety-language gate | QA agent | Add test: every relapse signal `note` field is passed through safety-language check | `@hum-ai/relapse-engine` + `@hum-ai/safety-language` | **YES** |
| R19 | **50% evidence base high-risk bias unacknowledged in product docs** | MEDIUM | Briganti 2025: 6/12 studies high risk of bias. This must be in internal doc | Clinical evidence agent | Document in VALIDATION_PLAN.md: "clinical voice biomarker evidence has significant methodological limitations" | VALIDATION_PLAN.md | NO |
| R20 | **Missing-modality fusion untested** | MEDIUM | Audio-only is the primary real-world case; untested degradation path could produce wrong outputs | QA agent | Add missing-modality fusion tests | `@hum-ai/fusion-engine` tests | **YES** |

---

## Must-Fix Before Demo Summary

The following risks (R01, R02, R03, R04, R05, R06, R07, R09, R13, R16, R18, R20) must be mitigated before any public demo:

1. **R01:** `@hum-ai/safety-language` exists with automated forbidden-phrase tests
2. **R02:** Relapse hard cap (88%) is a tested invariant
3. **R03:** Raw audio privacy throw-on-violation is unit-tested
4. **R04:** CLAIMS_LADDER.md forbids speech-dataset accuracy claims
5. **R05:** Domain classifier is minimally specified (even if not fully implemented)
6. **R06:** FusionOutput contract includes `abstain`, `topClassMargin`, `modalityAgreement`
7. **R07:** Relapse engine minimum-hum gate is specified and tested
8. **R09:** `BaselineStage` enum exists in shared-types
9. **R13:** Internal/user-facing label type separation is enforced
10. **R16:** RecommendationInput type forbids clinical labels
11. **R18:** Relapse copy is safety-language checked
12. **R20:** Missing-modality fusion is tested
