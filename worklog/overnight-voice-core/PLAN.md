# Overnight Voice-Core Implementation — PLAN

**Branch:** `overnight/voice-core-implementation`
**Worktree:** `c:\Users\Kafka\Documents\humai-overnight-voice-core`
**Date:** 2026-06-18 (overnight pass)
**Scope:** Voice-first only. No camera, no FER, no visual capture, no heavy ML deps.

## 1. Situation (what already exists — do NOT re-scaffold)

The monorepo already has a complete, tested, **derived-feature** pipeline:

```
audio-features → quality-gate → domain-classifier → expert-ser →
fusion-engine → personalization → relapse → intervention → safety-language
```

- `@hum-ai/orchestrator` (`orchestrateHumRead`) already wires the whole read path
  end-to-end over a hand-built `AcousticFeatures` object and enforces the three
  closed architecture decisions (two-head split / dual baseline / qualitative
  confidence) at the seams.
- `@hum-ai/quality-gate` already consumes `CaptureMetrics` (derived from
  `AcousticFeatures` via `metricsFromFeatures`) and applies the legacy
  `HUM_THRESHOLDS`.
- `@hum-ai/domain-classifier` already has a transparent heuristic classifier over
  the 8 `DOMAIN_CLASSES`.
- QA gates (`npm run qa`): no-clinical-leak, no-camera-deps, no-raw-confidence-copy,
  forbidden-files. **Baseline at start of this pass: typecheck ✅, 163 tests ✅, qa ✅.**

## 2. The one real gap

There is **no real extractor** turning an audio buffer into `AcousticFeatures`.
`NotImplementedExtractor.extract()` rejects by design. Everything downstream is
exercised only with hand-built feature fixtures. **The value of this pass is making
the hum-only voice layer real enough to test locally** — a deterministic pure-TS DSP
extractor that produces the real `AcousticFeatures` from PCM samples, wired through
the existing contracts.

## 3. What this pass will build (behind existing contracts)

### 3.1 `@hum-ai/audio-features` — real DSP extractor (primary)
- Keep `NotImplementedExtractor` and the existing pure helpers (existing tests depend
  on them — do not weaken).
- Add `HumDspExtractor implements FeatureExtractor` + a sync core `computeFeatures()`:
  - mono normalization, sample-rate-aware framing (80 ms RMS windows per `rmsWindowMs`).
  - energy group: durationSec, mean/median RMS, rmsEnergy, peak, active/quiet/clipped
    frame ratios, silenceRatio, noise-floor estimate (500 ms low-energy window), SNR
    proxy, zero-crossing rate.
  - pitch group: autocorrelation F0 per frame → pitchMean, coverage, variance, range
    (semitones), stability, drift, jitter proxy; voicing continuity; longest stable
    segment.
  - spectral group: small local radix-2 FFT (pure TS, no deps) → centroid, bandwidth,
    rolloff, flatness, flux.
  - continuity + expression groups: breaks/pauses, breathiness/shimmer/clarity,
    smoothness, musicality, controlled-expression + residual-instability proxies.
  - flags: isSilent / isTooFaint from the legacy thresholds.
- Add `synth.ts`: **deterministic** synthetic-signal generators (clean hum, silence,
  clipped, interrupted, noisy, speech-like, music-like). Clearly labelled as test/demo
  signal generators (a function generator), NOT real or validated audio. Generates raw
  PCM `AudioInput` so the REAL extractor processes it — honest DSP testing.

### 3.2 `@hum-ai/quality-gate`
- No threshold changes (they already mirror the legacy spec). Add **integration tests**:
  real extractor on synthetic signals → `metricsFromFeatures` → `evaluateQuality`,
  asserting the documented decisions (too-short, near-silent, clipped, interrupted,
  poor-voicing, soft-usable path, clean good/usable).

### 3.3 `@hum-ai/domain-classifier`
- Refine heuristics so they grade **real extractor output** robustly (keep the existing
  interpretable rule structure; no trained model — honest domain guard). Add
  extractor-driven tests: hum, silence, clipped, interrupted, speech-like, music-like.

### 3.4 `@hum-ai/orchestrator`
- Add an **audio-buffer entry point** `orchestrateHumAudio(input)` that runs the real
  extractor then delegates to `orchestrateHumRead`. Existing feature-based entry stays.
- Add `buildHumSyncPayload(read)` that constructs the derived sync payload and runs
  `assertNoRawAudioFields` **before** returning it (privacy boundary made explicit).
- Guarantee the raw buffer never appears in any output (no `samples`/`waveform`/`audio`
  field anywhere).

### 3.5 `apps/web`
- Keep the static placeholder. Add a **safe, mic-free, camera-free Node demo**
  (`apps/web/demo/voice-core-demo.ts`, run via `tsx`) that synthesizes a hum + a silent
  capture, runs them through `orchestrateHumAudio`, and prints the safe `userFacing`
  read. Lightly update copy/README to point at the now-real local pipeline. No
  `getUserMedia`, no camera, no diagnosis language, no validation claims.

### 3.6 Tests (strong, honest, deterministic)
Real extractor on clean hum / silence / clipped / interrupted / noisy; quality-gate
decisions; domain classification; orchestrator happy + rejected paths; no raw-audio
fields in sync/view; no clinical-label leakage; no raw numeric confidence in copy;
recommendation engine gets only the safe view; relapse stays gated before 20 eligible
hums; `npm run qa` still passes. **Do not weaken existing tests.**

### 3.7 Docs
- Patch `VOICE_FIRST_ROADMAP.md` (Phase-1 extractor is now real DSP, still heuristic /
  non-clinical).
- Create `docs/devops/DEPENDENCY_POLICY.md` (no heavy ML / no camera / pure-TS DSP).
- Create `docs/packages/audio-features.md` and `docs/packages/orchestrator.md`.
- This worklog folder.

## 4. Hard constraints (honored throughout)
No push / deploy / force. No secrets. No PDFs/docx/binaries/audio files committed (the
forbidden-files gate enforces this — synthetic audio is generated in code, never stored).
No ML/DSP libraries (librosa/torch/transformers/tensorflow/openSMILE). No camera packages.
No FER runtime. No fake accuracy, no fake WavLM/HuBERT/Wav2Vec2 inference — those stay as
future embedding experts behind the existing `AffectExpert` contract. Be ambitious but
honest: deterministic DSP + synthetic tests, clearly labelled non-clinical.

## 5. Workflow
worktree ✅ → inspect ✅ → PLAN ✅ → extractor → synth → extractor tests → quality-gate
tests → domain heuristics → orchestrator audio path → web demo → docs → run
test/typecheck/qa → adversarial review → commit locally only if green → MORNING_BRIEF.
