# ADR-0016: A state→KPI→parameter→wiring audit — fidelity is isolated from EVERY personal computation, and every user-facing affect label is a strict coarsening of the headline

- **Status:** Accepted (implemented; `npm run check`, `npm run qa`, `npm run sim`, `npm run hum-sim` all green)
- **Date:** 2026-06-29
- **Packages:** **`@hum-ai/personalization-engine`** (`profile.ts`, `dual-baseline.ts` — fidelity excluded from within-person z-deltas + divergence), **`@hum-ai/personality-signature`** (`index.ts` — fidelity cue dropped from OCEAN agreeableness), **`@hum-ai/orchestrator`** (`copy.ts` — dead inner-state branches revived; `temporal-read.ts` — the rising-instability trajectory wired; `axis-read.ts` + `display-read.ts` — arousal low-pin recalibration), **`@hum-ai/relapse-engine`** (`risk-markers.ts` — a lone hum can no longer escalate a marker), **`@hum-ai/intervention-engine`** (`sound-lab.ts` — language→genre→flow coherence taxonomy), `@hum-ai/app-web` (`render.ts` — mood-field zone aligned to the headline + a per-chunk region/time axis; sound-lab UI).
- **Builds on:** [ADR-0013](0013-trait-decoupled-within-person-standardized-read.md) (`state` vs `timbre`; the fidelity feature family that v14 now excludes everywhere), [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) (the benign-vs-risk head split the copy fix relies on), [ADR-0007](0007-dual-baseline-rolling-and-anchored.md) (the baselines v14 keeps fidelity out of), [ADR-0008](0008-user-facing-confidence-language.md) (the user-facing language contract the zone alignment extends), [ADR-0015](0015-unsupervised-chunking-longitudinal-vocal-range-inner-state-sim.md) (the within-hum trajectory whose dead "agitation rose" path v14 wires).
- **Unchanged:** the whole-hum V/A backbone math, `toFeatureVector` (byte-identical — trained artifacts untouched), the far-domain prior, every privacy/consent guard, two-head separation, and **no axis gate threshold was widened** (`read-not-skewed` / `no-single-zone-pin` / `cross-voice-invariance` / fidelity ⊥ affect unchanged).

## Context

v13 shipped a deep within-hum + longitudinal stack. Before cutting the next stable build we ran an **end-to-end backtrack audit**: for each inner state the product claims to read, trace it forward to the KPI it should move, to the parameter that computes that KPI, to the UI that surfaces it — and look for links that are **dead** (a branch nothing can reach), **leaking** (a non-affect signal entering an affect/longitudinal path), **pinned** (a real signal stuck at one value regardless of mood), **contradicting** (two surfaces disagreeing on the same screen), or **over-eager** (a single noisy event escalating). The audit found one of each kind plus a coherence gap in the Sound Lab taste controls. v14 is the set of wiring corrections; it adds no new modelling and rewrites no backbone.

Two findings were not local bugs but missing applications of principles already accepted elsewhere, so they are recorded here as decisions.

## Decision

### D1 — Fidelity features are isolated from EVERY personal/longitudinal computation, not just the acoustic affect read

ADR-0013 established a **fidelity** feature family (SNR, noise-floor, clarity, spectral flatness, breathiness) — capture-chain artefacts of the mic/room, not the voice — and v9/axis-read already keeps them out of the V/A read (the *fidelity ⊥ affect* contract). The audit found the same features still leaking into three other personal paths:

1. **Within-person z-deltas** (`personalization-engine/profile.ts`, `zDeltasAgainstBaseline`) — a noisier mic produced a large z-delta that could re-reference the displayed affect read and **seed a learned risk signature**.
2. **Dual-baseline divergence / drift** (`personalization-engine/dual-baseline.ts`, `baselineDivergence`) — a recent run of quieter captures registered as within-user **drift**, i.e. medical-layer evidence.
3. **OCEAN agreeableness** (`personality-signature/index.ts`) — `breathinessProxy` (= spectral flatness, a fidelity artefact) was a weighted agreeableness cue, so a breathy mic could swing a **temperament** read past its lean threshold.

**Decision:** the fidelity family is excluded from *all* within-person standardization, longitudinal divergence, and trait cues — sourced from the single `FIDELITY_FEATURE_KEYS` taxonomy so the set can never drift between call sites. Capture quality is never a within-person deviation, never drift evidence, and never a personality cue. Warmth in OCEAN is carried by the research-grounded `smoothnessScore` + inverse-brightness cues alone. This generalizes *fidelity ⊥ affect* to **fidelity ⊥ everything personal**.

