# Hum AI — All-Layers Revamp Plan

**Status date:** 2026-06-21 · **Scope:** every layer, capture → diagnosis → personalization → longitudinal · **Posture:** non-clinical, honest, local-first (unchanged)

This is the decisive plan for the final all-layers pass. It is grounded in a parallel
per-layer audit of the live tree and verified against it. It separates **what shipped
this pass** (real, tested, no shipped-artifact break) from the **ranked roadmap** (next,
honestly gated on data / training / IRB). It builds on the human-in-the-loop native-hum
loop ([ADR-0011](adr/0011-hitl-native-hum-retraining-loop.md)).

---

## 0. The thesis

Hum AI's bones are good and honest: a **deterministic acoustic backbone** that always
produces a valence/arousal read from the first hum; **far-domain priors that abstain**
when out-of-domain (the common case on a real hum); **confidence that is earned and
hard-capped**; and the **HiTL native-corpus loop** that grows an in-domain model from
the user's own confirmations.

What it was not *yet* is the best-in-class tool, because the layers **above** the backbone
were thin: priors blended naively, the read's affect heads were mostly neutral stubs, the
trend was a single-comparison verdict, personalization learned nothing the read used, and
confidence was hand-tuned and never measured.

**The revamp keeps the backbone as the floor and makes everything above it real,
learned-from-the-user, and audited — in pure TypeScript, with no break to the shipped
RAVDESS priors and no schema change.** The richer-feature work (MFCC/HNR/formants), real
SSL embeddings, the mel-CNN browser port, and clinical calibration are the roadmap the
HiTL corpus *unblocks* — honestly labelled as gated on data we do not have yet.

> **Invariant across every change:** the backbone always wins as the floor (no model is
> ever *required* for a read); confidence stays earned + qualitative-only (new signals may
> *lower* it, never raise a ceiling); `assertNoClinicalLeak` + `assertNoRawAudioFields`
> pass on every minted example, sync, and render; two-head separation + consent gates intact.

---

## 1. Shipped this pass

Concrete, tested changes — one or more per layer — all green under `npm run check`
(484 tests), `npm run qa` (4 gates), and `npm run build:web`.

| Layer | Change | Files | Why it's better |
|---|---|---|---|
| **Pretrained / priors** | **Implemented the trained `LogisticRegressionMetaLearner`** (`combine()` was a throwing stub): a real softmax forward pass over the fixed-layout concatenation of expert probability vectors, plus `fitMetaLearner` (deterministic multinomial-LogReg, inverse-frequency class weights). The deterministic `StubWeightedMetaLearner` stays the live default — the trained model is now a tested drop-in. | `fusion-engine/src/meta-learner.ts`, `fusion-engine/test/meta-learner.test.ts` | The fusion meta-learner is real and trainable instead of throwing; ready to wire on the native corpus. |
| **Diagnosis / affect** | **Replaced the 4 neutral SER-expert stubs** (`HumEmbedding`, `VocalBurstExpression`, `SpeechEmotion`, `SpeechClinical` all returned `{neutral: 1}`) with **principled deterministic multi-label tilts** from DSP features — each through its own lens (embedding/holistic, expressive-burst, prosodic-speech, clinical-biomarker), finite-guarded, keeping the low `domainMatch` so the ADR-0005 far-domain penalty + 0.35 confidence cap stand. | `expert-ser/src/experts.ts`, `base.ts`, `test/experts.test.ts` | The fused secondary read is carried by 6 real experts instead of 1 + near-uniform noise — the affect-label hint actually reflects the hum. |
| **Pretrained / priors** | A native, in-domain prior earns a **larger nudge cap** (`NATIVE_AXIS_NUDGE_CAP = 0.75`) than a far-domain one (`0.5`); the read stops leaning on the penalized far-domain prior once the user's own model is promoted. | `orchestrator/src/axis-read.ts`, `native-corpus/src/prior.ts` | The user's on-domain hum model actually *leads* the refinement, instead of being capped like an acted-speech prior. |
| **Pretrained / priors** | **Prior-disagreement confidence penalty**: an in-domain prior that *agrees* with the acoustic backbone lifts confidence; one that strongly *disagrees* now **lowers** it (conflicting evidence ⇒ a more ambiguous read). | `orchestrator/src/axis-read.ts` | Confidence reflects evidence conflict honestly, not just agreement. |
| **Diagnosis / affect** | The transparent acoustic→valence/arousal mapping went from **7 features to 13** (arousal adds melodic pitch-range + spectral flux; valence adds musicality + controlled-expression + vibrato-regularity), still fully transparent + deterministic + non-clinical. | `orchestrator/src/axis-read.ts` | A richer, more faithful read of the hum's character — while preserving every invariant (energetic > subdued, bounded, acoustic-only confidence below the High band). |
| **Personalization** | **HiTL-driven per-user feature importance**: which derived features actually track *this user's* reported valence/arousal (`personalFeatureImportance`, `combinedFeatureImportance`), blended into the personal read's salience (`blendSalience`) and wired end-to-end (orchestrator → web cycle → web app). | `native-corpus/src/feature-importance.ts`, `personalization-engine/src/salience.ts`, `orchestrator/src/orchestrator.ts`, `apps/web/src/app/{cycle,main}.ts` | The loop now *visibly learns the user*: the read leans on the axes predictive **for them**, not just population variance. |
| **Longitudinal** | **Robust trend module**: Theil–Sen slope, Mann–Kendall significance, and CUSUM drift-onset over the recent within-user risk series, wired to refine a weak single-comparison verdict (never overrides a worsening verdict). | `relapse-engine/src/trend.ts`, `relapse-engine/src/longitudinal.ts`, `orchestrator/src/orchestrator.ts` | The trend is now data-driven over the actual series and robust to a noisy hum, with honest significance — not a single paired comparison. |
| **Cross-cutting honesty** | Centralized the evidence-band thresholds in the web render layer (import `EVIDENCE_BANDS` instead of re-hardcoding `0.72`/`0.5`). | `apps/web/src/app/render.ts` | One source of truth for the qualitative confidence cutoffs (ADR-0008). |

