# Voice Biomarker Evidence Map

**Sources:**  
- `clinical_voice_biomarker_review` — Briganti & Lechien, Journal of Voice (2025)  
- `vocal_biomarker_and_singing_protocol_support` — Rodrigo & Duñabeitia, Brain Sci. (2025)  
- `longitudinal_voice_treatment_response_source` — Kim et al., Communications Medicine (2026)  
- `ser_mental_health_review` — Jordan et al., JMIR Ment Health (2025)

---

## Feature evidence table

| Vocal feature | Associated condition/state | Strength of evidence | Source(s) | Relevance to hum | Caveats |
|--------------|--------------------------|---------------------|-----------|-----------------|---------|
| **F0 (fundamental frequency)** | MDD (reduced F0, reduced variability), stress (increased F0), BDI, PD, cognitive impairment | **STRONG** — most studied; only feature with sig. pre/post change in DVDSA (p=0.0016, Holm-Bonferroni) | Briganti 2025, Rodrigo 2025, Kim 2026, Jordan 2025 | Directly extractable from hum; pitchMean, pitchVariance map to F0-based features | Domain gap: clinical read-speech → hum. F0 in hum is sustained phonation, may behave differently from conversational speech |
| **Jitter** (pitch perturbation) | MDD (elevated), stress, AD, PD | **STRONG** — consistently elevated in depressed vs controls across 6/12 studies | Briganti 2025, Rodrigo 2025 | Maps directly to legacy `jitter` (SD of adjacent pitch diffs) | Jitter and pitch are more stable across microphone types than shimmer/HNR (Rodrigo 2025) |
| **Shimmer** (amplitude perturbation) | MDD (elevated), BDI, PD, stress | **MODERATE** — 6/12 studies, results consistent but CI wide; confound with PD | Briganti 2025, Rodrigo 2025 | Maps to `shimmerProxy` in legacy feature set | Shimmer drifts with microphone type and room acoustics (Rodrigo 2025 ref [86-88]); when PD controlled for, AD shimmer association decreases |
| **HNR (Harmonic-to-Noise Ratio)** | MDD, stress, PD | **MODERATE** — 3/12 studies; decreased harmonicity in depressed patterns | Briganti 2025, Rodrigo 2025 | Maps to `hnrProxy = pitchCoverage * (1 - clamp(avgPitchDiff/18, 0, 1))` | HNR proxy is an approximation; true HNR requires glottal analysis. HNR also drifts with microphone |
| **Speech rate** | MDD (reduced), BDI, AD, PD, dementia, stress, cognitive impairment | **STRONG** — consistently decreased in depressed individuals; among most studied | Briganti 2025, Rodrigo 2025, Jordan 2025 | Partially captured by `noteChangeRate`, `activeFrameRatio`. Hum is not speech — melodic note rate is closest analog | Hum speech rate analog is unclear; humming rate ≠ speech rate |
| **Pause duration** | MDD (longer pauses), schizophrenia FTD (longer utterance-initial pauses), dementia | **MODERATE** — 3/12 studies for HNR/pause; significant in longitudinal depression tracking | Briganti 2025, Rodrigo 2025, Jordan 2025 | Maps to `avgPauseLength`, `pauseCount`, `breakCount` in legacy | Pauses in a hum are breath breaks, different from conversational turn-taking pauses |
| **MFCC (Mel-Frequency Cepstral Coefficients)** | MDD, schizophrenia, stress | **MODERATE** — 5/12 studies; MFCCs capture spectral shape related to vocal tract resonances | Briganti 2025, Rodrigo 2025 | Spectral features (centroid, bandwidth, rolloff, flatness, flux) are Hum's spectral approximation to MFCCs | Full MFCC set not implemented in legacy Hum; spectral features cover similar information |
| **Spectral tilt / slope** | MDD, suicide risk (gender-specific) | **MODERATE** — used in prediction models; Gerczuk 2024 found spectral slope 0-500Hz predictive of suicide risk with gender diff | Briganti 2025, Jordan 2025 | `spectralFlux`, `spectralFlatness`, `spectralRolloff` partially cover this | Hum spectral features are simplified; not identical to spectral tilt |
| **Voice intensity / energy** | Suicide ideation (lower energy, flatter contours), MDD, stress | **MODERATE** — lower energy variability and flatter contours in suicidal speech (Belouali 2021); lower vocal intensity in MDD | Jordan 2025, Briganti 2025 | Maps to `rmsEnergy`, `inputRms`, `meanRms`, `activeFrameRatio` | Context-dependent; RMS energy in hum may reflect effort or technique rather than emotional state |
| **Zero crossing rate** | MDD, PD | **LOW-MODERATE** — ZCR shows p=0.045 between pre/post treatment (Kim 2026), but corrected p=0.068 (NS after Holm-Bonferroni) | Kim 2026 | `zeroCrossingRate` present in legacy feature set | Not consistently significant after multiple-comparison correction |
| **Formants (F1, F2)** | Stress, cognitive impairment | **LOW-MODERATE** — studied less in MDD; more studied in neurodegenerative | Rodrigo 2025, Briganti 2025 | Not extracted in legacy Hum (pitch-based not formant-based) | Hum doesn't involve vowel articulation — formants less relevant to humming |
| **Spectral centroid** | Stress (Rodrigo 2025), related to "brightness" | **LOW** — included in feature sets but limited independent evidence | Rodrigo 2025 | Maps to `spectralCentroid` / `brightness` dimension | Weak independent evidence; used as composite feature |
| **Spectral bandwidth** | PD | **LOW** — PD-specific, limited MDD evidence | Rodrigo 2025 | `spectralBandwidth` present | Limited relevance to hum for MDD |
| **Vibrato / glide** | Not in clinical literature — Hum-specific construct | **UNKNOWN** — no published evidence for hum vibrato as biomarker | hum_spec only | `vibratoScore`, `glideScore`, `tremorProxy` are Hum innovations | Hum-specific features; need original validation |
| **Musicality score** | Not in clinical literature — Hum-specific construct | **UNKNOWN** — composite measure not validated clinically | hum_spec only | `musicalityScore` composite | Hum-specific; high musicalityConflict reduces confidence (per spec) |
| **Controlled expression score** | Not in clinical literature — Hum-specific construct | **UNKNOWN** | hum_spec only | Proxies intentional control | Hum-specific innovation |

