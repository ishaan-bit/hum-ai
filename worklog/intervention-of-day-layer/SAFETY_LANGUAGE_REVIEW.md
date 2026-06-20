# Safety-Language Review

The Intervention of the Day layer is held to the same enforcement as the rest of Hum AI's
user-facing copy: `@hum-ai/safety-language` `validateUserFacingText` (forbidden-phrase scan) +
`isConfidenceCopySafe` (no raw `%`), plus `assertNoClinicalLeak` (no clinical head id / internal
label as an object key) from `@hum-ai/affect-model-contracts`.

## Enforcement points (defense in depth)

1. **Template authoring** — every string is plain, reflective, non-clinical by construction.
2. **`assertInterventionOfDaySafe(iod)`** inside `selectInterventionOfDay` — screens title,
   instruction, whySuggested, basedOnSignals, notBasedOn, safetyNote, escalation reason+copy.
   Throws `UnsafeLanguageError` / `UnsafeInterventionError` if a template ever regresses.
3. **Orchestrator boundary** — `interventionOfDayStrings()` is appended to `userFacingStrings`,
   so every IoD string is re-screened with `assertSafeUserFacingText` + `isConfidenceCopySafe`,
   and `assertNoClinicalLeak(userFacing)` traverses the whole rendered object.
4. **QA gates** (`npm run qa`) — the no-clinical-leak, no-raw-confidence-copy, and no-camera-deps
   gates all still pass with the new package.

## Forbidden registers and how the layer avoids them

| Forbidden (FORBIDDEN_PHRASES) | How the layer stays clear |
| --- | --- |
| `diagnos*` | No copy contains the token; `notBasedOn` says "any medical or clinical label" (avoids the word). Tested. |
| `you have (depression\|anxiety\|…)` | No state is ever stated as a condition about the user; copy is reflective ("your hum sounded …"). |
| `clinical(ly) certain/confirmed`, `clinically validated` | Confidence is qualitative (`early_signal`…`stronger_evidence`); no certainty language. |
| `guaranteed prevention/recovery`, `prevents relapse` | No outcome is promised; `needs_support` copy is "ease your load / talk things through", never prevention. |
| `medical device`, `FDA-cleared` | Never referenced. |
| `treats\|cures\|therapy for` | Steps are framed as *support* / *reset* / *recovery suggestion*; "treat"/"cure"/"therapy for" never used. |
| raw `%` confidence | No numeric confidence anywhere; `isConfidenceCopySafe` sweep over all output passes. |

## Clinical-label separation

- The engine consumes only the sanitized `RecommendationView`; it cannot read clinical labels.
- Output object keys are all benign (`id`, `title`, `category`, …); `assertNoClinicalLeak(iod)`
  passes across the full sweep.
- A textual test also asserts no clinical head id / internal label (e.g. `depressive_affect_markers`,
  `stress_load_high`, `relapse_drift_score`) appears as a substring in any user-facing string.
- The internal `REGULATION_STATE_CROSSWALK` (which *does* reference internal head names for
  documentation) is never rendered and never used to choose copy.

## Low-confidence / poor-capture discipline

- Poor capture → `repeat_capture`; `basedOnSignals` references only recording clarity; no affect
  is inferred.
- Abstain (mature) → `low_confidence`; abstain (immature) / committed-but-immature →
  `not_enough_history`. Copy explicitly states it is a general/optional step, not a response to a
  specific signal.
- Interpreted reads at evidence ≤ `low` append "(an early, low-confidence read)" to `whySuggested`
  so uncertainty is always surfaced when confidence is low.
- `needs_support` is the longitudinal risk-adjacent tier (CLAIMS_LADDER tier 3), so it surfaces an
  explicit, non-diagnostic tentative frame ("— a tentative pattern to gently note, not a conclusion
  —") at **every** evidence band, not only when the single-read confidence is low — because the
  load-bearing claim is the within-user trend, not this hum's confidence. Its `basedOnSignals`
  references the trend (never a per-hum affective read it did not make), and its escalation copy is
  consent- and persistence-gated and itself tentative. (Hardened after the adversarial review.)

## Result

All user-facing intervention copy passes safety-language across a full sweep
(states × evidence × escalation × rotation). See TEST_REPORT.md.
