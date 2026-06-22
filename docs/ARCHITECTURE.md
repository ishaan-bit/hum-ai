# Hum AI — Architecture & Technical Specification (latest)

**Version:** post all-layers revamp · **Date:** 2026-06-21 · **Status:** research-stage, **non-clinical, not a diagnosis, not FDA-cleared, not clinically validated**

This is the living technical spec of the whole system: the spine, every layer's
algorithms and data shapes, the human-in-the-loop native-hum loop, the governance
invariants, and the deployment. For the change plan see [REVAMP_PLAN.md](REVAMP_PLAN.md);
for the decision records see [docs/adr/](adr/).

---

## 1. What Hum AI is

A local-first, personalized, multimodal **voice-biomarker and affective-modeling
platform built around a single standardized 12-second hum**. The hum is the primary
input. Everything runs **on-device** (a Vite SPA bundles the entire spine client-side);
raw audio never leaves the device — only derived features and qualitative summaries sync,
and only with consent. Public datasets are **cold-start priors only**; as a user
accumulates eligible hums, native Hum AI data and a personal baseline progressively
dominate the model.

It surfaces **reflective, within-user signals** — a valence/arousal read, benign affect
leans, stress/recovery/worsening trends, and (consent-gated, hard-capped) relapse-risk
drift **markers** — never a diagnosis.

### Design principles (invariants)
1. **The deterministic acoustic backbone is the floor.** A hum always yields a read; no
   trained model is ever *required*. Missing/mismatched artifacts degrade to the backbone.
2. **Datasets are priors, not truth.** Only `native_hum` data is hum truth (ADR-0005).
3. **Confidence is earned, capped, and qualitative-only.** No raw percentage or probability
   ever reaches user copy (ADR-0008). New signals may *lower* confidence, never raise a ceiling.
4. **Privacy is structural.** `assertNoRawAudioFields` + `assertNoClinicalLeak` gate every
   persisted/synced/rendered object.
5. **Two-head separation + consent gating.** The clinical-risk head is withheld unless
   explicitly consented; its confidence is hard-capped at 88% (ADR-0006).

---

## 2. The spine (one hum, end to end)

```
 capture 12s  ──► audio-features ──► capture-gate (Stage ①) ──► quality-gate ──► domain-classifier
 (raw, ephemeral)   AcousticFeatures    accept / "hum again"      clean|borderline|reject   hum-compat penalty
       │                                                                                          │
       ▼                                                                                          ▼
   raw dropped                                                              expert-ser ensemble (+ learned prior)
                                                                                          │
                              ┌───────────────────────────────────────────────────────────┘
                              ▼
   axis-read  ──►  PERSONAL AXIS CALIBRATION (HiTL)  ──►  personalization (dual baseline, salience⊕HiTL-importance)
   valence+arousal     re-centre on this user                    re-reference vs the user's usual
   (acoustic backbone                                                      │
    + ranked priors)                                                       ▼
                              relapse-engine + ROBUST TREND (Theil–Sen/Mann–Kendall/CUSUM) ──► longitudinal state (88% cap, consent-gated)
                                                                           │
                                                                           ▼
                              intervention-engine ──► safety-language screen ──► UserFacingRead
                                                                           │
                                                                           ▼
                              HiTL feedback prompt ──► native-hum corpus + personal calibration ──► (on-device retrain → promote)
```

**Entry points** (`@hum-ai/orchestrator`):
- `orchestrateHumRead({ features, consent, modelVersion, now, history?, learnedAffectPrior?, axisPriors?, metaLearner? }) → OrchestratedRead`
- `orchestrateHumAudio({ audio, … })` — extracts features on-device, drops the buffer, then the above.
- `runHumCycle(input) → HumCycleResult` (`apps/web/src/app/cycle.ts`) — the app's per-hum loop: capture-gate → read → learn (`ingestHum`) → build sync payload.

**`OrchestratedRead`** = `{ userFacing, recommendationView, internal }`. `userFacing` is
safety-screened copy + qualitative confidence + the `innerState` sentence + a suggestion;
`recommendationView` is sanitized abstracted bands (no labels); `internal` carries the full
inference, two-head, relapse, longitudinal, dual baseline, quality, domain, personalization,
model provenance, the `axis` read, and `features` (derived only).

---

