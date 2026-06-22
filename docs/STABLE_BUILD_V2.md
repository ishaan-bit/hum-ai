# Hum AI — Stable Build v2 · End-to-End Specification

**Build:** `stable-build-v2` · **Date:** 2026-06-21 · **Head:** `852716a`
**Status:** research-stage · **NON-CLINICAL, not a diagnosis, not FDA-cleared, not clinically validated**
**Verification:** `npm run check` (typecheck + web typecheck + **497 tests**) ✅ · `npm run qa` (4 governance gates) ✅ · `npm run build:web` ✅
**Deployed:** Vercel production (project `hum-ai`) · Firebase Firestore rules + indexes → `humai-core-prod`

This is the complete, current specification of the deployed system — the spine, every layer's
algorithms and exact thresholds, the human-in-the-loop native-hum loop, the statistical
significance machinery, governance, the monorepo, and the build/deploy. It supersedes nothing
in [docs/adr/](adr/) (the decision records remain authoritative); it consolidates the live state
across ADR-0000…0011, the all-layers revamp, and the round-2 significance/accuracy pass.

---

## 0. What "v2" is (changelog over v1)

v1 was the honest spine: a deterministic acoustic backbone, far-domain priors that abstain OOD,
capped/qualitative confidence, two-head clinical separation. **v2 makes everything *above* the
backbone real, learned-from-the-user, and statistically honest**, without changing the 58-column
feature schema or invalidating the shipped RAVDESS priors:

1. **Human-in-the-loop native-hum loop (ADR-0011)** — users confirm/adjust the read; a native-hum
   corpus accrues on-device; a hum-native axis model retrains, gates, and promotes — escaping the
   far-domain penalty.
2. **All-layers revamp** — native-prior weighting + prior-disagreement penalty; 13-feature acoustic
   V-A mapping; HiTL per-user feature importance; robust longitudinal trend (Theil–Sen/Mann–Kendall/
   CUSUM); de-numbered honest copy.
3. **Round-2 significance + accuracy** — a rigorous on-device promotion gate (permutation p-value +
   ECE + bootstrap CI + calibration-trend hold); a **live trained fusion meta-learner**; continuous
   OOD distance + evidence-proportional nudge fade; per-user stable band + z-delta confidence
   intervals + signature-weighted drift; evidence-aware salience.

The trained `LogisticRegressionMetaLearner` and the 6 deterministic SER experts (no longer neutral
stubs) are both live behind their existing contracts.

---

## 1. Product & invariants

A **local-first, personalized, multimodal voice-biomarker and affective-modeling platform built
around a single standardized 12-second hum.** The entire read spine runs **on-device** (a Vite SPA
bundles it client-side). Public datasets supply **cold-start priors only**; native Hum data and a
personal baseline progressively dominate. It surfaces reflective, within-user signals — a valence/
arousal read, benign affect leans, and (consent-gated, hard-capped) risk **markers** — never a diagnosis.

**Design invariants (enforced everywhere):**
1. **The deterministic acoustic backbone is the floor.** A hum always yields a read; no trained model
   is ever *required*. Missing/malformed artifacts degrade to the backbone (or the stub fusion).
2. **Datasets are priors, not truth** — only `native_hum` is hum truth (ADR-0005).
3. **Confidence is earned, capped, and qualitative-only** — no raw % / probability in user copy
   (ADR-0008); new signals may only *lower* confidence, never raise a ceiling.
4. **Privacy is structural** — `assertNoRawAudioFields` + `assertNoClinicalLeak` gate every persisted/
   synced/rendered object.
5. **Two-head separation + consent gating** — the clinical-risk head is withheld unless consented;
   its confidence is hard-capped at **88%** (ADR-0006).
6. **Voice-first** — audio-derived features only; no camera/CV (ADR-0009).

---

## 2. End-to-end pipeline

