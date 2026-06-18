# ADR-0001: Architecture Spine — Expert-Based Late Fusion

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture / eng-lead group
- **Related:** [TriSense-Adapted Architecture](../architecture/TRISENSE_ADAPTED_ARCHITECTURE.md), [Domain-Aware Audio](../architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md), [Personalization & Relapse](../architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md), [Claims Ladder](../claims/CLAIMS_LADDER.md)

## Context

Hum's primary input is a standardized **12-second hum** [hum_spec], not a multimedia clip. We need an inference spine that (a) treats audio as the dominant modality while keeping face/text optional, (b) degrades gracefully when modalities are missing — the common case is audio-only — and (c) supports a **multi-head** output (dimensional valence-arousal, affect-state scores, longitudinal/risk-marker heads, meta heads) rather than a single emotion label.

Three properties are non-negotiable:

1. **Robustness to modality dominance.** A confident-but-off-domain channel (e.g. a conversational-speech prior applied to a hum, or a blurry face) must not catastrophically degrade the fused result [trisense_architecture].
2. **Cold-start from priors, then personal dominance.** Public-dataset signal enters only as a prior and must be progressively displaced by native-hum experts plus a personal rolling baseline as hums accumulate [hum_spec].
3. **Non-clinical discipline.** The spine must carry calibrated, capped confidence and an abstention path so risk-marker heads can be gated. Hum is non-clinical and not clinically validated; the affect-prior literature is dimensional-under-explored and methodologically uneven [ser_mental_health_review][clinical_voice_biomarker_review].

The reference architecture, **TriSense** [trisense_architecture], demonstrates exactly the topology these properties demand: independent modality experts (FER/ViT, SER/Wav2Vec2, TER/DistilRoBERTa) emit per-class probability vectors, a **Logistic-Regression meta-learner** fuses them by *late fusion*, and the result is mapped through Russell's Valence-Arousal circumplex to a recommendation. TriSense's MELD per-stream accuracies (Visual 18.4% / Audio 38.0% / Text 54.0% → Late Fusion 66.0%) are **architecture-reference numbers on TV dialogue, never Hum metrics** [trisense_architecture]; they motivate the design (fusion beats any single stream; a weak stream is recoverable) and nothing more.

## Decision

Adopt the **TriSense expert-based late-fusion spine** [trisense_architecture], reshaped for the hum thesis:

```
experts (independent ExpertOutput vectors)
  → MetaLearner.combine → FusionDistribution over FUSION_LABELS
  → FusionEngine.fuse → MultiHeadAffectInference (+ ConfidenceReport)
  → Valence-Arousal mapping → recommended intervention (selected downstream)
```

| Layer | Contract / type | v1 implementation | Target |
| --- | --- | --- | --- |
| Experts | `AffectExpert` / `ExpertOutput` (`affect-model-contracts`) | deterministic stubs: `defaultAudioExperts` (`expert-ser`), `FaceEmotionExpert` (`expert-fer`), `TextEmotionExpert` (`expert-ter`) | ViT / Wav2Vec2 / DistilRoBERTa-class models behind the same contract |
| Fusion label space | `FUSION_LABELS` + `FUSION_LABEL_AFFECT` (V-A anchors) | shared, contract-owned | unchanged |
| Meta-learner | `MetaLearner` (`fusion-engine`) | `StubWeightedMetaLearner` (reliability-weighted) | `LogisticRegressionMetaLearner` + `LogisticRegressionParams` |
| Fusion engine | `FusionEngine.fuse(experts, FusionContext)` | `ConfidenceModelV1`, `combineCaps`, missing-modality abstention | unchanged |
| Output | `MultiHeadAffectInference` | dimensional + 15 state heads + longitudinal + meta | unchanged |

Key bindings to the reference design:

- **Independent experts, no cross-talk.** Each `ExpertOutput` is produced without seeing other experts' predictions, exactly the TriSense late-fusion philosophy [trisense_architecture]. The `MetaLearner` interface (`combine(experts) → FusionDistribution`) is the single fusion seam; trained weights drop in without redesign (the `kind` discriminator is already `"stub_weighted" | "logistic_regression" | "attention_moe"`).
- **Audio primary, face/text optional.** `MODALITIES = audio | face | text` [shared-types], but most sessions are audio-only; FER/TER return `missingExpertOutput` and exercise the degradation path. `FusionEngine.fuse` filters to `available` experts and returns an abstaining `neutralInference` when none remain.
- **Modality-dominance defense.** `expertWeight(e) = clamp01(selfConfidence × domainMatch × (1 − oodScore))` down-weights off-domain experts automatically; the `domainMatch` term is fed by the `HumDomainAdapter` (`domain-classifier`) so a speech/clinical prior cannot dominate a hum-native expert. `computeAgreement` caps corroboration at 0.7 when only one modality is present.
- **V-A interlingua.** `FUSION_LABEL_AFFECT` carries each label's Russell circumplex anchor [trisense_architecture]; `dimensionalFromDist` projects the fused distribution onto valence/arousal, which the intervention engine later maps to a `recommended_intervention` (support, not treatment) [intervention_support_source].
- **Multi-head, not single-label.** The categorical fusion result expands into `MultiHeadAffectInference`: dimensional core, 15 `AFFECT_STATE_HEADS`, longitudinal heads (`relapse_drift`, `recovery_worsening_unchanged`), and meta heads (`uncertainty`, `abstain_reason`, `recommended_intervention`). This is the multi-head + abstention contract the affect-prior literature calls for [ser_mental_health_review].
- **Earned, capped confidence.** `ConfidenceModelV1` blends six evidence signals, tempers by calibration maturity and longitudinal trend, then clamps to caps combined by `combineCaps` (personalization-stage ∩ capture-quality). Caps trace to `hum_spec` (72/76/82/88/90-92%) and are detailed in ADR-0004.