## 3. Layer specs

### 3.1 Preprocessing — `@hum-ai/audio-features`, `quality-gate`, `signal-lab/capture-gate`
A deterministic, dependency-free DSP pipeline (`HumDspExtractor`/`computeFeatures`):
normalize → 80 ms RMS frames → energy / **adaptive noise-floor** (quietest sliding window) / SNR
proxy → **autocorrelation F0 with parabolic sub-bin interpolation + alias/edge guards**
(`dsp/pitch.ts`, decimated to ~8 kHz) → radix-2 FFT spectral features → voicing/continuity/
expression proxies.

- **`AcousticFeatures`** — the derived contract: energy (rms/peak/active-ratio/SNR), spectral
  (centroid/bandwidth/rolloff/flatness/flux), pitch (mean/variance/range/stability/jitter/
  drift/coverage, all nullable when unvoiced), continuity (breaks/pauses/voicing-coverage),
  expression (clarity/breathiness/shimmer/amplitude-stability/musicality/controlled-expression/
  vibrato-regularity/residual-instability). **Honest DSP, not a trained or clinical model.**
- **Capture gate (Stage ①, `assessCapture`)** — rejects non-hums (noise/silence/speech/sigh/
  whistle) *before any affect is computed*; a rejected capture never advances the baseline or syncs.
- **Quality gate** — `clean | borderline | rejected` + a capture-quality confidence cap +
  baseline-eligibility; only eligible hums shape the model.
- **Feature schema (`signal-lab/feature-schema.ts`)** — the 58-column model vector:
  32 numeric + 2 boolean + 12 nullable×(value, `__present` mask). Null = not-computable emits
  `0` value + `0` mask (never a false 0). This order is serialized with every model.

### 3.2 Pretrained models & priors — `signal-lab`, `native-corpus`, `fusion-engine`
- **Far-domain priors** — RAVDESS acted-speech LogReg/RF JSON models, served browser-side via the
  pure `axis-prior.ts` / `runtime-bridge.ts`. Each computes an **OOD distance** (`meanAbsZ` vs its
  own standardizer) and **abstains** (`inDomain=false`) when the hum is outside its acted-speech
  domain — the common case. Far-domain penalty cap 0.45 (ADR-0005). Honest gate status rides in
  `model_manifest.json` (`arousal_binary` ≈83% gate-passed; 6-class + valence below-gate).
- **Hum-native model** — the HiTL-trained axis model (`native-corpus`), in-domain on hums
  (standardizer fit on hums), **no far-domain penalty**, `nativeDomain: true`. Its on-device
  promotion gate is statistically rigorous, mirroring the offline harness: held-out balanced
  accuracy must clear a floor **and** beat the acoustic backbone, with a label-**permutation
  p-value** (`p<0.05`, beyond chance), an **ECE ceiling**, a **bootstrap accuracy CI**, and a
  **calibration-trend hold** (never promote a model whose recent read accuracy is slipping).
- **The ranked axis read (`axis-read.ts` `resolveAxis`)** — start from the transparent acoustic
  value; an in-domain prior nudges it, weighted by `confidence × balancedAccuracy × cap`, where
  **`cap = 0.75` for a native prior, `0.5` for far-domain** (`NATIVE_AXIS_NUDGE_CAP` /
  `FAR_DOMAIN_AXIS_NUDGE_CAP`). A **signed confidence adjustment** lifts confidence on agreement
  and **lowers it on strong disagreement**. The acoustic backbone always remains the read's spine.
- **Training (`signal-lab/model.ts` `trainLogReg`)** — deterministic, dependency-free multinomial
  logistic regression (zero-init full-batch GD, inverse-frequency class weights). Pure TS → runs in
  Node *and* the browser. Promotion gate (`cohort-eval.ts` `promotionGate`): balanced-acc ≥ 0.80 ∧
  permutation p < 0.01 ∧ ECE ≤ 0.15 (never rounded/waived).

