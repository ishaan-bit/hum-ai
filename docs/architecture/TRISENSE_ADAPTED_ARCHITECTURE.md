# TriSense-Adapted Architecture (the system spine)

Hum's inference spine is a direct adaptation of the **TriSense** expert-based
*late-fusion* design [trisense_architecture]: independent modality experts emit
probability vectors, a meta-learner combines them, and the combined state is
mapped through a Valence–Arousal circumplex to a recommendation. Hum keeps the
spine and re-shapes it around its thesis — the primary input is a standardized
12-second hum, not a multimedia clip — and replaces the single-label output with
a multi-head, calibrated, abstention-capable inference. Hum is **non-clinical
and not clinically validated**; every head that touches risk is a *marker*, never
a diagnosis.

> **Architecture-reference numbers only.** TriSense reports MELD per-stream
> accuracies of **Visual 18.4% / Audio 38.0% / Text 54.0% → Late Fusion 66.0%**
> on TV-dialogue data [trisense_architecture]. These motivate the design (late
> fusion beats any single stream; a weak stream must not dominate) but are
> **never** Hum's accuracy. Hum reports no accuracy figure here.

## 1. The three-stream origin

TriSense fuses three modality experts [trisense_architecture]:

| Stream | TriSense model | Role in Hum |
| --- | --- | --- |
| **FER** | Vision Transformer (ViT) | Optional companion (`FaceEmotionExpert`, `expert-fer`) |
| **SER** | Wav2Vec 2.0 | **Primary** — the hum itself (`expert-ser` ensemble) |
| **TER** | DistilRoBERTa | Optional companion (`TextEmotionExpert`, `expert-ter`) |

Each expert outputs an independent probability distribution; a Logistic-Regression
meta-learner fuses them; the result is read through Russell's circumplex.

## 2. How Hum reshapes the spine

The `MODALITIES` are `audio | face | text` [shared-types], but the weighting is
inverted relative to TriSense's balanced TV dialogue: **audio is primary**, face
and text are optional. Most hum sessions are audio-only, so the FER and TER
experts usually return a *missing-modality* output (`missingExpertOutput`) and
exercise fusion's degradation path rather than contributing signal.

The crucial reshape is **inside** the audio stream. Where TriSense had one SER
model, Hum runs an ensemble of audio experts (`expert-ser`), ordered by
hum-domain proximity (`defaultAudioExperts`), each with a default domain match:

| Expert (`expertId`) | Bridge / prior | `defaultDomainMatch` |
| --- | --- | --- |
| `HumAcousticExpert` | hum-native interpretable (spec features) | 0.90 |
| `HumEmbeddingExpert` | self-supervised hum embedding (Wav2Vec2/WavLM-style) | 0.85 |
| `SingingPhonationExpert` | sung / sustained phonation [vocal_biomarker_and_singing_protocol_support] | 0.70 |
| `VocalBurstExpressionExpert` | nonverbal vocal-burst expression | 0.55 |
| `SpeechEmotionExpert` | conversational SER prior (off-domain) | 0.40 |
| `SpeechClinicalExpert` | clinical voice-biomarker prior [clinical_voice_biomarker_review] | 0.35 |

Public-dataset priors enter only through the off-domain experts and are
**down-weighted by construction** via their low `domainMatch`; the singing expert
is the closest public bridge to a hum [vocal_biomarker_and_singing_protocol_support].
As native hums accumulate, the hum-native experts and the personal rolling baseline
dominate (see [PERSONALIZATION](./PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md)).

## 3. The expert contract

Every expert — audio, face, or text — implements `AffectExpert` [affect-model-contracts]:

```text
AffectExpert { expertId; modality; labelSpace; predict(features, meta) → ExpertOutput }
```

`ExpertOutput` carries everything fusion needs to weight and audit a vote without
the experts ever seeing each other (the TriSense independence property):

- `available` — `false` for a missing/failed modality; fusion must tolerate this.
- `probabilities` — distribution over the expert's native label space.
- `selfConfidence`, `domainMatch`, `oodScore` — the three weighting signals.
- `embedding?` — reserved for v2 attention / gated-MoE fusion.

