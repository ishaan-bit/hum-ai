# Hum AI — Stable Build v3 · End-to-End Specification & Status

**Build:** `stable-build-v3` · **Date:** 2026-06-21 · **Base HEAD:** `852716a`
**Status:** research-stage · **NON-CLINICAL, not a diagnosis, not FDA-cleared, not clinically validated**
**Verification:** `npm run check` (typecheck + web typecheck + **524 tests**) ✅ · `npm run qa` (4 governance gates) ✅ · `npm run build:web` ✅

This document is the current, honest specification of the deployed system after the v3 pass.
It supersedes nothing in [docs/adr/](adr/) (the decision records remain authoritative) and builds
directly on [STABLE_BUILD_V2.md](STABLE_BUILD_V2.md); read that first for the full v2 baseline. v3
keeps every v2 invariant and adds **sharper behavior plus more honesty** — not more claims.

> **One-line thesis of v3:** the model-truth hierarchy is now *behaviorally enforced* (a model that
> failed its gate can no longer steer or boost the read), what the user can see is *proven safe by a
> render-layer test*, and the system can now say — honestly and abstaining when unsure — *whether
> personalizing the read is actually helping the user*.

---

## 0. What "v3" is (changelog over v2)

v2 made everything above the deterministic acoustic backbone real, learned-from-the-user, and
statistically honest. v3 makes the **governance of that intelligence behavioral and provable**:

1. **Promotion-gated prior behavior (Part A).** Gate status was *metadata-only* in v2 (a failed-gate
   prior was still fused, just penalized + capped). In v3 a prior that **failed its promotion gate is
   HELD**: it cannot steer the dimensional read, cannot raise user-facing confidence, and cannot
   sharpen fusion confidence. Its lean survives **only as internal audit metadata**. Gate-passed
   far-domain priors still nudge within their far-domain caps; promoted native-hum priors still nudge
   within their (larger) native caps. Missing/old gate metadata degrades **conservatively** (held).
2. **Render-layer safety proof (Part B).** The deferred "render-copy gate" is implemented: a test
   drives the **real `apps/web` render functions** (behind a tiny DOM stub, no jsdom dependency) with
   real orchestrator reads across mature / abstained / consented / held-prior scenarios and asserts
   that the produced HTML carries **no raw percentages, no diagnosis claims, no clinical-risk head ids,
   and no raw-audio tokens**. A companion test proves a **rejected capture never advances the baseline
   or syncs**, and an accepted capture yields a derived-only, guard-clean sync payload.
3. **Personalization benefit / counterfactual honesty (Part C).** A new internal metric,
   `assessPersonalizationBenefit`, compares the **backbone** prediction vs the **personalized** read
   the user actually saw, both against the user's **benign self-reports**, and returns one of
   `insufficient_evidence | personalization_helping | neutral_or_unclear | personalization_worsening`.
   It abstains below an evidence threshold, uses no clinical labels, and is never an accuracy claim.
4. **Native-hum maturity visibility (Part D).** A sanitized `buildNativeMaturityView` view-model
   unifies the truthful lifecycle signals (eligible hums, labelled examples, promoted-vs-training,
   calibration trend, personalization benefit) with **no fake accuracy and no clinical claim**; the
   web "Your hum model" panel now also surfaces the personalization-benefit line, qualitatively.

Nothing in the **58-column feature schema** changed; no shipped RAVDESS prior was invalidated; the
backbone remains the floor; privacy/consent/QA gates are intact.

---

## 1. Product & invariants (unchanged from v2)

A **local-first, personalized, multimodal voice-biomarker and affective-modeling platform built around
a single standardized 12-second hum.** The entire read spine runs **on-device** (a Vite SPA bundles it
client-side). Public datasets supply **cold-start priors only**; native Hum data and a personal
baseline progressively dominate. It surfaces reflective, within-user signals — a valence/arousal read,
benign affect leans, and (consent-gated, hard-capped) risk **markers** — never a diagnosis.

