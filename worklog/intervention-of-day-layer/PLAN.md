# Intervention of the Day — Plan

**Branch:** `parallel/intervention-of-day-layer`
**Worktree:** `c:\Users\Kafka\Documents\humai-intervention-layer`
**Base:** `cohesion/voice-core-merge` @ `5a95aea` (includes the real voice-core extractor + orchestrator, merge `e6bd8c6`).
**Date:** 2026-06-19

## Goal

Turn Hum AI's already-extracted hum signal into a simple, safe, evidence-informed
**Intervention of the Day**: one small (1–5 minute) regulation-support step, with a
plain one-sentence reason, that never claims therapy / diagnosis / treatment / cure /
prevention and never exposes internal clinical labels or raw confidence numbers.

The pipeline this layer plugs into already exists:

```
audio → audio-features → quality-gate → domain-classifier → expert-ser →
fusion-engine → personalization (dual baseline) → relapse-engine →
intervention-engine → safety-language → orchestrator(userFacing)
```

The conceptual model is **not** `hum → diagnosis → advice`. It is:

```
hum features → affective signal → confidence/safety gate → simple regulation support
```

## Hard constraints (from the brief + the existing architecture)

- Work only inside the worktree. **No push, no deploy.** Commit locally only if green.
- No heavy ML deps, no camera runtime, no model training, no faked clinical validation.
- The intervention layer reasons **only** over the sanitized `RecommendationView`
  (abstracted bands + dimensional V-A). It never reads raw clinical-risk labels
  (`depressive_affect_markers`, …) — ADR-0006.
- All user-facing strings pass `@hum-ai/safety-language` (`validateUserFacingText`) and
  carry no raw `%` confidence (`isConfidenceCopySafe`) — ADR-0008.
- `assertNoClinicalLeak` must pass on the produced object (no clinical head id / internal
  label as an object key anywhere).
- Display name **Hum AI**; scope `@hum-ai`; "legacy Hum" = older spec only.
- Language register: *daily regulation support, intervention of the day, small reset,
  grounding action, recovery suggestion, today's support step, why this was suggested.*
  Never "therapy / therapist / treats / cures / prevents relapse / diagnosis".

## Design decisions

1. **New module in `@hum-ai/intervention-engine`** (extends, does not replace):
   - `src/states.ts` — canonical **IoD regulation-state taxonomy** + a deriver that maps
     `(RecommendationView + safe meta)` → one `HumRegulationState`. Safe, abstracted names
     only; documents the crosswalk to the codebase's real internal heads.
   - `src/templates.ts` — a small library of ~30 practical templates (target/contra states,
     min evidence, baseline requirement, category, intensity, duration, why-fragment,
     safety note, source refs, music V-A target).
   - `src/intervention-of-day.ts` — the `InterventionOfDay` output type, `selectInterventionOfDay`,
     evidence→confidenceLanguage mapping, whySuggested composition, escalation gating, and a
     **self-check** that runs every produced string through safety-language.
   - The existing `selectIntervention` / `selectInterventionFromView` V-A mapper stays intact.
2. **Dependency:** add `@hum-ai/safety-language` to intervention-engine (it has zero deps →
   no cycle). Lets the layer self-validate copy and reuse the `EvidenceLevel` band.
3. **Orchestrator integration:** add `interventionOfDay: InterventionOfDay | null` to
   `UserFacingRead`, built from the same sanitized view + qualitative confidence + abstracted
   longitudinal status. Screen its strings in the existing safety pass; keep `internal`
   (numbers, risk markers) and `recommendationView` (bands) separate. Update the orchestrator
   test's `USER_FACING_KEYS` (allowed: we update all tests we touch).
4. **Determinism:** "of the day" rotation via an optional `rotationSeed` (e.g. day-of-year)
   chosen by the caller; default 0. No `Date`/random inside the engine.

## Selection priority (safety-first)

1. capture unusable → `poor_capture` → **repeat_capture** (no emotional interpretation)
2. abstained + baseline immature → `not_enough_history` → general low-intensity option
3. abstained + baseline mature → `low_confidence` → general grounding, cautious wording
4. committed + sustained worsening/relapse-drift → `needs_support` → **safety_support / reduce_load**
   (gentle; escalation block only when safety allows)
5. committed read → affect state from V-A + bands:
   `mixed_unsettled · high_activation_negative · low_recovery · low_mood ·
    positive_activation · calm_regulated · neutral_usual`

## Validation

`npm run typecheck` · `npm test` · `npm run qa` · `npm run demo:voice`, plus new tests
covering every canonical state, each design principle, poor capture, low confidence, not
enough history, worsening-with-safe-copy, no clinical-label leak, no treatment/diagnosis/
prevention claims, all copy passes safety-language, and music scope = regulation only.

## Deliverables

Code (above) + `docs/packages/intervention-of-day.md` + worklog files
(PLAN, STATE_TAXONOMY_EXTRACT, SOURCE_GROUNDING, INTERVENTION_MAPPING,
SAFETY_LANGUAGE_REVIEW, TEST_REPORT, PATCH_LOG, FINAL_STATUS, NEXT_PROMPT).
