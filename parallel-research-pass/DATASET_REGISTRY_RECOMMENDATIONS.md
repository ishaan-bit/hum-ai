# Dataset Registry Recommendations

**Sources:** All 7 source documents  
**Purpose:** Proposed registry entries for `@hum-ai/dataset-registry` package — tracks which datasets are used, their domain, domain gap to hum, allowed model uses, and prohibited uses.

---

## 1. Registry schema

```typescript
interface DatasetEntry {
  id: string;                        // snake_case unique identifier
  name: string;                      // human-readable name
  citation: string;                  // paper or source
  domain: DatasetDomain;             // what kind of audio/data
  task_type: TaskType;               // what was the task
  label_type: LabelType;             // what kind of labels
  n_participants: number | null;
  n_samples: number | null;
  language: string;
  is_public: boolean;
  requires_agreement: boolean;
  domain_gap_to_hum: DomainGap;      // qualitative rating
  confidence_penalty: number;        // multiplier 0.0–1.0 applied to model output confidence
  allowed_model_uses: string[];      // what you can do with models trained on this
  prohibited_model_uses: string[];   // what is forbidden
  notes: string;
}

type DatasetDomain = 'clinical_read_speech' | 'conversational_speech' | 'acted_speech' | 'acted_singing' | 'clinical_interview' | 'tv_dialogue' | 'hum_sustained_phonation' | 'general_audio';
type TaskType = 'emotion_recognition' | 'depression_detection' | 'treatment_response' | 'stress_reduction' | 'multi_task';
type LabelType = 'categorical_emotion' | 'dimensional_valence_arousal' | 'clinical_score' | 'treatment_outcome' | 'no_label';
type DomainGap = 'zero' | 'low' | 'moderate' | 'high' | 'very_high';
```

---

## 2. Recommended dataset registry entries

### MELD (Multi-modal EmotionLines Dataset)

```json
{
  "id": "meld_tv_dialogue",
  "name": "MELD — Multi-modal EmotionLines Dataset",
  "citation": "Poria et al., 2019; used by TriSense (Ilyas et al. 2026)",
  "domain": "tv_dialogue",
  "task_type": "emotion_recognition",
  "label_type": "categorical_emotion",
  "n_participants": null,
  "n_samples": 13708,
  "language": "English",
  "is_public": true,
  "requires_agreement": false,
  "domain_gap_to_hum": "very_high",
  "confidence_penalty": 0.60,
  "allowed_model_uses": [
    "architecture reference and comparison baseline",
    "TriSense-style late-fusion experiment on multi-speaker emotional speech",
    "categorical emotion label mapping to valence-arousal (label transfer only)"
  ],
  "prohibited_model_uses": [
    "reporting MELD accuracy numbers as Hum performance",
    "using MELD-trained model as primary SER expert without domain-gap penalty",
    "fine-tuning on Hum data without re-validation"
  ],
  "notes": "TriSense trained on MELD; 7-class labels (anger/disgust/fear/joy/neutral/sadness/surprise); TV-dialogue speakers; not clinical; not hum. MELD accuracy 66% is architecture reference, NOT Hum benchmark."
}
```

---

### DVDSA Paired Voice Dataset (Kim et al. 2026)

```json
{
  "id": "dvdsa_adolescent_mdd",
  "name": "DVDSA — Dual Voice-based Depressive State Analysis (Kim et al. 2026)",
  "citation": "Kim et al., Communications Medicine (2026)",
  "domain": "clinical_read_speech",
  "task_type": "treatment_response",
  "label_type": "treatment_outcome",
  "n_participants": 48,
  "n_samples": 96,
  "language": "Korean",
  "is_public": false,
  "requires_agreement": true,
  "domain_gap_to_hum": "high",
  "confidence_penalty": 0.75,
  "allowed_model_uses": [
    "architecture reference for within-person paired comparison design",
    "WavLM model architecture reference (binary: F1 78.05%, 3-class: F1 70.58%)",
    "DVDSA 3-class taxonomy reference (recovery/worsening/unchanged) for relapse engine design"
  ],
  "prohibited_model_uses": [
    "direct use of DVDSA performance figures as Hum relapse engine benchmarks",
    "applying models trained on this dataset to Hum without re-validation",
    "using adolescent MDD clinical population statistics for general consumer claims"
  ],
  "notes": "Stroop color-naming voice task (not hum); 48 adolescent inpatients; not publicly available; treatment interval mean 107 days. WavLM outperforms wav2vec2/HuBERT for within-speaker depression tracking — strong architecture signal."
}
```

---

### Briganti & Lechien Clinical Biomarker Review Population

```json
{
  "id": "briganti_lechien_review_population",
  "name": "Briganti & Lechien Voice Biomarker Review — Aggregated Population (2025)",
  "citation": "Briganti & Lechien, Journal of Voice (2025)",
  "domain": "clinical_read_speech",
  "task_type": "depression_detection",
  "label_type": "clinical_score",
  "n_participants": 16872,
  "n_samples": null,
  "language": "Multiple (12 studies)",
  "is_public": false,
  "requires_agreement": true,
  "domain_gap_to_hum": "high",
  "confidence_penalty": 0.75,
  "allowed_model_uses": [
    "clinical prior for which acoustic features correlate with MDD (F0, jitter, shimmer, HNR, MFCC, speech rate)",
    "evidence weighting for feature importance in confidence model",
    "supporting claims that voice features have clinical relevance"
  ],
  "prohibited_model_uses": [
    "reporting AUC 0.71–0.93 or accuracy 78–96.5% as Hum performance",
    "claiming Hum detects MDD based on this review",
    "using study populations as demographic reference for Hum users"
  ],
  "notes": "6/12 studies have high risk of methodological bias (QUADAS-2). Individual-specific models outperform population-level — confirms within-user personalization posture. AUC/accuracy are clinical study numbers, not Hum product numbers."
}
```

