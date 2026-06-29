# Hum AI — Stable Build v14

> **One line.** v14 is an **end-to-end QA/QC stabilization pass** — a backtrack audit that traces every
> inner state forward to its KPI, parameter, and UI, and fixes the broken links: a **leaking** signal
> (recording quality bleeding into the personalization, OCEAN, and drift layers), a **contradicting**
> one (the mood-field zone disagreeing with the headline on the same screen), **dead** ones (a near-centre
> copy lean and a within-hum "agitation rose" trajectory that nothing could reach), and **over-eager**
> ones (a lone hum escalating a risk marker; incoherent Sound Lab taste combinations reaching the search).
> Plus the **arousal low-pin** recalibration (gentle real captures no longer read subdued). No new
> modelling, no backbone rewrite, **no gate threshold widened**.

Builds on [v13](STABLE_BUILD_V13.md). The capture-gate, the V/A backbone, the unsupervised within-hum
chunking + longitudinal vocal-range model, fusion, the quality/consent/privacy gates, the
relapse/screening separation, the trained model's input vector (`toFeatureVector` byte-identical), and
the existing `npm run hum-sim` + `npm run sim` release gates are all **preserved** — v14 corrects
**wiring**, it does not generalize a layer. Recorded as
[ADR-0016](adr/0016-state-kpi-wiring-audit-fidelity-isolation.md).

## 0. Coordinates

- **Starting commit:** `da49fdd` (`docs: bring README/CONTRIBUTING/SECURITY/web + env docs up to date`), branch `main`.
- **Final commit:** `f2aef91` (`feat(stable-build-v14): state→KPI wiring audit — fidelity isolation, headline-aligned zones, revived dead branches, Sound Lab taste coherence`), branch `main`. This hash line is finalized in the immediately-following docs commit, per the v8–v13 convention.
- **Verified production deploy:** `hum-ai-beige.vercel.app` → HTTP 200, serving build asset `index-Cynaufqr.js` (matches the clean `f2aef91` tree build), with the v14 surface strings live in the bundle (`wh-region` per-chunk region axis, "Pick a genre to choose a flow", "Fits your read", "Tuned to"). Vercel CLI prebuilt deploy → production deployment `hum-3syrhlgt9-ishaans-projects-f5eaf242.vercel.app`. Deployed from the clean committed `f2aef91` tree.
- **Scope (changed):** `packages/personalization-engine/src/{profile,dual-baseline}.ts`, `packages/personality-signature/src/index.ts`, `packages/orchestrator/src/{copy,temporal-read,axis-read,display-read}.ts`, `packages/relapse-engine/src/risk-markers.ts`, `packages/intervention-engine/src/sound-lab.ts`, `apps/web/src/app/{render,sound-lab,sound-lab-store,styles}.{ts,css}`, plus new unit tests in `personalization-engine` and `intervention-engine`, this spec, and `docs/adr/0016-…`.
- **Unchanged:** the V/A acoustic backbone math, `toFeatureVector` (byte-identical), the far-domain prior, the raw-audio/clinical privacy guards, the unsupervised chunking + vocal-range model, two-head separation, and every axis gate (`read-not-skewed` / `no-single-zone-pin` / `cross-voice-invariance` / fidelity ⊥ affect — none widened).

## 1. Fidelity is isolated from EVERY personal computation (the leak fix)

ADR-0013 named a **fidelity** feature family (SNR, noise-floor, clarity, spectral flatness, breathiness)
— mic/room artefacts, not the voice — and v9 already keeps them out of the V/A read. The audit found
them still leaking into three other personal paths, each now closed against the single
`FIDELITY_FEATURE_KEYS` taxonomy:

- **Within-person z-deltas** (`profile.ts/zDeltasAgainstBaseline`) skip fidelity features, so a noisier
  mic can no longer re-reference the affect read or **seed a learned risk signature**.
- **Dual-baseline divergence** (`dual-baseline.ts/baselineDivergence`) skips them, so a run of quieter
  captures is no longer read as within-user **drift** (medical-layer evidence).
- **OCEAN agreeableness** (`personality-signature/index.ts`) drops `breathinessProxy` (= spectral
  flatness): a breathy mic could swing a **temperament** read past its lean threshold. Warmth is now
  carried by `smoothnessScore` + inverse-brightness (both research-grounded).

This is *fidelity ⊥ affect* generalized to **fidelity ⊥ everything personal**.

