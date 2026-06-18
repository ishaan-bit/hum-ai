# Hum Domain-Aware Audio Architecture

The audio stream is Hum's primary stream. Its central premise: **a hum is its own acoustic domain** — not ordinary speech, not a full music track, and not necessarily singing — so the public corpora used for cold start are **priors, not truth**. This document specifies the domain-aware audio path: domain classification, the conceptual expert ensemble and its hum-proximity ordering, the adapter that down-weights off-domain priors, the derived feature pipeline, and the quality gate. It is the implementation companion to [ADR-0002 (domain-aware audio modeling)](../adr/0002-domain-aware-audio-modeling.md) and [ADR-0005 (public datasets as priors, not truth)](../adr/0005-public-datasets-as-priors-not-truth.md).

Hum is non-clinical and not clinically validated. Nothing in this stream produces a diagnosis; all numbers below are architecture constants, never accuracy claims.

## Why a hum is not speech, music, or singing — and why datasets are not interchangeable

A standardized 12-second hum is **sustained, well-voiced, narrow-pitch-range, low-melodic-movement phonation** with the mouth closed. That acoustic gesture differs structurally from the corpora used to seed the model:

- **Clinical / acted / conversational speech** carries phonemic articulation, high zero-crossing and spectral flux, and frequent pauses. Voice→depression evidence here is real but bounded — AUC 0.71–0.93, accuracy 78–96.5%, yet 6/12 reviewed studies carried high methodological-bias risk and generalizability is unproven [clinical_voice_biomarker_review]. Treated as direct hum truth this would be doubly wrong: wrong domain and overstated certainty.
- **Music tracks** are broadband, instrument-rich, and weakly voiced; music-emotion evidence supports *intervention*, never user-state inference [intervention_support_source].
- **Singing / simple sustained melodic structures** is the closest public bridge: its acoustic features are language-independent and highly transferable, which is the scientific basis for the hum protocol itself [vocal_biomarker_and_singing_protocol_support]. But singing still adds melodic range and lyric articulation a hum lacks.

Because SER in mental health spans heterogeneous architectures, datasets, and pathologies — and the dimensional valence–arousal framing is under-explored relative to categorical labels [ser_mental_health_review] — a single classifier over pooled corpora would silently mix domains. Hum instead tags every dataset with an `AudioDomain` (`@hum-ai/shared-types`: `AUDIO_DOMAINS` = `native_hum`, `singing_or_sustained_phonation`, `vocal_burst_or_nonverbal_expression`, `clinical_speech`, `acted_speech_emotion`, `multimodal_conversation`, `music_emotion`, `unknown`) and a `DomainGap` to hum, so off-domain knowledge is admitted only as a penalized prior. See [Dataset Registry & Governance](../../packages/dataset-registry/).

## The eight conceptual audio components and hum-domain proximity

Following [trisense_architecture]'s late-fusion, expert-per-lens design, the SER stream is **not one model** but a set of conceptual experts plus two domain-reasoning components. Each affect expert carries a `defaultDomainMatch` (`@hum-ai/expert-ser` `StubAudioExpert`) encoding how on-domain it is for a *hum*; fusion uses it to down-weight off-domain opinion. v1 experts are honest deterministic stubs capped at `maxSelfConfidence = 0.35`; real Wav2Vec2/WavLM-style models slot in behind the same `AffectExpert` contract.

| Component | `expertId` / role | `defaultDomainMatch` | Provenance bridge |
| --- | --- | --- | --- |
| `HumAcousticExpert` | `expert-ser:hum-acoustic` — interpretable, spec-feature tilt | **0.90** | native hum [hum_spec] |
| `HumEmbeddingExpert` | `expert-ser:hum-embedding` — SSL hum embedding (placeholder) | **0.85** | native hum |
| `SingingPhonationExpert` | `expert-ser:singing-phonation` — sung/sustained-phonation prior | **0.70** | singing bridge [vocal_biomarker_and_singing_protocol_support] |
| `VocalBurstExpressionExpert` | `expert-ser:vocal-burst` — nonverbal expression bridge | **0.55** | vocal-burst expression |
| `SpeechEmotionExpert` | `expert-ser:speech-emotion` — Wav2Vec2-style SER prior | **0.40** | acted/conversational speech [ser_mental_health_review] |
| `SpeechClinicalExpert` | `expert-ser:speech-clinical` — clinical voice-biomarker prior | **0.35** | clinical speech [clinical_voice_biomarker_review] |
| `DomainClassifier` | `HeuristicDomainClassifier` — predicts the runtime `DomainClass` | n/a (gatekeeper) | — |
| `HumDomainAdapter` | `adaptPrior` / `scoreCapture` — converts gap → confidence penalty | n/a (gatekeeper) | — |

