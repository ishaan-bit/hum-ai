# Hum v2 — Parallel Agent Review Pack

**Pass:** Third Parallel Pass — Adversarial Architecture Review
**Date:** 2026-06-18
**Status:** Complete
**Reviewer model:** claude-sonnet-4-6 (multi-specialist simulation)

---

## Purpose

This folder contains a structured adversarial review of the Hum v2 foundation architecture. It is produced by a separate review session running in parallel with:

- **Session 1 (Main):** Building the foundation packages, ADRs, and architecture docs.
- **Session 2 (Research):** Auditing source documents and producing the research evidence pack (`parallel-research-pass/`).
- **Session 3 (This pass):** Adversarial specialist review producing this acceptance pack.

No files outside `parallel-agent-review/` were modified by this session.

---

## Specialist Agents Simulated

| Agent | Focus | File |
|---|---|---|
| Architecture Agent | TriSense adaptation, FER/SER/TER separation, late fusion, attention roadmap, recommendation layer | [ARCHITECTURE_AGENT_REVIEW.md](ARCHITECTURE_AGENT_REVIEW.md) |
| Audio Domain Agent | Hum vs speech domain gap, datasets as priors, domain classifier, HumDomainAdapter, confidence penalties | [AUDIO_DOMAIN_AGENT_REVIEW.md](AUDIO_DOMAIN_AGENT_REVIEW.md) |
| Clinical Evidence Agent | Depression voice biomarkers, SER mental health evidence, DVDSA, what can and cannot be claimed | [CLINICAL_EVIDENCE_AGENT_REVIEW.md](CLINICAL_EVIDENCE_AGENT_REVIEW.md) |
| Personalization Agent | Personal baseline, calibration ladder, user-specific fusion, recovery/relapse signatures | [PERSONALIZATION_AGENT_REVIEW.md](PERSONALIZATION_AGENT_REVIEW.md) |
| Safety, Privacy & Claims Agent | Raw-audio privacy, consent gating, forbidden clinical claims, confidence rules, abstention | [SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md](SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md) |
| QA/Test Agent | Required tests for main repo across all critical contracts | [QA_TEST_AGENT_REVIEW.md](QA_TEST_AGENT_REVIEW.md) |

---

## Output Files

| File | Purpose |
|---|---|
| `README.md` | This file — orientation |
| `AGENT_REVIEW_SUMMARY.md` | Executive synthesis, top findings, top risks |
| `ARCHITECTURE_AGENT_REVIEW.md` | Architecture specialist review |
| `AUDIO_DOMAIN_AGENT_REVIEW.md` | Audio domain specialist review |
| `CLINICAL_EVIDENCE_AGENT_REVIEW.md` | Clinical evidence specialist review |
| `PERSONALIZATION_AGENT_REVIEW.md` | Personalization specialist review |
| `SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md` | Safety and claims specialist review |
| `QA_TEST_AGENT_REVIEW.md` | QA and test acceptance criteria |
| `CROSS_AGENT_CONFLICTS.md` | Tensions and disagreements between specialist views |
| `RISK_REGISTER.md` | Prioritized risk table with mitigations |
| `MAIN_REPO_ACCEPTANCE_CRITERIA.md` | PASS/WARN/FAIL checklist for foundation repo |
| `POST_FOUNDATION_INTEGRATION_PROMPT.md` | Exact prompt to run after all three sessions complete |
| `CHECK_ACCEPTANCE_CRITERIA.sh` | Read-only bash script that checks main repo structure |

---

## Source Documents Used

All sources are from `docs/source/` and extracted text from `.extract/`. The `docs/source/INDEX.md` was used as the authoritative extraction manifest.

| Source ID | Document | Role |
|---|---|---|
| `trisense_architecture` | IJERTCONV14IS040031.pdf | System spine — TriSense architecture |
| `hum_spec` | Hum_Academic_Review_Technical_Specification.docx | Source of truth — hum protocol, thresholds, privacy |
| `clinical_voice_biomarker_review` | 1-s2.0-S0892199725001870-main.pdf | Clinical prior — voice→depression biomarkers |
| `vocal_biomarker_and_singing_protocol_support` | brainsci-15-00762.pdf | Singing/sustained phonation bridge to hum |
| `ser_mental_health_review` | mental-2025-1-e74260.pdf | SER in mental health — methodology guardrail |
| `longitudinal_voice_treatment_response_source` | s43856-025-01326-3.pdf | DVDSA relapse/recovery engine inspiration |
| `intervention_support_source` | Effects_of_music_interventions... | Music intervention evidence — intervention rationale only |

---

## Review Rules Applied

1. Source-backed facts are labeled `[SOURCE: id]`. Brief-derived claims are labeled `[BRIEF]`.
2. If a source cannot be parsed, it is stated explicitly. All seven sources were machine-readable.
3. Contradictions between ambition and evidence are called out explicitly.
4. The vision (early detection, anxiety/depression-risk markers, broad emotional-state detection, relapse-risk prevention, personalization) is preserved.
5. Claim safety is enforced: **risk marker / screening signal = YES; diagnosis / prevents relapse / clinically validated = NO.**
