# Architecture Agent Review

**Specialist:** Architecture Agent
**Focus:** TriSense adaptation, FER/SER/TER expert separation, late fusion, attention/gated fusion roadmap, recommendation/intervention layer
**Date:** 2026-06-18

---

## 1. TriSense Adaptation Assessment

### What TriSense Actually Is (Source-Backed)

[SOURCE: trisense_architecture] TriSense is a three-stream multimodal emotion recognition system trained and evaluated on MELD (Multimodal EmotionLines Dataset — TV show Friends dialogues). Its architecture:

- **FER:** Vision Transformer (ViT) — 18.4% accuracy on MELD
- **SER:** Wav2Vec 2.0 — 38.0% accuracy on MELD
- **TER:** DistilRoBERTa — 54.0% accuracy on MELD
- **Late Fusion:** Logistic Regression meta-learner over per-expert probability vectors — 66.0% on MELD (+12% synergistic gain)
- **Recommendation:** Valence–Arousal circumplex (Russell 1980) → music curated by emotional state

[SOURCE: trisense_architecture] Future scope explicitly mentions: attention-based fusion, gated mixture-of-experts, LLM explanations, diffusion-based missing-modality synthesis.

### How Hum Adapts TriSense

[BRIEF] Hum v2 removes FER (no camera/video) and TER (no speech transcription) in native use. The primary expert is a Hum Audio Expert (HAE) built over the hum capture. TER may be optionally re-enabled for a companion text/mood journal input. This constitutes a "TriSense-adapted" architecture: from 3 independent experts to a 1–3 expert system depending on session modality availability.

### Verdict

**PASS criteria met:**
- Expert separation concept correctly inherited from TriSense. Each modality should remain an independent expert with its own probability vector output, not merged at feature level.
- Late fusion (logistic regression meta-learner) is the correct first-class fusion mechanism.
- Modality dropout/dominance handling is correctly understood.

**WARN criteria:**
- The Hum specification documents a rule-based heuristic pipeline, not a trained classifier. The SER expert in TriSense is a fine-tuned Wav2Vec 2.0. Hum's audio expert is currently rule-based (z-score dimensions). This is architecturally valid as a first pass, but creates a **semantic gap**: TriSense's meta-learner receives probability vectors from neural classifiers; Hum's meta-learner must receive probability-equivalent confidence-weighted vectors from rule-based dimension scores. This mapping is not trivially equivalent and must be explicitly specified in the architecture.
- FER is absent in Hum's primary flow. The architecture must document what fills the FER slot (or that it is intentionally absent / future journal-entry TER).

---

## 2. FER/SER/TER Expert Separation

### Required Contract

Each expert must:
1. Receive its modality input independently (no shared preprocessing).
2. Emit a probability-equivalent vector over the affect taxonomy.
3. Flag availability (is this modality present? was capture quality sufficient?).
4. Flag confidence (hum: based on capture quality tier; future SER neural: based on model confidence).

### Finding: Missing FER Treatment

[BRIEF] The hum_spec document makes no mention of FER. If facial video is not in scope, the architecture document must explicitly say so and document what happens to the FER slot in the meta-learner when FER is absent. Options:
- **Remove the slot entirely** (TriSense-2-expert variant)
- **Reserve the slot as null** (meta-learner must handle sparse input)
- **Fill with journal TER** (TER slot doubles as soft FER proxy in future)

Failure to document this creates implementation ambiguity. **This is a WARN-level gap in the architecture doc.**

### Finding: SER Expert — Hum vs Speech Model

The SER expert in TriSense is Wav2Vec 2.0 fine-tuned on MELD speech. Hum's input is a sustained hum (not speech). This is the single most critical architecture adaptation point. Applying a speech-trained SER directly to a hum will produce systematically degraded probability vectors.

The architecture must document:
- Whether the Hum Audio Expert is **a hum-native rule-based system** (current state, correct but limited)
- Or a **speech-pretrained model with domain adaptation** (aspirational, requires domain classifier + HumDomainAdapter)
- The transition roadmap between these states

---

## 3. Late Fusion — First-Class Status

### Source Evidence

[SOURCE: trisense_architecture] Late fusion is explicitly preferred over early fusion because:
- It preserves distinct feature hierarchies per modality.
- It prevents a noisy channel from degrading the full prediction.
- The logistic regression meta-learner dynamically weights the most reliable signals.

### Hum v2 Requirement

The fusion engine must implement:

```
FusionInput {
  humAudioVector: ProbabilityVector | null
  ferVector: ProbabilityVector | null        // null if camera not available
  terVector: ProbabilityVector | null        // null if journal not present
  domainConfidencePenalties: DomainGapPenalty
  captureQualityWeight: float               // from quality gate
  baselineMaturity: float                   // personalization stage
}

FusionOutput {
  fusedProbabilityVector: ProbabilityVector
  confidence: float                         // capped per personalization stage
  dominantModality: 'audio' | 'text' | 'absent'
  abstain: boolean                          // triggered by low confidence
  topClass: EmotionLabel
  topClassMargin: float                     // margin over runner-up
  modalityAgreement: float                  // cross-expert agreement score
}
```

**FAIL if:** The fusion engine produces a fused output without exposing `abstain`, `topClassMargin`, or `modalityAgreement`. These are safety-critical outputs.

---

## 4. Attention/Gated Fusion Roadmap

### Source Evidence

[SOURCE: trisense_architecture] Future scope: "Replacing the Logistic Regression fusion with an Attention-Based Fusion Network would allow for dynamic, sample-by-sample modeling of inter-modal relationships."

### Requirement

The architecture doc must include a documented roadmap:
- **Phase 1 (current):** Logistic Regression meta-learner. Fast, interpretable, auditable.
- **Phase 2:** Gated mixture-of-experts. Per-sample weight allocation based on modality confidence.
- **Phase 3:** Attention-based fusion. Learns inter-modal relationships from data.
- **Phase 4 (optional):** Diffusion-based missing-modality synthesis. Imputes absent FER/TER signals.

**WARN if** the architecture doc does not include this roadmap. The product vision requires it, and the technical path must be contractually reserved.

---

## 5. Recommendation/Intervention Layer

### Source Evidence

[SOURCE: trisense_architecture] TriSense maps emotion → Valence–Arousal circumplex → music recommendation (therapeutic alignment, not clinical prescription).

[SOURCE: intervention_support_source] 104 RCTs, 9,617 participants: music interventions reduced physiological stress (d=0.380) and psychological stress (d=0.545). Supports recommendation rationale.

[SOURCE: hum_spec] Current music system: Last.fm-backed scoring with hum musical shape features, user filters (genre, language, flavor), and a complex finalScore formula.

### Architecture Separation Requirement

The intervention layer must remain **strictly separated** from the diagnostic/clinical layer. The architecture must enforce:

1. `@hum-ai/intervention-engine` does not receive clinical labels (PHQ-9, GAD-7, diagnosis codes).
2. Music recommendations are framed as "mood-aligned" or "energetically matched," never as "treatment."
3. The recommendation system must never assert that it prevented relapse, reduced depression, or is medically indicated.
4. The valence-arousal mapping is explicitly labeled as **a product feature**, not a clinical output.

**FAIL if** the recommendation engine ingests clinical labels or outputs clinical claims.

---

## 6. Architecture Agent Summary

| Check | Status | Notes |
|---|---|---|
| TriSense adaptation documented | WARN | Rule-based heuristic vs trained neural expert gap must be explicitly bridged |
| FER absence documented | WARN | Must declare FER slot handling (absent/null/future) |
| SER/HAE expert separation | PASS | Correct conceptual separation |
| Late fusion first-class | PASS | Logistic regression meta-learner correctly planned |
| Fusion output contract | FAIL | `abstain`, `topClassMargin`, `modalityAgreement` must be required outputs |
| Attention/gated fusion roadmap | WARN | Must be documented as a named future phase |
| Recommendation separation | PASS | Current architecture separates recommendation from diagnosis |
| Modality dominance handling | PASS | Correctly inherited from TriSense |

---

## Architecture Agent Top 3 Findings

1. **Critical semantic gap (rule-based vs neural expert):** TriSense's meta-learner consumes neural probability vectors. Hum's audio expert currently emits rule-based z-score dimension scores. The architecture must explicitly document how dimension scores become probability-equivalent vectors, or the fusion layer contract is undefined. This is the most architecturally consequential gap.

2. **Missing fusion output contract fields:** The fusion engine must expose `abstain`, `topClassMargin`, and `modalityAgreement`. Without these, safety checks downstream (safety-language, confidence gate, abstention policy) cannot operate correctly. This is a FAIL-level requirement.

3. **FER slot undocumented:** The TriSense architecture has three expert slots. Hum drops FER for primary use. The architecture document must state explicitly: is the FER slot absent, null-padded, or reserved for future journal TER input? Without this, the meta-learner input shape is undefined.
