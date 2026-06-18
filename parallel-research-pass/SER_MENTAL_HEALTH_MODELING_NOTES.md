# SER Mental Health Modeling Notes

**Source:** Jordan et al., "Speech Emotion Recognition in Mental Health: Applications and Limitations" — JMIR Ment Health (2025)  
**Extraction status:** ✅ FULL TEXT EXTRACTED

---

## 1. Emotion model taxonomy

### 1.1 Categorical models

| Model | Labels | Notes |
|-------|--------|-------|
| Ekman 6-class | happiness, sadness, anger, fear, disgust, surprise | Most widely used in SER literature; basic universal emotions |
| Plutchik 8-class | joy, trust, fear, surprise, sadness, disgust, anger, anticipation | Adds trust and anticipation; organized in wheel with opposites |
| MELD 7-class | anger, disgust, fear, joy, neutral, sadness, surprise | TriSense training labels (TV-dialogue) |

**Hum implication:** TriSense uses categorical MELD labels. For Hum, categorical output is optional; the primary output is dimensional (valence-arousal) per the intervention pipeline. Categorical labels can be derived from VA quadrant assignment.

### 1.2 Dimensional models

> "A comparatively underexplored but more nuanced approach" — Jordan et al.

- **Valence**: positive/negative emotional quality (hedonic tone)
- **Arousal**: level of physiological/emotional activation (calm ↔ excited)
- Russell's Circumplex Model (1980) maps all emotions to (valence, arousal) coordinates
- Allows continuous intermediate states — more clinically appropriate for mood tracking than discrete labels
- RDoC (NIMH) uses dimensional approach for psychiatric disorders
- HiTOP (Hierarchical Taxonomy of Psychopathology) uses spectra and subfactors

**Hum requirement:** `EmotionOutput` type must include both:
- `categoricalLabel?: EkmanEmotion | PlutchikEmotion` (optional)
- `valence: number` (−1 to +1)
- `arousal: number` (0 to +1)
- `confidence: number`
- `source: 'ser' | 'fusion' | 'hum_acoustic'`

---

## 2. Direct vs indirect SER in mental health literature

| Approach | Definition | Clinical example |
|----------|-----------|-----------------|
| **Direct SER** | Emotion recognition is an explicit labeling step in the pipeline | Pipeline: audio → SER → emotion label → clinical score |
| **Indirect SER** | Emotional/affective features used without naming an emotion | Pipeline: audio → acoustic features → classifier → depression score |

Most Hum literature sits in the indirect SER camp (acoustic features → state tracking). TriSense is direct SER. Hum can use both:
- **Hum v2 primary pipeline**: indirect (acoustic feature vector → personalization engine → state label)
- **Hum v2 fusion layer**: direct SER output from Wav2Vec 2.0 → fusion engine → valence-arousal

---

## 3. Feature extraction toolkit: openSMILE

> openSMILE: "standard toolkit with eGeMAPS and ComParE feature sets"

- **eGeMAPS** (extended Geneva Minimalist Acoustic Parameter Set): 25 low-level descriptors including F0, jitter, shimmer, HNR, MFCC, formants. Designed for clinical use.
- **ComParE** (Computational Paralinguistics Challenge): 6373 features; comprehensive but high-dimensional
- Used in 8/14 studies in Jordan et al.
- openSMILE is the de facto standard — consider as backend for `@hum-ai/audio-features` ML expansion
- Current Hum features are a manual subset of eGeMAPS-like features; extending to full eGeMAPS is a natural upgrade path

**Hum recommendation:** If WavLM is adopted for the SER expert, eGeMAPS extraction via openSMILE is still valuable for the interpretable feature track and confidence model.

---

## 4. Model architectures in the literature

