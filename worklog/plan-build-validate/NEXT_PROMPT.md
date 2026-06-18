# Next Prompt — Hum AI

**Recommended next pass:** A — Implement legacy Hum audio-features and quality-gate

---

## Rationale

The foundation pass is complete and verified:
- All 15 TypeScript packages exist with full contracts and 89 passing tests
- All naming is consistent: `hum-ai` / `@hum-ai` / `Hum AI`
- All docs (ADRs, architecture, claims, validation, privacy) are present
- The repo is named and structured correctly for GitHub/Vercel as `hum-ai`

The single most valuable next step is implementing **real audio feature extraction** behind the `@hum-ai/audio-features` `FeatureExtractor` contract. Currently `NotImplementedExtractor.extract()` throws. Without real features, the quality gate, domain classifier, and all experts operate on dummy/mocked data.

The legacy Hum spec (in `.extract/hum_spec.txt`) defines a complete acoustic feature dictionary (energy/RMS, pitch contour, spectral, continuity, vibrato, residual instability, musicality, controlled expression) and exact quality-gate thresholds. This is the next honest buildable unit.

---

## Exact Next Prompt

```
You are implementing the Hum AI audio feature extraction layer.

Context:
- Repo: c:/Users/Kafka/Documents/humai
- Product: Hum AI (slug: hum-ai, scope: @hum-ai)
- All packages exist; `@hum-ai/audio-features` has types but `NotImplementedExtractor` throws
- The legacy Hum spec is in `.extract/hum_spec.txt` — read it first
- Thresholds are in `packages/quality-gate/src/thresholds.ts`
- Feature types are in `packages/audio-features/src/features.ts`
- The quality gate in `packages/quality-gate/src/gate.ts` already uses `CaptureMetrics`

Your job:
1. Read `.extract/hum_spec.txt` sections on acoustic features and capture metrics
2. Implement `WebAudioFeatureExtractor` in `packages/audio-features/src/` 
   - Uses the Web Audio API AnalyserNode + AudioBuffer
   - Computes all fields of `AcousticFeatures` and `CaptureMetrics`
   - Works in a browser context (no Node.js audio deps)
3. Implement a Node.js test extractor that accepts a Float32Array of PCM samples
   - Used for unit tests only
4. Write tests that exercise real feature extraction on synthetic signals:
   - Sine wave → pitch detected, voiced, clean
   - White noise → no pitch, noisy
   - Silence → isSilent, rejected by quality gate
   - Long enough clip → passes duration gate
5. Verify `npm run typecheck` and `npm test` still pass (89 + new tests)
6. Do NOT install large ML/audio deps (no librosa, no tensorflow, no numpy)
7. Do NOT fabricate accuracy numbers or train models

Allowed deps: the Web Audio API (browser-native), `@hum-ai/shared-types`, standard math

Do not build UI. Do not deploy. Do not create new packages.
Only stop if a true blocker is reached (missing spec content, ambiguous threshold).
```

---

## Alternative Next Prompts

**B. Run research audit:**
```
Perform a deep research audit of Hum AI's scientific claims.
Read docs/source/INDEX.md, then check each ADR claim against the corresponding .extract/ file.
Flag any claim that is not grounded in a specific source passage.
Produce a CLAIMS_AUDIT.md in docs/claims/.
```

**C. Bootstrap GitHub/Vercel for hum-ai:**
```
Bootstrap the hum-ai repository on GitHub and Vercel.
- Create a new GitHub repo named hum-ai
- Push the current contents of c:/Users/Kafka/Documents/humai as the initial commit
- Create a Vercel project named hum-ai linked to the GitHub repo
- Do not deploy (no app is built yet)
- Verify the Vercel project name and repo name both read "hum-ai"
```

**D. Build first minimal web demo:**
```
Build the first minimal Hum AI web demo in apps/web.
The demo records a 12-second hum, runs the quality gate, and displays:
- Quality decision (clean/borderline/rejected)
- Capture quality score
- Domain classification (hum/speech/singing/etc.)
No affect inference yet — quality gate and domain classifier only.
Stack: React + Vite + TypeScript. No backend.
```

---

## Recommended order

1. **A** (audio features) — unblocks all downstream ML work
2. **B** (research audit) — validates scientific grounding before demo
3. **D** (web demo) — first user-facing surface
4. **C** (GitHub/Vercel) — when ready to share publicly
