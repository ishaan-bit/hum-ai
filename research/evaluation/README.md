# research/evaluation

Evaluation protocols (no evaluation run in this pass). Summarized in
[VALIDATION_PLAN](../../docs/validation/VALIDATION_PLAN.md).

Priorities:
1. **Calibration over raw accuracy** — reliability diagrams, Expected Calibration
   Error, and verification that confidence caps hold (a first hum can never
   report >72%).
2. **Abstention quality** — the system should abstain on poor capture / domain
   mismatch / OOD rather than guess. Measure abstain precision/recall.
3. **Domain robustness** — feed speech/music/silence and confirm the domain
   classifier + adapter down-weight them (no confident affect read on a non-hum).
4. **Within-user (DVDSA-style)** — evaluate recovery/worsening/unchanged on
   paired samples, not group-level accuracy (`longitudinal_voice_treatment_response_source`).
5. **Privacy invariants** — fuzz sync payloads; `assertNoRawAudioFields` must
   throw on any raw-audio-like field.
6. **Safety copy** — every user-facing string passes `@hum-ai/safety-language`.

We do **not** report MELD-style single accuracy numbers as Hum performance.
