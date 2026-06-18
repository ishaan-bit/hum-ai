# TriSense Architecture Requirements Extract

**Source:** IJERTCONV14IS040031.pdf — Ilyas et al., "TriSense: MultiModel Emotion Detector and Music Recommender," IJERT Vol. 14 Issue 04, ICTEM 2.0 (2026)  
**Extraction status:** ✅ FULL TEXT EXTRACTED

---

## 1. Source-backed requirements (direct quotes and paraphrases from the paper)

### 1.1 Expert stream architecture

> "TriSense shifts away from older architectural paradigms toward state-of-the-art Transformer models … Comprising five interconnected components … Facial Emotion Recognition (FER) Module … Speech Emotion Recognition (SER) Module … Text Emotion Recognition (TER) Module … Fusion Module … Recommendation Module."

- **FER**: Vision Transformer (ViT), treating images as sequences of patches to capture global facial configurations including partial occlusion.
- **SER**: Wav2Vec 2.0, self-supervised model learning latent speech representations directly from raw waveforms — captures subtle intonations and stress patterns. Audio resampled to 16 kHz, mono.
- **TER**: DistilRoBERTa, "distilled version retaining 97% of BERT's performance while being 40% smaller." Provides semantic anchor when audio/visual is noisy. Max 128 tokens.

### 1.2 Fusion architecture

> "This module utilizes an Expert-Based Late Fusion architecture. It processes the probabilistic outputs from the FER, SER, and TER modules independently and employs a Logistic Regression Meta-Learner to dynamically weigh the most reliable signals."

- **Late Fusion** over probability vectors, not raw features.
- **Logistic Regression** as initial meta-learner (not neural).
- Handles modality dominance: noisy/absent channel cannot catastrophically degrade prediction.
- Preserves distinct feature hierarchies of each modality.

### 1.3 Reported MELD test split accuracies (2,610 samples)

| Stream | Accuracy |
|--------|----------|
| Visual (FER) | 18.4% |
| Audio (SER) | 38.0% |
| Text (TER) | 54.0% |
| **Late Fusion** | **66.0%** |

> "demonstrating a synergistic gain of over 12% by effectively integrating the noisy cues without degrading performance"

**⚠️ CRITICAL GOVERNANCE NOTE:** These numbers are from the MELD TV-dialogue dataset. They represent architecture-reference performance, NOT Hum performance figures. Must never be presented to users as Hum accuracy.

### 1.4 SOTA comparison (MELD)

| System | Performance |
|--------|------------|
| DialogueRNN | ~67.6% weighted accuracy |
| MMGCN | 58.65% weighted F1 |
| RobinNet (speaker-aware) | 72.8% accuracy |
| Bi-LG-GCN | ~80.0% accuracy |
| BERT+CNN (Deng & Zhang) | 67.81% |
| **TriSense Late Fusion** | **66.0%** |

TriSense is competitive with established baselines while offering "distinct advantage in modularity and real-time inference speed."

### 1.5 Valence-Arousal recommendation

> "This module translates the detected emotion into actionable mental health support … maps the user's emotional state to a Valence-Arousal model to drive a novel, context-aware music recommendation engine."

- Uses Russell's Circumplex Model of Affect (1980).
- Maps discrete emotion labels to continuous V-A coordinates.
- Music tracks selected by therapeutic alignment (e.g., "Anxiety" → Low Arousal, High Valence).

### 1.6 Future scope (source-backed upgrade path)

> "Replacing the Logistic Regression fusion with an Attention-Based Fusion Network would allow for dynamic, sample-by-sample modeling of inter-modal relationships."
> "Incorporating models like LLaMA could allow the system to generate personalized, empathetic explanations."
> "McDiff … Multi-Condition Guided Diffusion Networks can effectively reconstruct missing features … would further enhance TriSense's robustness against data scarcity."

---

## 2. Inferred Hum v2 adaptations (not from paper — Hum-specific)

| TriSense element | Hum v2 adaptation | Rationale |
|-----------------|-------------------|-----------|
| FER (ViT on face) | **DROPPED** — Hum has no camera input | Privacy posture; hum is audio-only ritual |
| SER (Wav2Vec 2.0) | **PRIMARY EXPERT** — Hum is audio-only | Most relevant to the hum signal |
| TER (DistilRoBERTa on transcript) | **OPTIONAL SECONDARY** — Hum has no speech transcript | Can be added if user provides text context; defaults absent |
| MELD 7-class labels (Anger/Disgust/Fear/Joy/Neutral/Sadness/Surprise) | **REPLACED** with valence-arousal dimensional head + categorical head | Hum doesn't have conversation labels; dimensional model is more appropriate per Jordan et al. 2025 |
| Logistic Regression meta-learner | **RETAINED AS FIRST STAGE** | Calibrated, interpretable, appropriate for few-modality case |
| Attention-based fusion (future) | **ROADMAP ITEM** — implement after enough data | Consistent with TriSense future scope |
| Valence-Arousal → music recommendation | **DIRECTLY PORTED** | Core intervention layer |
| MELD training data | **NOT USED** — Hum uses its own acoustic features + public prior from clinical/SER datasets | Domain mismatch (MELD = TV dialogue ≠ hum) |

---

## 3. Implementation checklist for `@hum-ai/fusion-engine`

- [ ] `FusionInput` type accepts per-expert probability vectors with optional/null fields (handles absent modalities)
- [ ] SER expert is the primary modality; TER and FER can be null
- [ ] Meta-learner is a calibrated Logistic Regression (or equivalent) in first version
- [ ] Fusion output includes: predicted emotion label, valence-arousal coordinates, confidence score, modality weights, which modalities were present
- [ ] Confidence must be downgraded when fewer modalities are present
- [ ] Confidence must be calibrated (not raw softmax probability)
- [ ] Valence-Arousal output feeds the intervention/recommendation layer
- [ ] Architecture note in ADR: TriSense MELD accuracy numbers are reference figures, not Hum benchmarks
- [ ] Future upgrade path to attention-based fusion is documented in ADR
- [ ] Unit tests: null modality inputs don't crash or inflate confidence
- [ ] Unit tests: fusion output with only SER input produces lower confidence than with 2+ modalities

---

## 4. What TriSense does NOT provide (gaps for Hum)

- No personalization — TriSense is per-session, not within-user longitudinal
- No relapse modeling — DVDSA (Kim et al.) fills this gap
- No confidence calibration beyond what LR inherently provides
- No domain-gap handling — training data is MELD TV dialogue, not clinical voice, not hum
- No baseline comparison — single-shot emotion detection only
- No abstention mechanism — TriSense always outputs a label
- No privacy architecture — Hum local-first posture comes from hum_spec