`defaultAudioExperts()` returns the six affect experts ordered by descending proximity — hum-native first, the safety-sensitive clinical prior last. The clinical expert emits risk-leaning labels (`low_mood`, `fatigued`, `tense_anxious`) yet is the **most off-domain and most gated**: low domain match plus downstream risk-marker governance ensure it can never assert diagnosis.

## DomainClassifier: classes and heuristics

`HeuristicDomainClassifier` (`@hum-ai/domain-classifier`) answers "what am I actually hearing?" before any affect head is trusted. It scores the eight `DOMAIN_CLASSES` — `speech`, `singing`, `hum`, `vocal_burst`, `music`, `silence`, `invalid`, `noisy_unknown` — then softmax-normalizes, returning a `DomainClassification { predicted, probabilities, confidence }`. The v1 model is transparent and rule-based; a trained classifier later slots behind the same `DomainClassifier` interface.

Heuristics derive directly from `hum_spec` feature meanings:

- **Short-circuits:** `isSilent || meanRms <= 0.006` → `silence` (conf 0.9); `durationSec < 1 || NaN(rmsEnergy)` → `invalid` (conf 0.8).
- **hum** = voiced (`pitchCoverage > 0.35`) + narrow range (`pitchRangeSemitones < 5`) + `smoothnessScore > 0.5` + low `musicalityScore` + high `voicingContinuityCoverage`.
- **singing** = voiced + high `musicalityScore` + wider pitch range.
- **speech** = high `zeroCrossingRate` / `spectralFlux` + more pauses (`pauseCount`).
- **music** = high flux + wide `spectralBandwidthHz` + low voicing.
- **vocal_burst** = short (`durationSec < 3`) + low sustained voicing + high `peakAmplitude`.
- **noisy_unknown** = poor-SNR catch-all (`signalToNoiseProxy <= 3`) + `breathinessProxy`.

Final `confidence` is the top probability tempered by SNR (×0.7 when noisy), so a confidently-classified clean hum is trusted far more than an ambiguous one.

## HumDomainAdapter: domain match and confidence penalty

`HumDomainAdapter` is where "datasets are priors, not truth" becomes arithmetic. It returns a `DomainAdaptation { domainMatch, confidencePenalty, gap, rationale }` — `domainMatch = 1` means perfectly hum-compatible, `confidencePenalty` is multiplicative with `1 = no penalty`. Domain mismatch MUST reduce confidence.

**`adaptPrior(sourceDomain)`** — penalizes a prior by where it was *learned*. It maps the dataset's `AudioDomain` through `DEFAULT_DOMAIN_GAP` → `DomainGap`, then `domainGapPenalty()`:

| `DomainGap` | `DOMAIN_GAP_PENALTY` | Example source domain |
| --- | --- | --- |
| `none` | 1.00 | `native_hum` |
| `near` | 0.90 | `singing_or_sustained_phonation` |
| `moderate` | 0.70 | `vocal_burst_or_nonverbal_expression` |
| `far` | 0.45 | `clinical_speech`, `acted_speech_emotion`, `music_emotion`, `multimodal_conversation` |
| `unknown` | 0.40 | `unknown` (worse than `far` — an unlabelled gap cannot be reasoned about) |

So a clinical-speech prior [clinical_voice_biomarker_review] enters fusion at ×0.45 confidence; a music-emotion prior is both `far` and diagnosis-prohibited [intervention_support_source].