```
 capture 12s hum ─► audio-features ─► capture-gate (Stage ①) ─► quality-gate ─► domain-classifier
 (raw, ephemeral)     AcousticFeatures    accept / "hum again"     clean|borderline|reject   hum-compat penalty
       │ raw dropped on-device                                                                      │
       ▼                                                                                            ▼
   AXIS READ ◄──────────────────────────────────────────────────  experts (SER ensemble + learned prior)
   valence + arousal                                                         │ FusionEngine(+meta-learner)
   = acoustic backbone (13 features)                                         ▼
     + ranked priors (native > far-domain), OOD-faded                 secondary 6-way affect hint + risk
       │
       ▼
   PERSONAL AXIS CALIBRATION (HiTL)  ─►  PERSONALIZATION (dual baseline, salience⊕HiTL-importance, circadian)
   re-centre on this user                  re-reference vs the user's usual
       │
       ▼
   RELAPSE (within-user paired comparison, personal stable band, signature-weighted drift)
       │   + ROBUST TREND (Theil–Sen / Mann–Kendall / CUSUM) over the risk series
       ▼
   LONGITUDINAL STATE (88% cap, consent-gated, non-diagnostic)  ─►  INTERVENTION (V-A + UCB bandit)  ─►  SAFETY screen
       │
       ▼
   UserFacingRead  ─►  HiTL feedback prompt  ─►  native-hum corpus + personal calibration  ─►  on-device retrain → promote
```

**Entry points** (`@hum-ai/orchestrator`):
- `orchestrateHumRead({ features, consent, modelVersion, now, history?, learnedAffectPrior?, axisPriors?, metaLearner? }) → OrchestratedRead`
- `orchestrateHumAudio({ audio, … })` — extracts features on-device, drops the buffer, then the above.
- `runHumCycle(input) → HumCycleResult` (`apps/web/src/app/cycle.ts`) — the per-hum loop: capture-gate
  → read → learn (`ingestHum`) → build sync payload; carries `axisPriors`, `featureImportance`, `metaLearner`.

**`OrchestratedRead` = `{ userFacing, recommendationView, internal }`.** `userFacing` = safety-screened
copy + qualitative confidence + the `innerState` sentence + a suggestion + intervention-of-the-day;
`recommendationView` = sanitized abstracted bands (no labels); `internal` = full inference, two-head,
relapse, longitudinal, dual baseline, quality, domain, personalization, model provenance, the `axis`
read (with per-axis `oodDistance`), `affectHint`, and `features` (derived only). Raw audio never
appears in any returned object.

---

## 3. Layer specifications

### 3.1 Preprocessing — `@hum-ai/audio-features`, `quality-gate`, `signal-lab/capture-gate`

Deterministic, dependency-free DSP (`HumDspExtractor` / `computeFeatures`):
normalize → 80 ms RMS frames → energy / **adaptive noise floor** (quietest sliding window) / SNR proxy
→ **autocorrelation F0 with parabolic sub-bin interpolation + alias/edge guards** (`dsp/pitch.ts`,
decimated to ~8 kHz) → local radix-2 FFT spectral features → voicing/continuity/expression proxies.

- **`AcousticFeatures`** — the derived contract: energy (rms/peak/active-ratio/SNR/ZCR), spectral
  (centroid/bandwidth/rolloff/flatness/flux), pitch (mean/variance/range/stability/jitter/drift/
  coverage — all nullable when unvoiced), continuity (breaks/pauses/voicing-coverage), expression
  (clarity/breathiness/shimmer/amplitude-stability/musicality/controlled-expression/vibrato-regularity/
  residual-instability). **Honest DSP — not a trained or clinical model.**
- **Capture gate (Stage ①, `assessCapture`)** — rejects non-hums (noise/silence/speech/sigh/whistle/
  too-quiet) *before any affect is computed*; a rejected capture never advances the baseline or syncs.
- **Quality gate (`evaluateQuality`)** — `clean | borderline | rejected` + a capture-quality confidence
  cap + baseline eligibility; only eligible hums shape the model.
- **Feature schema (`signal-lab/feature-schema.ts`)** — the **58-column** model vector:
  **32 numeric + 2 boolean** (`isSilent`, `isTooFaint`) **+ 12 nullable × (value, `<name>__present`
  mask)**. Null = not-computable emits `0` value + `0` mask (never a false 0). `featureVectorNames()`
  is the model's serialized feature contract.

### 3.2 Pretrained models & priors — `signal-lab`, `native-corpus`, `fusion-engine`

