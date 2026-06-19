# Voice-First Roadmap

Hum AI is **voice-first now, camera-assisted later.** The intelligence core is the
standardized **12-second hum** and nothing else. This document is the scope guard:
it states what is in the product today, what is deliberately deferred, and why the
architecture carries a facial placeholder without that placeholder being a current
implementation target. See [ADR-0009](../adr/0009-voice-first-camera-later.md).

> **One-line scope:** the hum is the input. No camera packages, no visual feature
> extraction, no FER model are built in the current implementation. The face
> modality exists in the architecture as an *optional, off-domain, usually-absent*
> input only because the TriSense spine supports it [trisense_architecture].

## Why voice-first

A sustained, sung/melodic vocalization is a **language-independent, highly
transferable** vocal-biomarker source, and singing/simple melodic structures are a
validated assessment-and-intervention modality [vocal_biomarker_and_singing_protocol_support].
The hum strips away the content, language, and privacy exposure of free speech
while preserving the prosodic/spectral/perturbation features that carry affect and
mental-state signal [clinical_voice_biomarker_review]. A camera adds cost,
privacy surface, and failure modes (lighting, framing, presence) without being
necessary for the core read. Voice-first is therefore both the scientifically
grounded and the privacy-respecting default.

## Phases

### Phase 1 — Hum-only intelligence core *(current)*

The whole pipeline runs on the hum alone:

`audio-features → quality-gate → domain-classifier → expert-ser (audio experts) →
fusion-engine (calibrated, capped confidence, abstention) → personalization-engine
(rolling + anchored baseline) → relapse-engine → intervention-engine →
safety-language`.

- Single modality: **audio**. Experts are the SER-family audio experts; FER/TER are present as contracts/stubs but supply no signal in the default path.
- **Real DSP feature extractor (overnight voice-core pass).** `@hum-ai/audio-features` now ships `HumDspExtractor` / `computeFeatures` — a deterministic, dependency-free, pure-TypeScript DSP pipeline (mono normalization, 80 ms RMS framing, noise-floor/SNR proxy, autocorrelation pitch tracking, a small local radix-2 FFT for the spectral group, and voicing/continuity/expression proxies) that turns a raw PCM buffer into the derived `AcousticFeatures`. It replaces `NotImplementedExtractor` for local use. It is **honest signal processing, not a trained or clinically validated model**; the embedding experts (WavLM / HuBERT / Wav2Vec2) remain Phase-2 future work behind the existing `AffectExpert` contract — no fake inference is shipped.
- **Audio-buffer entry point.** `@hum-ai/orchestrator` `orchestrateHumAudio(buffer)` runs the full read from raw PCM; `buildHumSyncPayload` runs `assertNoRawAudioFields` at the sync boundary so the raw buffer can never ride along. The raw audio is consumed by extraction on-device and never stored, synced, or returned.
- Two-head output separation and the consent-gated clinical-risk head (ADR-0006).
- Dual baseline: rolling short-term + anchored long-term (ADR-0007).
- User-facing confidence as qualitative language, never a raw number (ADR-0008).
- **No camera packages. No visual feature extraction. No FER model.**
- Try it: `npm run demo:voice` drives synthetic hums through the whole pipeline (no microphone, no camera).

### Phase 2 — Longitudinal voice personalization

Deepen the *voice* model over time — still hum-only:

- Native-hum-trained SER/embedding experts replacing heuristic stubs.
- Mature dual-baseline tuning (anchor window, EMA α) on real longitudinal data.
- DVDSA-style within-user recovery/worsening/relapse-drift evaluation [longitudinal_voice_treatment_response_source].
- Personalized fusion weights and reliability calibration.
- Still **no camera**. Phase 2 is about getting more out of the hum, not adding a sensor.

### Phase 3 — Optional camera-assisted multimodal hum *(future, opt-in)*

Only here does a camera enter, and only as an **optional assist** to a hum session:

- The existing FER contract (`@hum-ai/expert-fer`, `AffectExpert`) gets a real ViT-style model behind it; the late-fusion engine already tolerates an added/missing modality (modality-dominance handling) [trisense_architecture].
- Camera is **opt-in**, per-session, and degradable — a hum is always sufficient on its own; the face modality can be absent without catastrophic degradation, exactly as the current `FaceEmotionExpert` stub already models.
- New privacy posture, consent scope, and on-device processing rules ship *with* this phase, not before it.

## Non-goals for the current pass

- No `getUserMedia({ video })`, no camera/vision npm packages, no image/frame pipelines.
- No facial feature extraction, landmarking, or FER inference.
- No multimodal fusion *using* a visual signal (the engine supports it; nothing feeds it).
- FER remains an **architecture placeholder** — present because the TriSense spine is FER+SER+TER, not because a visual expert is being implemented now [trisense_architecture].

## Where the placeholder lives (and why it's safe)

- `@hum-ai/expert-fer` — `FaceEmotionExpert` returns a **missing-modality** output unless a face frame is explicitly provided; for hum sessions it is absent by design. It exercises fusion's missing-modality path and nothing more.
- `@hum-ai/affect-model-contracts` — the `AffectExpert` interface and `Modality` taxonomy include `face`, so a future visual expert slots in behind the contract without reshaping fusion.

Keeping the seam in the types (but unfed) is what makes Phase 3 a clean addition instead of a rewrite — while keeping Phase 1/2 unambiguously voice-only.
