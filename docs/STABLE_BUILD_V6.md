# Hum AI — Stable Build v6

> **One line.** v6 makes the read path *measurable and self-calibrating*, makes the
> **hybrid (rule-based + ML)** posture an enforced contract, and adds the **cross-user
> population loop** so the baseline keeps improving across users — all without changing the
> privacy/safety posture or breaking the consumer flow.

Builds on [v5](STABLE_BUILD_V5.md) (investigational screening instrument, Phase 0) and the
AURA UI. Every rule-based change is grounded in the cited corpus (`docs/source/INDEX.md`,
`docs/research/voice-big-five.md`). Non-clinical framing, within-user comparison, and the
ADR-0005/0006/0008/0009 seams are all preserved.

## 1. The calibration & simulation harness — `@hum-ai/sim-lab` (new)

The read path (`acousticAffectAxes` → `resolveAxisRead` → `reReferenceDisplayRead`) and the
OCEAN signature were carefully reasoned but never *measured*. `@hum-ai/sim-lab` is a pure
(constructs derived `AcousticFeatures` directly — no audio, no I/O) sensitivity + scenario
harness that turns the opaque weight tables into an observed input→output map:

- **Sensitivity sweep** (`sweep.ts`): varies each captured parameter across its realistic range
  with all others held at a neutral reference, and reports per-output **span / direction /
  monotonicity / saturation / dead** — the "scale & vectorise the parameters" instrument.
- **Scenario batteries** (`scenarios.ts`):
  - **Mood ordering** — happy / calm / tense / sad acoustic archetypes land in the right
    Russell V-A quadrant (4/4).
  - **Fidelity invariance** — degrading ONLY mic/room fidelity must not move the affect read
    (Δvalence = 0.000, zone stable) — the [[valence-fidelity-decoupling]] contract, now a test.
  - **Pin / within-user re-reference** — a fixed-voice user humming five moods: the absolute
    read clusters (2 zones, span ~0.34) while the displayed re-referenced read fans across 5
    zones (span ~1.69). The display-read fix, demonstrated.
- **Hybrid validation** (`hybrid.ts`): the trained ML axis prior **refines but never overrides**
  the rule-based backbone (bounded by the native/far-domain cap), and **abstains** when
  out-of-domain or gate-failed (the read stays the acoustic backbone).
- **Findings + gate** (`report.ts`): research-contract violations are surfaced as
  `fail`/`warn`/`info`. `npm run sim` prints the markdown report and exits non-zero on any
  `fail`; `packages/sim-lab/test/calibration.test.ts` locks the contracts into `npm test`.

Scripts: `npm run sim` · `npm run sim:sweep` · `npm run sim:scenarios`.

## 2. Research-grounded recalibration

The sweep surfaced one genuine miscalibration and a set of acceptable plateaus:

- **Openness pitch-range window 0.3–4 → 0.5–6 st.** Pitch-range variation is *the* defining (and
  only reliably transferable) openness cue (voice-big-five.md §2: Kim 2025; Song 2023; Mairesse
  2007), yet the old window **saturated at ~4 st — half the realistic hum range** — so a
  melodically wide hummer read no more open than a moderate one. The new lower bound (0.5) also
  matches the melody window the arousal layer uses, removing a cross-layer disagreement.
- **The remaining 13 saturations are perceptually-correct plateaus at physical extremes**
  (loudness plateauing in arousal; perturbation maxing out steadiness), each documented with its
  research reason (`EXPECTED_SATURATION` in `report.ts`) and downgraded to `info`. We did **not**
  over-fit windows to a synthetic sweep. Result: **0 fail / 0 warn**.

All sensitivity **signs** were verified against the literature (arousal ↑ with energy/pitch/
brightness/flux; valence ↑ with pitch height/melody/settled voice quality; OCEAN cue directions
per voice-big-five.md). No sign was wrong.

## 3. Hybrid (rule-based + ML + trained models), made explicit

No fusion-math change was needed — the orchestrator already layers a transparent rule-based
acoustic backbone, capped/OOD-aware trained axis priors, and an optional promoted fusion
meta-learner. v6 turns that posture into an **enforced, tested contract** (sim-lab hybrid checks)
and extends it with a third prior tier (below).

