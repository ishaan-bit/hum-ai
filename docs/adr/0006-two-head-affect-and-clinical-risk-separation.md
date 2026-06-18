# ADR-0006: Two-Head Separation — Broad Affect vs Consent-Gated Clinical-Risk Markers

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture, eng leads, clinical reviewers, privacy
- **Packages:** `@hum-ai/affect-model-contracts`, `@hum-ai/intervention-engine`, `@hum-ai/safety-language`, `@hum-ai/shared-types`
- **Related:** [ADR-0004](0004-confidence-and-abstention.md) · [ADR-0005](0005-public-datasets-as-priors-not-truth.md) · [TRISENSE_ADAPTED_ARCHITECTURE](../architecture/TRISENSE_ADAPTED_ARCHITECTURE.md) · [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) · [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md)

## Context

The affect model emits a wide head set (`ALL_AFFECT_HEADS`): a dimensional valence/arousal core, 15 affect-state scores, longitudinal heads, and meta heads. Some of those heads are benign descriptions of a moment (`calm_regulated`, `joy_positive_activation`, `mixed_state`); others are **clinical-risk markers** — `anxiety_like_tension`, `depressive_affect_markers`, `sadness_low_mood`, `fatigue_low_recovery`, `flattened_affect`, `emotional_instability`, `stress_overload`, `fear_like_activation`, plus the longitudinal `relapse_drift` and `recovery_worsening_unchanged`. The registry already flags each with `riskMarker: boolean` (`affect-model-contracts/src/heads.ts`).

Until now those two kinds of head lived in one flat `MultiHeadAffectInference.states` object. Three risks follow from that flatness:

1. **Leak into copy.** The SER mental-health review is explicit that voice-based mental-state inference is used *indirectly* and that architecture/dataset/pathology heterogeneity makes direct assessment unreliable [ser_mental_health_review]; the clinical voice-biomarker review reports 6 of 12 studies at high methodological-bias risk [clinical_voice_biomarker_review]. A flat object invites a UI to render `depressive_affect_markers: 0.8` verbatim — exactly the diagnostic overclaim the [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) forbids.
2. **Leak into the recommendation engine.** If the intervention engine reads raw clinical labels, the recommendation becomes a covert clinical decision rule, and music-intervention evidence (support only, ADR-0005) risks being coupled to a clinical label [intervention_support_source].
3. **Surfaced without consent.** Telling a user "your hums show a depressive-affect marker" is a materially different act from telling them "your hum sounded a little subdued." The former needs explicit opt-in.

## Decision

Split the model output into **two structurally distinct heads**, enforced by types *and* runtime guards (`affect-model-contracts/src/two-head.ts`).

### 1. Broad affect head — always available

`BroadAffectHead` = dimensional valence/arousal + the **benign** state scores (`BROAD_AFFECT_STATE_HEADS`, i.e. every state head with `riskMarker: false`) + the benign `uncertainty` meta-signal. This head drives user-facing copy and the recommendation engine. It **never** contains a risk-marker score.

### 2. Clinical-risk marker head — consent-gated, non-diagnostic

`ClinicalRiskMarkerHead` = the risk-marker state scores (`CLINICAL_RISK_STATE_HEADS`) + `relapseDrift`, with a literal `isDiagnostic: false`. It is wrapped in a consent gate:

```
ConsentGatedClinicalRiskHead =
  | { available: true;  head: ClinicalRiskMarkerHead }
  | { available: false; withheldReason: string }
```

`splitInference(inference, consent)` returns the broad head plus the gated clinical head. The gate checks a **new consent scope** added to `@hum-ai/shared-types`: `clinical_risk_surfacing`. Default consent is still `["local_processing"]` only (`defaultConsent`), so **risk markers are withheld by default** — the caller learns only *that* they were withheld and *why*, never the values.

### 3. The recommendation engine cannot receive direct clinical labels

The intervention engine consumes a sanitized projection, `RecommendationView`, produced by `toRecommendationView(inference)`. The raw clinical labels are read **once, at that boundary**, and collapsed into abstracted booleans:

