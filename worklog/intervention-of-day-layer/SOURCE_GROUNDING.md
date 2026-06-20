# Source Grounding — Intervention of the Day

## Provenance note (read first)

The primary source binaries (`*.pdf`, `*.docx`) are **not tracked in this repo** — the
`forbidden-files` QA gate blocks committing binaries, and `docs/source/` holds only `INDEX.md`
+ `README.md`. So every claim below is **secondary-derived** from two committed, authoritative
in-repo summaries written when the sources *were* machine-extracted (`.extract/`, git-ignored):

- `docs/source/INDEX.md` — per-source extraction status + key facts carried into the build.
- `docs/claims/CLAIMS_LADDER.md` — the graded claim contract + the music-evidence scoping rule.

Where a number is quoted it is quoted from `INDEX.md`/`CLAIMS_LADDER.md` verbatim. No paper
internals beyond those summaries are asserted. This matches the brief's fallback rule:
*"If a source cannot be parsed directly, use docs/source/INDEX.md … mark the source as
secondary-derived, do not hallucinate exact paper details."*

## What the evidence supports for THIS layer

### Music as regulation support (not diagnosis, not treatment)
- `intervention_support_source` — de Witte et al. (2020), *Health Psychology Review*. Two
  meta-analyses, 104 RCTs / 327 effect sizes / 9,617 participants. Music interventions reduced
  **physiological stress d=.380** and **psychological stress d=.545** (HR effect d=.456). Both
  listening and making/singing reduced cortisol/HR/BP.
- **Scope (hard rule, CLAIMS_LADDER §4 / INDEX governance note):** this feeds the
  `music_regulation` category's *rationale only*. Music-emotion evidence may **never** be used
  as user-state diagnosis, and reducing stress-related outcomes is **not** "treating depression."
  Our music templates therefore only ever promise *regulation support* ("settle / steady / gentle
  lift / maintain / focused momentum"), never a clinical outcome.

### Valence–Arousal as the interlingua
- `trisense_architecture` — Ilyas et al. (IJERT 2026). Recommendation maps detected state through
  Russell's **Valence–Arousal circumplex** (ref [7]). This is why the layer selects interventions
  by V-A position and abstracted bands rather than by an emotion label.
- `ser_mental_health_review` — Jordan et al. (JMIR Ment Health 2025). Dimensional V-A is
  "comparatively underexplored" but more nuanced than categorical; reinforces **abstention /
  uncertainty discipline** → our `low_confidence` / `not_enough_history` paths.

### Within-user change drives the "needs support" path (not a population verdict)
- `longitudinal_voice_treatment_response_source` — Kim et al. (Communications Medicine 2026).
  DVDSA: personalized **within-user paired** voice comparison → recovery / worsening / unchanged.
  Our `needs_support` state is gated on a *sustained, within-user* worsening/relapse-drift signal,
  surfaced only as safe support language — never a diagnosis or a relapse-prevention claim.

### Hum protocol + quality gate → "repeat the hum, don't interpret"
- `hum_spec` — Hum technical specification. 12-second hum; quality gate `clean|borderline|rejected`;
  baseline activates at **5 eligible hums**; confidence hard-capped per stage. Grounds the
  `poor_capture` → `repeat_capture` and `not_enough_history` behaviours: when the capture is weak
  or the baseline is still forming, the safe action is another hum, not an emotional reading.

### Voice biomarkers are a research-stage prior, not truth
- `clinical_voice_biomarker_review` (Briganti & Lechien 2025) and
  `vocal_biomarker_and_singing_protocol_support` (Rodrigo & Duñabeitia 2025) establish that vocal
  features carry affect/stress signal and that **sung/sustained phonation** is a valid source —
  but with **6/12 studies at high risk of bias**, no formal clinical use, and a clinical-speech →
  hum domain gap. This is exactly why user copy stays reflective and non-diagnostic.

## What the evidence does NOT support (and we therefore never claim)

- It does **not** support diagnosis, treatment, cure, or relapse prevention from a hum.
- It does **not** make music a treatment for depression — only stress-outcome regulation support.
- It does **not** license clinical certainty or a Hum accuracy number; reference accuracies
  (MELD late-fusion 66.0%, voice→depression AUC 0.71–0.93, DVDSA F1 78.05%) are *architecture /
  clinical priors*, **never Hum performance** (CLAIMS_LADDER §4).
- It does **not** support resolving anger vs anxiety vs fear to the user; those live on the gated
  clinical head, so the safe layer collapses them to one downshift region.

## How this maps to the claims ladder

The IoD layer operates at **Tier 0–1** (reflective / emotional-state signal) for routine copy,
and brushes **Tier 2** (stress-load / recovery trend, within-user, baseline-active) only for the
abstracted `needs_support` framing. It never reaches Tier 3+ user-facing language. Caps and the
abstention floor still bind: low evidence → cautious wording; abstain → repeat/not-enough-history.

## Source-ref tags used in template `sourceRefs`

`intervention_support_source` (music), `trisense_architecture` (V-A mapping),
`longitudinal_voice_treatment_response_source` (within-user support path), `hum_spec`
(capture/baseline). All tags match the ids in `docs/source/INDEX.md`.