### D2 — Every user-facing affect label is computed from the SAME dead-band as the headline, so a coarser label can never contradict it

The read screen showed a 2-D circumplex **zone** word (`render.ts/zoneFor`) using a ±0.12 / quadrant-at-zero split, while the headline and inner-state line (`copy.ts`, `axisHeadline`/`innerStateLine`) use a ±0.2 dead-band. A barely-positive hum could therefore render an "Energised" mood-field zone beneath a "Steady" headline — two surfaces disagreeing on one screen.

**Decision:** any coarse user-facing affect label must be a **strict coarsening** of the headline — derived from the same `T = 0.2` dead-band and nine-band split. `zoneFor` is rewritten onto that band (nine zones aligned to the headline's), so the mood-field zone can only ever agree with, or be a less specific version of, the headline. New label vocabularies must reuse the shared band, not invent their own threshold.

### D3 (supporting wiring corrections, not new architecture)

- **Dead inner-state copy revived** (`copy.ts/innerStateLine`): the near-centre lean keyed on three **risk-marker** heads (anxiety/sadness/fatigue) that `splitInference` strips out of the benign broad head before the argmax (ADR-0006) — so those branches were unreachable and the centre always fell through to the generic line. Rebound onto the **benign** heads that can actually be the dominant broad state (`anger_frustration` / `mixed_state` / `calm_regulated`).
- **The "agitation rose" trajectory wired** (`temporal-read.ts/classifyShape`): the within-hum docs name a rising-instability → *winding up* path, but `instabilityTrend` only ever drove the *settling* clause. Added the exact **mirror** of settling at the same `SETTLE_T` magnitude (rising micro-instability with arousal not falling → `winding_up`); it cannot steal from settling, which requires falling arousal or *easing* instability.
- **A lone hum can no longer escalate a risk marker** (`risk-markers.ts/levelFrom`): a single early-onset deviant hum at high intensity could jump straight to **elevated**. Early-onset escalation now also requires the lean to have held ≥ 2 hums, consistent with the relapse rule's own `MIN_CONSECUTIVE_DRIFT_HUMS` and this file's "sustained" framing; a lone outlier tops out at **watch**.
- **Arousal low-pin recalibration** (`axis-read.ts` `AROUSAL_RMS` `[0.01,0.14]→[0.009,0.125]`; `display-read.ts` `REREF_FULL_HISTORY 12→8`): the "every read sits low" pin — real gentle captures run with auto-gain **off**, so they sit below the synth's neutral RMS and pinned arousal low while the simulator passed. A small, gate-safe zero-point nudge (the log-width is unchanged — the score is not widened) plus a faster within-user re-reference ramp (full strength by hum 8, not 12) shorten the cold-start subdued window **without** de-weighting loudness, the only capture-robust arousal cue.
- **Sound Lab taste is a coherence taxonomy** (`sound-lab.ts`): language→genre→flow is now a **hard** filter — only sensible combinations are offered (no English-language Bollywood, no lo-fi metal) — while the read's state picks **soft**, state-tied defaults within what's offered ("fits your read"). `planSoundLab` reconciles the taste at the **query boundary**, so no incoherent combination can reach the search regardless of how any UI mutator behaves.

## Validation

- `npm run check`: **719 tests** all green (11 new in v14 — 2 fidelity-exclusion + 9 Sound Lab coherence-taxonomy), `npm run qa` **5/5**.
- `npm run sim`: all calibration contracts hold; the not-skewed / no-single-zone-pin / cross-voice-invariance contracts are unchanged.
- `npm run hum-sim`: **15 core + 8 temporal + 20 inner-state** checks pass; `hum-sim:fidelity` 9/9 and `hum-sim:longitudinal` green — **no threshold widened** to pass.

## Consequences

- A mic change, a noisy room, or a quiet capture can no longer masquerade as a mood shift, a personality change, a learned risk signature, or longitudinal drift — the *fidelity ⊥ affect* contract now holds across the entire personal/medical stack, sourced from one taxonomy.
- The read screen is internally consistent: the mood-field zone is provably a coarsening of the headline.
- Three previously-dead or pinned signals (centre-lean copy, the rising-instability trajectory, gentle-capture arousal) now carry real information; two over-eager paths (lone-hum escalation, incoherent taste combinations) are damped.
- The audit's tracing discipline (state → KPI → parameter → wiring, classify each broken link) is reusable for the next build.
