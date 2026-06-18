# ADR-0002: Domain-Aware Audio Modeling

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture, audio modeling
- **Related:** [ADR-0001 — expert late-fusion spine](./0001-architecture-spine.md) · [ADR-0005 — public datasets as priors, not truth](./0005-public-datasets-as-priors-not-truth.md) · source manifest [`docs/source/INDEX.md`](../source/INDEX.md)

## Context

Hum's only first-class input is a standardized 12-second hum [hum_spec]. A hum is a sustained, well-voiced, narrow-pitch-range, smooth, low-melodic-movement vocalization — it is **not** ordinary speech, **not** a full music track, and **not** necessarily singing. This matters because every public corpus that could give us a cold-start prior was recorded in a *different* vocal domain:

- Clinical voice-biomarker evidence is read/spontaneous **speech** under depression protocols [clinical_voice_biomarker_review].
- SER mental-health evidence is **speech**, mostly used indirectly, with dimensional valence–arousal under-explored [ser_mental_health_review].
- The longitudinal treatment-response method (DVDSA) is paired clinical **speech** (Stroop color-naming) [longitudinal_voice_treatment_response_source].
- Music-emotion intervention evidence is **music listening/making**, not user vocalization [intervention_support_source].
- The closest public bridge is **singing / simple melodic / sustained phonation**, whose acoustic features (F0, jitter, shimmer, spectral) are argued to be language-independent and transferable [vocal_biomarker_and_singing_protocol_support].

If we treat all of this audio as one undifferentiated "voice→affect" signal, a confident model trained on read clinical speech would speak about a hum as if the gesture were identical. It is not. **Audio datasets are not interchangeable**, and the gap between a dataset's recording context and a native hum must be a first-class, quantified property — not an assumption buried in training data. This is the cold-start problem: priors are all we have until native hums accumulate, but priors that ignore the domain gap are actively misleading.

## Decision

Treat the audio stream as **domain-aware** at every stage. Three coordinated mechanisms in `@hum-ai/domain-classifier`, `@hum-ai/shared-types`, and `@hum-ai/expert-ser` enforce this.

### 1. A runtime DomainClassifier over 8 classes

`DomainClassifier.classify(features)` returns a `DomainClassification` (`predicted`, per-class `probabilities`, `confidence`) over the `DOMAIN_CLASSES` vocabulary in `@hum-ai/shared-types`:

`speech · singing · hum · vocal_burst · music · silence · invalid · noisy_unknown`

v1 is `HeuristicDomainClassifier` — a transparent, rule-based stub (not a trained model) scoring `AcousticFeatures` from `@hum-ai/audio-features`. Heuristics map directly to `hum_spec` feature meanings: a hum scores high on voicing (`pitchCoverage > 0.35`), narrow pitch range (`pitchRangeSemitones < 5`), smoothness, voicing continuity, and modest `musicalityScore`; singing diverges on wide range + high musicality; speech on zero-crossing/flux/pauses; music on broadband bright low-voicing energy. Silence and sub-second/`NaN` captures short-circuit to `silence`/`invalid`. The trained classifier later slots in behind the same `DomainClassifier` interface [hum_spec].

### 2. A HumDomainAdapter that converts "what we heard / where the prior came from" into a confidence penalty

`HumDomainAdapter` answers two questions and returns a `DomainAdaptation` (`domainMatch`, `confidencePenalty`, `gap`, `rationale`) — domain mismatch **must** reduce confidence, never silently pass through:

| Path | Method | Penalty source |
| --- | --- | --- |
| **Prior** (dataset → hum) | `adaptPrior(sourceDomain)` | `DEFAULT_DOMAIN_GAP[sourceDomain]` → `domainGapPenalty(gap)` = `DOMAIN_GAP_PENALTY[gap]` |
| **Live capture** (what we heard) | `scoreCapture(classification)` | `HUM_COMPATIBILITY[predicted]`, tempered by classifier `confidence` |

The shared `AudioDomain` → `DomainGap` table drives the prior path. `DEFAULT_DOMAIN_GAP` encodes the science: `native_hum: "none"`, `singing_or_sustained_phonation: "near"` (closest bridge [vocal_biomarker_and_singing_protocol_support]), `vocal_burst_or_nonverbal_expression: "moderate"`, and `clinical_speech` / `acted_speech_emotion` / `multimodal_conversation` / `music_emotion: "far"`. The penalty multipliers in `DOMAIN_GAP_PENALTY` are:

| `DomainGap` | Penalty | Meaning |
| --- | --- | --- |
| `none` | 1.00 | native hum — no penalty |
| `near` | 0.90 | sung/sustained phonation |
| `moderate` | 0.70 | vocal burst / nonverbal |
| `far` | 0.45 | clinical/acted speech, conversation, music |
| `unknown` | 0.40 | worse than `far` — an unlabelled gap cannot be reasoned about |

