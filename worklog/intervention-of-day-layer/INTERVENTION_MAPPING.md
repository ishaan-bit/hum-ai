# Intervention Mapping

How a sanitized read becomes one Intervention of the Day. The layer derives a safe
regulation state, then selects a template by (state → evidence → baseline → contraindication →
rotation).

## State derivation (safety-first order)

`deriveRegulationState(view, meta)` — `packages/intervention-engine/src/states.ts`:

1. `!captureUsable` → **poor_capture**
2. `view.abstained` → **low_confidence** (baseline mature) / **not_enough_history** (immature)
3. committed but `!baselineMature` → **not_enough_history** (general option only)
4. `longitudinal.drifting && longitudinal.persistent` → **needs_support**
5. otherwise the affect region from V-A + abstracted bands (clear-signal branches first, so a
   confident strong read keeps its step; mirrors `selectInterventionFromView` ordering):
   - `arousal ≥ .25 && valence < 0` → **high_activation_negative**
   - `arousal < 0 && valence < 0`: `lowEnergyPattern` → **low_recovery**; `lowMoodPattern` → **low_mood**; else **low_recovery**
   - `mixedOrUncertain` **or** any remaining `valence < 0` (mild/ambiguous arousal) → **mixed_unsettled**
     (so a clearly unpleasant read is never called "usual"/"steady")
   - `valence ≥ .2`: `arousal ≥ .3` → **positive_activation**; else **calm_regulated**
   - else **neutral_usual**

## State → intervention intent (brief principles → behaviour)

| Brief principle | IoD state | Primary categories | Intent |
| --- | --- | --- | --- |
| high arousal / stress / anxiety-like | `high_activation_negative` | breath_regulation, grounding, music_regulation(settle), reduce_load, movement_reset | downshift; longer exhale; lower demand; ground |
| anger / frustration | `high_activation_negative` | movement_reset (discharge), grounding | step away, unclench, short walk — no escalation |
| low recovery / fatigue | `low_recovery` | rest_recovery, movement_reset(gentle), reduce_load | rest; hydrate/stretch; avoid energising push |
| sadness / low mood | `low_mood` | movement_reset, grounding(daylight), social_check_in, music_regulation(gentle_lift) | tiny activation, light contact — no depression claim |
| mixed / unstable | `mixed_unsettled` | reduce_load, grounding, journaling(one line) | simplify next 10 min; one grounding action |
| calm / regulated | `calm_regulated` | no_action_needed, music_regulation(maintain) | maintain rhythm; do not over-intervene |
| excitement / positive activation | `positive_activation` | journaling(one task), music_regulation(focused_momentum) | channel energy into one focused thing |
| poor capture / low confidence | `poor_capture` / `low_confidence` | repeat_capture / grounding | repeat hum or optional reset; no emotional read |
| relapse_drift / worsening | `needs_support` | safety_support, reduce_load, grounding | reduce load; reach trusted support if persistent |
| not enough history | `not_enough_history` | grounding | baseline forming; general option only |

## Music → V-A mapping (regulation only)

| Read region | `musicTarget` | Template |
| --- | --- | --- |
| high arousal negative | `settle` | `music_settle` |
| low arousal / low mood | `gentle_lift` | `music_gentle_lift` |
| calm / regulated | `maintain` | `music_maintain` |
| mixed | `steady` | `music_steady` (low-complexity steady track) |
| positive activation | `focused_momentum` | `music_focused_momentum` |

Justified by `intervention_support_source` as regulation support, never diagnosis/treatment.

## Template selection

`selectTemplateForState(state, evidence, baselineMature, rotationSeed)`:

1. templates whose `targetStates` include the state and whose `contraindicatedStates` do **not**;
2. drop templates requiring a mature baseline when the baseline is immature;
3. keep templates whose `minEvidence` ≤ the read's evidence band; if that empties the set, fall
   back to the gentlest in-state baseline-eligible template (so a state is never left empty);
4. rotate deterministically: `candidates[((seed % n) + n) % n]`.

Each state has at least one `early_baseline`, baseline-not-required fallback, so selection always
succeeds. Every category in the taxonomy is used by ≥1 template (tested).

## whySuggested composition (one sentence)

`observation(state)` + (`" (an early, low-confidence read)"` when interpreted & evidence ≤ low) +
`", so " + template.whyAction + "."`. Meta-state observations describe capture/confidence/baseline,
never an emotion. Example: *"Your hum showed more activation and less steadiness than your recent
baseline, so a longer exhale helps bring that activation down a notch."*

## basedOnSignals / notBasedOn

`basedOnSignals` are safe, plain descriptors of what informed the step (e.g. "how activated your
hum sounded", "how today's hum compares with your recent baseline"); for meta states they
reference only recording clarity / confidence / hum count. `notBasedOn` fixes scope: "any medical
or clinical label", "the words you said — a hum has no speech content", "any camera, photo, or
video", "a single certainty score".

## Escalation gating

Only the `needs_support` state carries an `escalation` block. `show` is true **only** when the
safety flag is set (consent to clinical-risk surfacing) **and** the trend is persistent; the copy
is a gentle "ease your load and talk things through with someone you trust" — no diagnosis, no
prevention claim.