**The prior stack (per axis), resolved in `axis-read.ts` `resolveAxis`:**
- Start from the **transparent acoustic value** (the backbone, always present).
- A trained prior nudges it only when **in-domain**; weight = `|lean| × balancedAccuracy × cap × fade`:
  - `cap` = **0.75** for a native prior (`NATIVE_AXIS_NUDGE_CAP`), **0.5** for far-domain
    (`FAR_DOMAIN_AXIS_NUDGE_CAP`) — the native, on-domain model leads more; both bounded < 1.
  - `fade` = `exp(−1.5 · ood)` (`OOD_FADE_LAMBDA`) — a single, evidence-proportional OOD decay
    (the prior's `(1−ood)` self-confidence is kept out of the weight to avoid double-discounting).
- **Signed confidence adjustment**: an in-domain prior that *agrees* with the backbone lifts confidence;
  one that strongly *disagrees* lowers it (conflicting evidence ⇒ a more ambiguous read).
- `AxisResolution.oodDistance` surfaces the continuous OOD distance for transparency.

**Far-domain priors** — RAVDESS acted-speech LogReg/RF JSON models served browser-side via the pure
`axis-prior.ts` / `runtime-bridge.ts`; each computes an OOD distance (`meanAbsZ`) and **abstains** on
hums (the common case); far-domain penalty cap **0.45** (`AFFECT_PRIOR_FAR_DOMAIN_CAP`). `arousal_binary`
cleared the offline ~80% gate (≈83%); the 6-class + valence are below-gate. Honest gate status rides in
`model_manifest.json`.

**Hum-native models** — the HiTL-trained axis models (`native-corpus/train.ts`), standardizer fit on
hums ⇒ in-domain on hums, **no far-domain penalty**, `nativeDomain: true`.

**Offline training** — `signal-lab/model.ts` `trainLogReg`: deterministic, dependency-free multinomial
logistic regression (zero-init full-batch GD, inverse-frequency class weights). Pure TS → Node *and*
browser. The rigorous offline gate (`cohort-eval.ts` `promotionGate`): balanced-acc ≥ 0.80 ∧ permutation
p < 0.01 ∧ ECE ≤ 0.15.

**On-device native promotion gate** (`native-corpus/train.ts` `evaluateAxisPromotion`) — mirrors the
offline rigor with within-user, small-n thresholds. A model is promoted **only** when ALL hold:
- ≥ **24** clear labelled hums (`NATIVE_MIN_EXAMPLES`), ≥ **8** per pole (`NATIVE_MIN_PER_CLASS`);
- held-out (5-fold) balanced accuracy ≥ **0.60** (`NATIVE_ABS_FLOOR`) AND beats the acoustic backbone
  by ≥ **0.03** (`NATIVE_PROMOTE_MARGIN`);
- **ECE ≤ 0.20** (`NATIVE_ECE_CAP`) on the held-out predictions;
- recent **calibration trend is not "worsening"** (regression guard);
- **label-permutation p < 0.05** (`NATIVE_MAX_P_VALUE`; **24 permutations** so the minimum achievable
  p = 1/25 = 0.04 can clear it; observed + null use matched 120-iteration fits on a ≤250-row subsample).
- A **bootstrap 95% CI** (`bootstrapAccuracyCI`, 200 resamples) accompanies the accuracy.

The expensive permutation only runs to *confirm* a would-be promotion. Per-retrain training is bounded
to the most recent **600** rows (`NATIVE_TRAIN_MAX_ROWS`) for responsiveness. `pValue`/`ece`/`accuracyCI95`
ride on `AxisPromotion` + the manifest.

### 3.3 Diagnosis / affect read — `orchestrator/axis-read.ts`, `fusion-engine`, `expert-ser`, `affect-model-contracts`

**The dimensional read leads** (ADR-0010). `acousticAffectAxes` maps **13 on-domain DSP features** to
valence/arousal (transparent, deterministic, bounded [-1,1]):
- *Arousal* = `0.30·energy + 0.22·activeRatio + 0.16·brightness + 0.14·pitchHeight + 0.10·pitchRange + 0.08·spectralFlux`.
- *Valence* = `0.24·clarity + 0.18·smoothness + 0.18·stability + 0.16·(1−roughness) + 0.12·musicality + 0.08·controlledExpression + 0.04·vibratoRegularity`.

**Six deterministic experts** (`expert-ser`) — each reads the hum through a distinct lens
(acoustic, embedding-holistic, singing-phonation, expressive-burst, prosodic-speech, clinical-biomarker)
and emits a multi-label tilt; off-domain experts carry a low `domainMatch` (far-domain penalty, ADR-0005)
and a hard **0.35** confidence cap (untrained heuristics, never trained-model claims). A learned affect
prior drops into the speech-emotion slot when supplied.

**Late fusion** (`FusionEngine.fuse`) — reliability-weighted meta-learner over per-expert probability
vectors; calibrated + capped (strictest of the stage / capture-quality / domain / far-domain caps wins,
`combineCaps`). **The trained `LogisticRegressionMetaLearner` is wired live**: the corpus → experts →
a benign V-A→`FUSION_LABEL` quadrant → `fitMetaLearner` → 5-fold CV vs the `StubWeightedMetaLearner` →
**promoted only when it beats the stub** on held-out hums (≥ 32 examples, ≥ 45% accuracy, +4% over the
stub; `fusion-train.ts`). It sharpens the **secondary** affect-state read + confidence; the dimensional
V-A read still leads from the backbone. `fuse()` falls back to the stub on any meta-learner error.

`FUSION_LABELS` = `calm_regulated, positive_activation, high_arousal_negative, low_mood, tense_anxious,
fatigued, neutral_close_to_usual` — benign states, **distinct from the clinical-risk-marker head ids**
(so `assertNoClinicalLeak` holds).

**Multi-head contract** (`affect-model-contracts`) — a dimensional core, benign affect-state heads,
clinical-risk-marker heads (gated), longitudinal heads, meta heads. `splitInference(inf, consent)`
applies the consent gate; `toRecommendationView` + `assertNoClinicalLeak` keep clinical labels out of
the recommendation engine and user copy. A secondary 6-way affect-label *hint* rides alongside.

### 3.4 Personalization — `personalization-engine`, `native-corpus`

- **Dual baseline (ADR-0007)** — a rolling short-term + an anchored long-term robust baseline
  (median/MAD/IQR per feature). z-deltas re-reference the read against the user's own usual.
- **Salience (`salience.ts`)** — per-feature informativeness × independence, **blended with HiTL per-user
  feature importance** (`personalFeatureImportance` — |Pearson r| of each feature with the user's reported
  axis over their labelled corpus, min ≥ **12** examples). The blend weight is **evidence-aware**
  (`adaptiveBlendWeight(n) = 0.4·n/(n+5)`): thin baseline ⇒ discounted; mature ⇒ full.
- **Personal axis calibration (HiTL, ADR-0011)** — an EMA offset per axis learned from the residual
  `reported − predicted` (alpha **0.25**, bounded ±**0.6**, shrunk until ≥ **4** corrections;
  `axis-calibration.ts`). Applied before the personalization re-reference. `ingestFeedback(state, correction)`.
- **Signatures** (recovery/high-risk z-delta centroids, EMA **0.15**), **UCB bandit** over intervention
  responses, **online changepoint** (regime shift), **circadian** per-time-of-day centers. The **stage
  ladder** (5/10/20 eligible hums) is *silent progressive refinement*, never a read gate (ADR-0010).

### 3.5 Longitudinal / relapse — `relapse-engine`, `orchestrator/risk.ts`

- **Within-user paired comparison** (`assessRelapse`, DVDSA-inspired) — `RelapseSample` vs personal
  references (previous stable/high-risk, 7d/30d); emits `recovery | stable | worsening | relapse_drift |
  uncertain`, defaulting to `uncertain` without references.
- **Per-user stable band** (`personalStableBand(riskScores)` = `clamp(robustStd, 0.08, 0.25)`) — a
  high-variance voice gets a wider tolerance (fewer false alarms); a steady user a tighter band. Falls
  back to the uniform 0.12 below 4 samples.
- **z-delta confidence intervals** (`shared-types/stats.ts` `zDeltaCI`, half-width = `1.645·√(1.5/n)`;
  `ciShrunkMagnitude`) — a thin baseline can't claim a small drift (the CI overlaps the band ⇒ shrunk).
- **Signature-weighted drift** — `drift = clamp01(baseDrift · (1 + 0.3·cos_highRisk − 0.15·cos_recovery))`:
  drift matching the user's learned high-risk pattern is a stronger early-warning; recovery-aligned drift
  is damped (`SIGNATURE_DRIFT_HIGH_RISK_GAIN` 0.3, `SIGNATURE_DRIFT_RECOVERY_GAIN` 0.15).
- **Robust trend** (`trend.ts`) — **Theil–Sen** slope, **Mann–Kendall** (S/τ + small-sample significance),
  **CUSUM** drift-onset (in-control-baseline target) over the recent risk series; a *significant* rising-risk
  trend reads as worsening, falling as improving; refines a weak single-comparison verdict, never overrides
  a worsening verdict.
- **Longitudinal diagnostic state** (`assessLongitudinalState`) — synthesizes trend direction, a consent-
  gated non-diagnostic risk hypothesis, a SUSTAINED relapse-drift signal (≥ **3** consecutive hums,
  `MIN_CONSECUTIVE_DRIFT_HUMS`; high-risk band **0.6**, strong drift **0.5**), a recovery signal, a
  monitoring flag + routing action, and source provenance. Confidence **hard-capped at 88%**. Internal-only;
  surfacing is consent-gated and must pass the safety screen; structurally `isDiagnostic: false`.

---

## 4. The HiTL native-hum loop (ADR-0011)

```
read ─► "does this match how you feel?"  (active-learning gated; never on an abstained read)
            confirm / adjust  (benign valence/arousal self-report only — NEVER clinical PHI)
                     │
        ┌────────────┴──────────────┐
        ▼                           ▼
  PERSONAL track (instant)     GLOBAL track (batch)
  ingestFeedback →             appendExample → NativeCorpus (derived features + label; no raw audio)
  axis calibration EMA               │
  + per-user feature importance      ▼
                         retrain (pure-TS LogReg) → significance gate (§3.2) → promote
                                     │ axis models (V-A)  +  fusion meta-learner (secondary read)
                                     ▼
                         in-domain hum-native prior + promoted meta-learner → fed back into the read
```

- **Contract** (`affect-model-contracts/feedback.ts`): `HumLabel` (benign valence/arousal), `HumSelfReport`,
  `NativeHumExample` (self-contained: derived features + prediction + label + provenance +
  `featureSchemaVersion`), `assertValidNativeHumExample` (both privacy guards).
- **Calibration / convergent validity** (`native-corpus/calibration.ts`): sign-agreement, MAE, correlation,
  **ECE** of the read vs the user's self-reports, plus a chronological **trend** (the honest "is my read
  getting better?"; `CALIBRATION_DEADZONE` 0.08, `ECE_BINS` 5, `TREND_MIN_PER_HALF` 6).
- **Corpus** (`native-corpus/corpus.ts`): bounded ring (`NATIVE_CORPUS_LIMIT` **2000**), every row
  re-validated on insert; stats (quadrant coverage, pole balance, agreement).
- **Governance**: stored on-device under `local_processing`; backed up to the user's **own** private
  Firestore space (`users/{uid}/labels`, owner-scoped) under `derived_feature_sync`. Registered as the
  `native_hum_self_report_corpus` dataset (`kind: dataset`) — allows `hum_finetune` / `personalization` /
  `affect_prior` / `evaluation`; forbids `clinical_prior` / `relapse_tracking`. **Cross-user pooling is a
  separate IRB-gated backend step, never done client-side.**

---

## 5. Confidence model, stage ladder & caps

- **User-facing confidence is qualitative** (`UserFacingConfidence`: High / Medium / Low evidence, or an
  informational "Early baseline" flag) — earned from the hum's own axis read (signal clarity + in-domain
  trained agreement), **not** gated by a hum count (ADR-0010). Bands: `EVIDENCE_BANDS = { high: 0.72,
  medium: 0.5 }`. A clear signal alone earns at most Medium; High requires in-domain trained agreement.
