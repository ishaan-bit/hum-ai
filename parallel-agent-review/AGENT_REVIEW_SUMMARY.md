# Agent Review Summary

**Pass:** Third Parallel Pass — Adversarial Architecture Review
**Date:** 2026-06-18
**Session:** Parallel to Main Foundation Build + Research Audit

---

## Executive Summary

The Hum v2 architecture is built on sound foundations: TriSense's expert-based late-fusion paradigm is correctly adapted, the hum spec's acoustic feature pipeline is detailed and technically defensible, and the privacy model (raw audio blocked by default, derived-data-only sync) is a genuine strength. The clinical evidence base is real and correctly cited.

However, this review identified **7 CRITICAL/HIGH risks that block demo readiness** if left unaddressed, and **5 cross-agent architectural conflicts** that require explicit design decisions before implementation. The product vision is fully preserved — early detection, anxiety/depression-risk markers, relapse monitoring, and personalization are all defensible — but require the correct claim framing and safety infrastructure.

---

## Specialist Agent Top 3 Findings

### Architecture Agent

1. **Critical semantic gap: rule-based dimension z-scores ≠ neural probability vectors.** TriSense's meta-learner consumes neural probability vectors. Hum's current audio expert emits z-score dimension scores. The architecture must explicitly document how z-scores become probability-equivalent vectors, or the fusion layer contract is undefined.

2. **FusionOutput contract missing `abstain`, `topClassMargin`, and `modalityAgreement`.** Without these three fields, safety checks (abstention policy, margin-based confidence degradation, multi-expert agreement scoring) cannot function.

3. **FER slot undocumented.** TriSense has three expert slots; Hum drops FER. The architecture must declare: absent, null-padded, or future journal TER fill?

### Audio Domain Agent

1. **No domain classifier contract.** The system cannot distinguish a user who hummed from one who spoke, sang, or generated background noise. Without a domain classifier, all confidence values are potentially domain-inappropriate.

2. **Speech dataset accuracy will be misused without explicit prohibition.** Briganti 2025 AUC 0.71–0.93 is for clinical speech, not hum. Without a dataset-registry `forbiddenUse` field and a CLAIMS_LADDER.md prohibition, this number will appear in product materials.

3. **HumDomainAdapter is missing.** When speech-pretrained models are introduced in Phase 2, there is no adapter to domain-shift their outputs. Designing the interface now is trivially cheap; retrofitting it after integration is expensive.

### Clinical Evidence Agent

1. **50% of the depression voice biomarker evidence base has high methodological bias.** The 78–96.5% accuracy range from Briganti 2025 cannot be used in user-facing claims in any form. The only permitted framing is "associated with mood-related changes in research settings with varied methodology."

2. **DVDSA n=48 and clinical-speech domain gap disqualify Kim 2026 accuracy figures as Hum claims.** The DVDSA methodology is the correct inspiration for the relapse engine. The F1 scores (78.05%, 70.58%) cannot be cited as Hum performance figures.

3. **Multi-head affect contract (dimensional + discrete) is required by the evidence.** Jordan 2025 (JMIR Mental Health) explicitly states dimensional valence–arousal modeling is superior for mental health applications. Implementing only discrete categories misaligns with the clinical evidence.

### Personalization Agent

1. **No per-user fusion weight contract.** The confidence cap schedule is a coarse personalization mechanism. Without per-user feature weights, Hum is population-norm in implementation despite within-user framing. The DVDSA result (intra-patient outperforms group-level) proves this matters.

2. **Relapse drift confidence hard cap (88%) not contractually enforced.** This is the highest clinical-safety-risk invariant in the system. It must be a named constant in shared-types and a tested invariant in the relapse engine.

3. **Calibration ladder is implicit, not typed.** All downstream packages branch on baseline stage. Without a typed `BaselineStage` enum in shared-types, each package independently re-derives the same breakpoints with divergence risk.

### Safety, Privacy, and Claims Agent

1. **`@hum-ai/safety-language` does not exist as a testable contract.** The entire safety guarantee depends on this package. Without automated forbidden-phrase tests in CI, clinical language can reach users on any deploy.

2. **Top-class margin and modality agreement rules are missing.** A 51%-vs-49% prediction receives the same confidence as a 90%-vs-10% prediction. Without margin and agreement rules, confidence values are not meaningful.

3. **Domain-mismatch confidence cap is absent.** A speech-contaminated capture receives the same confidence as a clean hum capture. The cap schedule governs baseline maturity only; domain quality is unaccounted.

### QA/Test Agent

1. **Zero test coverage for the relapse engine.** The relapse engine is the highest clinical-safety-risk package. The hard cap (88%), minimum-hum emission rules, and safety-language in relapse copy are all untested.

2. **Safety language forbidden phrase tests do not exist.** `@hum-ai/safety-language` with automated tests must be part of CI. No deploy should be possible without this gate.

3. **Missing-modality fusion is untested.** Audio-only is the primary real-world case. An untested degradation path in the most common usage pattern is unacceptable.

---

## Top 10 Risks (From Risk Register)

| # | Risk | Severity | Must-Fix Before Demo |
|---|---|---|---|
| R01 | Forbidden clinical claims reach users (no safety-language package) | CRITICAL | YES |
| R02 | Relapse drift signal emitted without hard 88% confidence cap | CRITICAL | YES |
| R03 | Raw audio accidentally included in sync payload (untested throw) | CRITICAL | YES |
| R04 | MELD/clinical speech accuracy cited as Hum accuracy | HIGH | YES |
| R05 | No domain classifier — domain mismatch undetected | HIGH | YES |
| R06 | FusionOutput missing `abstain`, `topClassMargin`, `modalityAgreement` | HIGH | YES |
| R07 | Relapse engine emits signals from cold-start/early baseline | HIGH | YES |
| R13 | Internal/user-facing label separation not enforced at package boundary | HIGH | YES |
| R16 | Recommendation engine receives clinical labels | HIGH | YES |
| R18 | Relapse signal copy never safety-language checked | HIGH | YES |

---

## What Is Working Well

- **Privacy model is strong.** The forbidden-field list and derived-data-only sync posture are correct. The enforcement needs tests, but the design is right.
- **Quality gate is detailed and defensible.** The hum_spec thresholds (duration, clipping, silence, pitch coverage) are well-specified. This is among the most rigorous parts of the current system.
- **Confidence cap schedule is well-specified.** The 72/76/82/88/90–92% schedule is correctly designed as a signal quality indicator.
- **TriSense architecture adaptation is conceptually correct.** Expert separation + late fusion is the right paradigm. The semantic gap (rule-based vs neural) is an implementation detail, not a design error.
- **Within-user comparison framing is correct and well-supported.** DVDSA [SOURCE: longitudinal_voice_treatment_response_source] and the hum spec both point to the same design.
- **Music recommendation evidence is solid.** [SOURCE: intervention_support_source] 104 RCTs supporting music-stress reduction is the strongest evidence base in the entire system.

---

## Integration Readiness Gate

Before the three parallel sessions are integrated:

1. Run `parallel-agent-review/CHECK_ACCEPTANCE_CRITERIA.sh`
2. Run `parallel-research-pass/` check script if present
3. Confirm all 12 must-fix risks (R01–R07, R09, R13, R16, R18, R20) are addressed
4. Confirm cross-agent conflicts 1, 3, 4, 6, 8 have explicit resolution strategies in CLAIMS_LADDER.md and relevant architecture docs
5. Run full test suite; confirm no FAIL items in T01–T07

See `POST_FOUNDATION_INTEGRATION_PROMPT.md` for the exact integration prompt.
