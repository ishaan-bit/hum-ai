# Next Prompt — Intervention of the Day (handoff)

Use this to continue the work in a fresh session.

## State

- Branch `parallel/intervention-of-day-layer` (worktree `c:\Users\Kafka\Documents\humai-intervention-layer`),
  one local commit `feat: add Hum AI intervention of the day layer`, **not pushed**.
- Green: `npm run typecheck`, `npm test` (233/233), `npm run qa`, `npm run demo:voice`.
- The Intervention of the Day layer is complete in `@hum-ai/intervention-engine` and surfaced via
  `orchestrator.userFacing.interventionOfDay`.

## Recommended next steps (pick up here)

1. **Fix the flagged contracts governance issue (small, separate change).**
   In `packages/affect-model-contracts/src/heads.ts`, the `stress_overload` head (riskMarker:true)
   lists `intervention_support_source` (de Witte music meta-analysis) in `sourceRefs`. Per ADR-0005
   and `docs/source/INDEX.md`, music-intervention evidence must NOT back a state-DETECTION head —
   only the intervention/recommendation side. Remove it (leave `vocal_biomarker_and_singing_protocol_support`,
   optionally add `clinical_voice_biomarker_review` for parity). Then add a `contracts.test.ts`
   assertion: no `riskMarker` head's `sourceRefs` includes `intervention_support_source`. Re-run
   `npm test` (watch `affect-model-contracts` + any snapshot of head metadata).

2. **(Optional) Scale needs_support hedging to trend confidence.**
   `LongitudinalStatus` currently carries only `drifting`/`persistent` booleans. The orchestrator
   has richer signal (`relapseDrift`, `longitudinalTrendStrength`). Carry a trend-strength/low-confidence
   flag onto `LongitudinalStatus` and let `composeWhy` modulate the tentative frame by it (it is
   currently always-on for needs_support, which is safe but uniform).

3. **(Optional) Real surfaces.** Wire `userFacing.interventionOfDay` into a UI surface (mobile/web)
   — render `title`, `instruction`, `whySuggested`, `confidenceLanguage`, and the `escalation` block
   only when `escalation.show`. Keep `internal` and `recommendationView` off the client.

4. **(Optional) Content + i18n.** Localize template copy; add a per-user recently-shown history so
   the daily `rotationSeed` doesn't repeat a step too often.

## Guardrails (unchanged — keep enforcing)

No push/deploy. No heavy ML deps, camera runtime, model training, or faked clinical validation. No
weakened safety rules. No internal clinical labels or raw confidence numbers in user-facing copy.
No therapy/diagnosis/treatment/cure/prevention claims. The intervention engine reads only the
sanitized `RecommendationView`. Every user-facing string must pass `@hum-ai/safety-language`.

## Key files

- `packages/intervention-engine/src/{states,templates,intervention-of-day}.ts`
- `packages/intervention-engine/test/{intervention-of-day,intervention-safety}.test.ts`
- `packages/orchestrator/src/orchestrator.ts` (`interventionOfDay` build + screen)
- `docs/packages/intervention-of-day.md`
- `worklog/intervention-of-day-layer/` (PLAN, STATE_TAXONOMY_EXTRACT, SOURCE_GROUNDING,
  INTERVENTION_MAPPING, SAFETY_LANGUAGE_REVIEW, TEST_REPORT, PATCH_LOG, FINAL_STATUS, NEXT_PROMPT)