- **Stage caps** (silent progressive refinement; strictest-cap wins): population_prior **0.72** → early_
  calibration **0.76** → personal_baseline **0.82** (≥5 eligible) → personalized_fusion **0.88** (≥10) →
  relapse_model **0.92** (≥20). Plus the capture-quality cap, the domain-gap penalty, and the far-domain
  prior cap (0.45) — `combineCaps` takes the strictest.
- **Clinical-risk confidence hard cap: 88%** (`CLINICAL_RISK_CONFIDENCE_CAP`), regardless of maturity.
- Below the evidence floor the engine **abstains** with an explicit reason rather than guessing.

---

## 6. Privacy, consent & governance

- **Consent scopes** (`CONSENT_SCOPES`; granular, explicit, revocable, off-by-default except `local_processing`):
  | Scope | Default | Governs |
  |---|---|---|
  | `local_processing` | on | on-device extraction + baseline; no upload |
  | `derived_feature_sync` | off | derived-only summaries + the user's own labels → their private cloud |
  | `research_audio_upload` | off | **raw audio** → research storage (dedicated channel, never the derived payload) |
  | `clinical_label_capture` | off | PHQ-9 / GAD-7 / CES-DC + clinician events (PHI) |
  | `clinical_risk_surfacing` | off | whether risk markers + the longitudinal panel are shown (ADR-0006) |
