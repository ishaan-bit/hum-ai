# Audio Domain Agent Review

**Specialist:** Audio Domain Agent
**Focus:** Hum vs speech vs singing vs vocal burst vs music; public datasets as priors; domain classifier; HumDomainAdapter; domain-gap penalties; confidence degradation when applying speech-trained models to hums
**Date:** 2026-06-18

---

## 1. Domain Taxonomy: What Is a Hum?

A hum is a **sustained, closed-mouth phonation** on a comfortable pitch for 8–12 seconds. It is acoustically and linguistically distinct from:

| Domain | Key Acoustic Properties | Distance from Native Hum |
|---|---|---|
| Clinical read speech | Phoneme-level transitions, formants, high pitch variability, semantic content | LARGE — different voicing mode, no sustained tone |
| Spontaneous speech | Disfluencies, pauses, semantic variance, prosodic range | LARGE — no sustained tone, no word-level structure |
| Singing | Melodic structure, intentional pitch variation, sustained phonation possible | MEDIUM — sustained phonation overlaps; melodic movement different |
| Vocal bursts | Short vocalizations (laughs, sighs, exclamations), no sustained tone | LARGE — duration mismatch, different purpose |
| Sustained phonation (e.g., /aaah/) | Open-mouth sustained tone, similar duration | SMALL — closest non-hum proxy; mouth position differs |
| Music (instrumental) | No vocal source | MAXIMAL — irrelevant |

[SOURCE: vocal_biomarker_and_singing_protocol_support] Rodrigo & Duñabeitia (2025) directly support using singing / melodic structures as a bridge to hum-domain evidence: "acoustic features are language-independent and highly transferable" and "sustained phonation engages similar neural networks."

[SOURCE: hum_spec] The hum protocol specifies echoCancellation: false, noiseSuppression: false, autoGainControl: false — preserving raw microphone signal. This captures genuine hum phonation characteristics, not processed speech.

---

## 2. Public Datasets as Priors

### The Dataset Gap Problem

All major SER/voice-biomarker datasets use **speech**, not hums:

| Dataset | Domain | Closest Hum Relevance |
|---|---|---|
| MELD (TriSense training set) | TV show dialogue, multimodal | VERY LOW — speech, social dynamics, laugh tracks |
| RAVDESS | Acted speech/song | LOW-MEDIUM — includes sustained singing vowels |
| IEMOCAP | Acted/improvised speech | LOW — speech paradigm |
| MSP-IMPROV | Naturalistic speech | LOW |
| DAIC-WOZ (depression corpus) | Clinical interview speech | LOW — different voicing, context, pathological focus |
| AVEC datasets | Clinical speech | LOW |
| Kim et al. 2026 (DVDSA) | Adolescent read speech (Stroop test color-naming) | LOW-MEDIUM — sustained color words, not hum |

[SOURCE: longitudinal_voice_treatment_response_source] The Kim et al. dataset used **color-naming (Stroop test) recordings**, which involve short phonemic sequences, not sustained hum. The acoustic feature that showed significant pre/post change was F0 (fundamental frequency) — which is measurable in hums, but the recording context is entirely different.

### Requirement: Datasets as Priors, Not Truth

The architecture must state explicitly:
- Public speech datasets can be used to **pretrain** voice feature extractors and provide **prior distributions** for acoustic features.
- They **cannot** be treated as ground truth for hum-domain labels.
- Any model trained on speech datasets must have its outputs **domain-shifted** before use on hum captures.

**FAIL if** any package documentation claims that MELD/RAVDESS/DAIC-WOZ trained model accuracy translates directly to hum accuracy.

---

## 3. Domain Classifier Requirement

### Why a Domain Classifier Is Required

When Hum v2 ingests an audio capture, it cannot assume the user actually hummed. Captures may contain:
- Spoken words (user forgot instructions)
- Humming + speech mixture
- Background music bleed-in
- Near-silence or too-short phonation
- Coughing, throat-clearing (vocal bursts)

A **domain classifier** must sit before the affect model to determine whether the audio is:
1. `native_hum` — sustained closed-mouth phonation, pitch-covered, low-spectral-flatness
2. `sung_phonation` — sustained but with melodic structure (acceptable proxy)
3. `speech_leak` — formant patterns, ZCR signature of speech
4. `vocal_burst` — short, impulsive, not sustained
5. `noise_dominant` — SNR below usable threshold
6. `silence` — already caught by quality gate

### Proposed Domain Classifier Architecture

```
DomainClassifierInput {
  pitchCoverage: float          // voicing ratio
  spectralFlatness: float       // high = noisy/noisy vowel, low = harmonic structure
  zeroCrossingRate: float       // high = speech-like consonant transitions
  duration: float               // < 4s = likely burst
  musicalityScore: float        // melody structure
  breakCount: int               // phrase breaks
  noteChangeRate: float         // rapid = speech-like
}

DomainClassifierOutput {
  domain: 'native_hum' | 'sung_phonation' | 'speech_leak' | 'vocal_burst' | 'noise_dominant'
  domainConfidence: float
  humLikelihoodScore: float     // 0..1 continuous domain proximity
}
```

