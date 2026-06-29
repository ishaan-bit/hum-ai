# ADR-0015: Within-hum chunks are formed by UNSUPERVISED segmentation over the FULL feature set; absolute values feed a longitudinal per-user VOCAL-RANGE model; and the hum simulator is rebuilt to START FROM the inner states it must infer

- **Status:** Accepted (implemented; `npm run check`, `npm run qa`, `npm run sim`, `npm run hum-sim` all green)
- **Date:** 2026-06-29
- **Packages:** **`@hum-ai/audio-features`** (`temporal.ts` — full-feature live track + unsupervised DP segmentation), **`@hum-ai/shared-types`** (`RangeStats`), **`@hum-ai/personalization-engine`** (`vocal-range.ts` + profile/ingest/sync), **`@hum-ai/signal-lab`** (`feature-schema.ts` — `toTrajectoryVector` + `rangeStandardize`), **`@hum-ai/orchestrator`** (`temporal-read.ts` — musical-vs-inner-state chunk labels + vocal-range note), **`@hum-ai/hum-sim`** (`inner-state.ts` + contour-aware runner + recovery/longitudinal gates), `@hum-ai/sim-lab` (musical-vs-state round-trip), `@hum-ai/app-web` (surface).
- **Builds on:** [ADR-0014](0014-within-hum-temporal-trajectory.md) (the within-hum trajectory this generalizes), [ADR-0013](0013-trait-decoupled-within-person-standardized-read.md) (`state` vs `timbre`; absolute level = identity), [ADR-0007](0007-dual-baseline-rolling-and-anchored.md) (the longitudinal baselines the vocal-range model is a third sibling of), [ADR-0005](0005-public-datasets-as-priors-not-truth.md) (the far-domain prior stays absolute + penalized).
- **Unchanged:** the whole-hum V/A backbone, every axis gate (read-not-skewed / no-single-zone-pin / cross-voice-invariance), the trained model's input vector (`toFeatureVector` is byte-identical), all privacy guards, two-head separation, fidelity ⊥ affect.

## Context

ADR-0014 chunked a hum at its change-points and read the chunk-to-chunk variation, but three pieces of the design brief were still open:

1. The chunking watched only **four** channels and accepted a split by a **hand-tuned threshold** — not the *entire* feature set, and not an *unsupervised* paradigm.
2. **Absolute** feature values had no home of their own. The design is explicit that absolutes belong to **vocal RANGE** — how quiet↔loud, low↔high, dark↔bright a person's voice reaches — modelled **longitudinally** and refined each hum, distinct from the within-hum *relative* values that drive the chunking.
3. The hum **simulator** was inner-state-*blind*: it swept the latent space and watched where the read landed. The brief asks the inverse — **start from the inner states** (the medical markers + affect + the other inferences), generate a **wide range** of hums + vocal-feature variations, and check that the chunks + longitudinal models **yield those states**.

## Decision

### 1. Track the FULL feature set live; chunk by UNSUPERVISED segmentation (`audio-features/temporal.ts`)

`computeFrameTrack` now samples the **whole** mood-variable set on the 80 ms grid — energy, F0, brightness (centroid), **bandwidth, rolloff, zero-crossing rate**, spectral flux, and the **frame-to-frame pitch/amplitude perturbation**. Every channel is z-scored **within the hum** (trait-decoupling holds for free) into a multivariate matrix — "the entire feature set tracked through the hum."

The segmenter is **unsupervised least-squares change-point detection by dynamic programming with a penalized model selection** (the k-segments / PELT family). For each candidate chunk count *K* it finds the **globally optimal** partition minimizing the average within-segment variance; a complexity penalty (`splitGain`, per added chunk per frame) then selects *K*. No label, no target, no per-hum threshold tuning — **the data's own variability decides the number of chunks and where they fall**, up to a cap, each ≥ 2.5 s. Because the cost compares whole segments it fires on both an abrupt **step** and a gradual **ramp**; a steady hum whose bounded oscillation never clears the penalty stays **one chunk**. The auxiliary channels carry reduced weight so a single-channel shift (a pure energy swell) is not diluted below the penalty. The **dense live track is local-only** — it is never returned on the analysis object, never persisted, never synced. Only the chunks leave the module.

### 2. Absolutes feed a longitudinal VOCAL-RANGE model (`shared-types` `RangeStats`, `personalization-engine` `vocal-range.ts`)

`RangeStats` captures a parameter's robust reachable span (p05…p95, not raw min/max). The **vocal-range model** is the **third sibling of the dual baseline** (rolling center / anchored center / longitudinal **range**): `buildVocalRange` accumulates each parameter's span from the **absolute** per-hum values in the same windows the baselines use, refined every hum, persisted on `UserModelProfile.vocal_range_vector` (added to the sync raw-audio guard). `rangePosition` maps any value into the user's **own** [0,1] span — the absolute-but-personal frame for "where in *this person's* range does this sit," which is **not** the z-delta-vs-median the baselines carry. Activated only past `VOCAL_RANGE_MIN_HUMS` (a range needs more samples than a median).

