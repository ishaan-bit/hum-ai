# `@hum-ai/intervention-engine` — Intervention of the Day

Hum AI turns an already-extracted hum signal into **one** small, safe, doable
**Intervention of the Day**: a regulation-support step plus a plain one-sentence reason.
It is *daily regulation support* — a small reset / grounding action / recovery suggestion —
**not** therapy, treatment, diagnosis, cure, or relapse prevention.

The conceptual flow is deliberately **not** `hum → diagnosis → advice`. It is:

```
hum features → affective signal → confidence/safety gate → simple regulation support
```

## Where it sits

```
… fusion-engine → personalization → relapse-engine
        │
        ▼  toRecommendationView  (sanitized: V-A + abstracted bands; NO clinical labels)
   intervention-engine
        ├─ selectInterventionFromView()   (existing minimal V-A mapper — unchanged)
        └─ selectInterventionOfDay()       (this layer)
        │
        ▼  every string screened by @hum-ai/safety-language
   orchestrator.userFacing.interventionOfDay
```

The layer reads **only** the sanitized `RecommendationView` (ADR-0006) plus safe meta
(capture usability, qualitative evidence band, baseline maturity, an abstracted within-user
trend). It never sees a clinical-risk label, never sees a raw confidence number, and never
emits an internal label.

## Modules

- `src/states.ts` — the canonical IoD **regulation-state taxonomy** and `deriveRegulationState`,
  which maps the sanitized view + safe meta to one non-clinical state. A documented crosswalk
  ties each safe state back to the codebase's internal heads.
- `src/templates.ts` — ~30 curated **intervention templates** (target/contra states, minimum
  evidence, baseline requirement, category, intensity, 1–5 min duration, why-fragment, safety
  note, source refs, music V-A target).
- `src/intervention-of-day.ts` — the `InterventionOfDay` output type, `selectInterventionOfDay`,
  the evidence→confidence-language map, one-sentence `whySuggested` composition, escalation
  gating, and `assertInterventionOfDaySafe` (a safety-language self-check).

## Output shape

```ts
type InterventionOfDay = {
  id: string; title: string; durationMinutes: number;
  category: "breath_regulation" | "grounding" | "music_regulation" | "movement_reset"
    | "rest_recovery" | "journaling" | "social_check_in" | "reduce_load"
    | "repeat_capture" | "no_action_needed" | "safety_support";
  instruction: string; whySuggested: string;
  basedOnSignals: string[]; notBasedOn: string[];
  confidenceLanguage: "early_signal" | "low_evidence" | "moderate_evidence" | "stronger_evidence";
  safetyNote?: string;
  escalation?: { show: boolean; reason?: string; copy?: string };
};
```

## Sources that support the layer

All ids match `docs/source/INDEX.md`. The source binaries are not tracked in git (the
`forbidden-files` QA gate blocks binaries), so the facts below are **secondary-derived** from
`docs/source/INDEX.md` + `docs/claims/CLAIMS_LADDER.md`.

| Source id | Role for this layer |
| --- | --- |
| `intervention_support_source` (de Witte et al. 2020) | Music as **regulation support** (stress-outcome reduction d=.380 physiological / d=.545 psychological). Music templates only. |
| `trisense_architecture` (Ilyas et al. 2026) | Valence–Arousal circumplex as the recommendation interlingua → why selection is V-A based. |
| `ser_mental_health_review` (Jordan et al. 2025) | Dimensional V-A + **abstention/uncertainty discipline** → the low-confidence / not-enough-history paths. |
| `longitudinal_voice_treatment_response_source` (Kim et al. 2026) | Within-user change (DVDSA) → the `needs_support` path is gated on a *sustained, within-user* trend. |
| `hum_spec` | 12-second hum, quality gate, baseline-at-5 → the repeat-capture and baseline-forming behaviours. |

### What the evidence supports
- Small, low-risk regulation steps (paced breathing, grounding, light movement, rest, a light
  social check-in, reducing load, music for regulation) are reasonable daily self-regulation
  support.
- Music interventions reduce stress-related outcomes — enough to justify **offering** music as
  a regulation option.
- Valence–Arousal is a sound interlingua for choosing the *direction* of a nudge.
- Within-user change is the right frame for a "things have been heavier lately" support nudge.

### What the evidence does NOT support (and we never claim)
- No diagnosis, treatment, cure, or relapse prevention from a hum.
- Music is **not** a treatment for depression — only stress-outcome regulation support.
- No clinical certainty and no Hum accuracy number; reference accuracies are architecture /
  clinical priors, never Hum performance (CLAIMS_LADDER §4).
- The hum cannot resolve anger vs anxiety vs fear *for the user*; those live on the gated
  clinical head, so the safe layer collapses them to one downshift region.

## How music evidence is scoped

A music template carries `sourceRefs: ["intervention_support_source"]` and a `musicTarget` that
is purely a **regulation** direction: `settle` (high-arousal-negative), `steady` (mixed),
`gentle_lift` (low mood), `maintain` (calm), `focused_momentum` (positive activation). Music
copy never says it diagnoses, treats, or cures anything — enforced by a test that scans every
music template for over-claiming language.

## Why valence/arousal (not an emotion label)

The recommendation engine is forbidden from reading clinical-risk labels (ADR-0006). The
sanitized view it *can* read is dimensional V-A plus abstracted bands, and V-A is exactly the
interlingua `trisense_architecture` uses to pick a nudge direction. So the layer steers by where
the hum sits in V-A space and which safe bands are set — not by a categorical emotion verdict.

## Why user-facing language avoids clinical claims

Hum AI is a non-clinical, research-stage reflective tool (CLAIMS_LADDER). Every user-facing
string — title, instruction, `whySuggested`, `basedOnSignals`, `notBasedOn`, `safetyNote`,
`escalation.copy` — is run through `@hum-ai/safety-language` (`validateUserFacingText` +
`isConfidenceCopySafe`) by `assertInterventionOfDaySafe` and again at the orchestrator boundary.
Forbidden registers (diagnosis, clinical certainty, "treats/cures", "prevents relapse", medical
device / FDA, raw % confidence) cannot ship. Confidence is surfaced qualitatively
(`early_signal` … `stronger_evidence`), never as a number.

## Why poor capture → repeat capture (not advice)

If the capture itself is too weak to interpret (quality `rejected`), the safe action is another
hum, not an emotional reading. The deriver returns `poor_capture` **before** any affect branch,
the chosen step is a `repeat_capture` template, and `basedOnSignals` references only recording
clarity — never an emotional descriptor. The same conservatism applies when the read abstains
(`low_confidence`) or the baseline is still forming (`not_enough_history`): a general, optional
reset with explicit uncertainty, never an inferred state.

## Determinism

"Of the day" rotation is driven by an optional `rotationSeed` the caller supplies (the
orchestrator uses a value derived from the capture date). The engine itself uses no `Date` or
randomness, so a given input is fully reproducible.