**Design invariants (enforced everywhere):**
1. **The deterministic acoustic backbone is the floor.** A hum always yields a read; no trained model
   is ever required. Missing/malformed/failed-gate artifacts degrade to the backbone (or the stub fusion).
2. **Datasets are priors, not truth** — only `native_hum` is hum truth (ADR-0005).
3. **Confidence is earned, capped, and qualitative-only** — no raw % / probability in user copy
   (ADR-0008); new signals may only *lower* confidence, never raise a ceiling.
4. **Privacy is structural** — `assertNoRawAudioFields` + `assertNoClinicalLeak` gate every persisted/
   synced/rendered object.
5. **Two-head separation + consent gating** — the clinical-risk head is withheld unless consented; its
   confidence is hard-capped at **88%** (ADR-0006).
6. **Voice-first** — audio-derived features only; no camera/CV (ADR-0009).
7. **(v3) Gate status is behavioral, not cosmetic** — a model that did not pass its promotion gate may
   not steer or boost the read.

---

## 2. End-to-end v3 pipeline

```
 capture 12s hum ─► audio-features ─► capture-gate ─► quality-gate ─► domain-classifier
 (raw, ephemeral)     AcousticFeatures   accept/"hum again"  clean|borderline|reject  hum-compat penalty
       │ raw dropped on-device                                                                │
       ▼                                                                                       ▼
   AXIS READ  ◄───────────────────────────────────────────────────  experts (SER ensemble + learned prior)
   valence + arousal                                                          │ FusionEngine(+meta-learner)
   = acoustic backbone (13 features)                                          ▼
     + ranked priors — GATE-ENFORCED:                                 secondary 6-way affect hint + risk
       · gate-passed far-domain prior nudges (cap 0.5, OOD-faded)
       · promoted native prior nudges (cap 0.75)
       · GATE-FAILED prior HELD (no steer, no boost; audit only)  ◄── v3
       │
       ▼
   PERSONAL AXIS CALIBRATION (HiTL) ─► PERSONALIZATION (dual baseline, salience⊕HiTL-importance, circadian)
       │
       ▼
   RELAPSE (paired comparison, personal stable band, signature-weighted drift, z-delta CI, robust trend)
       │
       ▼
   LONGITUDINAL STATE (88% cap, consent-gated, non-diagnostic) ─► INTERVENTION (V-A + UCB bandit) ─► SAFETY
       │
       ▼
   UserFacingRead ─► [RENDER-COPY SAFETY PROVEN] ─► HiTL feedback prompt ─► native corpus + calibration
       │                                                                          │
       │                                                          on-device retrain → significance gate → promote
       ▼                                                                          │
   MATURITY VIEW (lifecycle + calibration trend + PERSONALIZATION BENEFIT) ◄──────┘   (v3 §C/§D)
```

**Entry points** (`@hum-ai/orchestrator`) are unchanged from v2:
`orchestrateHumRead({ features, consent, modelVersion, now, history?, learnedAffectPrior?, axisPriors?, metaLearner? })`,
`orchestrateHumAudio({ audio, … })`, and `runHumCycle(input)` (`apps/web/src/app/cycle.ts`).

---

## 3. Model truth hierarchy (v3 — behaviorally enforced)

This is the heart of the v3 change. For every read, evidence is ranked and **a model only contributes
to the degree it has earned**:

| Source | May steer the dimensional read? | May raise confidence? | Cap |
|---|---|---|---|
| **Acoustic backbone** (13 transparent DSP→V-A features) | Always — it IS the read | Earns from signal clarity | — (the floor) |
| **Promoted native-hum prior** (in-domain on hums, ADR-0011) | Yes, when in-domain | Yes (agreement lift) | nudge ≤ **0.75**, OOD-faded |
| **Gate-passed far-domain prior** (e.g. RAVDESS arousal binary) | Yes, when in-domain | Yes (agreement lift) | nudge ≤ **0.5**, OOD-faded, far-domain conf cap **0.45** |
| **Gate-FAILED prior** (e.g. the 6-class RAVDESS affect prior, valence binary) | **No — HELD** | **No** | not in the read; **audit metadata only** |
| **OOD prior** (any prior outside its training domain) | No — abstains | No | — |
| **Unknown-gate prior** (no/old manifest) | Conservative: **held** at the axis read; fused-but-capped only in the secondary hint | Bounded by the far-domain cap | held / cap 0.45 |

Mechanics:

- **Dimensional axis read** (`orchestrator/axis-read.ts` `resolveAxis`): a prior nudges the transparent
  acoustic value **only when `pred.inDomain && prior.passedGate`**. An in-domain prior that has not
  passed its gate becomes `trainedContribution: "held_failed_gate"` — its lean (`trainedValue`), gate
  flag, and OOD distance are recorded for provenance, but the surfaced value stays the backbone and the
  confidence is unchanged. The prior loaders degrade a missing/old manifest to `passedGate = false`, so
  an **unverified** axis prior is held by the same path (conservative by construction). Only a
  gate-passed, in-domain prior reaches the nudge + signed confidence adjustment (agreement lifts,
  strong disagreement lowers).
- **Secondary affect-state read / fusion** (`orchestrator.ts`): a supplied `learnedAffectPrior` whose
  `gatePassed === false` is **held out of the expert ensemble entirely** — the deterministic heuristic
  experts steer the secondary read, the prior never runs, and it contributes neither its probabilities
  (so it cannot sharpen the distribution or raise fusion confidence) nor its far-domain cap. The held
  prior is recorded in `ModelProvenance.heldPrior` with `priorContribution: "held_failed_gate"`. An
  unknown-gate prior (`undefined`) is still fused but bounded by its far-domain cap (0.45) — only a
  **known** failure is held.
- **Honesty:** because the production 6-class RAVDESS affect prior did not pass the gate (≈47.9%
  balanced accuracy), in v3 it no longer steers the secondary hint — the (real, deterministic) SER
  experts do. The one legitimately gate-passed far-domain model, the RAVDESS **arousal binary** (≈83%),
  is **not** suppressed: it still nudges the arousal axis when a hum lands in-domain.

**Degradation contract:** absent / unparseable / failed-gate / OOD models all degrade to the
transparent backbone (and the deterministic stub fusion). No trained model is ever required for a read.

---

## 4. Personalization & HiTL (v2 + the v3 benefit metric)

The HiTL native-hum loop is unchanged from v2 (benign valence/arousal self-report → personal axis
calibration EMA + a `NativeHumExample` row → on-device retrain → rigorous promotion gate
[permutation p, ECE, bootstrap CI, calibration-trend hold] → in-domain hum-native prior + fusion
meta-learner). v3 adds the **counterfactual honesty metric**:

`assessPersonalizationBenefit(corpus)` → `{ status, n, backboneMae, personalizedMae, improvement, reasons }`
(`@hum-ai/native-corpus/benefit.ts`):

- For every eligible, non-ambiguous labelled hum it compares, against the user's **self-report**:
  - the **backbone** prediction `acousticAffectAxes(features)` (no personalization), recomputed fresh;
  - the **personalized** prediction `example.predicted` (the axis read after HiTL calibration that the
    user actually saw).
- Mean-absolute-error over both axes: if personalizing tracks self-reports **meaningfully** better
  (Δ MAE > `0.03`) → `personalization_helping`; meaningfully worse → `personalization_worsening`; small
  gap → `neutral_or_unclear`; below `BENEFIT_MIN_EXAMPLES` (12 comparisons) → `insufficient_evidence`
  (**abstain**).