| View field | Derived at the boundary from |
| --- | --- |
| `elevatedRegulationNeed` | `relapseDrift ≥ 0.5 ∨ depressive_affect_markers ≥ 0.6 ∨ stress_overload ≥ 0.6` |
| `lowEnergyPattern` | `fatigue_low_recovery ≥ 0.4` |
| `lowMoodPattern` | `sadness_low_mood ≥ 0.5 ∨ depressive_affect_markers ≥ 0.4` |
| `mixedOrUncertain` | `mixed_state ≥ 0.4 ∨ uncertainty ≥ 0.6` |

The view carries the benign dimensional signal and these bands — **no clinical-marker keys**. `selectInterventionFromView(view, ctx)` is now the only function that decides an intervention, and it has no access to clinical labels. `selectIntervention(inf, ctx)` is a thin adapter: `selectInterventionFromView(toRecommendationView(inf), ctx)`.

`assertNoClinicalLeak(view)` is the runtime backstop: it walks an object and throws `ClinicalLeakError` if any clinical-risk head id or internal label appears as a key. A test pins that the recommendation view passes this guard and that a leaky object trips it.

### 4. Internal labels still cannot reach copy

This ADR composes with the existing `@hum-ai/safety-language` separation (`INTERNAL_TO_USER_FACING`, `isInternalOnly`, `validateUserFacingText`): the clinical head's internal labels (`depressive_affect_marker`, …) are translated to reflective copy and screened for forbidden phrasing before render. Two-head separation adds the *structural* guarantee on top of the *lexical* one.

## Consequences

**Positive**
- A UI literally cannot render a clinical-risk score without first passing the consent gate and the safety-language translation; the default path shows only broad affect.
- The recommendation engine is provably clinical-label-free (`assertNoClinicalLeak` + test), so intervention selection can never become a hidden diagnostic rule.
- The consent gate makes "surface a risk marker" an explicit, revocable, per-user decision, consistent with the local-first, opt-in posture in [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md).

**Negative / costs**
- One more transform (`toRecommendationView`) on the hot path, and two head objects instead of one flat one. Deliberate: the abstraction boundary is the point.
- The abstracted bands lose resolution the engine *could* have used. Accepted — a recommendation does not need the raw marker, only the regulation signal.
- Adds a consent scope the product/consent UI must now expose and honor.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **Keep one flat `states` object; rely on copy-layer screening only** | Rejected | Lexical screening (`validateUserFacingText`) catches *phrasing*, not *structural* leaks into the recommendation engine or a numeric render of a clinical score. |
| **Drop clinical-risk heads entirely** | Rejected | The longitudinal/relapse value of the platform depends on them [longitudinal_voice_treatment_response_source]; the fix is gating + non-diagnostic framing, not deletion. |
| **Gate on the existing `clinical_label_capture` scope** | Rejected | That scope is about capturing PHQ/GAD ground-truth labels (research), a different act from surfacing a derived marker. Surfacing deserves its own scope. |
| **Pass the full inference to the engine, document "don't read clinical fields"** | Rejected | A comment is not an enforcement boundary. `assertNoClinicalLeak` + the view type make the rule mechanical. |

## Sources

- [ser_mental_health_review] — Jordan et al., *JMIR Ment Health* 2025: SER used indirectly; heterogeneity makes direct assessment hard → markers, not diagnoses.
- [clinical_voice_biomarker_review] — Briganti & Lechien, *J Voice* 2025: depression voice biomarkers AUC 0.71–0.93, 6/12 high bias risk → clinical prior only.
- [longitudinal_voice_treatment_response_source] — Kim et al., *Comms Med* 2026: within-user DVDSA recovery/worsening/unchanged → motivates keeping (not dropping) longitudinal risk heads.
- [intervention_support_source] — de Witte et al., *Health Psych Review* 2020: music interventions reduce stress → support only, must not couple to a clinical label.
