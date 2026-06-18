# Lane C — Voice-First Scope Guard

**Verdict: PASS.** Hum AI is unambiguously voice-first now, camera-assisted later. No camera implementation this pass.

## Created

- `docs/architecture/VOICE_FIRST_ROADMAP.md` — the scope guard + phase ladder.
- `docs/adr/0009-voice-first-camera-later.md` — the decision (Status: Accepted).

## Roadmap phases (as required)

- **Phase 1 — hum-only intelligence core** *(current)*: whole pipeline on the hum alone; audio modality only; two-head split, dual baseline, qualitative confidence; **no camera packages, no visual feature extraction, no FER model**.
- **Phase 2 — longitudinal voice personalization**: native-hum-trained experts, mature dual-baseline tuning, DVDSA-style evaluation, personalized fusion — still hum-only, still no camera.
- **Phase 3 — optional camera-assisted multimodal hum** *(future, opt-in)*: real FER model behind the existing `AffectExpert` contract; opt-in per session; degradable (a hum is always sufficient); ships with its own privacy posture + consent scope.

## Scope guarantees verified (independent audit)

- **No camera/vision/ML deps** anywhere (19 package.json + lockfile + node_modules).
- **No** `getUserMedia({video})`, video capture, image/frame pipeline, FER inference, or facial landmarks in source.
- `@hum-ai/expert-fer` is a stub returning `missingExpertOutput` on the hum path. A documented synthetic branch returns a uniform distribution (no inference) only when a face frame is explicitly supplied — never by the hum flow. Added a clarifying inline comment this pass.
- FER seam (`AffectExpert`, `Modality` incl. `face`) is retained as an **architecture placeholder** only — present because the TriSense spine is FER+SER+TER, not because a visual expert is a current target.
- Roadmap and ADR-0009 are mutually consistent on the three phases.

## Why the placeholder is safe

Keeping the seam in the types (but unfed) makes Phase 3 a clean addition behind a stable contract (fusion already handles added/missing modalities) while keeping Phase 1/2 unambiguously voice-only. This is documented in both the roadmap ("Where the placeholder lives") and ADR-0009.