**Preprocessing (L2) — assessed, intentionally not churned.** The DSP is already strong:
the autocorrelation F0 tracker has **parabolic sub-bin interpolation + alias/edge guards**
(`audio-features/src/dsp/pitch.ts`), and the noise floor is already **adaptive** (quietest
sliding window). The high-value next step (MFCC/HNR/formants) is **schema-breaking** and is
roadmapped with a safe migration (§3). Forcing a churny in-place change here for marginal
gain would risk the deployed pipeline — the disciplined call is to roadmap it.

---

## 2. Roadmap — ranked, per layer

Honest tags: **[NEXT]** = pure-TS, schema-stable, no shipped-artifact break (the natural
follow-on pass); **[GATED]** = needs data / training / IRB / a schema migration.

### Layer A — Pretrained models & priors
- **[DONE] `LogisticRegressionMetaLearner.combine()` implemented** (forward pass) + `fitMetaLearner` (training). `fusion-engine/src/meta-learner.ts`. *Follow-up:* wire it live — map each native-corpus example to `(expert outputs → fusion label)` and fit on ≥30 examples, then promote it over `StubWeightedMetaLearner` when it beats the stub on held-out hums.
- **[NEXT] Failed-gate 6-class affect prior is aux-only** — ensure the orchestrator treats an affect model with `affectPassedGate:false` as transparency-only (parity with the arousal aux), never a steering signal. Files: `orchestrator/src/orchestrator.ts`, `fusion-engine/src/fuse.ts`.
- **[NEXT] Mahalanobis OOD** replacing the scalar `meanAbsZ` — precompute covariance in the standardizer; `d = √((x−μ)ᵀΣ⁻¹(x−μ))`, pure TS. Files: `signal-lab/src/axis-prior.ts`, `native-corpus/src/prior.ts`.
- **[NEXT] Domain-ranked prior stacking** — a proximity×confidence blend across all available priors (backbone anchor 1.0; native 1.0; far-domain 0.45). Files: `orchestrator/src/axis-read.ts`, `shared-types/src/domain.ts`.
- **[GATED] Learned confidence calibration** (temperature/Platt + reliability diagrams + ECE). Unblocked at ≥50 confirmed hums. Files: `fusion-engine/src/confidence.ts`, `native-corpus/src/calibration.ts`.
- **[GATED] Mel-CNN browser port** (pure-TS mel filterbank → JSON op-graph; ~84% BA on hum, currently Python-only). Depends on the schema-v2 mel path. Files: `research/training/signal_neural/export_ts.py`, `audio-features/src/features.ts`.

