# Post-Foundation Integration Prompt

**Purpose:** This is the exact prompt to run AFTER all three parallel sessions complete and before implementation of legacy Hum audio-features and quality-gate begins.

**When to use:** After session 1 (main foundation), session 2 (research audit), and session 3 (this review pass) have all finished writing their output folders.

---

## Integration Prompt

Copy and paste the following verbatim into a new Claude Code session:

---

```
You are starting the Hum v2 integration and gap-closing phase.

Three parallel sessions have just completed:
- Session 1: Main foundation (packages, architecture docs, ADRs)
- Session 2: Research audit (parallel-research-pass/)  
- Session 3: Adversarial review (parallel-agent-review/)

Your job is:
1. Read the main foundation output
2. Read parallel-research-pass/ if present
3. Read parallel-agent-review/
4. Run both check scripts
5. Compare against acceptance criteria
6. Patch missing contracts, docs, and tests
7. Only then begin implementation of legacy Hum audio-features and quality-gate

Do not skip steps. Do not begin legacy implementation until the gap-closing checklist is complete.

---

STEP 1: READ THE THREE PASSES

Read these files in order:

Main foundation:
- README.md (project root)
- docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md
- docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md
- docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md
- docs/claims/CLAIMS_LADDER.md
- docs/privacy/DATA_GOVERNANCE.md
- docs/validation/VALIDATION_PLAN.md
- docs/adr/ (all files)
- packages/shared-types/index.ts (or equivalent)
- packages/affect-model-contracts/index.ts (or equivalent)
- packages/fusion-engine/index.ts (or equivalent)
- packages/personalization-engine/index.ts (or equivalent)
- packages/relapse-engine/index.ts (or equivalent)
- packages/safety-language/index.ts (or equivalent)
- packages/quality-gate/index.ts (or equivalent)
- packages/dataset-registry/index.ts (or equivalent)

Research audit:
- parallel-research-pass/README.md
- parallel-research-pass/SOURCE_AUDIT.md
- parallel-research-pass/VOICE_BIOMARKER_EVIDENCE_MAP.md
- parallel-research-pass/TRISENSE_REQUIREMENTS_EXTRACT.md
- parallel-research-pass/LEGACY_HUM_FEATURES_TO_SALVAGE.md

Adversarial review:
- parallel-agent-review/AGENT_REVIEW_SUMMARY.md
- parallel-agent-review/ARCHITECTURE_AGENT_REVIEW.md
- parallel-agent-review/AUDIO_DOMAIN_AGENT_REVIEW.md
- parallel-agent-review/CLINICAL_EVIDENCE_AGENT_REVIEW.md
- parallel-agent-review/PERSONALIZATION_AGENT_REVIEW.md
- parallel-agent-review/SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md
- parallel-agent-review/QA_TEST_AGENT_REVIEW.md
- parallel-agent-review/CROSS_AGENT_CONFLICTS.md
- parallel-agent-review/RISK_REGISTER.md
- parallel-agent-review/MAIN_REPO_ACCEPTANCE_CRITERIA.md

---

STEP 2: RUN BOTH CHECK SCRIPTS

Run: bash parallel-agent-review/CHECK_ACCEPTANCE_CRITERIA.sh
Capture all PASS / WARN / FAIL outputs.

If parallel-research-pass/ contains a check script, run that too.

---

STEP 3: COMPARE AGAINST ACCEPTANCE CRITERIA

Open parallel-agent-review/MAIN_REPO_ACCEPTANCE_CRITERIA.md.

For each criterion (A01–A14, C01–C09, P01–P05, PKG01–PKG14, ADR01–ADR04, T01–T10, I01–I04):
- Determine its current state: PASS, WARN, or FAIL based on what you read in Step 1.
- Write a gap-closing log listing all non-PASS items with their current state and what needs to be done.

The demo-ready gate requires:
- All CRITICAL risks (R01, R02, R03) from RISK_REGISTER.md mitigated
- All must-fix test criteria (T01, T02, T04, T05) passing
- No more than 3 FAIL items across Sections 1–5 of acceptance criteria

---

STEP 4: PATCH MISSING CONTRACTS, DOCS, AND TESTS

For each FAIL or WARN item, patch in the following priority order:

Priority 1 — Safety-critical (must fix before any demo):
1. Create packages/safety-language if absent. Implement checkSafetyLanguage() with forbidden-phrase list from SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md Section 3. Add automated tests covering all forbidden phrases.
2. Add BaselineStage enum to packages/shared-types if absent.
3. Add abstain, topClassMargin, modalityAgreement to FusionOutput type if absent.
4. Add InternalAffectLabel vs UserFacingAffectCopy type separation if absent.
5. Add relapse engine hard-cap (88%) test if absent. Add minimum-hum gate (3 consecutive, 5 baseline) specification if absent.
6. Add raw audio privacy throw-on-violation tests for all 12 forbidden field names.
7. Add domain classifier interface to quality-gate if absent (interface only; full implementation follows).
8. Add UserConsentState type with researchMode, longitudinalMonitoring, researchAudioUpload if absent.

Priority 2 — Architecture gaps:
9. Add HumDomainAdapter interface to audio architecture doc or quality-gate package if absent.
10. Add dataset-registry forbidden-use fields if absent.
11. Add multi-head affect contract (discrete + dimensional) to affect-model-contracts if absent.
12. Document dual baseline (rolling + anchored) in personalization architecture if absent.
13. Add CLAIMS_LADDER.md claim prohibitions if absent or incomplete.

Priority 3 — Test coverage:
14. Add confidence cap schedule unit tests if absent.
15. Add missing-modality fusion tests if absent.
16. Add domain gap confidence penalty tests if absent.
17. Add personalization stage policy tests if absent.
18. Add intervention claim guardrail tests if absent.

Priority 4 — Documentation gaps:
19. Write any missing ADRs (domain adaptation, claims ladder, dual baseline).
20. Complete VALIDATION_PLAN.md with evidence limitation acknowledgements.

---

STEP 5: LEGACY HUM FEATURES INTEGRATION

Only begin this step after Step 4 is complete and the acceptance criteria gate is met.

Read parallel-research-pass/LEGACY_HUM_FEATURES_TO_SALVAGE.md.

For each salvageable legacy feature:
1. Confirm it is compatible with the new packages/quality-gate domain classifier contract.
2. Confirm it does not bypass the confidence cap schedule.
3. Confirm it outputs to the correct AffectOutput head (broad affect, NOT clinical risk).
4. Port the feature to the new package structure.
5. Add a regression test confirming the feature produces the same output as the legacy lib/audioFeatures.ts implementation.

For each feature that is NOT salvageable (incompatible with new contracts):
- Document the reason in a migration note.
- Do not port it.
- Do not remove the legacy implementation yet — mark it as @deprecated in a comment.

---

STEP 6: VERIFY

Run the full test suite. Confirm:
- All T01–T10 tests pass (see MAIN_REPO_ACCEPTANCE_CRITERIA.md Section 6)
- No new forbidden clinical phrases introduced in any string
- Raw audio privacy throw-on-violation still passing
- Relapse hard cap still at ≤88%
- Domain gap penalties apply correctly

Report the final acceptance criteria scan: count of PASS / WARN / FAIL.
If FAIL count > 3, do not tag the build as demo-ready.

---

STEP 7: FINAL REPORT

Write a brief integration report (max 200 words) covering:
- What was already in place from the main foundation pass
- What was patched in this integration step
- Current acceptance criteria state (PASS/WARN/FAIL counts)
- Whether the demo-ready gate is met
- Any remaining WARN items and their mitigation timeline

Save the report as: integration-report/INTEGRATION_REPORT.md
```

---

## Notes for the Integration Claude Session

- This prompt is designed to be self-contained. The integration session does not need to re-read the original PDFs or source documents — all relevant facts have been extracted into the review files.
- If the main foundation pass produced files at different paths than those listed in Step 1, adapt the paths but check every equivalent file.
- If the research pass (session 2) produced a check script, run it. If not, skip Step 2b.
- Do not modify `parallel-agent-review/` or `parallel-research-pass/` during this session. These are read-only reference outputs.
- If you find that the main foundation pass already addressed most items, celebrate and go to Step 5 immediately.
- The integration session may write to: `packages/`, `docs/`, `tests/`, `integration-report/`. Not to `parallel-agent-review/`.

---

## Integration Prompt File Location

This file: `parallel-agent-review/POST_FOUNDATION_INTEGRATION_PROMPT.md`
