# ADR-0013: The read separates voice IDENTITY from mood — a heavier/huskier or brighter voice is not read as a different feeling; mood is the within-person standardized deviation, and the models retrain on those deviations, not absolute values

- **Status:** Accepted (implemented; `npm run check`, `npm run sim`, `npm run hum-sim` all green)
- **Date:** 2026-06-26
- **Packages:** **`@hum-ai/audio-features` (new `feature-taxonomy.ts`)**, `@hum-ai/orchestrator` (`axis-read` cold-start cue rebalance), `@hum-ai/personalization-engine` (timbre-aware salience), `@hum-ai/signal-lab` (`toFeatureVector(f, baseline)`), `@hum-ai/native-corpus` + `@hum-ai/population-corpus` (retrain on within-person / within-contributor deviations + matching inference), `@hum-ai/personality-signature` (population-decoupled trait cues), `@hum-ai/hum-sim` + `@hum-ai/sim-lab` (cross-voice invariance gate), `@hum-ai/app-web` (live baseline threaded to the population prior).
- **Builds on:** [ADR-0010](0010-model-led-read-from-first-hum.md) (the axis read leads from hum #1; the 0.5/0.75 axis-nudge caps), [ADR-0011](0011-hitl-native-hum-retraining-loop.md) (within-user HiTL retrain), [ADR-0012](0012-cross-user-population-corpus-loop.md) (population pooling, group-by-contributor CV), the within-user **display re-reference** (`display-read.ts`) and the **personalization re-reference** (`personalize.ts`).
- **Unchanged:** all privacy guards (`assertNoRawAudioFields`, `assertNoClinicalLeak`), the two-head separation ([ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md)), the fidelity ⊥ affect contract ([valence-fidelity-decoupling]), the dual-baseline **divergence**/relapse signal (stays ABSOLUTE), and the transparent `acousticValue` provenance.

## Context

Every person has a natural vocal range. A heavier/huskier voice sits **low and dark**; a brighter voice sits **high and bright** — stable properties of the *speaker + microphone*, not of how they feel right now. The cold (first-hum) read mapped the **absolute** level of those features straight onto affect (`acousticAffectAxes`: `pitchMeanHz` register → valence/arousal, `spectralCentroidHz` brightness → arousal). So a husky hummer was read **calmer/lower** and a bright one **more activated/unsettled** — a cross-person bias driven by voice identity, not mood. The same bug exists in the OCEAN signature (loudness/brightness → Extraversion/Agreeableness).

The product already removed this offset *as data accrued* — the within-user display re-reference (≥3 hums) and the personalization re-reference open up the small within-user variation that actually tracks mood — but (a) the very **first hums** still read absolute, and (b) nothing standardized the features **inside the trained models**, which still learned from absolute values.

The decisive design correction (from an adversarial review): the absolute level of an identity cue is **identity ⊕ mood** and cannot be perfectly separated on one hum; the mood part is the **within-person deviation** (the z-delta against the person's own usual), which only becomes available as hums accumulate. So the fix is split by reference frame, and the within-person opening must be applied **exactly once** (the existing output-level re-reference owns it — feature-level personal standardization in the read would double-count it and destroy the `acousticValue` provenance).

## Decision

### 1. A shared trait/state taxonomy (`@hum-ai/audio-features` `FEATURE_KIND`)

One source of truth classifying every `AcousticFeatures` field as `timbre` (identity-bearing absolute level: pitch / loudness / brightness register), `state` (already-relative within-hum dynamics: melodic movement, spectral flux, steadiness, vibrato, micro-instability — honest mood cues from hum #1), `fidelity` (mic/room — never affect), or `structural`. Imported by the read, the salience, the model feature vector, and the personality signature so the subsystems can never drift.

### 2. The FIRST-hum read leans away from the purest identity cues (gate-safe)

`acousticAffectAxes` keeps the absolute, population-referenced backbone (so the four corner archetypes still separate and the poles stay reachable — every existing axis-read regression holds), but **reweights** so the purest IDENTITY cues carry the *smallest* mood weight: pitch register 0.30→0.18 (valence) and 0.12→0.06 (arousal), brightness 0.10→0.06 (arousal); the freed weight goes to loudness (the strongest, most universal arousal cue), **melodic movement** (relative, in semitones), spectral flux, and the within-hum voice-quality block. Vibrato remains a *valence* cue, never tension. This roughly **halves** the husky↔bright cold-read spread while the read still reaches both poles and still moves with mood. The transparent `acousticValue` stays absolute (provenance for calibration/audit).

### 3. The within-person opening (as data accrues) is applied EXACTLY once

Unchanged and owned by the **output-level** `reReferenceDisplayRead` (subtract the user's own acoustic centre, open the residual by their spread; ≥3 hums) + the personalization re-reference. The read does **not** add feature-level personal standardization on top (it would double-count and overwrite `acousticValue`). The personal **salience** now down-weights `timbre` features (×0.4), so the within-person *mood* deviation leans on the `state` cues rather than slow register drift (a head-cold, a new mic). The **divergence/relapse** signal deliberately stays on ABSOLUTE features (it must detect an objective shift in the person's own baseline).

### 4. The models retrain on within-person STANDARDIZED DEVIATIONS, not absolute values

`signal-lab` `toFeatureVector(f, baseline?)` emits each `timbre` feature as its within-person/within-contributor **z-delta** (winsorized) when a baseline is supplied, and `state`/`fidelity` features as-is; with no baseline it is byte-identical to the absolute vector (far-domain priors + every existing caller unchanged). The **within-user** native retrain can group all of a user's hums (`SELF_BASELINE_KEY`); the **population** retrain standardizes **per contributor** (each person's identity removed before pooling, so the pooled model learns the population's shared *mood* mapping, not a blend of voices). Inference standardizes the live hum the SAME way (the population prior is rebuilt per-hum against the live user's rolling baseline) — mismatched standardization would silently corrupt the prediction. This is the user's directive made concrete: *"the variations relative to the individual … are the parameters used to retrain the models, not absolute values; as we get more hums, new variables are introduced which are these variations standardized."*

### 5. Personality (OCEAN) timbre cues are POPULATION-decoupled, not within-person

A trait is a *stable between-person* property, so the correct reference is the **population**, not the person's own baseline (within-person standardization would conflate a real trait with baseline maturation). The identity cues feeding Extraversion/Agreeableness (`meanRms`, `peakAmplitude`, `spectralCentroidHz`) are marked `identity` and read through `PopulationOceanNorms` (already recomputed from the pooled p10–p90 by `computePopulationOceanNorms`). Reducing their weight is not an option — Extraversion is fundamentally a loudness trait — so the population window IS the decoupling; until a corpus exists the read stays honestly "tentative / exploratory".

### 6. A cross-voice invariance release gate

`npm run hum-sim` and `npm run sim` now assert: with **mood held fixed**, five voices spanning husky/low → bright/high must read within a bounded displayed span (valence ≤ 0.45, arousal ≤ 0.30). This is the inverse of the existing pin/un-pin check (same person, many moods → SPREAD; many voices, same mood → CLUSTER). The pre-v11 read spread ≈0.55/≈0.33 and would fail; the v11 read measures ≈0.25/≈0.26 and passes. The gate is honest about the residual: one cold hum cannot fully separate a low voice from a low mood — the rest is earned as the personal baseline forms.

## Consequences

- A new user no longer gets a read driven by their natural voice; the first-hum read leans on what they actually *do* with the hum, and the cross-person bias halves immediately and then dissolves as their baseline forms.
- The trained models generalize on **mood**, not on whose voice contributed — the population baseline is no longer a blend of everyone's timbres.
- **Honest limit, stated:** the first hum still carries a bounded residual identity offset (it is mathematically un-removable without personal data); it is hedged by the population-prior confidence cap and removed within a few hums.
- No privacy/sync surface added (z-deltas are *less* identifying than absolutes; no new persisted free-form-keyed field). Divergence/relapse and `acousticValue` provenance are untouched.

## Alternatives rejected

- **Shrink identity cues toward neutral on the cold read.** Kills the dominant arousal driver (loudness), re-creates the original voice-quality valence pin, and breaks 6+ reachability gates. Rejected for the measured weight-rebalance.
- **Feature-level personal standardization inside `acousticAffectAxes`.** Double-counts the output-level re-reference and overwrites the absolute `acousticValue` provenance (breaks calibration). Rejected — the within-person opening lives at exactly one layer.
- **Within-person standardization for the OCEAN traits.** Conflates a stable trait with baseline maturation and erases the between-person position a trait describes. Rejected for population-norm decoupling.
