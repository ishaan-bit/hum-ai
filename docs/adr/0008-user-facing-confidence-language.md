# ADR-0008: User-Facing Confidence Language

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture, eng leads, clinical reviewers, design
- **Packages:** `@hum-ai/safety-language`, `@hum-ai/fusion-engine`, `@hum-ai/affect-model-contracts`
- **Related:** [ADR-0004](0004-confidence-and-abstention.md) · [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) · [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md)

## Context

ADR-0004 makes the internal confidence number *earned and calibrated*: a tempered blend of eight evidence signals, clamped by baseline-maturity / capture-quality / domain-match caps, with abstention below a floor. That number is correct and useful — **for model logic**: abstention, ranking, gating.

But a number shown to a user is read as a *claim*. "We're 87% confident" reads as a diagnostic accuracy — precisely the figure Hum does not have and must never imply. The supporting literature is unambiguous: clinical voice-biomarker accuracies (AUC 0.71–0.93, 78–96.5%) come from clinical read-speech under high methodological-bias risk [clinical_voice_biomarker_review]; the TriSense MELD late-fusion 66.0% is a TV-dialogue architecture-reference number [trisense_architecture]; dimensional V-A inference is under-explored and used indirectly [ser_mental_health_review]. Surfacing any percentage — even the honestly-capped internal one — invites the user to treat a reflective signal as a clinical measurement. ADR-0004 already states the displayed percent is "a calibrated internal confidence, not a clinical accuracy"; this ADR removes the temptation entirely by not displaying it.

## Decision

**Do not surface raw, clinical-looking numeric confidence to the user by default.** The internal numeric `ConfidenceReport` (ADR-0004) stays exactly as-is for model logic. For the user, translate it to qualitative language in `@hum-ai/safety-language` (`src/confidence-language.ts`):

### Vocabulary

- **Signal clarity** — `High evidence` / `Medium evidence` / `Low evidence`, or `Early baseline`.
- **Based on N clean hums** — grounds the read in how much the system actually knows ("Based on your first clean hum" / "Based on 12 clean hums").
- **Early baseline** — shown explicitly while the personal baseline is still forming.

### Mapping (`evidenceLevelFromConfidence`)

| Condition | Evidence level |
| --- | --- |
| `eligibleHumCount < EARLY_BASELINE_HUMS` (5) | `early_baseline` (regardless of the number) |
| baseline-active, `abstained` | `low` |
| baseline-active, `confidence ≥ 0.80` | `high` |
| baseline-active, `confidence ≥ 0.60` | `medium` |
| otherwise | `low` |

Pre-baseline accounts are **always** "Early baseline" — honest about the cold-start regime where only population priors apply (the same regime that caps confidence at 0.72 in ADR-0004). `userFacingConfidence(report, eligibleHumCount)` returns `{ evidenceLevel, signalClarity, basedOn, isEarlyBaseline, summary }` and the `summary` (e.g. `"Signal clarity: High evidence · Based on 12 clean hums"`) is safe to render directly. It **never** includes the raw number.

### Enforcement

`isConfidenceCopySafe(text)` is a guard: it rejects copy that embeds a percentage (`\d{1,3}\s?%`), catching a regression that pipes the internal number into UI text. Tests assert that (a) every generated `summary` passes both `isConfidenceCopySafe` and the existing forbidden-phrase check `validateUserFacingText`, and (b) the guard trips on `"We are 87% confident"`.

Internal numeric confidence remains available to engineering and research (logs, eval, ranking) — this ADR governs the **render boundary only**, consistent with the internal-vs-user-facing-label separation in ADR-0006 and `INTERNAL_TO_USER_FACING`.

## Consequences

**Positive**
- The user never sees a clinical-looking accuracy; "Signal clarity / evidence level" cannot be mistaken for a diagnosis or a validated metric, keeping the [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) honest.
- "Based on N clean hums" makes uncertainty legible the way a number cannot: low evidence is obviously low *because the system has seen little*, not because of an opaque score.
- A regression that tries to render the percentage fails a test (`isConfidenceCopySafe`).

**Negative / costs**
- Qualitative bands lose granularity a power user might want. Accepted; a future, clearly-labeled "advanced/debug" surface (never the default) could expose the internal number for engineering, gated like regulatory mode in `@hum-ai/safety-language`.
- The numeric→band thresholds (0.80 / 0.60) are design defaults to be revisited once reliability data exists ([VALIDATION_PLAN](../validation/VALIDATION_PLAN.md)).
- Two representations of confidence now coexist (internal number, user bands); the boundary (`userFacingConfidence`) must remain the only translation point.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **Show the capped numeric percent** | Rejected | Even an honestly-capped percent reads as clinical accuracy; the literature numbers it resembles are study priors / architecture references, never Hum metrics [clinical_voice_biomarker_review][trisense_architecture]. |
| **Show a 0–100 "confidence bar" (no %)** | Rejected | A bar is a number with the label filed off; still invites precise mis-reading. Bands + "based on N hums" communicate *why* the confidence is what it is. |
| **Hide confidence entirely** | Rejected | Users deserve to know how much to trust a read; opacity erodes the reflective, honest stance. Qualitative clarity is the middle path. |
| **Free-text confidence per read (LLM-generated)** | Rejected (this pass) | Unbounded copy reintroduces the forbidden-phrase risk; the fixed vocabulary is auditable and screened. Revisit with the safety-language gate enforced. |

## Sources

- [clinical_voice_biomarker_review] — Briganti & Lechien, *J Voice* 2025: AUC 0.71–0.93, 78–96.5% — clinical read-speech under high bias risk; not Hum's accuracy.
- [trisense_architecture] — IJERT TriSense: MELD late-fusion 66.0% on TV dialogue — architecture-reference only.
- [ser_mental_health_review] — Jordan et al., *JMIR Ment Health* 2025: dimensional V-A under-explored, SER used indirectly → confidence must be communicated as uncertainty, not accuracy.
- [hum_spec] — confidence caps scale with baseline maturity (72→92%); pre-baseline is a cold-start regime, hence "Early baseline".
