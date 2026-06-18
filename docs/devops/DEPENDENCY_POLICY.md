# Dependency Policy

Hum AI's intelligence core is deliberately **dependency-light and pure-TypeScript**.
This is a scope guard, a privacy guard, and a reproducibility guard — and several of
its rules are enforced automatically by the QA gates (`npm run qa`).

## Principles

1. **Pure TypeScript by default.** The voice-core DSP (feature extraction, quality
   gate, domain classifier, fusion, personalization) is implemented in plain
   TypeScript with standard `Math`. No native addons, no WASM, no build step beyond
   `tsx`/`tsc`. This keeps the core auditable, deterministic, cross-platform, and
   easy to run locally.
2. **No heavy ML / DSP libraries.** The following (non-exhaustive) are **not** to be
   added to any `packages/*` or `apps/*` `package.json`:
   - ML runtimes / frameworks: `torch`, `tensorflow`, `@tensorflow/tfjs*`,
     `onnxruntime*`, `transformers`, `@xenova/transformers`.
   - Audio/DSP heavyweights: `librosa` (Python), `openSMILE`, `meyda`-scale feature
     suites, `fft.js`/`fftw` native bindings, `node-wav`, full codec stacks.
   - Reason: they pull large/native/non-deterministic surfaces, encourage
     "borrowed accuracy" claims, and are unnecessary — the hum feature set is a
     small, well-understood DSP problem. When a real embedding model is warranted
     (Phase 2), it slots in behind the `@hum-ai/affect-model-contracts` `AffectExpert`
     interface as a separately-reviewed, opt-in expert, not as a core dependency.
3. **No camera / computer-vision / face packages — ENFORCED.** Hum is voice-first
   (ADR-0009). The `no-camera-deps` QA gate scans every tracked `package.json` and
   `@hum-ai/expert-fer` source for a denylist (`@mediapipe/*`, `@tensorflow-models/face*`,
   `face-api.js`, `opencv*`, `react-webcam`, …). `expert-fer` must stay a placeholder.
4. **No raw media / weights / secrets in git — ENFORCED.** The `forbidden-files` QA
   gate (a Node port of `privacy-check.yml`) blocks tracked `.wav/.mp3/.m4a/...`,
   model weights (`.pt/.onnx/.safetensors/...`), `.env` (except `.env.example`),
   credential JSON, `.vercel`, private keys, and dataset/clinical-label payloads.
   Synthetic test audio is therefore **generated in code** (`@hum-ai/audio-features`
   `synth.ts`), never committed as files.
5. **Local FFT, not a dependency.** The only frequency-domain need (the spectral
   feature group) is met by a small in-repo radix-2 FFT (`audio-features/src/dsp/fft.ts`).
   If a larger transform is ever needed, prefer extending the local implementation
   or a tiny, audited, pure-JS package over a native binding.

## Allowed dependencies

- Dev tooling only at the root: `typescript`, `tsx`, `@types/node`.
- Internal workspace packages (`@hum-ai/*`).
- A new runtime dependency requires: a clear need that pure TS cannot meet, a size /
  native-surface / license review, and confirmation it trips none of the QA gates
  above. Default answer is "implement it in TypeScript."

## Honesty clause

No dependency (or its absence) may be used to imply accuracy Hum does not have. The
DSP extractor is deterministic signal processing, **not** a clinically validated
biomarker model. See [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md).
