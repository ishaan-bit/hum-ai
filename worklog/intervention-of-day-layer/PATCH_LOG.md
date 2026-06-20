# Patch Log

Branch `parallel/intervention-of-day-layer`, worktree
`c:\Users\Kafka\Documents\humai-intervention-layer`. All changes local; nothing pushed.

## New files — `@hum-ai/intervention-engine`

- `packages/intervention-engine/src/states.ts` — canonical IoD regulation-state taxonomy
  (`HUM_REGULATION_STATES`, 11 states), `deriveRegulationState` (sanitized view + safe meta →
  state), the internal `REGULATION_STATE_CROSSWALK`, `isAffectiveState`, `EVIDENCE_RANK`, and the
  `RegulationStateMeta` / `LongitudinalStatus` types.
- `packages/intervention-engine/src/templates.ts` — `InterventionCategory` (11), intensity,
  `MusicVaTarget`, `InterventionTemplate`, and `INTERVENTION_TEMPLATES` (32 curated templates).
- `packages/intervention-engine/src/intervention-of-day.ts` — `InterventionOfDay` output type,
  `InterventionOfDayInput`, `selectInterventionOfDay`, `selectTemplateForState`, `composeWhy`
  (one-sentence whySuggested), evidence→`confidenceLanguage` map, `NOT_BASED_ON`, escalation
  gating, `interventionOfDayStrings`, and `assertInterventionOfDaySafe` (safety-language self-check).
- `packages/intervention-engine/test/intervention-of-day.test.ts` — state-mapping + design-principle
  + capture/confidence/history + escalation + confidence-language + determinism tests.
- `packages/intervention-engine/test/intervention-safety.test.ts` — full-sweep safety-language,
  no-treatment/diagnosis/prevention, no-clinical-leak, music-scope, and library-integrity tests.

## Edited files

- `packages/intervention-engine/src/index.ts` — re-export `./states`, `./templates`,
  `./intervention-of-day` (the existing `selectIntervention*` V-A mapper is unchanged).
- `packages/intervention-engine/package.json` — add dependency `@hum-ai/safety-language` (the
  package has zero deps, so no cycle; lets the layer self-validate copy and reuse `EvidenceLevel`).
- `packages/orchestrator/src/orchestrator.ts` —
  - import `selectInterventionOfDay`, `interventionOfDayStrings`, type `InterventionOfDay`, and
    `EARLY_BASELINE_HUMS`;
  - add `interventionOfDay: InterventionOfDay` to `UserFacingRead`;
  - build it from the sanitized `recommendationView` + qualitative confidence + abstracted
    longitudinal status + consent gate, with a deterministic per-day `rotationSeed` derived from
    `now` (no `Date` object);
  - append `interventionOfDayStrings(...)` to the boundary safety screen (`userFacingStrings`).
- `packages/orchestrator/test/orchestrator.test.ts` — add `interventionOfDay` to the expected
  `USER_FACING_KEYS` (the only contract-shape change; all existing assertions still hold).
- `apps/web/demo/voice-core-demo.ts` — print the Intervention of the Day in the demo output.

## Docs

- `docs/packages/intervention-of-day.md` — package + evidence-grounding doc.
- `worklog/intervention-of-day-layer/` — PLAN, STATE_TAXONOMY_EXTRACT, SOURCE_GROUNDING,
  INTERVENTION_MAPPING, SAFETY_LANGUAGE_REVIEW, TEST_REPORT, PATCH_LOG, FINAL_STATUS, NEXT_PROMPT.

## Review-driven fixes (post adversarial review)

A 6-dimension adversarial review (26 agents, every finding independently verified) confirmed 16
real findings; all in-scope ones were fixed:

- **Safety (needs_support):** the longitudinal risk-tier now ALWAYS carries an explicit, tentative
  non-diagnostic frame ("— a tentative pattern to gently note, not a conclusion —") independent of
  the single-read evidence band (CLAIMS_LADDER tier-3); `basedOnSignals` now reflects the trend, not
  a per-hum affective read; the escalation reason is softened ("seems to have persisted").
- **Correctness:** the deriver no longer leaves a clearly-negative read with mild arousal mapped to
  `neutral_usual`/`calm` (it routes to a grounding step); `mixedOrUncertain` is checked AFTER the
  clear V-A branches so a confident strong read keeps its downshift; non-finite `rotationSeed`
  (NaN/±Infinity) is sanitized instead of crashing; the dead/baseline-bypassing fallback branch was
  removed (selection now throws loudly on a real library gap, with a totality-invariant test).
- **Copy:** fixed a double-conjunction whyAction, the broken 5-4-3-2-1 grammar, the box-breath
  title/instruction dose mismatch, and a "mixed moment" reason on a neutral read.
- **Brief:** added the `music_steady` template so the declared `steady` music target (brief's
  "mixed → low-complexity steady track") is actually used; strengthened the anger discharge test.
- **Docs:** clarified the `sourceRefs` field semantics (content vs within-user gating).
- **Flagged, not fixed (out of scope):** `affect-model-contracts` `heads.ts` cites the music
  source `intervention_support_source` on the `stress_overload` *detection* head — a pre-existing
  ADR-0005 governance contradiction in a different package's clinical contract. Recorded in
  FINAL_STATUS / NEXT_PROMPT for the contracts owner.

## Guardrails respected

No push/deploy. No heavy ML deps (only the existing light devDeps installed for the worktree). No
camera runtime, no model training, no faked clinical validation, no weakened safety rules, no
internal clinical labels in user-facing copy, no therapy/diagnosis/treatment/cure/prevention
claims.
