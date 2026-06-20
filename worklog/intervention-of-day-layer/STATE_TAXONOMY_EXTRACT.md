# State Taxonomy — Extracted from the codebase

Every state/signal below was read directly from source on the `parallel/intervention-of-day-layer`
worktree. Nothing here is invented; file references are clickable.

## 1. Affect-state heads — `AFFECT_STATE_HEADS`

`packages/affect-model-contracts/src/heads.ts` — 15 unit-interval `[0,1]` state scores.
`riskMarker: true` heads are **consent-gated and never reach the recommendation engine as raw labels**.

| Head id | internalLabel | riskMarker | userVisible | notes |
| --- | --- | --- | --- | --- |
| `calm_regulated` | calm_regulated_state | no | yes | settled activation |
| `joy_positive_activation` | positive_activation | no | yes | upbeat positive |
| `excitement` | high_positive_arousal | no | yes | high-arousal positive |
| `stress_overload` | stress_load_high | **yes** | yes | elevated stress load |
| `anger_frustration` | anger_frustration | no | yes | high-arousal negative |
| `anxiety_like_tension` | anxiety_like_tension_marker | **yes** | yes | non-diagnostic |
| `fear_like_activation` | fear_like_activation | **yes** | yes | fear-like high arousal neg |
| `sadness_low_mood` | low_mood_state | **yes** | yes | low mood / sadness |
| `depressive_affect_markers` | depressive_affect_marker | **yes** | yes | screening signal, non-diagnostic |
| `fatigue_low_recovery` | fatigue_low_recovery | **yes** | yes | low recovery |
| `emotional_instability` | affect_instability | **yes** | yes | lability marker |
| `flattened_affect` | flattened_affect_marker | **yes** | yes | blunted affect |
| `cognitive_attention_strain_later` | attention_strain_future | **yes** | **no** | RESERVED — not produced v1 |
| `mixed_state` | mixed_state | no | yes | conflicting heads |
| `neutral_close_to_usual` | neutral_close_to_usual | no | yes | close to baseline |

Benign (broad head, safe for copy/recommendation): `calm_regulated`, `joy_positive_activation`,
`excitement`, `anger_frustration`, `mixed_state`, `neutral_close_to_usual`.
Clinical-risk (gated head): the eight `riskMarker: true` states above.

Dimensional heads: `valence` `[-1,1]`, `arousal` `[-1,1]` (Russell circumplex).

## 2. Longitudinal heads

- `relapse_drift` `[0,1]` (riskMarker) — drift toward a previously high-risk signature.
- `recovery_worsening_unchanged` → `DvdsaClass = recovery | worsening | unchanged` (riskMarker, nullable).

## 3. Fusion label space — `FUSION_LABELS`

`packages/affect-model-contracts/src/fusion-labels.ts` — 7 labels, each with a V-A anchor + dominant state:
`calm_regulated · positive_activation · high_arousal_negative · low_mood · tense_anxious · fatigued · neutral_close_to_usual`.

## 4. Relapse engine outcomes — `RELAPSE_CLASSES`

`packages/relapse-engine/src/relapse.ts`: `recovery · stable · worsening · relapse_drift · uncertain`
(richer than the 3-class DVDSA summary on the inference). References: `previous_stable`,
`previous_high_risk`, `baseline_7d`, `baseline_30d`.

## 5. Quality-gate outcomes — `packages/quality-gate/src/gate.ts`

- `QualityDecision`: `clean · borderline · rejected`
- `CaptureQuality`: `good · usable · soft_usable · poor · rejected`
- `baselineEligible: boolean` (eligible to grow the rolling baseline)

## 6. Confidence / abstention — `packages/affect-model-contracts/src/confidence.ts`

- `AbstainReason`: `poor_capture_quality · domain_mismatch · out_of_distribution ·
  insufficient_baseline · low_margin · modality_conflict · first_hum · none`
- Qualitative evidence (`@hum-ai/safety-language` confidence-language):
  `EvidenceLevel = early_baseline · low · medium · high`; baseline activates at **5 eligible hums**.

## 7. Existing intervention vocabulary — `INTERVENTION_TYPES`

`packages/affect-model-contracts/src/intervention-types.ts`:
`music_recommendation · breath_regulation · journaling_prompt · rest_recovery ·
social_check_in · escalation_suggestion · none`.

## 8. The sanitized recommendation view — `RecommendationView` (ADR-0006)

`packages/affect-model-contracts/src/two-head.ts` — **the only affect surface the intervention
engine is allowed to read.** Raw clinical labels are collapsed into abstracted bands at
`toRecommendationView`:

```
abstained, dimensional {valence, arousal}, uncertainty,
elevatedRegulationNeed   // relapseDrift≥.5 OR depressive≥.6 OR stress≥.6
lowEnergyPattern         // fatigue_low_recovery ≥ .4
lowMoodPattern           // sadness≥.5 OR depressive≥.4
mixedOrUncertain         // mixed_state≥.4 OR uncertainty≥.6
```

`assertNoClinicalLeak(view)` throws if any clinical head id / internal label appears as an
object key anywhere in a payload handed to the engine or rendered.

## 9. User-facing label map — `packages/safety-language/src/labels.ts`

`INTERNAL_TO_USER_FACING` is the one-way internal→user translation; `userFacingLabel()` falls
back to "a pattern in your hum"; `abstain_reason` and `attention_strain_future` are internal-only.

## 10. Canonical IoD regulation states (derived; this layer)

Because the engine cannot see clinical labels, the IoD layer derives a small, **safe** state
set from the sanitized view + meta. Each maps to one or more codebase internal heads/classes
(crosswalk), but its name is non-clinical:

| IoD state | Derived from (sanitized view + meta) | Codebase heads it abstracts |
| --- | --- | --- |
| `calm_regulated` | valence ≥ +0.2, low arousal | calm_regulated |
| `positive_activation` | valence ≥ +0.2, arousal ≥ +0.3 | joy_positive_activation, excitement |
| `high_activation_negative` | arousal ≥ +0.25, valence < 0 | stress_overload, anxiety_like_tension, anger_frustration, fear_like_activation |
| `low_recovery` | arousal < 0, valence < 0, `lowEnergyPattern` | fatigue_low_recovery, flattened_affect |
| `low_mood` | arousal < 0, valence < 0, `lowMoodPattern` | sadness_low_mood, depressive_affect_markers |
| `mixed_unsettled` | `mixedOrUncertain` | mixed_state, emotional_instability |
| `neutral_usual` | close to centre | neutral_close_to_usual |
| `needs_support` | committed + sustained worsening/relapse-drift (abstracted, mature baseline) | relapse_drift, recovery_worsening_unchanged=worsening |
| `poor_capture` | capture unusable / `poor_capture_quality` abstain | quality `rejected`, AbstainReason poor_capture_quality |
| `low_confidence` | abstained + baseline mature | AbstainReason low_margin / modality_conflict / ood / domain_mismatch |
| `not_enough_history` | abstained + baseline immature (or first hums) | AbstainReason insufficient_baseline / first_hum; stage population_prior |

**Why derived, not raw heads:** ADR-0006 forbids the engine from consuming clinical labels;
the brief's separate anger/anxiety/fear states all live on the *gated* head and are
deliberately collapsed to one V-A region (`high_activation_negative`) in the safe view. The
intervention for that whole region is the same safe downshift, so no clinical resolution is lost
for the user. The `cognitive_attention_strain_later` head is reserved (not produced v1) and is
intentionally **not** mapped to any intervention. These additions are documented + tested.
