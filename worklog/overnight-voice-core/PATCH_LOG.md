# Patch Log

Chronological record of changes in this pass. Branch
`overnight/voice-core-implementation`, worktree
`c:\Users\Kafka\Documents\humai-overnight-voice-core`. No pushes, no deploys.

## New files

- `packages/audio-features/src/dsp/params.ts` — `DSP_PARAMS`, `EPS`.
- `packages/audio-features/src/dsp/fft.ts` — local radix-2 FFT + `magnitudeSpectrum`.
- `packages/audio-features/src/dsp/signal.ts` — time-domain helpers.
- `packages/audio-features/src/dsp/pitch.ts` — autocorrelation F0 tracker.
- `packages/audio-features/src/dsp/spectral.ts` — short-time spectral features.
- `packages/audio-features/src/hum-extractor.ts` — `computeFeatures` / `HumDspExtractor`.
- `packages/audio-features/src/synth.ts` — deterministic synthetic signal generators.
- `packages/audio-features/test/fft.test.ts` — FFT unit tests.
- `packages/audio-features/test/hum-extractor.test.ts` — extractor tests on synthetic signals.
- `packages/quality-gate/test/extractor-integration.test.ts` — extractor→gate integration.
- `packages/quality-gate/test/threshold-sync.test.ts` — DSP_PARAMS ↔ HUM_THRESHOLDS pin.
- `packages/domain-classifier/test/domain-real.test.ts` — extractor-driven domain tests.
- `packages/orchestrator/test/audio-path.test.ts` — audio entry + sync-payload + relapse-gating.
- `apps/web/demo/voice-core-demo.ts` — safe Node demo (no mic, no camera).
- `docs/devops/DEPENDENCY_POLICY.md`, `docs/packages/audio-features.md`,
  `docs/packages/orchestrator.md` — new docs.
- `worklog/overnight-voice-core/*` — this worklog.

## Modified files

- `packages/audio-features/src/index.ts` — export `hum-extractor`, `synth`,
  `DSP_PARAMS`, and the FFT helpers.
- `packages/domain-classifier/src/classifier.ts` — graded evidence terms +
  margin-aware confidence (behaviour-compatible with existing tests).
- `packages/orchestrator/src/orchestrator.ts` — add `orchestrateHumAudio`,
  `buildHumSyncPayload`, `HumSyncPayload`, and `InternalRead.features`.
- `package.json` — add `demo:voice` script.
- `docs/architecture/VOICE_FIRST_ROADMAP.md` — note the real DSP extractor + audio entry.
- `apps/web/index.html`, `apps/web/README.md` — point at the now-real local voice core.
- `package-lock.json` — from `npm install` of existing devDeps in the fresh worktree
  (tsx / typescript / @types/node only; no new runtime deps).

## Notable mid-pass fixes (from empirical calibration)

1. **Frame-activity floor 0.028 → 0.012.** A soft-but-clean hum was being rejected as
   `too_little_active_audio`. Lowering the floor (just below `softRms`) lets soft hums
   read as active → `usable`, while baseline-relative softness still yields `soft_usable`.
2. **Voicing-weighted `musicalityScore`.** Multiplying by `pitchCoverage` stopped a
   polyphonic music chord (wide *apparent* range, low voicing) from reading as
   "singing"; it now correctly classifies as "music".
3. **FFT helper exports.** `ceilPow2` / `magnitudeSpectrum` etc. were initially not
   re-exported from the package index (broke the FFT test import); added to `index.ts`.

## Temp artifacts (removed before commit)

- `packages/audio-features/smoke.mts`, `tmp-smoke.mts` — calibration smoke scripts,
  deleted. No audio/binary files were ever written to disk.