## Consequences

### Positive

- **Robust to missing modalities and modality dominance.** Audio-only is a first-class path, not a fallback; a noisy or off-domain channel is down-weighted rather than corrupting the fused state [trisense_architecture].
- **Modular and swappable.** Experts, meta-learner, and confidence model sit behind stable contracts (`AffectExpert`, `MetaLearner`, `ConfidenceModel`). Real models replace stubs with no orchestration change; the LogReg→attention/MoE upgrade is a constructor swap.
- **Prior-to-personal trajectory is structural.** Public datasets enter only through low-`domainMatch` experts and population caps; the weighting mechanically shifts to hum-native experts and the personal baseline as hums accumulate [hum_spec][vocal_biomarker_and_singing_protocol_support].
- **Safety is enforced at the seam.** Abstention, capped confidence, and risk-marker gating live in the fusion output, not scattered across experts.
- **Interpretable.** Per-expert probabilities, reliability weights, and the binding cap reason are all inspectable — far more debuggable than an end-to-end black box.

### Negative / costs

- **v1 fusion is heuristic.** `StubWeightedMetaLearner` is a reliability-weighted average, **not a trained meta-learner**; `LogisticRegressionMetaLearner.combine` throws until weights are fit (`research/training`). v1 has **no learned synergy** between modalities — the +12% fusion gain TriSense reports is not claimed for Hum.
- **Late fusion forgoes early cross-modal interactions.** Fine-grained correlations between modalities are not modeled until the v2 attention/gated-MoE path (`embedding` is reserved on `ExpertOutput` for this).
- **Label-space compression.** Experts must map their native labels into the compact `FUSION_LABELS` space, losing resolution at the expert boundary.
- **Calibration debt.** Caps and the abstention floor are spec-derived, not yet empirically calibrated; this is tracked in the [Validation Plan](../validation/VALIDATION_PLAN.md) and ADR-0004.

## Alternatives considered

| Alternative | Why rejected (per [trisense_architecture]) |
| --- | --- |
| **Early / feature fusion** (concatenate raw features, single classifier) | Curse of dimensionality; fragile to missing modalities — a silent-audio or no-text hum breaks the fixed input vector. Hum is audio-only most of the time, so this is the worst-case fit. |
| **End-to-end multimodal transformer** | Data-hungry and opaque; Hum's native-hum corpus starts at zero (cold-start from priors only) and an end-to-end model cannot express the prior→personal weighting or per-expert abstention we require. |
| **Graph-based fusion (MMGCN-style)** | Heavy; over-engineered for two-to-three sparse modalities and incompatible with the local-first, derived-data-only runtime [hum_spec]. |
| **Single emotion classifier** | Cannot serve the dimensional + categorical + longitudinal multi-head contract the affect-prior literature motivates [ser_mental_health_review]. |

**Chosen:** expert-based late fusion — the only option that satisfies missing-modality robustness, prior-to-personal weighting, per-expert interpretability, and the multi-head/abstention contract simultaneously.

**v2 path (not in this ADR's scope):** attention-based fusion / gated mixture-of-experts, with `ExpertOutput.embedding` and the `"attention_moe"` meta-learner kind already reserved [trisense_architecture].

## Sources

- **[trisense_architecture]** Ilyas et al., "TriSense: MultiModel Emotion Detector and Music Recommender," *IJERT* 14(04), 2026 — system spine; MELD numbers are architecture-reference only.
- **[hum_spec]** Hum project team, "A Local-First Vocal Signal System for Reflective Daily Self-Awareness," working paper, 2026 — 12s protocol, baseline, confidence caps, privacy.
- **[ser_mental_health_review]** Jordan et al., *JMIR Ment Health* 2025;12:e74260 — dimensional + categorical multi-head, abstention discipline.
- **[clinical_voice_biomarker_review]** Briganti & Lechien, *J Voice* 2025 — clinical prior only; methodological-bias caveats.
- **[vocal_biomarker_and_singing_protocol_support]** Rodrigo & Duñabeitia, *Brain Sci* 2025, 15, 762 — scientific basis for the hum/sung-tone protocol.
- **[intervention_support_source]** de Witte et al., *Health Psych Rev* 14(2), 2020 — intervention support only, never diagnostic.
