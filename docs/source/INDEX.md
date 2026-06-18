# Source Index

This file is the authoritative manifest of the primary source documents used to build
the Hum platform foundation. Each entry records the document's **intended role**, its
**extraction status**, and the **key facts** that were carried into code and architecture
docs.

> **Provenance rule.** Every claim, threshold, or design decision that traces to a source
> must cite it by the `id` below. Where a source could not be machine-extracted, that is
> stated explicitly and the source is flagged `NEEDS-MANUAL-EXTRACTION`. We do **not**
> hallucinate source contents — the architecture brief in the project prompt is used as the
> working spec for any unreadable source.

Extraction was performed with `pdftotext` (poppler) for PDFs and the `word/document.xml`
zip entry for the `.docx`. Raw extracted text was cached locally under `.extract/`
(git-ignored, never committed). All seven sources were machine-readable on this pass.

| Status | Meaning |
| --- | --- |
| ✅ EXTRACTED | Full text extracted and read; facts carried into code/docs. |
| ⚠️ PARTIAL | Extracted but figures/tables degraded; prose usable. |
| ❌ NEEDS-MANUAL-EXTRACTION | Could not be parsed; brief used as working spec. |

---

## Tier 1 — Implementation & Science Sources

### `trisense_architecture` — IJERTCONV14IS040031.pdf
- **Status:** ✅ EXTRACTED (4,689 words)
- **Citation:** Ilyas, M., Sharma, D., Sharma, D., Chauhan, D., Singh, I. "TriSense: MultiModel Emotion Detector and Music Recommender." *IJERT*, Vol. 14, Issue 04, ICTEM 2.0 (2026).
- **Role:** **System spine.** Defines the expert-based late-fusion architecture Hum adapts.
- **Key facts carried into the build:**
  - Three modality experts: **FER** (Vision Transformer / ViT), **SER** (Wav2Vec 2.0), **TER** (DistilRoBERTa).
  - **Late Fusion** with a **Logistic Regression meta-learner** over per-expert probability vectors (not early/feature concatenation).
  - Handles **"modality dominance"**: a noisy channel (blurry face, silent audio) must not catastrophically degrade fused prediction.
  - **Recommendation** maps detected state through Russell's **Valence–Arousal circumplex** (ref [7]).
  - Reported **MELD** stream accuracies: Visual 18.4%, Audio 38.0%, Text 54.0%, **Late Fusion 66.0%** (≈ +12% synergistic gain).
  - **Future upgrade path:** Attention-based fusion / gated mixture-of-experts; LLM-generated explanations; diffusion-based missing-modality synthesis.
- **Critical adaptation note:** MELD accuracies are **architecture-reference numbers from a TV-dialogue dataset**, NOT Hum performance figures. They must never be presented as Hum's accuracy. See [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md).

### `hum_spec` — Hum_Academic_Review_Technical_Specification.docx
- **Status:** ✅ EXTRACTED (4,535 words)
- **Citation:** Hum project team. "Hum — A Local-First Vocal Signal System for Reflective Daily Self-Awareness." Working paper, draft 15 June 2026 (prepared for Prof. Arvind Sahay).
- **Role:** **Source of truth** for the hum protocol, acoustic features, quality gate, baseline statistics, confidence caps, and privacy posture.
- **Key facts carried into the build:**
  - **12-second** hum capture (min 8 s); raw-ish constraints (echoCancellation/noiseSuppression/autoGainControl off).
  - Large **acoustic feature dictionary** (energy/RMS, pitch contour, spectral, continuity/pauses, vibrato/glide, residual instability, musicality, controlled expression).
  - **Quality gate** decisions: `clean | borderline | rejected`; capture quality `good | usable | soft_usable | poor | rejected`. Thresholds (e.g. duration < 8 s, clippedFrameRatio > 0.08, silenceRatio > 0.72, pitchCoverage < 0.35) carried into `@hum-ai/quality-gate`.
  - **Baseline** activates after **5 eligible hums**; rolling window of **24**; robust stats **median / MAD / IQR**, `robustStd = MAD × 1.4826`, `zDelta = (current − mean)/max(std, ε)`, feature `ratio = current / mean`.
  - **Confidence caps**: 72% (first hum), 76% (pre-baseline), 82% (5–9), 88% (10–19), 90–92% (mature) — carried into `@hum-ai/personalization-engine` and `@hum-ai/fusion-engine`.
  - **Privacy:** local-first; **raw audio not uploaded by default**; derived-data-only sync; explicit **forbidden raw-audio field names** (`audio`, `audioBlob`, `rawAudio`, `recording`, `blob`, `waveformRaw`, `microphoneData`, …) — carried into `@hum-ai/shared-types` privacy guard.
  - Non-clinical framing; within-user comparison over population norms.

### `clinical_voice_biomarker_review` — 1-s2.0-S0892199725001870-main.pdf
- **Status:** ✅ EXTRACTED (5,424 words)
- **Citation:** Briganti, G., Lechien, J.R. "Speech and Voice Quality as Digital Biomarkers in Depression: A Systematic Review." *Journal of Voice* (2025). doi:10.1016/j.jvoice.2025.05.002
- **Role:** **Clinical prior** for voice→depression markers. Defines which acoustic features have evidence and the strength/limits of that evidence.
- **Key facts:** 12 studies, 16,872 participants (MDD n=1,535). Voice features distinguished depression from controls **AUC 0.71–0.93**, classification accuracy **78–96.5%**. Prosodic/spectral/perturbation features (F0, jitter, shimmer, HNR, MFCC, spectral tilt, speech rate). **6/12 studies high risk of methodological bias**; heterogeneity and generalizability concerns flagged before clinical adoption.
- **Governance note:** Clinical-speech evidence → `clinical_prior` only. **Must not** be treated as direct hum truth (domain gap: clinical read speech ≠ hum). See ADR-0005.