---

## Summary: Evidence tiers for Hum features

| Tier | Features | Clinical backing |
|------|----------|-----------------|
| **Tier 1 — Well-established** | F0 / pitchMean+pitchVariance, jitter, shimmer, pause duration, speech rate analogs | Consistent across multiple clinical studies |
| **Tier 2 — Moderate evidence** | HNR proxy, MFCC-related spectral features, energy/RMS, ZCR (uncorrected) | Several studies, heterogeneous |
| **Tier 3 — Emerging / weak** | Spectral centroid, spectral bandwidth, spectral tilt proxies | Limited or indirect evidence |
| **Tier 4 — Hum-specific / unvalidated** | vibratoScore, glideScore, musicalityScore, controlledExpressionScore, tremorProxy, residualInstabilityScore | No external clinical evidence; require original validation |

---

## Important caveats for all features

1. **Domain gap:** All clinical evidence comes from speech (read-aloud, conversational, clinical interview, Stroop task). Hum is sustained phonation — a distinct vocal act. Evidence is a prior, not direct proof.
2. **Instrument bias:** 6/12 depression studies (Briganti 2025) had high risk of methodological bias.
3. **Device variability:** Shimmer, HNR, and spectral slope are less stable across microphone types than pitch and jitter (Rodrigo 2025, refs [86-88]).
4. **Individual models outperform population models:** Briganti 2025 — "longitudinal studies demonstrated … individual-specific models showing stronger predictive correlations compared with population-level approaches." This validates Hum's within-user personalization posture.
5. **Only F0 survived multiple-comparison correction** in the DVDSA study (Kim 2026) — all other features' significance disappeared under Holm-Bonferroni. Deep learning models (WavLM) outperformed feature-based ML despite this, suggesting complex non-linear patterns matter more than individual features.
