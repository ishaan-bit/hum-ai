# Parallel Research Pass — Hum v2 Architecture Audit

**Generated:** 2026-06-18  
**Session role:** Parallel research and implementation audit (read-only outside this folder)  
**Primary session:** Main foundation build (packages, types, ADRs)

---

## Purpose

This folder contains a source-grounded research and implementation audit pack created in parallel with the main Hum v2 foundation build. Its purpose is to give the next implementation session an independent reference to:

1. Verify that the main foundation faithfully implements the TriSense architecture, legacy Hum features, and clinical governance requirements derived from the source documents.
2. Provide a checklist and a bash script to audit the main repo automatically.
3. Provide the exact prompt to run next.

## Files

| File | Purpose |
|------|---------|
| `README.md` | This file |
| `SOURCE_AUDIT.md` | Per-source extraction status, key facts, implementation relevance |
| `TRISENSE_REQUIREMENTS_EXTRACT.md` | Architecture requirements from IJERTCONV14IS040031.pdf |
| `LEGACY_HUM_FEATURES_TO_SALVAGE.md` | Features, formulas, thresholds from Hum_Academic_Review_Technical_Specification.docx |
| `VOICE_BIOMARKER_EVIDENCE_MAP.md` | Feature→condition evidence table from clinical sources |
| `SER_MENTAL_HEALTH_MODELING_NOTES.md` | SER taxonomy, affect models, methodology guardrails |
| `HUM_VS_SPEECH_DOMAIN_GAP.md` | Domain adaptation argument; confidence penalty logic |
| `PERSONALIZATION_AND_RELAPSE_REQUIREMENTS.md` | Within-person comparison model and relapse engine design |
| `MUSIC_INTERVENTION_REQUIREMENTS.md` | What the music meta-analysis does and does not support |
| `DATASET_REGISTRY_RECOMMENDATIONS.md` | Proposed registry schema and domain gap entries |
| `CONFIDENCE_AND_CLAIMS_GUARDRAILS.md` | Allowed terms, caps, abstention rules, clinical ladder |
| `MAIN_REPO_CHECKLIST.md` | Checklist to verify main foundation session output |
| `CHECK_MAIN_FOUNDATION.sh` | Bash script to run from repo root — PASS/WARN/FAIL |
| `NEXT_IMPLEMENTATION_PROMPT.md` | Exact prompt for the next implementation session |

## Reading order for the next session

1. Run `CHECK_MAIN_FOUNDATION.sh` first.
2. Read `MAIN_REPO_CHECKLIST.md` and compare against script output.
3. Use `LEGACY_HUM_FEATURES_TO_SALVAGE.md` when implementing `@hum-ai/audio-features` and `@hum-ai/quality-gate`.
4. Use `TRISENSE_REQUIREMENTS_EXTRACT.md` when wiring `@hum-ai/fusion-engine`.
5. Use `CONFIDENCE_AND_CLAIMS_GUARDRAILS.md` when writing any user-facing copy or confidence model.
6. Use `PERSONALIZATION_AND_RELAPSE_REQUIREMENTS.md` when implementing `@hum-ai/relapse-engine`.

## Isolation contract

This pass **did not modify** any file outside `parallel-research-pass/`. All source PDFs and docx were read from `.extract/` (cached text) and `docs/source/INDEX.md`. No packages, types, ADRs, or docs outside this folder were touched.
