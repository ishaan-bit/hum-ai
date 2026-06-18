# Hum vs Speech Domain Gap

**Sources:**  
- `vocal_biomarker_and_singing_protocol_support` — Rodrigo & Duñabeitia, Brain Sci. (2025)  
- `clinical_voice_biomarker_review` — Briganti & Lechien, Journal of Voice (2025)  
- `longitudinal_voice_treatment_response_source` — Kim et al., Communications Medicine (2026)  
- `ser_mental_health_review` — Jordan et al., JMIR Ment Health (2025)  
- `hum_spec` — Hum Technical Specification

---

## 1. The domain gap is real

All clinical voice biomarker research uses one of these voice tasks:
- Read-aloud text (standardized clinical read speech)
- Spontaneous/conversational speech
- Clinical interview (e.g., DAIC-WOZ, Stroop color-naming in Kim et al.)
- Acted emotion (e.g., RAVDESS)

**None of the clinical literature uses humming as a voice task.**

Hum uses **sustained non-lexical phonation** — no articulation, no language, no word content. This is physiologically and acoustically distinct from all standard clinical tasks.

---

## 2. Why this gap matters

| Dimension | Clinical speech | Hum (sustained phonation) |
|-----------|----------------|--------------------------|
| Articulatory demand | High (consonants, vowels, coarticulation) | None (lip closure, sustained vowel-like tone) |
| Linguistic content | Present (words, sentences) | Absent |
| Prosodic complexity | Full prosody (stress, intonation, rhythm of language) | Musical prosody (tempo, vibrato, pitch contour) |
| Voluntary control | Semi-automatic speech production | Highly intentional vocal production |
| Trained variation | Expected across speakers | Also voluntary (pitch, volume, style vary by choice) |
| Pause type | Conversational turn pauses, breath groups | Breath breaks between musical phrases |
| F0 behavior | Varies per phoneme environment | Purely continuous; less influenced by articulation |
| Neural locus | Language network (Broca, Wernicke) + auditory | Auditory + motor cortex, distinct from language areas |

> "Speech and song are processed by spatially segregated neural populations in the auditory cortex" — Rodrigo & Duñabeitia 2025 (citing Norman-Haignere et al. 2022)

---

## 3. Singing/sustained phonation as the closest proxy

Rodrigo & Duñabeitia (2025) is the key source arguing that singing and sustained melodic phonation can **substitute** for speech as a biomarker source:

- "Acoustic features derived from sung speech are language-independent and highly transferable between speakers and languages"
- "Singing requires greater motor control complexity than speech → may reveal subtle motor/coordination deficits earlier"
- "Spectral features … robust across impairment severity regardless of vocal production modality"
- RAVDESS includes both speech and singing — and both yield emotion-relevant features

**Conclusion for Hum:** Singing/sustained phonation datasets are the closest existing data proxy for hum. All domain-gap penalties should be calibrated against a singing→hum gap (smaller) rather than speech→hum gap (larger).

---

## 4. Domain gap scores (qualitative ratings, not empirical measurements)

| Source domain | Target domain (Hum) | Gap severity | Key mismatches |
|--------------|---------------------|-------------|----------------|
| Clinical read speech | Hum sustained phonation | **HIGH** | Articulation, language, prosody mismatch |
| Conversational speech | Hum | **HIGH** | Social interaction dynamics, turn-taking, phoneme variety |
| Acted speech (RAVDESS speech) | Hum | **HIGH** | Exaggerated expression; no humming |
| Acted singing (RAVDESS singing) | Hum | **MODERATE** | Closest public source; sung vowels ≈ hum vowels; no lip-closure hum |
| Stroop color-naming (Kim 2026) | Hum | **HIGH** | Read aloud, adversarial cognitive task, not musical |
| Clinical interview (DAIC-WOZ) | Hum | **HIGH** | Long-form conversational speech, 5–20 min, English |
| Humming (no current public dataset) | Hum | **ZERO (self)** | No gap — Hum is the domain |

**Key insight:** There is currently no published clinical dataset for humming as a biomarker task. Hum is creating the domain.

---

## 5. Consequence: domain gap confidence penalties

Any model trained on non-hum data and applied to Hum should have its confidence down-weighted. The penalty structure:

| Model source | Confidence multiplier (proposed) | Rationale |
|-------------|--------------------------------|-----------|
| Trained on hum data (Hum's own longitudinal data) | 1.00 (no penalty) | In-domain |
| Trained on singing (RAVDESS singing only) | 0.90 | Closest proxy; moderate gap |
| Trained on clinical speech (DAIC-WOZ, etc.) | 0.75 | Large gap; articulation mismatch |
| Trained on acted speech (RAVDESS speech) | 0.70 | Acted + speech = double mismatch |
| Trained on TV dialogue (MELD, TriSense) | 0.60 | Entertainment context, spontaneous, multi-speaker |
| General speech-pretrained (Wav2Vec 2.0, WavLM) | 0.80 | Self-supervised raw audio; less label-contaminated |

These multipliers are applied **before** the confidence cap system. The cap system then applies the maturity ceiling on top.

---

## 6. Source-to-target transfer plan

### Phase 1: Hum-in-domain acoustic features (current)
- Use the legacy Hum acoustic feature set (F0, jitter, shimmer, HNR, RMS, spectral) derived directly from each user's hum
- Personalization via within-user z-delta comparison
- No external SER model applied yet
- Domain gap is avoided, not bridged

### Phase 2: Singing-domain SER (first external model)
- Use models trained on RAVDESS singing (or fine-tuned) as SER expert
- Apply 0.90 domain gap multiplier
- Feed into fusion with flag: `domain: 'singing'`
- Collect Hum audio (with consent) to begin in-domain dataset

### Phase 3: Hum-domain fine-tuning (future)
- Fine-tune WavLM on Hum user data (requires IRB-like consent, differential privacy)
- Reduce domain gap multiplier toward 1.00 as in-domain data grows
- Dataset registry entry updated to `domain_gap_to_hum: 'zero'`

---

## 7. Device variability compounds the gap

Rodrigo & Duñabeitia (2025) flag specific features that are sensitive to microphone type:
- **More stable across devices:** pitch (F0), jitter, intensity
- **Less stable across devices:** shimmer, HNR, spectral slope

Hum users record on smartphone microphones (diverse hardware). This adds an additional source of variability on top of domain gap.

**Mitigation already in Hum spec:**
- Gain normalization (`gain = min(0.82/peak, 10)`) reduces amplitude-related variance
- Relative within-user comparison (z-delta vs personal baseline) cancels constant device-specific offsets
- Device-sensitive features (shimmer, HNR, spectral slope) should receive lower weight in confidence model

---

## 8. Three validation gates (from Rodrigo 2025)

Before any singing/hum biomarker claim can be made clinically, three gates must be cleared:

1. **Verification** — does the feature actually change as hypothesized?
2. **Analytical validation** — are the algorithms measuring what they claim (sensitivity, specificity, precision)?
3. **Clinical validation** — does the biomarker predict clinical outcomes in a prospective trial?

**Hum status:**
- Gate 1: In progress (observational, within-user)
- Gate 2: Required before clinical-adjacent claims
- Gate 3: Not yet started

**This means all Hum user-facing language must treat the product as a self-monitoring tool, not a diagnostic tool, until Gate 3 is cleared.**