`ExpertInputMeta` passes the per-modality `captureQuality` from the quality gate.
Real ViT / Wav2Vec2 / DistilRoBERTa-style models slot in behind this contract
without touching fusion.

## 4. LATE fusion via a LogReg-compatible meta-learner

Hum fuses at the **decision** level, not the feature level. The `MetaLearner`
contract in `fusion-engine` mirrors TriSense exactly — expert probability vectors
in, one `FusionDistribution` out — with a discriminated `kind`:

| Implementation | `kind` | Status |
| --- | --- | --- |
| `StubWeightedMetaLearner` | `stub_weighted` | **v1 default** — deterministic, reliability-weighted, no training |
| `LogisticRegressionMetaLearner` (+ `LogisticRegressionParams`) | `logistic_regression` | **target** — drop-in once weights are fit; `combine` throws until trained |
| (v2) attention / gated MoE | `attention_moe` | roadmap |

`StubWeightedMetaLearner.combine` accumulates `expertWeight(e) × p_label` per
label and normalizes — a faithful, untrained stand-in for the LogReg meta-learner
so the trained model is a drop-in, not a redesign.

**Why late, not early fusion.** (1) *Missing modalities:* audio-only is the norm;
early feature concatenation would need imputation for an absent face/text channel,
whereas late fusion simply drops an unavailable expert. (2) *Modality dominance:*
TriSense's core lesson is that a weak/noisy stream must not corrupt the result
[trisense_architecture]; late fusion lets Hum re-weight per expert per sample.
(3) *Domain heterogeneity:* the audio experts span hum-native to off-domain
clinical-speech priors — keeping their label spaces separate until fusion lets
each carry its own `domainMatch` penalty. (4) *Auditability:* every vote and its
weight is inspectable, which the safety/claims layer requires.

## 5. Shared FUSION_LABELS space and V-A handoff

Experts emit (or are mapped) into one shared 7-label space, defined in the
contract to avoid a dependency cycle [affect-model-contracts]:

```text
FUSION_LABELS = calm_regulated | positive_activation | high_arousal_negative
              | low_mood | tense_anxious | fatigued | neutral_close_to_usual
```

`FUSION_LABEL_AFFECT` anchors each label to a `ValenceArousal` point and a
dominant `AffectStateHead` — this is the TriSense circumplex interlingua that
turns a categorical fused distribution into multi-head output. `FusionEngine.fuse`
derives the dimensional core by taking the distribution-weighted V-A centroid
(`dimensionalFromDist`) and seeds the state scores from the same mapping
(`statesFromDist`).

## 6. Missing-modality and modality-dominance handling

The TriSense "modality dominance" problem [trisense_architecture] is solved
mechanically:

- **Per-expert weight** — `expertWeight(e) = selfConfidence × domainMatch ×
  (1 − oodScore)`; an unavailable expert weighs `0`. A confident-but-off-domain
  speech expert is automatically down-weighted relative to a hum-native one.
- **Reliability renormalization** — only available experts contribute and the
  distribution is renormalized, so dropping a modality redistributes mass rather
  than skewing it. `modalityReliability` reports the per-modality max weight.
- **Agreement guard** — with only one modality present, fused agreement
  (`computeAgreement`) is capped (≤ 0.7): a single channel cannot corroborate
  itself, which lowers confidence.
- **Abstain when none** — if no expert is available, `fuse` returns a neutral
  abstaining inference (`neutralInference`, `abstainReason: poor_capture_quality`).
  Confidence is then clamped and floored by `ConfidenceModelV1` against the
  combined caps (`combineCaps`); below `abstainBelow` the system abstains with an
  `AbstainReason` from `ABSTAIN_REASONS`. See [ADR-0004](../adr/0004-confidence-and-abstention.md).

## 7. Multi-head output vs TriSense single-label

TriSense emits one emotion label. Hum emits `MultiHeadAffectInference`
[affect-model-contracts], because the SER mental-health literature shows
dimensional V-A is under-explored relative to categorical models and that both
are useful [ser_mental_health_review]:

- **Dimensional core** — `dimensional: ValenceArousal` (heads `valence`, `arousal`).
- **15 affect-state scores** — `AffectStateHead`s including the gated risk markers
  `anxiety_like_tension`, `depressive_affect_markers`, `stress_overload`,
  `flattened_affect` (`RISK_MARKER_HEADS`; non-diagnostic wording enforced by
  `safety-language`).
- **Longitudinal heads** — `relapseDrift` and `recoveryWorseningUnchanged`
  (a `DvdsaClass`, `null` until a baseline comparison exists), filled by the
  [relapse engine](./PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) [longitudinal_voice_treatment_response_source].
- **Meta heads** — `uncertainty`, calibrated `confidence` (`ConfidenceReport`),
  `abstained` / `abstainReason`, and `recommendedIntervention`.

## 8. Valence-Arousal recommendation handoff

`fuse` leaves `recommendedIntervention: null`; the [intervention engine](../../packages/intervention-engine/)
fills it. `selectIntervention` sanitizes the fused inference into a `RecommendationView`
(via `toRecommendationView`) and delegates to `selectInterventionFromView`, which reads
only the benign `dimensional` V-A point plus abstracted regulation/mood/energy bands —
never the raw state scores or clinical-risk labels (ADR-0006) — and returns an
`InterventionSuggestion` with a `vaTarget` that gently
steers toward a more regulated point — the TriSense recommendation philosophy,
re-cast as support not treatment. It never acts on an abstained read, and
`escalation_suggestion` is double-gated on a persistent risk pattern and a safety
allowance. Music recommendation is justified as *intervention support only*
[intervention_support_source], never as diagnostic evidence.

## 9. Pipeline diagram

```text
        12s HUM  ──► quality-gate ──► domain-classifier (HumDomainAdapter)
           │            (captureQuality)        │ domainMatch / OOD
           ▼                                     ▼
   ┌─────────────────── AUDIO EXPERTS (expert-ser, primary) ───────────────────┐
   │ HumAcoustic ▸ HumEmbedding ▸ SingingPhonation ▸ VocalBurst ▸ Speech ▸      │
   │ SpeechClinical            each → ExpertOutput{probabilities, selfConf,     │
   └───────────────────────────  domainMatch, oodScore} ─────────────────────┘
           │                         ▲                         ▲
           │           (optional)    │ FaceEmotionExpert       │ TextEmotionExpert
           │                          (expert-fer, usually      (expert-ter, optional
           │                           missing)                  reflective note)
           ▼
   FUSION (fusion-engine) ─ expertWeight ▸ renormalize ▸ MetaLearner.combine
           │   StubWeightedMetaLearner (v1)  →  LogisticRegressionMetaLearner (target)
           ▼
   FusionDistribution over FUSION_LABELS ─ FUSION_LABEL_AFFECT ─► V-A + state heads
           │                              ConfidenceModelV1 + combineCaps ▸ abstain?
           ▼
   MultiHeadAffectInference ──► relapse-engine (longitudinal heads)
           │                └─► intervention-engine (selectIntervention via V-A)
           ▼
   calibrated, non-diagnostic read
```

## 10. v2 roadmap

The contracts already reserve the upgrade path TriSense names
[trisense_architecture]: the `MetaLearner.kind` enum includes `attention_moe`,
and `ExpertOutput.embedding` is reserved so an **attention / gated
mixture-of-experts** fusion can attend over learned per-expert embeddings instead
of probability vectors alone. This is a fusion-layer swap behind the same
`MetaLearner` and `AffectExpert` contracts — experts and downstream consumers are
unchanged. LLM-generated explanations and missing-modality synthesis are deferred.

---

**See also:** [ADR-0001 — expert-based late fusion as the spine](../adr/0001-architecture-spine.md) ·
[ADR-0004 — confidence and abstention](../adr/0004-confidence-and-abstention.md) ·
[CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) ·
[PERSONALIZATION](./PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) ·
[RELAPSE_ENGINE](./PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md) ·
[INTERVENTION_ENGINE](../../packages/intervention-engine/)