### 3. The model adjustment: standardize within-hum + against the range; vectorize (`signal-lab/feature-schema.ts`)

The trained model's input vector (`toFeatureVector`) is left **byte-identical** — its standardizer is serialized with every artifact, and changing it silently corrupts promoted priors. V13 instead **adds** the representation the within-hum/longitudinal layer reasons over: `rangeStandardize` (longitudinal-range standardization of identity features, the complement of v11's within-person z-delta) and `toTrajectoryVector` (a fixed-length **vectorization** of the within-hum chunk-to-chunk variation — per feature: net arc, swing range, volatility — z-scored across the hum's chunks, so identical chunks yield the zero vector). The far-domain prior stays absolute (its OOD math requires it); these new vectorizers carry no persisted artifact, so the unsupervised within-hum layer can adopt them freely.

### 4. Chunks may differ MUSICALLY or as INNER-STATE shifts (`orchestrator/temporal-read.ts`)

Each transition into a chunk is classified by which family of within-hum **differences** dominates: **musical** (pitch register/contour, brightness, melodic movement) vs **inner-state** (energy, arousal, valence, steadiness) — normalized *differences*, so a husky vs bright voice produces the same-scale change and the split stays trait-decoupled. Surfaced per chunk (`kind`) and aggregated (`variationMode`), with the longitudinal vocal range placing each chunk's loudness in the user's own span (`energyInRange` + a screened `rangeNote`). Strictly **additive** — it never rewrites the V/A backbone — and all new copy is screened by `@hum-ai/safety-language` and persisted as derived scalars.

### 5. The simulator STARTS FROM the inner states (`hum-sim/inner-state.ts`)

A new layer **above** the latent maps each canonical inner state — single-sourced from `AFFECT_STATE_HEADS` (calm / joy / excitement / stress / anger / anxiety / fear / sadness / **depressive** / fatigue / instability / flattened / mixed / neutral) — to a **distribution** of hums (mean latent + per-control spread → a *wide range*, not one centre) plus a within-hum **contour** (the trajectory the state produces: depressive = fading + falling pitch; anxious = rising + jittery; calm = settling). The expected output is recorded for **scoring only** and never fed into the pipeline (the no-label-smuggling contract). Two new release-gate batteries, folded into `npm run hum-sim`:
  - **inner-state recovery** — the exact pipeline recovers each state's **arousal direction** + a consistent **trajectory shape** across its wide distribution, the activated states separate from the subdued ones, and a weak cold **valence ordering** holds;
  - **longitudinal inner-state** — a within-user **drift** (calm→depressive, calm→anxious, sad→calm) is recovered by the displayed read (depressive V → −0.7, anxiety A → +0.9, recovery V → +0.75). This is where the **valence-sign** claim is honestly earned — cold acoustic valence is weak (the documented reason the within-user re-reference exists), so the single-hum gate does not over-claim it.

## Validation

- `npm run hum-sim`: core + **temporal (8/8)** + **inner-state recovery (17 checks)** + **longitudinal inner-state (3 checks)** — all green; thresholds were **not** widened to pass (`read-not-skewed` / `no-single-zone-pin` / corner separations unchanged).
- `npm run sim`: the within-hum trajectory scenarios gained **musical-variation** (melody/brightness move, feeling held → `musical`) and **inner-state-shift** (energy/steadiness move, melody held → `inner_state`) round-trips; the not-skewed contract (identical chunks → steady, `variationMode steady`) holds.
- `npm run check`: 702 tests (15 new — `RangeStats`, vocal-range, trajectory vector + range standardize, chunk-kind classification), `npm run qa` 5/5.

## Consequences

- The chunking is now genuinely **unsupervised** over the **whole** feature set, and its globally-optimal partition is more stable than greedy binary segmentation.
- A user's **vocal range** is modelled in its own right and **sharpens** every hum; the within-hum read can say "this stretch sat at the low end of *your* usual loudness" without leaking the speaker's absolute offset.
- The simulator can now be driven from a **diagnosis or affect target**, generating a wide battery of hums to prove the chunks + longitudinal models recover it — a far stronger validation than a blind latent sweep.
- The within-hum inner-state mapping stays **rule-based + interpretable** (no within-chunk supervised labels exist); the unsupervised paradigm lives in the **chunking**, exactly as the brief specifies. A future trained within-hum head can consume `toTrajectoryVector` behind its own promotion gate.