- **Raw-audio firewall** — `assertNoRawAudioFields` blocks raw-audio field names/tokens at any depth.
- **Clinical-leak firewall** — `assertNoClinicalLeak` blocks clinical-risk-marker head ids / internal
  labels as keys *or string values*.
- **Dataset governance** (`@hum-ai/dataset-registry`) — 8 entries; every source carries allowed/forbidden
  uses; only `native_hum` may serve hum truth (ADR-0005).
- **QA gates** (`npm run qa`): `no-clinical-leak`, `no-camera-deps` (ADR-0009), `no-raw-confidence-copy`
  (ADR-0008), `forbidden-files` (no binaries/audio/weights/.env/credentials/datasets/PHI in git).
- **Firestore rules** — owner-scoped `users/{uid}` with `hums` and `labels` subcollections; deny all else.

---

## 7. Monorepo (20 packages + 3 apps)

npm workspaces; one concern per package; all `@hum-ai/*`, raw TypeScript (no build step), Vite-bundled from source.

| Package | Role |
|---|---|
| `shared-types` | numeric/stats primitives (incl. `zDeltaCI`, robust stats), branded ids, consent + privacy guard, `MODALITIES`, domain taxonomy, claims caps |
| `audio-features` | the real DSP extractor (`computeFeatures`), `AcousticFeatures` |
| `quality-gate` | capture-quality decision + cap + baseline eligibility |
| `domain-classifier` | hum-compatibility scoring + far-domain penalty |
| `affect-model-contracts` | affect-head registry, two-head split, clinical-leak guard, fusion labels, **HiTL feedback contract** |
| `expert-ser` / `expert-fer` / `expert-ter` | 6 deterministic audio experts (+ off-domain face/text placeholders) |
| `fusion-engine` | `StubWeightedMetaLearner` + **trained `LogisticRegressionMetaLearner` + `fitMetaLearner`**, confidence model, cap combination |
| `personalization-engine` | dual baseline, salience (+HiTL blend + evidence-aware weight), **axis calibration**, signatures, bandit, changepoint, circadian, ladder |
| `relapse-engine` | within-user paired comparison, **robust trend**, **personal stable band**, **signature-weighted drift**, longitudinal diagnostic state |
| `intervention-engine` | V-A-mapped supportive suggestion + intervention-of-the-day + music recommendation |
| `safety-language` | forbidden-phrase + confidence-copy screens, `EVIDENCE_BANDS`, user-facing labels |
| `orchestrator` | the end-to-end read path + HiTL feedback seam + axis calibration + trend + meta-learner wiring |
| `signal-lab` | offline training/eval/inference + the runtime bridge serving priors (Node; pure deep modules for the browser) |
| **`native-corpus`** | the **HiTL loop**: corpus store, calibration/ECE, active-learning, browser retrain → **significance gate** → promote, hum-native prior, per-user feature importance, **fusion meta-learner training** |
| `dataset-registry` | governance: allowed/forbidden uses; the `native_hum` entry |
| `qa-gates` / `naming-check` / `dataset-harness` | gates, naming constitution, local-only dataset CLI |

