# ADR-0005: Public Datasets as Priors, Not Truth

> **Refined by [ADR-0010](0010-model-led-read-from-first-hum.md) (2026-06-20).** The "priors only, never hum truth" governance here is fully retained. ADR-0010 adds the operational consequence that, because the far-domain priors **saturate / go out-of-distribution on real hums**, they are NOT the primary read: the read leads with a transparent on-domain acoustic valence/arousal mapping, and a trained prior contributes only when it is in-domain (it abstains otherwise). Far-domain penalty + gate-honesty are unchanged.

- **Status:** Accepted (operationalized by ADR-0010)
- **Date:** 2026-06-18
- **Deciders:** ML architecture, clinical review, data governance
- **Related:** [ADR-0002 — Domain-Aware Audio Modeling](./0002-domain-aware-audio-modeling.md) ·
  [HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE](../architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md) ·
  [PERSONALIZATION_AND_RELAPSE_ARCHITECTURE](../architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) ·
  [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) · [Source INDEX](../source/INDEX.md)

## Context

Hum's primary input is a standardized 12-second hum [hum_spec]. At launch there is
**no native hum corpus**: the only public evidence comes from adjacent domains —
clinical read/spontaneous speech, acted emotion, singing/sustained phonation,
vocal bursts, multimodal TV dialogue, and music. None of these is a hum. A hum is
not ordinary speech, not a full music track, and not necessarily singing
(`AudioDomain`, `@hum-ai/shared-types`), so these datasets are **not interchangeable**
with hum data and cannot be the ground truth for any statement Hum makes about a
specific user.

The public evidence is also bounded in strength. Voice→depression results report
AUC 0.71–0.93 and accuracy 78–96.5%, but **6 of 12 studies carry high
methodological-bias risk** and generalizability is unproven before clinical
adoption [clinical_voice_biomarker_review]. Dimensional valence–arousal is
"comparatively underexplored" relative to categorical models, and SER is used
mostly indirectly across heterogeneous architectures and pathologies
[ser_mental_health_review]. The TriSense MELD numbers (Visual 18.4 / Audio 38.0 /
Text 54.0 → Fusion 66.0%) are **architecture-reference figures on TV dialogue, never
Hum metrics** [trisense_architecture]. Singing/sustained phonation is the closest
public bridge — acoustic features are language-independent and transferable — but it
is a *perspective* argument, not a validation study [vocal_biomarker_and_singing_protocol_support].
The within-patient paired DVDSA method (recovery/worsening/unchanged) inspires our
relapse engine, but it is group-level clinical-speech work, not hum
[longitudinal_voice_treatment_response_source]. Music-stress meta-analysis (d=.380
physiological, d=.545 psychological) supports *interventions*, not user-state
inference [intervention_support_source].

The risk we are guarding against: a model trained or calibrated as if clinical,
acted, or music data were hum truth would launder unproven, off-domain, sometimes
high-bias evidence into a confident statement about a real person. Hum is
**non-clinical and not clinically validated**; it emits risk markers and signals,
never diagnoses.

## Decision

**Public datasets and reference documents may serve as cold-start PRIORS only.
Native hum data plus the user's personal rolling baseline are the only sources of
hum truth.** As hums accumulate, native data and the personal baseline progressively
dominate the priors [hum_spec].

This is enforced as **code, not policy prose**, in `@hum-ai/dataset-registry`. Every
dataset or reference Hum touches is catalogued as a `DatasetRegistryEntry` carrying
its `domain` (`AudioDomain`), `domain_gap_to_hum` (`DomainGap`), and explicit
`allowed_model_use` / `prohibited_model_use` lists drawn from `MODEL_USES`. The
`MODEL_USES` vocabulary deliberately separates **priors** (`pretraining`,
`evaluation`, `recommendation`, `clinical_prior`, `affect_prior`) from **truth**
(`hum_finetune`, `personalization`, `relapse_tracking`).