- **Honesty guardrails:** no new model is fit; only the benign `HumLabel` (valence/arousal) is read —
  no clinical label is accepted or required; it is a coarse category, **never** an accuracy %; it is
  retrospective (a corpus with no calibration engaged correctly reads as `neutral_or_unclear`).

---

## 5. Native-hum maturity visibility (v3 §D)

`buildNativeMaturityView({ corpus, artifact, eligibleHumCount })` → `NativeMaturityView`
(`@hum-ai/native-corpus/maturity.ts`) is the sanitized lifecycle view-model the "Your hum model" panel
(and any internal surface) can render truthfully:

- `eligibleHumCount`, `labelledExamples`, `trainableExamples`, `quadrantsCovered`;
- `valenceModel` / `arousalModel`: `"promoted"` (steering) vs `"training"`; `anyPromoted`; `readyToRetrain`;
- `calibrationTrend` per axis (`improving|steady|worsening|insufficient`);
- `personalizationBenefit` (the §4 category);
- a plain, non-clinical `summary`.

It carries **no raw accuracy percentage and no clinical label** (counts are hum/label counts, not
confidence figures), so a renderer can show it verbatim under ADR-0008. The deployed web panel
(`apps/web/src/app/render.ts` `renderModelLab`) now also surfaces the personalization-benefit line
qualitatively (e.g. "Personalizing your read is tracking your self-reports more closely than the
generic read would.").

---

## 6. Longitudinal & intervention (unchanged from v2)

Within-user only: paired comparison (`assessRelapse`), a **personal stable band**
(`clamp(robustStd, 0.08, 0.25)`), **z-delta confidence intervals** (a thin baseline can't claim a small
drift), **signature-weighted drift**, and a **robust trend** (Theil–Sen / Mann–Kendall / CUSUM) over the
risk series. `assessLongitudinalState` synthesizes a trend direction, a consent-gated non-diagnostic
risk hypothesis, a SUSTAINED relapse-drift signal (≥ 3 consecutive hums), a recovery signal, and a
monitoring flag — confidence **hard-capped at 88%**, `isDiagnostic: false`, surfacing consent-gated and
safety-screened. Interventions are chosen from the **sanitized `RecommendationView`** (benign V-A bands)
+ a UCB bandit over the user's safe supportive options — never from a clinical label or a diagnosis; the
music recommendation is derived from the V-A read and framed as support only.

---

## 7. Privacy & governance (unchanged invariants; one new audit field)

- **Consent scopes** (off-by-default except `local_processing`): `derived_feature_sync`,
  `research_audio_upload` (raw audio — separate channel, never the derived payload),
  `clinical_label_capture` (PHI), `clinical_risk_surfacing` (the gated risk/longitudinal panel).
- **Raw-audio firewall** `assertNoRawAudioFields` + **clinical-leak firewall** `assertNoClinicalLeak`
  gate every persisted/synced/rendered object. The new `ModelProvenance.heldPrior` audit field carries
  only an expert id, an artifact path, a gate flag, and a plain gate note — no clinical-risk or
  raw-audio-like field — and lives in the internal read only (never synced/rendered raw); the v3 tests
  assert `findRawAudioFields` stays empty and `assertNoClinicalLeak` passes with it present.
- **Dataset governance** (`@hum-ai/dataset-registry`): only `native_hum` may serve hum truth; cross-user
  pooling is a separate IRB-gated backend step, never client-side.
- **QA gates** (`npm run qa`): `no-clinical-leak`, `no-camera-deps`, `no-raw-confidence-copy`,
  `forbidden-files` — all still passing.
- **Firestore rules** — owner-scoped `users/{uid}` with `hums` and `labels` subcollections; deny all else.

---

## 8. Verification

Exact commands and results for this build (see §11 for what each new test proves):

| Command | Result |
|---|---|
| `npm run check` (typecheck + web typecheck + Node test runner over `packages/**/test` **and** `apps/**/test`) | **524 tests, 524 pass, 0 fail** ✅ |
| `npm run qa` (4 governance gates) | **no violations** ✅ |
| `npm run build:web` (Vite, browser-pure) | **built, exit 0** ✅ |

v3 widened the test glob to include `apps/**/test` so the render-layer + cycle tests run under the
standard suite. The web bundle stays **browser-pure** (Vite reaches `signal-lab` only via its pure deep
modules; no `node:fs`).

Targeted suites touched this pass: `packages/orchestrator/test/{axis-read,learned-prior}.test.ts`,
`packages/signal-lab/test/runtime-bridge-manifest.test.ts`, `packages/native-corpus/test/{benefit,maturity}.test.ts`,
`apps/web/test/{render-safety,cycle}.test.ts`.

---

## 9. Claims refused (still, explicitly)

- **Not diagnostic.** Risk **markers** and reflective signals only, never a diagnosis. The 88% cap,
  consent gates, and two-head separation are invariant.
- **Not clinically validated; no FDA / medical-device claim.** v3 changes *behavior and honesty*, not
  validation status.
- **No fabricated accuracy.** The personalization-benefit metric is a coarse within-user category vs
  the user's own self-reports — never surfaced as an accuracy percentage, never a clinical claim.
- **No cross-user / pooled-model claim.** Pooling remains a separate IRB-gated backend step that does
  not exist client-side.
- **Reference numbers are not Hum metrics.** Architecture-reference accuracies and clinical study AUCs
  are priors, never presented as Hum's accuracy.
- The deterministic SER experts remain **heuristics**, not trained models; the trained fusion
  meta-learner is a learned **re-weighting** of them, promoted only when it beats the stub on the
  user's own hums.

---

## 10. Remaining roadmap (honest, deferred)

- **[GATED] Mahalanobis OOD** replacing scalar `meanAbsZ` (needs covariance storage + far-domain
  threshold retuning).
- **[GATED] Schema-v2 richer features** (MFCC/HNR/formants, ~25 new columns) behind the deliberate
  versioned migration in [REVAMP_PLAN §3](REVAMP_PLAN.md) — out of scope here; the 58-column contract is
  untouched and now schema-locked.
- **[GATED] Temperature-scaled probability calibration** (unblocks at ≥50 confirmed hums).
- **[GATED] External validation + clinical-label pipeline** — the real path off the far-domain ceiling
  toward a Tier-3 within-user early-warning *marker* (see [validation/DIAGNOSTIC_ROADMAP](validation/DIAGNOSTIC_ROADMAP.md)).
- **[NEXT] jsdom-based render test** — the current render-copy proof uses a hand-rolled DOM stub (no
  dependency) and a real-orchestrator battery; a jsdom upgrade would let it also exercise event
  handlers and layout, at the cost of a dev-dependency. Chosen the stub for now to keep the repo
  dep-light; the stub proves the produced markup, which is the safety surface that matters.
- **[NEXT] Counterfactual depth** — the §C benefit metric is retrospective (uses the historical
  `predicted`); a fully fresh re-prediction with the *current* calibration state would need the
  calibration threaded into the assessment. Documented as a known caveat, not a hidden one.

### Notes / known limitations (not hidden)
- `apps/**/test` files are executed by `tsx` but are **outside both tsconfig `include` sets**, so they
  are run, not statically type-checked. Their assertions are the contract; the engine packages they
  import remain fully type-checked. (Pulling them into a tsconfig would add the DOM lib and a
  document-stub type conflict for no behavioral gain.)
- The render-copy proof asserts the produced markup; it does not (yet) drive a full browser layout.

---

*Stable Build v3 — generated 2026-06-21 on base `852716a`. For the v2 baseline see
[STABLE_BUILD_V2.md](STABLE_BUILD_V2.md); the per-layer narrative spec is [ARCHITECTURE.md](ARCHITECTURE.md);
the change plan is [REVAMP_PLAN.md](REVAMP_PLAN.md); decisions are in [docs/adr/](adr/).*