**Apps:** `web` (the deployed local-first SPA running the full spine + HiTL feedback UI + "Your hum model"
panel); `mobile` / `ops` (placeholder shells).

---

## 8. Build, test & deploy

- **Verify:** `npm run check` (typecheck + web typecheck + the Node built-in test runner over
  `packages/**/test`, **497 tests**) · `npm run qa` (4 governance gates). No third-party test framework.
- **Web build:** `npm run build:web` (Vite). The bundle is **browser-pure** — `signal-lab` is reached only
  via its pure deep modules (`model`, `feature-schema`, `axis-prior`, `expert`, `capture-gate`), never its
  `node:fs` barrel; verified at build time.
- **Deploy:** Vercel production (`vercel.json` → `build:web` → `apps/web/dist`); Firebase Firestore rules +
  indexes → default project `humai-core-prod`. (Vercel Deployment Protection / SSO is on at the project level.)

---

## 9. Decision records (ADR index)

`0000` product naming · `0001` architecture spine · `0002` domain-aware audio modeling · `0003`
personalization & relapse model · `0004` confidence & abstention · `0005` datasets as priors not truth ·
`0006` two-head affect & clinical-risk separation (88% cap, consent gate) · `0007` dual baseline
(rolling + anchored) · `0008` user-facing confidence language (qualitative-only) · `0009` voice-first,
camera-later · `0010` model-led read from the first hum (no 5-hum gate) · **`0011` HiTL native-hum
retraining loop**.