`DOMAIN_FORBIDDEN_USES: Record<AudioDomain, ModelUse[]>` encodes the prohibited rule
per domain. `validateEntry` returns typed `RegistryViolation`s and
`assertValidRegistry` throws if any entry is non-conforming (run in CI/tests over
`REGISTRY`); `isUseAllowed(entry, use)` is the single runtime gate — a use is
permitted only if it is allowed, not prohibited, **and** not forbidden for the
entry's domain.

### The prohibited rule (explicit)

| Domain (`AudioDomain`) | Default gap | Forbidden uses (`DOMAIN_FORBIDDEN_USES`) | Rationale |
| --- | --- | --- | --- |
| `native_hum` | `none` | *(none)* | Target domain — the **only** source of hum truth. |
| `singing_or_sustained_phonation` | `near` | `personalization`, `relapse_tracking` | Closest public bridge; may pretrain/finetune priors, but a sung tone is still not *this user's* hum [vocal_biomarker_and_singing_protocol_support]. |
| `vocal_burst_or_nonverbal_expression` | `moderate` | `clinical_prior`, `personalization`, `relapse_tracking` | Affective-expression bridge (Hume-style), **not** a diagnosis source. |
| `clinical_speech` | `far` | `hum_finetune`, `personalization`, `relapse_tracking` | Clinical read/spontaneous speech ≠ a hum; usable as `clinical_prior` only, never hum truth [clinical_voice_biomarker_review]. |
| `acted_speech_emotion` | `far` | `clinical_prior`, `hum_finetune`, `personalization`, `relapse_tracking` | Acted affect is performed, not lived; affect prior at most. |
| `multimodal_conversation` | `far` | `hum_finetune`, `personalization`, `relapse_tracking`, `clinical_prior` | Architecture reference (MELD); never a hum metric [trisense_architecture]. |
| `music_emotion` | `far` | `clinical_prior`, `affect_prior`, `hum_finetune`, `personalization`, `relapse_tracking` | **Music's affect ≠ the user's affect** — intervention support only, never user-state diagnosis or a prior over state [intervention_support_source]. |
| `unknown` | `unknown` | same as `music_emotion` | An unlabelled gap is treated as worst-case. |

Two named, defense-in-depth checks back the table independently of it
(`RegistryViolation.code`): `music_used_for_diagnosis` (a `music_emotion` entry that
allows `clinical_prior`/`relapse_tracking`) and `clinical_used_as_hum_truth` (a
`clinical_speech` entry that allows `hum_finetune`). In plain terms:

- **Music-emotion datasets must not be used as user-state diagnosis** [intervention_support_source].
- **Clinical-speech datasets must not be treated as direct hum truth** [clinical_voice_biomarker_review].
- **Vocal-burst / Hume-style datasets are affective-expression bridges, not diagnosis.**
- **Only `native_hum` may serve `hum_finetune` / `personalization` / `relapse_tracking`.**

### The seven registered entries

`REGISTRY` holds one entry per primary source (all `kind: "reference"` on this pass —
there is no raw hum corpus yet; real datasets will follow the same schema and rules):

| `id` | Role / source | Domain | Allowed | Prohibited (notable) |
| --- | --- | --- | --- | --- |
| `trisense_meld_architecture` | architecture spine [trisense_architecture] | `multimodal_conversation` | `pretraining`, `evaluation`, `affect_prior` | `clinical_prior`, `hum_finetune`, `personalization`, `relapse_tracking` |
| `hum_legacy_spec` | hum protocol / privacy posture [hum_spec] | `native_hum` | `hum_finetune`, `personalization`, `relapse_tracking`, `evaluation`, `affect_prior` | `clinical_prior`, `market_research_only` |
| `voice_depression_systematic_review` | clinical prior [clinical_voice_biomarker_review] | `clinical_speech` | `clinical_prior`, `affect_prior`, `evaluation` | `hum_finetune`, `personalization`, `relapse_tracking`, `recommendation` |
| `vocal_biomarkers_singing_perspective` | hum-protocol science [vocal_biomarker_and_singing_protocol_support] | `singing_or_sustained_phonation` | `affect_prior`, `hum_finetune`, `evaluation`, `pretraining` | `clinical_prior`, `personalization`, `relapse_tracking` |
| `ser_mental_health_systematic_review` | affect prior + guardrail [ser_mental_health_review] | `clinical_speech` | `affect_prior`, `clinical_prior`, `evaluation`, `pretraining` | `hum_finetune`, `personalization`, `relapse_tracking` |
| `adolescent_mdd_dvdsa_longitudinal` | relapse-engine method [longitudinal_voice_treatment_response_source] | `clinical_speech` | `clinical_prior`, `affect_prior`, `evaluation` | `hum_finetune`, `personalization`, `relapse_tracking`, `recommendation` |
| `music_interventions_stress_metaanalysis` | intervention support [intervention_support_source] | `music_emotion` | `recommendation`, `evaluation`, `market_research_only`, `pretraining` | `clinical_prior`, `affect_prior`, `hum_finetune`, `personalization`, `relapse_tracking` |

