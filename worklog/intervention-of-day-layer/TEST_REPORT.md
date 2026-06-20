# Test Report

Worktree: `c:\Users\Kafka\Documents\humai-intervention-layer` · branch
`parallel/intervention-of-day-layer`. Node v22.20.0.

## Commands

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | ✅ clean, no errors |
| `npm test` (node:test over `packages/**/test`) | ✅ **233 / 233 pass**, 0 fail, 0 skipped |
| `npm run qa` (QA gates) | ✅ all 4 gates pass (no-clinical-leak, no-camera-deps, no-raw-confidence-copy, forbidden-files) |
| `npm run demo:voice` | ✅ runs; prints user-facing read + Intervention of the Day (incl. repeat-capture on the rejected hum) |

Baseline before this change was 202 tests; the layer adds **31 tests** (233 total): 24 from the
initial implementation plus **7 regression tests** added after the adversarial review (non-finite
seed, needs_support always-on uncertainty, needs_support trend-based basedOnSignals, the
negative-valence dead zone, mixed-vs-clear-signal precedence, the steady-music option, and the
state-coverage totality invariant). No existing test regressed; the one contract change (added
`userFacing.interventionOfDay`) was reflected in the orchestrator test's `USER_FACING_KEYS`.

## Adversarial review pass

A 6-dimension multi-agent review (safety-language, correctness, evidence-claims,
integration-separation, brief-compliance, copy-quality) with independent per-finding verification
ran over the layer. Integration/separation came back **clean (0 findings)**; 16 real findings were
confirmed and all in-scope ones fixed (see PATCH_LOG "Review-driven fixes"). One pre-existing
out-of-scope finding (a clinical-detection head in `affect-model-contracts` citing the music
source) is flagged in FINAL_STATUS/NEXT_PROMPT, not changed here.

## New tests and the brief's required coverage

`packages/intervention-engine/test/intervention-of-day.test.ts` and
`packages/intervention-engine/test/intervention-safety.test.ts`:

| # | Required check (brief) | Test |
| --- | --- | --- |
| 1 | state→intervention mapping for **every** canonical state | "every canonical state maps to a valid, safe, 1-5 minute intervention" (loops all 11 states) |
| 2 | high arousal / stress | "high arousal + negative valence → downshift" |
| 3 | low recovery / fatigue | "low recovery / fatigue → rest/recovery, never an energising push" |
| 4 | sadness / low mood | "sadness / low-mood markers → gentle activation, no claim of treating depression" |
| 5 | anger / frustration | "anger/frustration shares the high-activation-negative downshift region" |
| 6 | calm / regulated | "calm / regulated → maintain, do not over-intervene" |
| 7 | excitement / positive activation | "excitement / positive activation → channel into one focused thing" |
| 8 | mixed / unstable | "mixed / unstable → simplify, one grounding action" |
| 9 | poor capture | "poor capture → repeat capture, NO emotional interpretation" |
| 10 | low confidence / abstain | "low confidence / abstain (mature baseline) → cautious general grounding" |
| 11 | not enough history | "not enough history → baseline-forming general option only" |
| 12 | relapse_drift / worsening with safe copy | "sustained worsening / relapse-drift → needs_support with SAFE copy" + escalation-gating test |
| 13 | no clinical label leak | "no clinical head id / internal label leaks into the intervention output" (structural + textual sweep) |
| 14 | no treatment/diagnosis/prevention claims | "no intervention string makes a treatment / diagnosis / prevention claim" |
| 15 | all user-facing text passes safety-language | "every produced intervention string passes safety-language and carries no raw %" (full sweep) |
| 16 | music scope = regulation only | "music templates are regulation support only — cited, scoped, never treatment/diagnosis" |
| + | confidence language mapping + uncertainty surfacing | "evidence band maps to confidence language; low evidence surfaces uncertainty" |
| + | determinism / safe rotation | "selection is deterministic per input and rotates safely by seed" |
| + | library integrity | "25-40 templates, unique ids, 1-5 min, every category used"; "every canonical state covered"; "contraindicated ∩ target = ∅" |

Orchestrator-side (existing suite, still green): "recommendation engine receives only the
sanitized view"; "clinical-risk labels can never leak into user-facing output"; "user-facing
confidence is qualitative only" — these now also traverse `userFacing.interventionOfDay`.

## Notes

- The full-sweep safety test exercises every state × 4 evidence bands × escalation on/off × 4
  rotation seeds and screens every produced string — so a future unsafe template fails loudly.
- The intervention engine still consumes only `RecommendationView`; the no-clinical-leak QA gate
  and orchestrator separation tests confirm the boundary is intact.