### Layer B — Preprocessing
- **[NEXT] Silence / leading-edge trimming** before extraction (energy-gate trim; keep `silenceRatio` true-to-12s). Files: `audio-features/src/hum-extractor.ts`, `dsp/signal.ts`.
- **[NEXT] Octave-error contour correction** — harmonic-contiguity post-pass on the F0 series. Files: `audio-features/src/dsp/pitch.ts`, `hum-extractor.ts`.
- **[NEXT] YIN pitch** (CMND + first-trough + parabolic refine) behind the existing `PitchFrameResult` contract — lower octave-error rate; downstream untouched. Files: `audio-features/src/dsp/pitch.ts`. *(Care: must hold the synthetic-corpus tests.)*
- **[GATED — schema v2, BREAKS PRIORS] MFCC(12)+energy, HNR, spectral-contrast, formant proxies** (~25 new columns). Requires the §3 migration. Files: `audio-features/src/dsp/spectral.ts`, `signal-lab/src/feature-schema.ts`, all `model*.json`.
- **[GATED] Stage-3a reliability study** (test-retest ICC, device agreement). Needs real multi-device recordings; gates the confidence caps. Files: `quality-gate/src/thresholds.ts`, `docs/validation/VALIDATION_PLAN.md`.

### Layer C — Diagnosis / affect read
- **[DONE] The 4 neutral-stub SER experts now express real deterministic multi-label tilts** from DSP features (`expert-ser/src/experts.ts`), each through its own lens, finite-guarded, low-confidence-capped, far-domain-penalty preserved. *Follow-up:* swap the heuristic tilts for trained SSL embeddings behind the same contract (gated on a browser-servable embedding path).
- **[NEXT] Per-axis continuous OOD on `AxisResolution`** (expose the distance, not just the binary flag) so the nudge weight fades with distance. Files: `orchestrator/src/axis-read.ts`, `personalization-engine/src/axis-calibration.ts`.
- **[NEXT] Per-marker confidence on the clinical-risk head** (`confidenceByMarker`) so the relapse engine + consent UI can down-weight noisy markers. Files: `affect-model-contracts/src/two-head.ts`, `orchestrator/src/risk.ts`.
- **[NEXT] Adversarial axis-read test suite** (whisper, clipped, extreme-pitch, very-faint, vibrato). Files: `orchestrator/test/axis-read.adversarial.test.ts`.
- **[GATED — BREAKS FUSION CONTRACT] Expand `FUSION_LABELS` (7→~13)** so the 5 currently-unreachable clinical markers become reachable (unblocks DIAGNOSTIC_ROADMAP A4). Files: `affect-model-contracts/src/fusion-labels.ts`, `fusion-engine/src/fuse.ts`, `heads.ts`.
- **[GATED] Calibrate `RISK_SEVERITY` weights + the 0.6 band** on labelled outcomes (roadmap B2); interim: emit `{score, confidenceLow, confidenceHigh}`. Files: `orchestrator/src/risk.ts`.

### Layer D — Personalization & native-hum retraining
- **[NEXT] Wire the bandit into read-time intervention selection** — `selectByUCB` exists but `selectInterventionFromView` never calls it; once `personalizedFusionActive` and ≥3 interventions tried, UCB **re-ranks the already-safe candidate set** (safety gates remain the sole arbiter of *eligibility*). Files: `intervention-engine/src/index.ts`, `orchestrator/src/orchestrator.ts`.
- **[NEXT] Calibration-trend → promotion-hold** — if `calibrationTrend` shows the recent half degrading, `train.ts` returns `decision: hold` even when margin/floor are met. Files: `native-corpus/src/{calibration,train}.ts`.
- **[NEXT] `readyForRetrain` signal + closed-loop collection** — feed `nextCollectionHint` / pole-balance back into `buildFeedbackRequest` priority; power a "Model learning… 18/24" surface. Files: `native-corpus/src/active-learning.ts`, `orchestrator/src/feedback.ts`.
- **[NEXT] Personalization-improvement metric** — read accuracy vs HiTL labels with personalization on/off, stored as a trend (closes the user-visible "teaching helps" loop). Files: `native-corpus/src/calibration.ts`, `personalization-engine/src/profile.ts`.
- **[GATED] Tune shrinkage K / EMA alphas / Page-Hinkley thresholds** on accumulated native data (grid-search; needs corpus volume).

