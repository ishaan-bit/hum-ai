# ADR-0009: Voice-First Now, Camera-Assisted Later

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Product, ML architecture, eng leads, privacy
- **Packages:** `@hum-ai/expert-fer`, `@hum-ai/affect-model-contracts`, `@hum-ai/fusion-engine`, `apps/*`
- **Related:** [VOICE_FIRST_ROADMAP](../architecture/VOICE_FIRST_ROADMAP.md) · [ADR-0001](0001-architecture-spine.md) · [ADR-0002](0002-domain-aware-audio-modeling.md) · [TRISENSE_ADAPTED_ARCHITECTURE](../architecture/TRISENSE_ADAPTED_ARCHITECTURE.md)

## Context

The architecture spine (ADR-0001) is adapted from TriSense, a **FER + SER + TER** late-fusion design [trisense_architecture]. Carrying that spine faithfully means the type system has a `face` modality and an FER expert seam. That raises a legitimate scope question: is Hum building a camera/visual feature path?

It is not — not now. Hum's core input is a single standardized **12-second hum**. The science that justifies the product is about *voice*: sustained/sung phonation as a language-independent, transferable vocal-biomarker source [vocal_biomarker_and_singing_protocol_support], and prosodic/spectral/perturbation features distinguishing affective/mental states in *speech and voice* [clinical_voice_biomarker_review]. None of it requires a camera. Adding one now would add privacy surface, cost, and failure modes for no core-read benefit, and would blur the scope of every subsequent pass.

## Decision

**Voice-first now; camera-assisted only as a future, opt-in phase.**

1. The current implementation is **hum-only**. The single active modality is audio. The pipeline produces a complete read from the hum alone.
2. **No camera packages, no visual feature extraction, no FER model** are added in the current implementation pass. Concretely: no `getUserMedia({ video })`, no vision/image npm dependencies, no frame/landmark/FER inference.
3. **FER stays an architecture placeholder.** `@hum-ai/expert-fer`'s `FaceEmotionExpert` returns a missing-modality output unless a face frame is explicitly supplied (which the hum flow never does). It exists because the TriSense spine is FER+SER+TER and because the late-fusion engine must tolerate added/absent modalities — *not* because a visual expert is an active target [trisense_architecture].
4. Camera-assisted multimodal hum is **Phase 3** ([VOICE_FIRST_ROADMAP](../architecture/VOICE_FIRST_ROADMAP.md)): real FER model behind the existing `AffectExpert` contract, opt-in per session, degradable (a hum is always sufficient), shipped with its own privacy posture and consent scope.

The phase ladder is: **Phase 1** hum-only intelligence core (current) → **Phase 2** longitudinal voice personalization → **Phase 3** optional camera-assisted multimodal hum.

## Consequences

**Positive**
- Unambiguous scope: reviewers, contributors, and CI can assert "no camera in this pass" against a written decision. A vision dependency or a `video: true` capture is now a flagged scope violation, not a judgment call.
- The architecture stays future-proof without future-building: the `Modality`/`AffectExpert`/FER seam means Phase 3 is an addition behind a stable contract, not a refactor (modality-dominance handling already exists in `FusionEngine.fuse`).
- Smallest privacy surface: voice-only, local-first, raw audio not uploaded by default — no image data anywhere.

**Negative / costs**
- The codebase carries an FER stub and a `face` modality that supply no signal today, which can read as dead code. Mitigated by this ADR and the roadmap making the placeholder's purpose explicit, and by the stub actively exercising fusion's missing-modality path in tests.
- Any multimodal accuracy upside from a visual channel is deferred to Phase 3.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **Build FER now (full TriSense tri-modal)** | Rejected | Adds privacy surface, cost, and scope creep for no core-read benefit; the science underwriting Hum is voice-based [vocal_biomarker_and_singing_protocol_support][clinical_voice_biomarker_review]. |
| **Remove the FER seam entirely** | Rejected | Throws away the clean Phase-3 extension point and diverges from the adopted TriSense spine (ADR-0001); re-adding it later would be a fusion refactor. |
| **Leave scope implicit** | Rejected | Without a written decision, the FER placeholder invites accidental implementation; the ADR + roadmap make the boundary enforceable. |

## Sources

- [trisense_architecture] — IJERT TriSense: FER (ViT) + SER (Wav2Vec2) + TER (DistilRoBERTa) late fusion with modality-dominance handling; the spine Hum adapts and the reason the FER seam exists.
- [vocal_biomarker_and_singing_protocol_support] — Rodrigo & Duñabeitia, *Brain Sci* 2025: singing/sustained phonation as a language-independent vocal-biomarker source — the voice-first scientific basis.
- [clinical_voice_biomarker_review] — Briganti & Lechien, *J Voice* 2025: voice features distinguish affective state; the core signal is vocal, not visual.