**`scoreCapture(classification)`** — penalizes by what was actually *heard*, via `HUM_COMPATIBILITY` per `DomainClass`: `hum 1.0`, `singing 0.85`, `vocal_burst 0.6`, `speech 0.4`, `noisy_unknown 0.25`, `music 0.2`, `silence/invalid 0.0`. Compatibility is weighted by classifier confidence (`domainMatch = compatibility × (0.5 + 0.5·conf)`), then `confidencePenalty = 0.25 + 0.75·domainMatch`. An unsure "hum" is therefore trusted less than a confident one, and a "speech" capture is heavily discounted even if affect experts fire.

## Feature pipeline and quality gate

The only representation that may be stored or synced is the **derived** `AcousticFeatures` (`@hum-ai/audio-features`), distilled from the ~80-field `hum_spec` dictionary. Raw audio is never represented — no buffers, no blobs — enforced by the `@hum-ai/shared-types` privacy guard (`FORBIDDEN_RAW_AUDIO_FIELDS`, `assertNoRawAudioFields`) [hum_spec]. Feature groups:

- **Energy / RMS:** `durationSec`, `meanRms`, `rmsEnergy`, `peakAmplitude`, `activeFrameRatio`, `quietFrameRatio`, `clippedFrameRatio`, `silenceRatio`, `noiseFloorRms`, `signalToNoiseProxy`, `zeroCrossingRate`.
- **Pitch / melodic** (nullable when unvoiced): `pitchMeanHz`, `pitchRangeSemitones`, `pitchStability`, `jitter`, `pitchDrift`, `pitchCoverage`.
- **Spectral:** `spectralCentroidHz`, `spectralBandwidthHz`, `spectralRolloffHz`, `spectralFlatness`, `spectralFlux`.
- **Continuity / phrasing:** `breakCount`, `pauseCount`, `avgPauseLengthSec`, `microBreakRatio`, `voicingContinuityCoverage`.
- **Expression / stability:** `clarityScore`, `breathinessProxy`, `shimmerProxy`, `smoothnessScore`, `musicalityScore`, `residualInstabilityScore`, `vibratoRegularity`.

The **quality gate** (`@hum-ai/quality-gate` `evaluateQuality`) reads the minimal `CaptureMetrics` and returns a `QualityResult { decision, captureQuality, captureQualityScore, confidenceCap, baselineEligible, reasons }`. Thresholds come from `HUM_THRESHOLDS` (`hum_spec` §7–8): target 12 s / min 8 s, `maxClippedFrameRatio 0.08`, `maxSilenceRatio 0.72`, `minPitchCoverage 0.35`, `minSnrProxy 2.5`, `minActiveFrameRatio 0.22`. Decisions and tiers:

| `QualityDecision` | `CaptureQuality` | `CAPTURE_QUALITY_CONFIDENCE_CAP` | `baselineEligible` |
| --- | --- | --- | --- |
| `clean` | `good` | 0.95 | yes |
| `clean` | `usable` | 0.90 | yes |
| `borderline` | `soft_usable` | 0.70 | no |
| `rejected` | `poor` | 0.50 | no |
| `rejected` | `rejected` | 0.30 | no |

Hard rejections (too short, near-silent, clipped, too interrupted, poor voicing/SNR) short-circuit; only `clean` captures feed the rolling baseline (`baselineActivationCount = 5`, `rollingBaselineSize = 24`). The capture-quality cap is one of the minimums the fusion confidence model takes alongside the personalization-stage cap.

## How off-domain priors are down-weighted

Three multiplicative gates compound so off-domain knowledge can inform but never dominate:

1. **Prior gate** — `adaptPrior` discounts each public-dataset prior by its `DomainGap` (clinical/acted speech ×0.45; singing ×0.90; native hum ×1.0).
2. **Capture gate** — `scoreCapture` discounts the whole reading when the live capture is not a confident hum.
3. **Quality gate** — `CAPTURE_QUALITY_CONFIDENCE_CAP` caps confidence by capture quality.

These feed the late-fusion meta-learner ([trisense_architecture], `@hum-ai/fusion-engine`), where per-expert `domainMatch` further shapes `expertWeight`. As native hums accumulate and the rolling baseline matures, hum-native experts (0.85–0.90 match) and within-user deltas dominate, while seeded speech/music priors recede to the cold-start role they were meant to play. See [Personalization & Baseline](./PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) and [Fusion & Confidence](./TRISENSE_ADAPTED_ARCHITECTURE.md).