## 2. The mood-field zone is a strict coarsening of the headline (the contradiction fix)

`render.ts/zoneFor` rendered a circumplex zone word from a ±0.12 / quadrant split while the headline
and inner-state line use a ±0.2 dead-band — so a barely-positive hum could show an "Energised" zone
under a "Steady" headline. `zoneFor` is rebuilt on the **same `T = 0.2` nine-band split**, so the
mood-field zone can only agree with, or be a less specific version of, the headline. A new per-chunk
**region/time axis** under the within-hum strip also makes *where* each chunk falls in the ~12 s legible
(start–end seconds, aligned to the change-point boundaries).

## 3. Dead signals revived (the unreachable-branch fix)

- **Near-centre copy lean** (`copy.ts/innerStateLine`): the centre branches keyed on three **risk-marker**
  heads (anxiety/sadness/fatigue) that the two-head split strips out of the benign broad head before the
  argmax (ADR-0006) — they could never fire, and the centre always fell to the generic line. Rebound onto
  the **benign** heads that can actually be the dominant broad state (`anger_frustration` / `mixed_state`
  / `calm_regulated`).
- **The within-hum "agitation rose" trajectory** (`temporal-read.ts/classifyShape`): the module's docs
  name a rising-instability → *winding up* path, but `instabilityTrend` only drove the *settling* clause.
  Added the exact **mirror** of settling at the same `SETTLE_T` magnitude — and it cannot steal from
  settling, which requires falling arousal or *easing* instability.

## 4. Over-eager signals damped

- **Lone hum can't escalate a risk marker** (`risk-markers.ts/levelFrom`): a single early-onset deviant
  hum at high intensity could jump straight to **elevated**. Early-onset escalation now also requires the
  lean to have held ≥ 2 hums (consistent with the relapse rule's `MIN_CONSECUTIVE_DRIFT_HUMS` and this
  file's "sustained" framing); a lone outlier tops out at **watch**. (Removed the now-unused
  `RECENT_MARKER_WINDOW`.)
- **Sound Lab taste coherence** (`sound-lab.ts` + web): language→genre→flow is a **hard** coherence filter
  — only sensible combinations are offered (no English-language Bollywood, no lo-fi metal) — while the
  read's state picks **soft**, state-tied defaults within what's offered ("fits your read", a leading dot,
  never a fence). `planSoundLab` reconciles the taste at the **query boundary**, the single chokepoint
  every caller flows through, so no incoherent combination can reach the search regardless of how a UI
  mutator behaves; a `tasteTouched` flag distinguishes "never chosen" from "deliberately cleared" so a
  removed genre is never reinstated.

## 5. Arousal low-pin recalibration (the pinned-signal fix)

`axis-read.ts` nudges the `AROUSAL_RMS` window `[0.01, 0.14] → [0.009, 0.125]` and `display-read.ts`
tightens `REREF_FULL_HISTORY 12 → 8`. Real **gentle** captures run with auto-gain **off** (a sustained
hum is exactly what AGC fights), so they sit below the synth's neutral RMS and pinned arousal low while
the simulator passed. The window's **log-width is unchanged** — this moves the zero-point toward where
real hums sit, it does **not** widen the score — and the within-user re-reference (the real disambiguator
of "quiet capture" vs "calm mood") reaches full strength a few hums sooner. Loudness keeps its lead
weight; it is the only capture-robust arousal cue, so the pin is fixed by recalibration, not by
de-weighting it.

## 6. Validation (all green)

- `npm run check`: **719 tests** all green (11 new in v14 — fidelity-exclusion in z-deltas + divergence;
  the Sound Lab coherence taxonomy), `npm run qa` **5/5**.
- `npm run sim`: all calibration contracts hold; not-skewed / no-single-zone-pin / cross-voice-invariance
  unchanged.
- `npm run hum-sim`: **15 core + 8 temporal + 20 inner-state** checks; `hum-sim:fidelity` **9/9**;
  `hum-sim:longitudinal` green — **no threshold widened**.
- `npm run build:web`: production bundle builds clean.

## 7. Non-claims (unchanged)

Non-clinical, not validated, not a diagnosis. v14 fixes wiring; it adds no model and changes no claim.
The medical markers remain within-user, consent-gated, and non-diagnostic; the screening head stays
blinded; the simulator is synthetic validation, not data.