### 3.3 Diagnosis / affect read — `orchestrator/axis-read.ts`, `fusion-engine`, `expert-ser`, `affect-model-contracts`
- **Dimensional read leads** (ADR-0010). `acousticAffectAxes` maps **13 on-domain DSP features** to
  valence/arousal:
  - *Arousal* (activation): `0.30·energy + 0.22·activeRatio + 0.16·brightness + 0.14·pitchHeight + 0.10·pitchRange + 0.08·spectralFlux`.
  - *Valence* (pleasant/settled): `0.24·clarity + 0.18·smoothness + 0.18·stability + 0.16·(1−roughness) + 0.12·musicality + 0.08·controlledExpression + 0.04·vibratoRegularity`.
  - Transparent, deterministic, bounded [-1,1]; the same honesty class as `HumAcousticExpert` — a
    reflection of acoustic qualities, never a clinical or ground-truth label.
- **Six deterministic experts** (`expert-ser`) — each reads the hum through a distinct lens
  (acoustic, embedding-holistic, singing-phonation, expressive-burst, prosodic-speech,
  clinical-biomarker) and emits a multi-label tilt; off-domain experts carry a low `domainMatch`
  (far-domain penalty, ADR-0005) and a hard 0.35 confidence cap (untrained heuristics, never
  trained-model claims).
- **Late fusion** — a reliability-weighted meta-learner over per-expert probability vectors
  (`FusionEngine.fuse`), calibrated + capped. The strictest of the stage / capture-quality /
  domain / far-domain caps wins (`combineCaps`). The trained `LogisticRegressionMetaLearner` is
  **wired live** (`native-corpus/fusion-train.ts`): the user's confirmed hums → deterministic
  experts → a benign V-A→FUSION_LABEL quadrant → `fitMetaLearner` → 5-fold CV vs the stub →
  **promoted only when it beats the stub** on held-out hums (else the deterministic
  `StubWeightedMetaLearner`, the honest fallback; a malformed meta-learner degrades to it too).
  It sharpens the **secondary** affect-state read; the dimensional V-A read still leads from the
  acoustic backbone. The trained-prior axis nudge fades smoothly with OOD distance
  (`exp(−1.5·ood)`), and `AxisResolution.oodDistance` surfaces the continuous distance.
- **Multi-head contract** (`affect-model-contracts`) — a dimensional core, benign affect-state
  heads, clinical-risk-marker heads (gated), longitudinal heads, meta heads. `splitInference`
  applies the consent gate; `toRecommendationView` + `assertNoClinicalLeak` keep clinical labels
  out of the recommendation engine and user copy. A secondary 6-way affect-label *hint* rides
  alongside the dimensional read.

### 3.4 Personalization — `personalization-engine`, `native-corpus`
- **Dual baseline (ADR-0007)** — a rolling short-term + an anchored long-term robust baseline
  (median/MAD/IQR per feature). z-deltas re-reference the read against the user's own usual.
- **Salience (`salience.ts`)** — per-feature informativeness × independence (decorrelated coverage),
  now **blended with HiTL per-user feature importance** (`blendSalience`): which features actually
  track *this user's reported* valence/arousal (`personalFeatureImportance` — |Pearson r| of each
  feature with the reported axis over the user's labelled corpus, max-normalized). So the read leans
  on the axes predictive **for them**.
- **Personal axis calibration (HiTL, ADR-0011)** — an EMA offset per axis learned from the residual
  `reported − predicted`, re-centring the read on this person immediately (bounded ±0.6, shrunk until
  ≥4 corrections back it). `applyAxisCalibration` runs before the personalization re-reference.
- **Signatures + bandit + changepoint + circadian** — learned recovery/high-risk z-delta centroids,
  a UCB contextual bandit over intervention responses, online regime-shift detection, and
  per-time-of-day centers. The **stage ladder** (5/10/20 eligible hums) is *silent progressive
  refinement*, never a read gate (ADR-0010).

### 3.5 Longitudinal / relapse state — `relapse-engine`, `orchestrator/risk.ts`
- **Within-user paired comparison (`assessRelapse`, DVDSA-inspired)** — `RelapseSample` vs personal
  references (previous stable/high-risk, 7d/30d); emits `recovery | stable | worsening |
  relapse_drift | uncertain`, defaulting to `uncertain` without references.