| Architecture | Use case | Notes |
|-------------|----------|-------|
| SVM | Most common in acoustic-feature SER; accuracy 78–96% (Briganti) | Works well with small clinical samples; interpretable |
| Random Forest | Multi-feature importance; DVDSA ML top F1 65.83% | Handles mixed feature types well |
| CNN | Learns spectrogram features directly | Data-hungry; MFCC-based CNNs well-established |
| LSTM/BiLSTM | Temporal sequences | Useful for long speech, less clear benefit for 12s hum |
| Wav2Vec 2.0 | Self-supervised pre-training on raw audio | TriSense SER stream; F1 66.63% DVDSA binary |
| HuBERT | Better than wav2vec for some tasks | F1 70.31% DVDSA binary |
| WavLM | Best for within-speaker tracking | F1 78.05% DVDSA binary, 70.58% 3-class; uses masked-speech pre-training with denoising |
| DistilRoBERTa | Text stream only (TER) | N/A without transcript |
| openSMILE + shallow ML | Interpretable baseline | Recommended as transparency layer |

**Hum recommendation for SER expert:**
- First version: Wav2Vec 2.0 (consistent with TriSense)
- Upgrade path: WavLM (Kim et al. 2026 — best for within-speaker detection)
- WavLM's superiority specifically for longitudinal within-speaker comparison is the strongest argument for adopting it in the relapse engine

---

## 5. Datasets referenced for SER in mental health

| Dataset | Size | Task | Language | Notes |
|---------|------|------|----------|-------|
| DAIC-WOZ | 193 sessions, 5–20 min | Depression interview (PHQ-8) | English | Clinical gold standard; not public without agreement |
| RAVDESS | 24 actors | Acted emotion (speech + song) | English | Includes singing — relevant to hum domain |
| MELD | ~13,708 utterances | Multi-modal emotion (TV dialogue) | English | TriSense training data; NOT clinical |
| AVEC | Various years | Depression/affect challenge | English | Competition dataset; clinical depression labels |
| CMU-MOSI / CMU-MOSEI | Multi-modal | Sentiment / opinion | English | Sentiment, not clinical depression |

**Hum domain gap note:** None of these datasets contain humming or sustained non-speech phonation. RAVDESS singing is the closest. Any model trained on these must have a domain_gap_penalty applied when making Hum predictions.

---

## 6. Conditions studied in SER mental health literature

| Condition | Studies in Jordan 2025 | Notes |
|-----------|----------------------|-------|
| Depression / MDD | 8/14 | Primary target; most relevant to Hum |
| Suicide risk | 3/14 | Energy/contour features; higher clinical stakes |
| Psychotic disorders (SZ) | 3/14 | FTD, pause timing; different feature profile |
| Bipolar disorder | Limited | Valence cycling over time |
| Anxiety | Limited | Arousal-dominant signal |

---

## 7. Clinical methodology flags

1. **Categorical emotion labels and psychiatric conditions are poorly correlated.** There is no clean mapping between "anger" (SER label) and "depression episode." Dimensional V-A is preferable for mood tracking.
2. **Acted emotion ≠ natural emotion.** Datasets like RAVDESS use actors; clinical validity is uncertain.
3. **Within-subject design endorsed** for longitudinal monitoring: "Future work should prioritize … within-subject tracking paradigms" — Jordan et al.
4. **openSMILE features do not require clinical labels** to compute — this is an advantage for Hum (no psychiatric diagnosis needed).
5. **Cross-corpus generalization is low.** Models trained on one dataset often perform poorly on another. Domain shift is the central unsolved problem.

---

## 8. Hum SER stream design requirements (derived)

| Requirement | Rationale | Source |
|-------------|-----------|--------|
| Dual-head output: categorical + dimensional V-A | Both heads needed: categorical for music mapping, dimensional for continuous tracking | Jordan 2025, TriSense |
| Within-person comparison as primary inference | Absolute emotion classification unreliable; relative change from personal baseline is signal | Kim 2026, Jordan 2025 |
| Confidence penalty when SER trained on speech (not hum) | Domain mismatch reduces reliability | Rodrigo 2025, Kim 2026 |
| WavLM preferred over wav2vec 2.0 for relapse track | WavLM F1 +11pp over wav2vec2 in within-speaker depression tracking (Kim 2026) | Kim 2026 |
| openSMILE eGeMAPS as interpretable feature layer | Standard clinical feature set; transparent; enables explainability | Jordan 2025, Briganti 2025 |
| No psychiatric diagnosis output | SER does not diagnose; only supports self-monitoring | All sources |