The only entry permitted for `hum_finetune`/`personalization`/`relapse_tracking` as
*truth* is `hum_legacy_spec` (`native_hum`). `vocal_biomarkers_singing_perspective`
is allowed `hum_finetune` as a near-domain **prior** but is barred from
`personalization`/`relapse_tracking` — those run only on the user's own hums. The
DVDSA entry contributes a **method** (within-user paired comparison), explicitly not
its clinical-speech **data**, to `@hum-ai/relapse-engine`.

## Consequences

**Positive**

- Governance is **code-enforced and testable**: `assertValidRegistry` fails the
  build on any entry that would use off-domain or music data as truth/diagnosis, so
  the prohibition cannot quietly erode.
- The prior/truth split is legible end-to-end: `MODEL_USES` names it, the registry
  records it, and `isUseAllowed` gates it at call sites.
- Off-domain priors are not merely allowed/denied but **down-weighted by distance**.
  `domain_gap_to_hum` feeds `DOMAIN_GAP_PENALTY` / `domainGapPenalty`
  (`none` 1.0 → `near` 0.9 → `moderate` 0.7 → `far` 0.45 → `unknown` 0.4), so a
  clinical-speech prior cannot speak about a hum with full confidence
  (cross-ref [ADR-0002](./0002-domain-aware-audio-modeling.md)).
- Keeps Hum honestly **non-clinical**: no MELD or clinical-review accuracy is ever
  surfaced as Hum's performance; those numbers live only in `validation_notes`.

**Negative / costs**

- **Slower dataset onboarding.** Every new corpus needs a domain tag, gap, and
  reviewed allowed/prohibited lists before any code may touch it; `validateEntry`
  rejects under-specified entries.
- Cold-start quality is capped by priors plus the personalization stage and
  capture-quality confidence caps until enough native hums accumulate
  ([CLAIMS_LADDER](../claims/CLAIMS_LADDER.md)); early predictions lean on
  down-weighted, off-domain belief.
- Some genuinely informative off-domain signal is intentionally left on the table
  (e.g. clinical-speech features are barred from personalization), trading recall for
  domain integrity.

## Alternatives considered

1. **Train directly on clinical / acted / music data as if it were hum.** *Rejected.*
   Imports unproven, high-bias [clinical_voice_biomarker_review] and off-domain affect
   (music ≠ user state [intervention_support_source]; MELD is a TV-dialogue reference
   [trisense_architecture]) as hum truth — exactly the laundering this ADR forbids.
2. **No registry / governance — rely on developer discipline.** *Rejected.* Tribal
   knowledge does not survive contributors or refactors; the prior/truth boundary must
   be enforced as data that CI checks, which is why `DOMAIN_FORBIDDEN_USES` plus
   `assertValidRegistry` exist.
3. **Allow off-domain data for personalization with a heavier penalty.** *Rejected for
   truth-tier uses.* A confidence multiplier mitigates over-confidence but does not make
   non-hum data a valid record of *this user's* hum; `personalization`/`relapse_tracking`
   stay `native_hum`-only, with penalties reserved for legitimate priors (ADR-0002).