---

## 10. Constants reference

| Constant | Value | Where |
|---|---|---|
| Feature vector length | **58** (32 numeric + 2 bool + 12×2 nullable) | `signal-lab/feature-schema.ts` |
| Far-domain / native axis nudge cap | **0.5** / **0.75** | `orchestrator/axis-read.ts` |
| OOD fade λ | **1.5** | `orchestrator/axis-read.ts` |
| Far-domain prior confidence cap | **0.45** | `signal-lab/runtime-bridge.ts` |
| Native gate: min examples / per-pole / floor / margin | **24 / 8 / 0.60 / 0.03** | `native-corpus/train.ts` |
| Native gate: max-p / ECE-cap / permutations / bootstrap | **0.05 / 0.20 / 24 / 200** | `native-corpus/train.ts` |
| Native train / permutation row caps | **600 / 250** | `native-corpus/train.ts` |
| Fusion: min examples / floor / margin / quadrant deadzone | **32 / 0.45 / 0.04 / 0.2** | `native-corpus/fusion-train.ts` |
| Native corpus ring limit | **2000** | `native-corpus/corpus.ts` |
| Feature-importance min examples | **12** | `native-corpus/feature-importance.ts` |
| Calibration deadzone / ECE bins / trend min-per-half | **0.08 / 5 / 6** | `native-corpus/calibration.ts` |
| Axis calibration: alpha / max offset / min-confident | **0.25 / 0.6 / 4** | `personalization-engine/axis-calibration.ts` |
| Signature EMA alpha | **0.15** | `personalization-engine/signatures.ts` |
| Stable band min / max | **0.08 / 0.25** | `relapse-engine/relapse.ts` |
| Signature drift gains (high-risk / recovery) | **0.3 / 0.15** | `relapse-engine/relapse.ts` |
| Min consecutive drift / high-risk band / strong drift | **3 / 0.6 / 0.5** | `relapse-engine/longitudinal.ts` |
| Evidence bands (high / medium) | **0.72 / 0.5** | `safety-language/confidence-language.ts` |
| Stage caps | **0.72 / 0.76 / 0.82 / 0.88 / 0.92** | `personalization-engine/ladder.ts` |
| Clinical-risk confidence hard cap | **0.88** | `shared-types/claims.ts` |
| Early-baseline hums | **5** | `safety-language` |

---

## 11. Honest non-claims & roadmap

- The downstream affect/clinical-risk apparatus is carried by the **transparent acoustic backbone** plus
  penalized, abstaining priors, the growing hum-native model, and 6 deterministic heuristic experts —
  **not** validated clinical models. The trained meta-learner is a learned **re-weighting** of those
  heuristics, promoted only when it beats the stub on the user's own hums.
- **Non-clinical, not validated.** Risk **markers** and reflective signals only, never a diagnosis. The 88%
  cap, consent gates, and two-head separation are invariant.
- **Reference numbers are not Hum metrics.** Architecture-reference accuracies (TriSense MELD) and clinical
  study AUCs are priors, never presented as Hum's accuracy. No fabricated metrics anywhere.
- **Realistic near-term destination** (per [DIAGNOSTIC_ROADMAP](validation/DIAGNOSTIC_ROADMAP.md)): a Tier-3
  within-user early-warning *marker* validated for calibration + within-user agreement — after the native
  corpus, clinical labels, and external validation the HiTL loop begins to unblock.
- **Deferred (next):** Mahalanobis OOD + chi-square thresholds (need covariance storage + far-domain
  threshold retuning); the `schemaVersion` stamp + schema-v2 richer features (MFCC/HNR/formants — a
  coordinated migration); temperature-scaled probability calibration; an honest bandit reward signal from
  HiTL; a counterfactual "is personalization helping?" metric; a render-layer copy-safety test (needs jsdom).

---

*Stable Build v2 — generated 2026-06-21 at `852716a`. For the change plan see [REVAMP_PLAN.md](REVAMP_PLAN.md);
the per-layer narrative spec is [ARCHITECTURE.md](ARCHITECTURE.md); decisions are in [docs/adr/](adr/).*
