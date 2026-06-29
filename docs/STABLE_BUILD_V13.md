# Hum AI — Stable Build v13

> **One line.** v13 makes the within-hum read **unsupervised** and **longitudinal**. The *full*
> feature set is tracked live across the 12 s; an **unsupervised** segmenter (dynamic-programming
> least-squares change-point detection with a penalized model selection) decides how many **chunks**
> the hum holds and where they fall — no per-hum threshold, the data's own variability chooses.
> Each chunk is labelled by *how* it differs from the last — **musically** (melody/brightness) or as
> an **inner-state** shift (energy/steadiness). Meanwhile **absolute** values feed a new per-user
> **vocal-range** model that sharpens every hum, so a chunk can be placed in *your own* reachable
> span. And the hum **simulator** is rebuilt to **start from the inner states** it must infer —
> generating a wide range of hums to prove the chunks + longitudinal models recover them.

Builds on [v12](STABLE_BUILD_V12.md). The capture-gate, the V/A backbone, fusion, the
quality/consent/privacy gates, the relapse/screening separation, the fidelity ⊥ affect contract, the
trained model's input vector, and the existing `npm run hum-sim` + `npm run sim` release gates are all
**preserved** — v13 generalizes the v12 within-hum layer and adds a longitudinal range model, never
rewriting the backbone. Recorded as
[ADR-0015](adr/0015-unsupervised-chunking-longitudinal-vocal-range-inner-state-sim.md).

## 0. Coordinates

- **Starting commit:** `60ef233` (`docs(stable-build-v12): record final commit hash + verified production deploy`), branch `main`.
- **Final commit:** _recorded in the immediately-following docs commit, per the v8–v12 convention._
- **Verified production deploy:** _recorded with the final commit (Vercel CLI prebuilt deploy → `hum-ai-beige.vercel.app`)._
- **Scope (new):** `packages/audio-features/src/temporal.ts` (full-feature track + unsupervised DP segmentation), `packages/shared-types/src/stats.ts` (`RangeStats`), `packages/personalization-engine/src/vocal-range.ts`, `packages/hum-sim/src/inner-state.ts`, the V13 unit tests (`range-stats`, `vocal-range`, `trajectory-vector`, `temporal-read-v13`), this spec, `docs/adr/0015-…`.
- **Scope (changed):** `packages/signal-lab/src/feature-schema.ts` (`toTrajectoryVector` + `rangeStandardize`), `packages/personalization-engine/src/{profile,update,state,index}.ts`, `packages/orchestrator/src/{temporal-read,orchestrator}.ts`, `packages/hum-sim/src/{pipeline,cli}.ts`, `packages/sim-lab/src/temporal-scenario.ts`, `apps/web/src/app/{render.ts,styles.css}`.
- **Unchanged:** the V/A acoustic backbone math, **`toFeatureVector` (byte-identical — trained artifacts untouched)**, the far-domain prior (stays absolute + penalized), the raw-audio/clinical privacy guards, the dual-baseline divergence/relapse signal, and the within-user display re-reference.

## 1. Unsupervised chunking over the full feature set

`computeFrameTrack` now tracks the **whole** mood-variable set on the 80 ms grid — energy, F0,
brightness, **bandwidth, rolloff, zero-crossing rate**, spectral flux, and the frame-to-frame
**pitch/amplitude perturbation**. Every channel is z-scored *within the hum* (so a husky vs bright
voice cannot manufacture separation) into a multivariate matrix.

The segmenter is **unsupervised**: for every candidate chunk count *K*, dynamic programming finds the
**globally optimal** partition minimizing average within-segment variance (the k-segments / PELT
family), and a complexity **penalty** selects *K*. No label, no target, no per-hum threshold tuning —
the data's variability decides. It fires on both an abrupt **step** and a gradual **ramp**; a steady
hum stays **one chunk**. The four validated primary channels carry full weight, the auxiliary channels
reduced weight, so a single-channel shift (a pure energy swell) is not diluted below the penalty. The
dense live track is **local-only** — never returned, persisted, or synced; only the chunks leave.

## 2. Absolutes → a longitudinal vocal-range model

`RangeStats` (robust p05…p95 span) + `vocal-range.ts` add the **third sibling** of the dual baseline
(rolling center / anchored center / longitudinal **range**). It accumulates each parameter's reachable
span from **absolute** per-hum values, refined every hum, persisted on
`UserModelProfile.vocal_range_vector` (in the sync guard). `rangePosition` maps a value into the
user's **own** [0,1] span — the absolute-but-personal frame, distinct from the z-delta-vs-median the
baselines carry — so a chunk read can say "this stretch sat at the low end of *your* usual loudness."

## 3. The model adjustment (standardize within-hum + against the range; vectorize)

`toFeatureVector` is left **byte-identical** (its standardizer is serialized with every artifact).
v13 **adds** the representation the within-hum/longitudinal layer reasons over: `rangeStandardize`
(longitudinal-range standardization, the complement of v11's within-person z-delta) and
`toTrajectoryVector` (a fixed-length **vectorization** of the chunk-to-chunk variation — per feature:
arc, swing range, volatility — z-scored across the hum's chunks, so identical chunks yield zero).

## 4. Chunks differ musically or as inner-state shifts

Each transition is classified by which family of within-hum **differences** dominates — **musical**
(pitch/brightness/melody) vs **inner-state** (energy/arousal/valence/steadiness) — surfaced per chunk
(`kind`) and aggregated (`variationMode`), with the vocal range placing each chunk in the user's span.
Strictly **additive**; all copy is safety-screened and persisted as derived scalars.

## 5. The simulator starts from the inner states

`inner-state.ts` maps each canonical state (single-sourced from `AFFECT_STATE_HEADS`: calm / joy /
excitement / stress / anger / anxiety / fear / sadness / **depressive** / fatigue / instability /
flattened / mixed / neutral) to a **wide distribution** of hums + a within-hum **contour** (depressive
= fading + falling pitch; anxious = rising + jittery; calm = settling). The expected output is scored,
never fed in (no label smuggling). Two new `npm run hum-sim` batteries: **inner-state recovery**
(arousal direction + trajectory shape recovered across each state's distribution; activated states
separate from subdued) and **longitudinal inner-state** (a within-user drift is recovered by the
displayed read — depressive V → −0.7, anxiety A → +0.9, recovery V → +0.75; this is where valence sign
is honestly earned, since cold acoustic valence is weak).

## 6. Validation (all green)

- `npm run hum-sim`: core + temporal **8/8** + inner-state recovery **17** + longitudinal inner-state **3** — thresholds **not** widened.
- `npm run sim`: within-hum trajectory scenarios gained **musical-variation** + **inner-state-shift** round-trips; the not-skewed contract holds.
- `npm run check`: **702 tests** (15 new), `npm run qa` 5/5.

## 7. Non-claims (unchanged)

Non-clinical, not validated, not a diagnosis. The unsupervised chunking is signal processing; the
chunk→inner-state mapping is a reflective, interpretable rule layer (no within-chunk supervised labels
exist). The vocal-range model is a derived per-user summary. The simulator is synthetic validation, not
data. The medical markers remain within-user, consent-gated, non-diagnostic.