[SOURCE: hum_spec] The quality gate already captures most of these signals (pitchCoverage, spectralFlatness, breakCount, etc.). The domain classifier is an extension of the quality gate's logic into a typed domain determination.

---

## 4. HumDomainAdapter

### Purpose

A `HumDomainAdapter` sits between the raw audio expert and the affect model. When the domain is `speech_leak` or `sung_phonation`, it applies a **confidence penalty** and a **feature transform** to make speech-pretrained model outputs more compatible with hum-domain expectations.

### Required Behavior

| Detected Domain | Adapter Action | Confidence Penalty |
|---|---|---|
| `native_hum` | Pass through, no penalty | 0% |
| `sung_phonation` | Minor transform (adjust pitch range expectation) | –5% to –10% |
| `speech_leak` | Flag modality mismatch, heavy penalty | –25% to –35% |
| `vocal_burst` | Reject (too short / wrong type) | Reject → quality gate |
| `noise_dominant` | Already caught by quality gate | Reject |

### Confidence Degradation When Applying Speech Models to Hums

[SOURCE: clinical_voice_biomarker_review] AUC 0.71–0.93 for voice→depression classification was measured on **clinical speech** (read standardized texts, spontaneous speech, telemedicine calls). Domain transfer to hum will degrade AUC. Conservative estimate of domain-gap penalty: **subtract 0.10–0.20 from reported AUC** when extrapolating to hum. This is not in the literature — it is the agent's technical judgment that must be documented in the architecture.

[SOURCE: trisense_architecture] TriSense's SER achieved 38% on MELD speech. If applied naively to hum, the expected accuracy would likely fall well below 38% due to:
- Absence of phonemic transitions
- Different F0 contour behavior
- Different spectral envelope

---

## 5. Domain-Gap Penalties in the Confidence System

### Required Confidence Penalty Rules

The following domain-gap penalties must be enforced **in addition to** the baseline maturity caps:

```
domainGapPenalty(domain, source):
  if domain == 'native_hum' and source == 'hum_trained':      return 0.0
  if domain == 'native_hum' and source == 'speech_pretrained': return 0.12
  if domain == 'sung_phonation':                               return 0.07
  if domain == 'speech_leak':                                  return 0.28
  if domain == 'vocal_burst':                                  REJECT
  if domain == 'noise_dominant':                               REJECT

effectiveConfidence = rawConfidence * (1 - domainGapPenalty)
```

**FAIL if** the confidence system does not include a domain-gap penalty applied before confidence is reported to the user.

---

## 6. Dataset Registry Requirement

### Required `@hum-ai/dataset-registry` Contract

The architecture must require a dataset registry package that:
1. Lists each dataset used as a prior with its domain, task type, and permitted usage.
2. Forbids using MELD, RAVDESS, or IEMOCAP reported accuracy as a Hum accuracy claim.
3. Documents which features are transferable (F0, jitter, shimmer, MFCC — [SOURCE: vocal_biomarker_and_singing_protocol_support]) vs which are speech-specific (formant frequencies, word-level prosody).

| Dataset | Domain | Permitted Use | Forbidden Use |
|---|---|---|---|
| MELD | TV speech | Architecture reference baseline | Hum accuracy claim |
| RAVDESS | Acted speech/song | Singing-domain F0 prior | Direct hum SER training |
| DAIC-WOZ | Clinical interview | Depression F0/jitter prior | Hum domain labels |
| Kim et al. 2026 | Adolescent read speech | DVDSA method inspiration | Within-hum accuracy claim |
| Briganti 2025 | Clinical speech meta-review | Clinical prior for feature selection | Hum AUC claim |

---

## 7. Audio Domain Agent Summary

| Check | Status | Notes |
|---|---|---|
| Hum vs speech domain distinction | WARN | Must be explicitly documented in HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md |
| Public datasets as priors only | FAIL | No document yet forbids misuse of speech dataset accuracy as hum accuracy |
| Domain classifier specified | FAIL | Not yet in any architecture or contract document |
| HumDomainAdapter specified | FAIL | Not yet in any architecture or contract document |
| Domain-gap confidence penalty | FAIL | Not specified in confidence system |
| Dataset registry | WARN | `@hum-ai/dataset-registry` mentioned but not contracted |
| Transferable acoustic features documented | PASS | hum_spec and vocal_biomarker source both enumerate F0/jitter/shimmer/MFCC |

---

## Audio Domain Agent Top 3 Findings

1. **No domain classifier contract:** The system has no mechanism to detect when a capture is speech, a vocal burst, or singing rather than a native hum. Without a domain classifier, all confidence values are potentially inflated and domain-inappropriate. This is a FAIL-level gap.

2. **Speech dataset accuracy is being cited without domain-gap penalties:** The clinical voice biomarker review (Briganti 2025) reports AUC 0.71–0.93 on clinical speech. This number will be misused in product descriptions unless there is an explicit, enforced prohibition on applying it to hum. This is a FAIL-level documentation gap.

3. **HumDomainAdapter is missing from the architecture:** When speech-pretrained models are later introduced as the SER expert (Phase 2 roadmap), there is no adapter layer to domain-shift outputs. Planning this now is cheaper than retrofitting it after a model is already integrated.