### `vocal_biomarker_and_singing_protocol_support` — brainsci-15-00762.pdf
- **Status:** ✅ EXTRACTED (9,351 words)
- **Citation:** Rodrigo, I., Duñabeitia, J.A. "Listening to the Mind: Integrating Vocal Biomarkers into Digital Health." *Brain Sci.* 2025, 15, 762. doi:10.3390/brainsci15070762
- **Role:** **Scientific basis for the hum/sung-tone protocol.** Argues **singing / simple melodic structures** can substitute for speech as a vocal-biomarker source — directly supporting Hum's sustained-phonation hum.
- **Key facts:** Pitch, jitter, shimmer, speech rate, pause duration are well-established biomarkers (stress, MDD, PD, dementia). **Acoustic features are language-independent and highly transferable**; spectral features robust across impairment severity. Singing engages multiple neural networks → both an assessment and an intervention modality. Field still emerging; no formal clinical use yet.
- **Governance note:** Supports `singing_or_sustained_phonation` as the closest public-data bridge to native hum, and language-agnostic feature design.

### `ser_mental_health_review` — mental-2025-1-e74260.pdf
- **Status:** ✅ EXTRACTED (11,418 words)
- **Citation:** Jordan, E., Terrisse, R., Lucarini, V., Alrahabi, M., Krebs, M.-O., Desclés, J., Lemey, C. "Speech Emotion Recognition in Mental Health: Systematic Review of Voice-Based Applications." *JMIR Ment Health* 2025;12:e74260. doi:10.2196/74260
- **Role:** **Affect prior + methodology guardrail** for the SER stream and the affect head taxonomy.
- **Key facts:** 14 studies — suicide risk (3), depression (8), psychotic disorders (3). Categorical (Ekman "big six", Plutchik) vs **dimensional valence–arousal** models; dimensional approach is "comparatively underexplored" but more nuanced. SER mostly used **indirectly**; architecture/dataset/pathology diversity makes direct assessment hard. QUADAS-2 risk-of-bias used. Future work: clinician-collaborative use.
- **Governance note:** Justifies a **multi-head dimensional + categorical** affect contract rather than one classifier; reinforces abstention/uncertainty discipline.

### `longitudinal_voice_treatment_response_source` — s43856-025-01326-3.pdf
- **Status:** ✅ EXTRACTED (11,426 words)
- **Citation:** Kim, J.-W., Yoon, H., Kim, B.-N., Lee, S.-Y., Kim, D.-J., Moon, S.-E., Choi, Y., Yang, C.-M. "Deep neural network-based analysis of voice biomarkers for monitoring treatment response in adolescent major depressive disorder." *Communications Medicine* (2026) 6:82. doi:10.1038/s43856-025-01326-3
- **Role:** **Direct inspiration for the relapse/recovery engine** — within-patient, paired-sample longitudinal voice comparison.
- **Key facts:** 48 adolescent MDD patients, **paired pre/post treatment** voice. Proposed **DVDSA (Dual Voice-based Depressive State Analysis)** → categorizes intra-patient change as **recovery / worsening / unchanged**. WavLM F1 **78.05%** binary, **70.58%** on DVDSA; classic ML topped out at F1 65.83%. Only **F0** changed significantly at the individual-feature level (Holm-Bonferroni). Mean pre→post interval ≈107 days.
- **Governance note:** Anchors the relapse engine as **personalized within-user paired comparison**, not group-level classification. Hum extends DVDSA's 3 classes to `recovery | stable | worsening | relapse_drift | uncertain`.

---

## Tier 2 — Intervention Support

### `intervention_support_source` — Effects_of_music_interventions_on_stress_related_outcomes...pdf
- **Status:** ✅ EXTRACTED (19,147 words)
- **Citation:** de Witte, M., Spruit, A., van Hooren, S., Moonen, X., Stams, G.-J. "Effects of music interventions on stress-related outcomes: a systematic review and two meta-analyses." *Health Psychology Review* 14(2), 294–324 (2020). doi:10.1080/17437199.2019.1627897
- **Role:** **Intervention support only.** Evidence that music interventions reduce stress — used to justify the music-recommendation intervention, NOT as diagnostic evidence.
- **Key facts:** 104 RCTs, 327 effect sizes, 9,617 participants. Music interventions reduced **physiological stress d=.380** and **psychological stress d=.545**; HR effect d=.456. Both music listening and music making/singing reduce cortisol/HR/BP.
- **Governance note:** Feeds `@hum-ai/intervention-engine` recommendation rationale only. **Music-emotion evidence must never be used as user-state diagnosis** (ADR-0005, prohibited rule).

---

## Out of scope this pass
- Competitor PDFs are **excluded** from this pass per the project brief.

## Reproducing extraction
```bash
# DOCX text
python -c "import zipfile,re,html; \
x=zipfile.ZipFile('docs/source/Hum_Academic_Review_Technical_Specification.docx').read('word/document.xml').decode(); \
print(html.unescape(re.sub('<[^>]+>','',re.sub('</w:p>','\n',x))))"

# PDF text (poppler)
pdftotext docs/source/IJERTCONV14IS040031.pdf -
```