## 4. Cross-user population loop (ADR-0012) — offline-capable

The within-user HiTL loop already personalizes each user's read. v6 adds the missing tier: pool
consented hums so a **population baseline** retrains and benefits every user — built as an
**offline-capable pipeline + client tier** (NOT auto-deployed; live pooling + scheduled
aggregation are a governed, IRB-gated follow-up).

- **Consent.** New scope `population_corpus_contribution` (shared-types) — distinct from
  `derived_feature_sync` (which only backs up to the user's OWN space).
- **Contract.** `PopulationContribution` + `assertValidPopulationContribution`
  (affect-model-contracts): a pseudonymous envelope around a benign, derived-only
  `NativeHumExample` (re-runs the no-raw-audio + no-clinical-leak guards; rejects identifying keys).
- **Group-by-contributor CV.** `native-corpus` training gained a backward-compatible
  `RetrainOptions.foldKey` (default = per-example, so within-user behavior is byte-identical),
  so the population retrain reuses the **exact same honest promotion gate** (beat the acoustic
  backbone on held-out hums, significantly, well-calibrated) — just folded by contributor.
- **`@hum-ai/population-corpus` (new).** `poolContributions` → `trainPopulationArtifact`
  (group-by-contributor CV) → a versioned `PopulationArtifact` (axis models + manifest) with a
  **contributor-diversity guard** (`POPULATION_MIN_CONTRIBUTORS = 8`); `computePopulationOceanNorms`
  (data-grounded OCEAN windows from pooled percentiles); `selectAxisPriors` (the 3-tier selector);
  `buildPopulationContribution` + `contributorPseudonym`.
- **Big Five ↔ population.** `assessPersonalitySignature` now accepts optional
  `PopulationOceanNorms`, so the hardcoded protocol defaults become **data-grounded windows** as
  the corpus grows (resolves the limitation flagged in voice-big-five.md §5). Default path is
  byte-identical (honest cold start).
- **Offline job.** `apps/ops/src/population-train.ts` (`npm run population:train`) reads a pooled
  contributions JSON, re-runs the safety guards, trains, and writes the artifact.
- **Firestore rules.** `populationContributions/*` (create-only by consented users, **read only by
  the `populationAggregator` role — never cross-user**, append-only) + `populationModels/*`
  (signed-in read for distribution, aggregator write).
- **Client (non-breaking).** `effectiveAxisPriors` is now **personal > population > far-domain**;
  `loadPopulationArtifact()` fetches `/models/population-artifact.json` (null when absent → exact
  prior behavior); `currentSignature()` consumes population OCEAN norms; the **gathering write** in
  `onFeedback` is wired but **gated on the opt-in scope (off by default)**, so no cross-user data
  leaves a device until the consent-UI + IRB sign-off ship.

## 5. What did NOT change (discipline)

- No change to the privacy posture: raw audio never leaves the device; derived-only sync; the
  raw-audio + clinical-leak guards run on every new path.
- No change to the affect/clinical read math beyond the one openness window; the displayed read,
  personalization, relapse, and intervention paths are untouched.
- The Big Five stays **exploratory** — it does not steer the affect or clinical read; it only
  gains better-calibrated windows and (optionally) population norms.
- Cross-user pooling is **not** auto-deployed; the live contribution write is consent-gated off.

## 6. Verification

`npm run typecheck` + `npm run typecheck:web` + `npm test` (all green) + `npm run qa` (5/5 gates)
+ `npm run sim` (0 fail / 0 warn) + `npm run build:web`. The offline population job was run
end-to-end on a synthetic 12-contributor / 72-hum pool: it honestly **held** the axes (synthetic
labels don't beat the backbone) while recomputing 9 OCEAN windows from data — the correct
conservative behavior.

See [[aura-ui-architecture]], [[stable-build-v5]], [[personality-signature-ocean]],
[[valence-fidelity-decoupling]], [[todays-read-valence-pinned]], [[source-corpus]].