### Layer E — Longitudinal / relapse *(trend.ts already shipped + wired)*
- **[NEXT] Personalized stable-band calibration** — a per-user MAD-derived band (floor 0.08 / ceiling 0.20) replacing the uniform 0.12. Files: `personalization-engine/src/noise-profile.ts` (new), `relapse-engine/src/relapse.ts`.
- **[NEXT] Confidence-interval bounds on z-deltas** (`zDeltaCI(current, baseline, n) → [lo, center, hi]`); a CI overlapping the band ⇒ `borderline`. Files: `shared-types/src/stats.ts`, `relapse-engine/src/relapse.ts`.
- **[NEXT] Signature-weighted drift** — boost drift magnitude when the current z-delta pattern aligns with the *learned* high-risk signature; dampen when it aligns with recovery (centroids already computed). Files: `relapse-engine/src/relapse.ts`.
- **[NEXT] CUSUM onset → early-warning** — surface `cusumDrift`'s change-index in the longitudinal state as a consent-gated, non-diagnostic monitoring hint. Files: `relapse-engine/src/longitudinal.ts`.
- **[GATED] Multi-horizon relapse forecast** (`relapseForecast`, Theil–Sen extrapolation + user-empirical distribution). Consent-gated, explicitly non-predictive; needs longitudinal volume.

### Layer F — Cross-cutting (governance, web UX, CI, deploy)
- **[NEXT] Render-layer safety test suite + `renderCopyGate`** — drive the real `render*` functions with synthetic reads at each stage; assert every text field passes `isConfidenceCopySafe` + `validateUserFacingText` and no numeric `riskHypothesis.confidence`/`driftMagnitude` appears in HTML. *The single highest-value cross-cutting fix — the only user-visible surface currently has no copy test.* (Needs a jsdom dev-dep; the test glob would extend to `apps/web`.) Files: `qa-gates/src/render-copy.ts` (new), `qa-gates/test/render.test.ts`.
- **[NEXT] CI step for `npm run qa:all`** + documented single-command verification. Files: `.github/workflows/ci.yml`, `README.md`.
- **[GATED] Post-build bundle-safety scan** (grep the built SPA for embedded percentages / clinical keywords). Files: `qa-gates/src/bundle-safety.ts`, `vercel.json`.

---

## 3. Feature-schema-v2 migration (how to add richer features without breaking shipped priors)

The 58-column layout is the RAVDESS-prior contract; the shipped `model*.json` artifacts
serialize the exact order. The safe path:

1. **Add a `schemaVersion` field first (schema-stable).** Stamp a version into
   `feature-schema.ts` and every artifact's metadata, and make `runtime-bridge.ts` /
   `axis-prior.ts` **refuse a prior whose `schemaVersion` ≠ the vectorizer's** (degrade to
   backbone). This is the only schema-touching work that can ship without retraining.
2. **v2 is additive + versioned.** New columns append after the existing 57 with their own
   `__present` masks; `toFeatureVector` emits v1 or v2 by requested version.
3. **Dual-serve.** v1 priors load against v1 vectors; v2 priors against v2 vectors; mismatch
   ⇒ backbone fallback (never a silent wrong inference).
4. **Retrain + cross-validate before promotion.** Re-fit RAVDESS priors with v2 features;
   promote v2 only if it does **not regress** v1 balanced accuracy. The native corpus needs
   no re-annotation — features are derived, so re-vectorize stored examples at v2.
5. **The backbone is the safety net.** `acousticAffectAxes` reads raw fields by *name*, not
   vector position, so the always-available read survives any schema bump untouched.

---

## 4. Sequencing the next pass

1. **Make the read real** — deterministic SER experts → `meta-learner.combine()` → failed-gate aux-only. (Layer A/C, no schema change.)
2. **Priors & OOD** — Mahalanobis OOD → domain-ranked stacking → continuous OOD on `AxisResolution`. (Depends on 1.)
3. **Preprocessing robustness** — silence trim → octave correction → adaptive-floor polish → YIN (behind the contract). (Independent.)
4. **Personalization closes the loop** — bandit wiring → calibration-trend→hold → `readyForRetrain` → improvement metric.
5. **Longitudinal depth** — personalized band → z-delta CI → signature-weighted drift → CUSUM onset.
6. **Cross-cutting** — render-copy gate + CI, then the `schemaVersion` stamp that unblocks v2.

Each step keeps `npm run check` + `npm run qa` green and the backbone as the floor.