For live captures, `HUM_COMPATIBILITY` ranges `hum: 1.0`, `singing: 0.85`, `vocal_burst: 0.6`, `speech: 0.4`, `noisy_unknown: 0.25`, `music: 0.2`, `silence`/`invalid`: `0.0`. `scoreCapture` weights compatibility by classifier confidence (`0.5 + 0.5 × confidence`) so an *unsure* "hum" is trusted less than a confident one, then floors the resulting `confidencePenalty` at `0.25 + 0.75 × domainMatch`.

### 3. Multiple conceptual audio experts ordered by hum-domain proximity

The SER stream is not one model. `defaultAudioExperts()` returns an ensemble ordered nearest-to-farthest from a hum, each carrying a `defaultDomainMatch` so the fusion meta-learner can down-weight off-domain opinions:

| Expert (`expertId`) | `defaultDomainMatch` | Domain role |
| --- | --- | --- |
| `expert-ser:hum-acoustic` | 0.90 | hum-native interpretable [hum_spec] |
| `expert-ser:hum-embedding` | 0.85 | self-supervised hum embedding (WavLM-style) |
| `expert-ser:singing-phonation` | 0.70 | sung/sustained-phonation bridge [vocal_biomarker_and_singing_protocol_support] |
| `expert-ser:vocal-burst` | 0.55 | nonverbal expression bridge |
| `expert-ser:speech-emotion` | 0.40 | Wav2Vec2-style SER, off-domain [ser_mental_health_review] |
| `expert-ser:speech-clinical` | 0.35 | clinical voice-biomarker prior, most off-domain + safety-gated [clinical_voice_biomarker_review] |

Each `StubAudioExpert` emits `domainMatch` and `oodScore = 1 − captureQuality × defaultDomainMatch` on its `ExpertOutput`, capping self-confidence (`maxSelfConfidence = 0.35`) because these are untrained stubs. The clinical-leaning expert is the most off-domain *and* the most safety-sensitive: its risk-marker labels are gated downstream and never surface as diagnosis (per the [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) and `@hum-ai/safety-language`).

## Consequences

**Positive**

- Off-domain priors are **down-weighted, not blindly trusted**. A `far`-gap prior enters fusion at ≤0.45 confidence; speech/music live captures are penalized before any affect head is read. As native hums accumulate, the hum-native experts (`domainMatch` 0.85–0.90) and the personal rolling baseline progressively dominate the cold-start priors [hum_spec].
- The domain gap is **explicit and auditable** — `DEFAULT_DOMAIN_GAP`, `DOMAIN_GAP_PENALTY`, `HUM_COMPATIBILITY`, and each entry's `domain_gap_to_hum` in `@hum-ai/dataset-registry` (7 entries) are inspectable constants with rationale strings, not opaque weights.
- Reinforces non-clinical framing: clinical-speech evidence stays a `clinical_prior` carrying a `far` penalty, structurally preventing read-speech findings from being presented as hum truth (ADR-0005).

**Negative / costs**

- More components to build and maintain: a classifier, an adapter, six conceptual experts, and the shared domain vocabulary — versus a single SER model.
- The v1 classifier is a **heuristic stub**, interpretable but not validated; its `confidence` and the resulting capture penalty are approximate until a trained classifier and real hum corpus exist. Penalty constants are starting heuristics, not empirically tuned.
- Per-expert `defaultDomainMatch` values are hand-set priors that will need recalibration once native-hum evaluation data exists.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| **One generic SER model** over all audio | Ignores the domain gap; a model fit on read clinical speech would speak about a hum with false confidence [clinical_voice_biomarker_review]. |
| **Train only on native hum data** | No cold start — Hum has no native hum corpus yet; the first hums would have zero prior. Sung/sustained-phonation priors are the legitimate bridge [vocal_biomarker_and_singing_protocol_support]. |
| **Treat all audio as equivalent** (no classifier, no penalty) | Rejected outright: silently conflates speech, music, singing, and hum, and contradicts the central requirement that a hum is its own vocal gesture [hum_spec]. |

Hum is non-clinical and **not clinically validated**; the public-dataset accuracy figures cited above (and the MELD architecture-reference numbers) are properties of *those* studies on *their* domains, never Hum's accuracy on hums.

## Sources

- `hum_spec` — 12s hum protocol, acoustic feature dictionary, quality gate, baseline statistics.
- `vocal_biomarker_and_singing_protocol_support` — singing/sustained phonation as the closest, language-independent public bridge to a hum.
- `clinical_voice_biomarker_review` — clinical-speech depression markers; clinical prior only, far domain gap.
- `ser_mental_health_review` — SER in mental health; speech-domain, dimensional V-A under-explored.
- `longitudinal_voice_treatment_response_source` — paired clinical-speech method (DVDSA); far domain.
- `intervention_support_source` — music-emotion intervention evidence; far domain, support only.

See [`docs/source/INDEX.md`](../source/INDEX.md) for full citations and extraction provenance.
