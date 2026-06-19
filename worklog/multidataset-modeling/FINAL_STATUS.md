# Multi-Dataset Modeling Pass — FINAL STATUS

**Date:** 2026-06-19 · **Branch:** cohesion/voice-core-merge
**Scope:** one focused ML pass over `@hum-ai/signal-lab` — is the foundation *genuinely*
multi-dataset, can the datasets become hum-signal features, and does any inference target
clear a minimum 80% support bar? **Zero new runtime deps.** Reproduce: `npm run signal:experiment`.

## Headline (ambitious modeling, conservative claims)

- **The primary 6-way affect target does NOT reach 80%** — 47.9% balanced accuracy
  (random forest), real signal (p=0.007) but a population prior, kept as-is.
- **One target clears the experimental 80% gate:** the contract-derived **arousal axis
  (high vs low) at 83.1% balanced accuracy**, ECE 0.032, p=0.007, on acted speech — a
  far-domain PRIOR, **not** wired into the runtime read.
- **Multi-dataset usage is real but asymmetric:** only RAVDESS is affect-labelled
  (supervised); VocalSet + VocalSound are feature-extracted for **domain/OOD only**.

## 1. Multi-dataset usage audit

| dataset | available | feature-extracted | supervised train | domain/OOD | music/interv. | metadata-only | why |
|---|---|---|---|---|---|---|---|
| ravdess | ✅ 2 zips | ✅ 2452 rows | ✅ 2068 labeled | anchor (speech) | — | — | only affect-labelled corpus + audio |
| vocalset | ✅ zip | ✅ | ❌ (no labels) | ✅ near (phonation) | — | — | unlabeled; nearest-to-hum domain |
| vocalsound | ✅ zip | ✅ | ❌ (no labels) | ✅ moderate (bursts) | — | — | unlabeled; OOD/negative guard |
| deam | annotations | ❌ | ❌ | ❌ | (planned) | ✅ | audio is a separate download |
| mtg_jamendo | metadata | ❌ | ❌ | ❌ | (planned) | ✅ | metadata only |
| crema_d | metadata/CSV | ❌ | ❌ | ❌ | — | ✅ | AudioWAV empty (LFS not pulled) |

**Before this pass extraction ran for 3 corpora but only RAVDESS was used at all** (the
others extracted features with `fusionLabel: null` and were never modelled). This pass
puts VocalSet/VocalSound to genuine use for domain/OOD.

## 2. Hum-signal conversion check (real extractor `computeFeatures`)

| dataset | decoded | decode-fail | pitch null-rate | hum-likeness (P(hum)/compat) | usable for |
|---|---|---|---|---|---|
| ravdess | 100% | 0 | ~19% | 0.13 / 0.14 (far) | state inference (prior), domain anchor |
| vocalset | 100% | 0 | ~3–4% | **0.24 / 0.42** (near) | domain/OOD calibration (most hum-like) |
| vocalsound | 100% | 0* | ~36% | 0.12 / 0.25 (moderate) | OOD / non-hum guard |

*Incidental fix:* the VocalSound zip (macOS-authored) carries a `__MACOSX/._*.wav`
AppleDouble next to **every** real file — ~21k of its 42k `.wav` entries are 212-byte
resource-fork junk. The extractor counted them as "decode failures" (a misleading ~40%)
and wasted half its sampling budget. `extract.ts` now filters AppleDouble/`__MACOSX`
before sampling and reports `junkEntriesSkipped` separately (real audio decodes 100%).
Speaker/singer groups are now parsed for all corpora (leakage-safe cross-corpus CV).

## 3. Model cohort (dependency-free, deterministic)

linear (LogReg + L2-strong) · prototype (nearest-centroid) · probabilistic (Gaussian NB)
· instance (k-NN) · tree (CART + bagged random forest) · ensemble (prob-avg). Evaluated
under actor/speaker-grouped 5-fold CV.

## 4. The 80% gate (metric + verdict)

**Metric (EXPERIMENTAL — the repo defines no numeric bar):** balanced accuracy ≥ 0.80 ∧
label-permutation p < 0.01 ∧ top-class ECE ≤ 0.15, under grouped CV. Balanced accuracy
(not raw accuracy) so a skewed class prior cannot inflate it — consistent with
`evaluate.ts` reporting majority-class accuracy as chance, and ADR-0004's calibration-first stance.

| target | best model | balanced acc | chance | ECE | perm p | tier | GATE |
|---|---|---|---|---|---|---|---|
| affect_fusion_label (6-way) | random_forest | 47.9% | 16.7% | 0.073 | 0.007 | supported | ❌ |
| **arousal_binary** | **logreg** | **83.1%** | 50.0% | 0.032 | 0.007 | supported | ✅ |
| valence_binary | random_forest | 69.4% | 50.0% | 0.032 | 0.007 | supported | ❌ |

## 5. Cross-corpus domain / OOD (the genuinely multi-dataset experiment)

- **Domain classification (speech/singing/burst)**: 98.5% all-features → **95.6% even
  after ablating rate-sensitive spectral features**. Separation survives ablation, but
  each domain == a single corpus == recording conditions → **corpus-confounded**, so it
  is **never promoted** as an inference capability.
- **Hum-likeness probe (no training)**: ran the repo's own `HeuristicDomainClassifier` +
  `HumDomainAdapter` over each corpus. Hum-compatibility **VocalSet 0.42 > VocalSound 0.25
  > RAVDESS 0.14** — matches the registry's near > moderate > far ordering, validating the
  domain guard against three labelled corpora. The affect prior also reads VocalSet as
  least OOD (most hum-like), as expected.

## 6. Inference impact

- The 6-way affect prior did **not** pass → **kept as the population prior**, unchanged.
- `model_manifest.json` records every gate outcome; `model.arousal_binary.json` persists
  the one promoted (auxiliary, far-domain) model. **Neither changes the runtime affect/
  intervention read.**
- `inferFromHum` now carries an honest `promotion` block + warnings: "affect target did
  NOT pass the 80% gate (47.9%) — population prior only; coarse arousal axis passed as a
  far-domain prior, not driving this read".
- **Intervention mapping is UNCHANGED** — interventions stay driven by the capped fusion
  path; a far-domain arousal prior is not allowed to steer them (conservative).

## 7. Tests & gates

- **+ ~29 new tests** (targets, cohort, grouped-CV no-leakage, gate honesty, ANOVA-F,
  AppleDouble-junk handling, speaker grouping, manifest honesty, inference promotion,
  domain ablation). `npm test` → **281 pass / 0 fail**. `npm run typecheck` clean.
  `npm run qa` 4/4 green.
- Privacy: `git ls-files data/` empty; all artifacts (incl. weights + the new manifest)
  git-ignored; no raw audio / weights / credentials tracked.

## What remains weak / blocked / unproven

- **Unproven for real hums:** everything — every number is acted-speech / singing / burst
  PRIOR. No native-hum corpus exists; nothing here is hum truth or clinical (ADR-0005).
- **No multi-corpus *affect* training is possible** — only RAVDESS has affect labels.
- **Blocked data:** CREMA-D audio (LFS), DEAM/MTG-Jamendo audio (separate downloads),
  clinical/access-pending corpora (no local bytes).
- **Weakest axis:** valence (69.4%); **strongest:** arousal (83.1%, energy/pitch-driven).
