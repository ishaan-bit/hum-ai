# Source Audit

All seven sources were extracted via `.extract/` cached text files (confirmed present on 2026-06-18). No source required manual extraction on this pass.

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ EXTRACTED | Full text extracted and verified; facts carried into this audit |
| ⚠️ PARTIAL | Text extracted but tables/figures degraded; prose usable |
| ❌ NEEDS-MANUAL | Could not be parsed; brief used as working spec |

---

## Source table

| Source file | Exists | Parsable | Tier | Role | Key extracted facts | Implementation relevance | Open issues |
|------------|--------|----------|------|------|--------------------|-----------------------|-------------|
| `IJERTCONV14IS040031.pdf` | ✅ | ✅ EXTRACTED (~4,689 words) | 1 | **System spine** — TriSense architecture | Three-stream expert model (ViT/Wav2Vec 2.0/DistilRoBERTa); late fusion with Logistic Regression meta-learner; MELD accuracies Visual 18.4%, Audio 38.0%, Text 54.0%, Fused 66.0%; Russell Valence-Arousal circumplex for recommendation; modality dominance handling; future: attention-based fusion, LLM explanations, diffusion synthesis | Direct model for `@hum-ai/fusion-engine` architecture; FER stream dropped (no face input in Hum), SER is primary expert; late fusion contract must support absent modalities | MELD numbers are TV-dialogue, NOT Hum benchmarks — must never be presented as Hum accuracy |
| `Hum_Academic_Review_Technical_Specification.docx` | ✅ | ✅ EXTRACTED (~4,535 words) | 1 | **Source of truth** — Hum protocol, features, thresholds, privacy | 12s capture (min 8s); echoCancellation/noiseSuppression/autoGainControl off; 45+ acoustic features; quality gate clean/borderline/rejected; thresholds: duration<8s, clippedFrameRatio>0.08, silenceRatio>0.72, pitchCoverage<0.35; baseline active after 5 eligible hums; rolling 24-hum window; median/MAD/IQR robust stats; robustStd=MAD×1.4826; zDelta=(current−mean)/max(std,ε); confidence caps 72/76/82/88/90-92%; privacy: raw audio NOT uploaded; forbidden Firestore field list | `@hum-ai/audio-features`, `@hum-ai/quality-gate`, `@hum-ai/personalization-engine`, `@hum-ai/shared-types` privacy guard, `@hum-ai/fusion-engine` confidence model | Some feature formulas reference legacy code paths; stereo handling not yet resolved |
| `1-s2.0-S0892199725001870-main.pdf` | ✅ | ✅ EXTRACTED (~5,424 words) | 1 | **Clinical prior** — voice→depression biomarkers | 12 studies, 16,872 participants (MDD n=1,535); AUC 0.71–0.93; accuracy 78–96.5%; key features: F0, jitter, shimmer, HNR, MFCC, spectral tilt, speech rate; 6/12 high risk of methodological bias; individual-specific models outperform population-level | Informs which acoustic features have clinical backing; supports `clinical_prior` tag in dataset registry; confirms F0+jitter+shimmer+HNR as highest-evidence features | Domain gap: clinical read-speech ≠ hum (see HUM_VS_SPEECH_DOMAIN_GAP.md); bias level means evidence is prior, not validated proof |
| `brainsci-15-00762.pdf` | ✅ | ✅ EXTRACTED (~9,351 words) | 1 | **Scientific basis for hum/sung-tone protocol** | Argues singing/sustained phonation substitutes for speech as biomarker source; language-independent acoustic features with high transferability; spectral features robust across impairment severity; singing engages distinct neural networks from speech; three validation gates (verification, analytical, clinical); GDPR/EU AI Act classify voice biomarker tools as high-risk AI | Directly supports Hum's use of sustained phonation; anchors `singing_or_sustained_phonation` as closest public-data proxy for hum; justifies language-agnostic feature design | Field still emerging; no formal clinical use yet; device variability impacts shimmer/HNR/spectral slope more than pitch/jitter |
| `mental-2025-1-e74260.pdf` | ✅ | ✅ EXTRACTED (~11,418 words) | 1 | **Affect prior + methodology guardrail** for SER stream | 14 studies (suicide 3, depression 8, psychosis 3); categorical (Ekman/Plutchik) vs dimensional (valence-arousal) emotion models; dimensional "comparatively underexplored but more nuanced"; SER mostly used indirectly; openSMILE toolkit standard; DAIC-WOZ is clinical-interview dataset; RAVDESS includes acted speech AND singing; RDoC dimensional approach in psychiatry | Justifies multi-head dimensional + categorical affect contract; openSMILE features map to Hum's acoustic features; within-subject longitudinal monitoring endorsed as future direction | Diversity of architectures/datasets makes direct comparison hard; no hum data in any included study |
| `s43856-025-01326-3.pdf` | ✅ | ✅ EXTRACTED (~11,426 words) | 1 | **Inspiration for relapse/recovery engine** | 48 adolescent MDD patients, paired pre/post voice; only F0 changed significantly (p=0.0016, Holm-Bonferroni corrected); ML max F1 65.83% (RF), DL WavLM F1 78.05% (binary), DVDSA 3-class WavLM F1 70.58%; pre→post interval mean 107 days (SD 128); DVDSA categories: recovery/worsening/unchanged | Direct model for `@hum-ai/relapse-engine` within-user paired comparison; anchors 3-class → Hum 5-class extension; WavLM outperforms wav2vec2/HuBERT for within-speaker tracking | Clinical study (treated MDD), not Hum user domain; voice task was Stroop (not hum); small sample (n=48); not publicly available |
| `Effects_of_music_interventions...pdf` | ✅ | ✅ EXTRACTED (~19,147 words) | 2 | **Intervention support** — music reduces stress | 104 RCTs, 9,617 participants; physiological stress d=0.380 (heart rate d=0.456); psychological stress d=0.545; music listening AND music making/singing both effective; slow tempo (60-80 bpm) → larger effects trend; no significant difference live vs prerecorded, self-selected vs researcher-selected | Justifies `@hum-ai/intervention-engine` music recommendation rationale; NOT evidence for diagnosis; feeds recommendation only | Must never be used to claim music diagnoses or treats depression; stress reduction ≠ depression treatment |

---

## Cross-source governance flags

1. **MELD numbers are not Hum benchmarks.** (trisense_architecture → hum_spec)
2. **Clinical-speech domain ≠ hum domain.** (clinical_voice_biomarker_review, longitudinal_voice_treatment_response_source → hum_spec)
3. **Music evidence → intervention layer only, not diagnosis.** (intervention_support_source → hum_spec)
4. **Singing/sustained phonation is the closest public proxy** for hum, not ordinary speech. (vocal_biomarker_and_singing_protocol_support → all audio sources)
5. **Personalization must be within-user.** (longitudinal_voice_treatment_response_source → hum_spec)