- **Robust trend (`trend.ts`, new)** — **Theil–Sen** slope (median of pairwise slopes, outlier-robust),
  **Mann–Kendall** (S statistic + Kendall's τ + small-sample significance), and **CUSUM** drift-onset
  detection (early-warning change index against the in-control baseline) over the recent within-user
  risk series. A *significant* rising-risk trend reads as worsening, falling as improving; it refines
  a weak single-comparison verdict and **never overrides a worsening verdict**.
- **Per-user significance + uncertainty** — the stable band is **personalized** from the user's own
  risk-score noise (`personalStableBand`: a high-variance voice gets a wider tolerance, fewer false
  alarms); within-user deviations carry a **finite-sample confidence interval** (`zDeltaCI` +
  `ciShrunkMagnitude`: a thin baseline can't claim a small drift); and drift is **signature-weighted**
  (drift matching the user's learned high-risk pattern is a stronger early-warning; recovery-aligned
  drift is damped).
- **Longitudinal diagnostic state (`assessLongitudinalState`)** — synthesizes trend direction, a
  consent-gated non-diagnostic risk hypothesis, a SUSTAINED relapse-drift signal (≥ 3 consecutive
  hums), a recovery signal, a monitoring flag + routing action, and source provenance. Confidence is
  **hard-capped at 88%** (`CLINICAL_RISK_CONFIDENCE_CAP`). Internal-only; surfacing is consent-gated
  and must pass the safety screen; structurally `isDiagnostic: false`.

---

## 4. The human-in-the-loop native-hum loop (ADR-0011)

The mechanism that takes the product *off* the far-domain ceiling, on-device.

```
read ──► "does this match how you feel?"  (active-learning gated; never on an abstained read)
            confirm / adjust (benign valence/arousal self-report only — never clinical PHI)
                     │
        ┌────────────┴─────────────┐
        ▼                          ▼
  PERSONAL track (instant)    GLOBAL track (batch)
  ingestFeedback →            appendExample → NativeCorpus (derived features + label, no raw audio)
  axis calibration EMA              │
  + per-user feature importance     ▼
                          retrain (pure-TS trainLogReg, ≤600-row window) → CV vs acoustic backbone
                                    │  promote an axis ONLY if it beats the backbone on held-out hums
                                    ▼  (≥24 ex, ≥8/pole, ≥0.60 floor, +0.03 margin)
                          buildHumNativeAxisPrior (in-domain, no far-domain penalty) → feeds axisPriors
```

- **Contract** (`affect-model-contracts/feedback.ts`): `HumLabel` (benign valence/arousal),
  `HumSelfReport`, `NativeHumExample` (self-contained: derived features + prediction + label +
  provenance + `featureSchemaVersion`), `assertValidNativeHumExample` (both privacy guards).
- **Calibration / convergent validity** (`native-corpus/calibration.ts`): sign-agreement, MAE,
  correlation, **ECE** of the read vs the user's self-reports, plus a chronological **trend** —
  the honest, user-visible "is my read getting better?".
- **Governance**: stored on-device under `local_processing`; backed up to the user's *own* private
  Firestore space (`users/{uid}/labels`, owner-scoped) under `derived_feature_sync`. Registered as
  the `native_hum_self_report_corpus` dataset (`kind: dataset`) — allows `hum_finetune` /
  `personalization` / `affect_prior` / `evaluation`; forbids `clinical_prior` / `relapse_tracking`.
  **Cross-user pooling is a separate IRB-gated backend step, never done client-side.**

---

## 5. Privacy, consent & governance

- **Consent scopes** (granular, off-by-default except `local_processing`): `local_processing` (on),
  `derived_feature_sync` (cloud backup of derived-only summaries + the user's own labels),
  `clinical_risk_surfacing` (the consent-gated longitudinal/risk panel), `clinical_label_capture`
  (PHQ/GAD/CES-DC PHI — separate channel + IRB), `research_audio_upload` (raw audio — separate
  channel, never the derived payload).
- **Raw-audio firewall** — `assertNoRawAudioFields` blocks raw-audio field names/tokens at any depth.
- **Clinical-leak firewall** — `assertNoClinicalLeak` blocks clinical-risk-marker head ids /
  internal labels as keys *or string values*.
- **Dataset governance** — `@hum-ai/dataset-registry`: every source carries allowed/forbidden uses;
  only `native_hum` may serve hum truth.
- **QA gates** (`npm run qa`): `no-clinical-leak`, `no-camera-deps` (voice-first, ADR-0009),
  `no-raw-confidence-copy`, `forbidden-files`.

---

## 6. Monorepo map

npm workspaces; one concern per package; all `@hum-ai/*`, raw TypeScript (no build step), bundled
from source by Vite.

| Package | Role |
|---|---|
| `shared-types` | numeric/stats primitives, branded ids, consent, `MODALITIES`, domain taxonomy, privacy guard |
| `audio-features` | the real DSP extractor (`HumDspExtractor`/`computeFeatures`), `AcousticFeatures` |
| `quality-gate` | capture-quality decision + cap + baseline eligibility |
| `domain-classifier` | hum-compatibility scoring + far-domain penalty |
| `affect-model-contracts` | affect-head registry, two-head split, clinical-leak guard, **HiTL feedback contract** |
| `expert-ser` / `expert-fer` / `expert-ter` | audio expert ensemble (+ off-domain face/text stubs) |
| `fusion-engine` | reliability-weighted meta-learner, confidence model, cap combination |
| `personalization-engine` | dual baseline, salience (+HiTL blend), signatures, bandit, changepoint, circadian, **axis calibration** |
| `relapse-engine` | within-user paired comparison, **robust trend (Theil–Sen/MK/CUSUM)**, longitudinal diagnostic state |
| `intervention-engine` | V-A-mapped supportive suggestion + intervention-of-the-day |
| `safety-language` | forbidden-phrase + confidence-copy screens, `EVIDENCE_BANDS`, user-facing labels |
| `orchestrator` | the end-to-end read path + **HiTL feedback seam** + axis calibration + trend wiring |
| `signal-lab` | offline training/eval/inference + the runtime bridge serving priors |
| **`native-corpus`** | the **HiTL retraining loop**: corpus store, calibration/ECE, active-learning, browser retrain→gate→promote, per-user feature importance, hum-native prior |
| `dataset-registry` | governance: allowed/forbidden uses; the `native_hum` entry |
| `qa-gates` / `naming-check` / `dataset-harness` | gates, naming constitution, local-only dataset CLI |
| **`apps/web`** | the local-first Vite SPA running the full spine client-side + the HiTL feedback UI + "Your hum model" panel |

---

## 7. Build, test & deploy

- **Verify:** `npm run check` (typecheck + web typecheck + the Node built-in test runner over
  `packages/**/test`, 502 tests) and `npm run qa` (4 governance gates). No third-party test framework.
- **Web build:** `npm run build:web` (Vite). The bundle is browser-pure — `signal-lab` is reached only
  via its pure deep modules (`model`, `feature-schema`, `axis-prior`, `expert`, `capture-gate`), never
  its `node:fs` barrel.
- **Deploy:** Vercel production (`vercel.json` → `build:web` → `apps/web/dist`); Firebase Firestore
  rules + indexes to the default project (`humai-core-prod`), owner-scoped `users/{uid}` with `hums`
  and `labels` subcollections.

---

## 8. Honest non-claims

- The downstream affect/clinical-risk apparatus is carried by the **transparent acoustic backbone**
  plus penalized, abstaining priors and the growing hum-native model — **not** by validated clinical
  models. The SER experts are **deterministic heuristics** (not trained models); the trained
  `LogisticRegressionMetaLearner` is now **wired live** on the HiTL corpus
  (`native-corpus/fusion-train.ts`): fit on the user's own confirmed hums and promoted over the
  deterministic `StubWeightedMetaLearner` only when it beats it on held-out hums (≥32 examples,
  ≥45% accuracy, +4% margin), else the stub stays as the honest fallback (a malformed meta-learner
  degrades to it too). It is a learned **re-weighting** of those heuristics for the **secondary**
  affect-state read only — the dimensional V-A read still leads from the acoustic backbone.
- **Non-clinical, not validated.** Risk **markers** and reflective signals only, never a diagnosis.
- **Reference numbers are not Hum metrics.** Architecture-reference accuracies (TriSense MELD) and
  clinical study AUCs are priors, never presented as Hum's accuracy. No fabricated metrics anywhere.
- The realistic near-term destination (per [DIAGNOSTIC_ROADMAP](validation/DIAGNOSTIC_ROADMAP.md)) is a
  Tier-3 within-user early-warning *marker* validated for calibration + within-user agreement — after
  the native corpus, clinical labels, and external validation that the HiTL loop begins to unblock.