---

### RAVDESS (Acting Speech + Singing)

```json
{
  "id": "ravdess",
  "name": "RAVDESS — Ryerson Audio-Visual Database of Emotional Speech and Song",
  "citation": "Livingstone & Russo (2018)",
  "domain": "acted_singing",
  "task_type": "emotion_recognition",
  "label_type": "categorical_emotion",
  "n_participants": 24,
  "n_samples": 7356,
  "language": "English",
  "is_public": true,
  "requires_agreement": false,
  "domain_gap_to_hum": "moderate",
  "confidence_penalty": 0.90,
  "allowed_model_uses": [
    "singing-domain SER training (closest public proxy to hum domain)",
    "feature distribution reference for vocal style analysis",
    "benchmark for singing emotion recognition models"
  ],
  "prohibited_model_uses": [
    "reporting RAVDESS-based model performance as Hum accuracy without domain-gap disclosure",
    "claiming acted emotion labels represent naturalistic Hum user states"
  ],
  "notes": "Includes BOTH acted speech and acted singing (24 professional actors). Singing subset is closest public-domain proxy for Hum sustained phonation. Moderate domain gap due to: (1) professional actors vs casual humming, (2) sung vowels vs hummed /m/ or /n/, (3) acted vs naturalistic."
}
```

---

### DAIC-WOZ (Depression Interview Corpus)

```json
{
  "id": "daic_woz",
  "name": "DAIC-WOZ — Distress Analysis Interview Corpus (Wizard-of-Oz)",
  "citation": "Gratch et al. (2014)",
  "domain": "clinical_interview",
  "task_type": "depression_detection",
  "label_type": "clinical_score",
  "n_participants": 193,
  "n_samples": 193,
  "language": "English",
  "is_public": false,
  "requires_agreement": true,
  "domain_gap_to_hum": "high",
  "confidence_penalty": 0.75,
  "allowed_model_uses": [
    "depression detection model training (with domain-gap penalty applied to Hum outputs)",
    "SER system comparison and benchmark reference",
    "feature correlation study for depression-related acoustic features"
  ],
  "prohibited_model_uses": [
    "claiming DAIC-WOZ model accuracy applies to Hum user population",
    "using PHQ-8 score thresholds as Hum user labels"
  ],
  "notes": "193 clinical interviews, 5–20 min each, English, PHQ-8 labeled. Conversational interview task; not humming. High clinical validity but large domain gap. Standard benchmark for depression detection SER."
}
```

---

### de Witte Music Intervention Meta-Analysis Population

```json
{
  "id": "de_witte_music_meta",
  "name": "de Witte et al. Music Intervention Meta-Analysis (2020/2025)",
  "citation": "de Witte et al., JMIR Ment Health",
  "domain": "general_audio",
  "task_type": "stress_reduction",
  "label_type": "no_label",
  "n_participants": 9617,
  "n_samples": 327,
  "language": "Multiple (104 RCTs)",
  "is_public": false,
  "requires_agreement": false,
  "domain_gap_to_hum": "very_high",
  "confidence_penalty": 0.50,
  "allowed_model_uses": [
    "supporting claims that music reduces physiological stress (d=0.380) and psychological stress (d=0.545)",
    "informing BPM range preference (60–80 bpm trend for psychological effect)",
    "justifying existence of music recommendation/intervention layer in Hum"
  ],
  "prohibited_model_uses": [
    "claiming Hum's music recommendation produces d=0.380 or d=0.545 effect sizes",
    "using meta-analysis RCT outcomes as Hum product performance claims",
    "claiming music treats depression or any clinical condition"
  ],
  "notes": "This is a meta-analysis of music interventions, not a voice analysis dataset. No domain gap to Hum audio — the dataset is about outcomes from music listening, not biomarker detection. Listed here to mark governance constraints on how music intervention evidence is cited."
}
```

---

## 3. Hum in-domain dataset (future)

```json
{
  "id": "hum_longitudinal_user_data",
  "name": "Hum User Longitudinal Hum Dataset (internal, future)",
  "citation": "Hum project team (ongoing)",
  "domain": "hum_sustained_phonation",
  "task_type": "multi_task",
  "label_type": "no_label",
  "n_participants": null,
  "n_samples": null,
  "language": "Language-agnostic",
  "is_public": false,
  "requires_agreement": true,
  "domain_gap_to_hum": "zero",
  "confidence_penalty": 1.0,
  "allowed_model_uses": [
    "fine-tuning SER expert for in-domain humming",
    "calibrating confidence model with hum-specific priors",
    "validating feature distributions against baseline algorithms"
  ],
  "prohibited_model_uses": [
    "using without user consent",
    "uploading raw audio without explicit user opt-in",
    "sharing with third parties without data agreement"
  ],
  "notes": "Does not yet exist as a formal dataset. Requires ethics review and explicit user consent before collection. Privacy posture: local-first, derived features only, no raw audio in Firestore by default."
}
```

---

## 4. Domain gap summary table

| Dataset | Domain gap | Confidence penalty | Primary use |
|---------|-----------|-------------------|-------------|
| MELD | very_high | 0.60 | Architecture reference only |
| DAIC-WOZ | high | 0.75 | Depression SER training (with penalty) |
| DVDSA | high | 0.75 | Relapse engine architecture reference |
| Briganti population | high | 0.75 | Clinical feature prior |
| RAVDESS singing | moderate | 0.90 | Closest hum proxy; SER training |
| Hum user data (future) | zero | 1.00 | In-domain fine-tuning |
