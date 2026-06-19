# `@hum-ai/audio-features`

The derived-feature layer: it turns a raw, on-device hum capture into the
`AcousticFeatures` object — **the only representation that may be stored or synced**
(raw audio is never represented here; see the `@hum-ai/shared-types` privacy guard).

## What it exports

- **`AcousticFeatures`** — the derived feature schema (energy, pitch, spectral,
  continuity, expression groups + capture flags), distilled from the legacy
  `hum_spec` §6 dictionary. `null` means "not computable for this capture" (e.g. no
  voiced frames), exactly as the spec marks pitch/melodic fields nullable.
- **`CaptureMetrics` / `metricsFromFeatures`** — the minimal subset the quality gate
  reads.
- **`computeFeatures(input)` / `HumDspExtractor`** — the real, deterministic DSP
  extractor (this pass). `humDspExtractor` is a convenience singleton.
- **`NotImplementedExtractor`** — retained: it still rejects, documenting the
  contract for callers that have not adopted the real extractor.
- **pure helpers** — `rms`, `peakAmplitude`, `silenceRatio`, `zeroCrossingRate`.
- **`synth.ts` generators** — deterministic synthetic test signals (see below).
- **`DSP_PARAMS`** and the local **FFT** (`magnitudeSpectrum`, `fftInPlace`, …).

## The DSP pipeline (`computeFeatures`)

Pure TypeScript, no external DSP/ML dependency (see
[DEPENDENCY_POLICY](../devops/DEPENDENCY_POLICY.md)). Deterministic: same samples →
identical features.

```
normalize (mono, DC-removed) → 80 ms RMS frames → energy + noise-floor + SNR proxy
  → autocorrelation pitch (decimated to ~8 kHz) → voicing continuity / breaks
  → spectral group (local radix-2 FFT: centroid/bandwidth/rolloff/flatness/flux)
  → expression proxies → capture flags
```

- **Energy:** `durationSec`, overall + per-frame `meanRms`/`medianRms`/`rmsEnergy`,
  `peakAmplitude`, active/quiet/clipped frame ratios, per-sample `silenceRatio`,
  `noiseFloorRms` (mean of the quietest ~500 ms), `signalToNoiseProxy`
  (`signalLevel / noiseFloor`, capped), `zeroCrossingRate`.
- **Pitch:** normalized short-time autocorrelation per frame over a 70–500 Hz F0
  band (signal decimated to ~8 kHz for speed), with parabolic-interpolation refinement
  → `pitchMeanHz`, `pitchCoverage`, `pitchVariance`, `pitchRangeSemitones` (robust
  p5–p95), `pitchStability`, `jitter` (frame-to-frame relative step), `pitchDrift`
  (net semitone glide), `longestStableSegmentSec`.
- **Continuity:** voiced run-length analysis → `breakCount`, `pauseCount`,
  `avgPauseLengthSec`, `microBreakRatio`, `onsetDelaySec`, `voicingContinuityCoverage`.
- **Spectral:** Hann-windowed local FFT, averaged over energetic frames →
  `spectralCentroidHz`, `spectralBandwidthHz`, `spectralRolloffHz` (85%),
  `spectralFlatness` (Wiener entropy), `spectralFlux`.
- **Expression (PROXIES):** `clarityScore`, `breathinessProxy`, `shimmerProxy`,
  `amplitudeStability`, `smoothnessScore`, `musicalityScore` (voicing-weighted),
  `controlledExpressionScore`, residual-instability scores, `vibratoRegularity`,
  `attackConsistency`.
- **Flags:** `isSilent`, `isTooFaint` (legacy thresholds).

### Honesty boundaries

- These are **deterministic measurements and proxies**, not a trained or clinically
  validated model. Perturbation-style fields are named `*Proxy` / `*Score` on purpose
  — they are not clinical jitter/shimmer/HNR.
- `DSP_PARAMS` duplicates a few legacy energy constants that also live in
  `@hum-ai/quality-gate` `HUM_THRESHOLDS` (to avoid a dependency cycle). A
  cross-package test (`quality-gate/test/threshold-sync.test.ts`) pins them so they
  cannot drift.

## Synthetic test signals (`synth.ts`)

A deterministic software "function generator": `synthHum`, `synthSoftHum`,
`synthSilence`, `synthClippedHum`, `synthInterruptedHum`, `synthNoisyHum`,
`synthSpeechLike`, `synthMusicLike`. They return raw PCM `AudioInput` (exactly what a
microphone would hand the extractor) so the **real** extractor can be exercised in
tests and the local demo with **no audio files committed to git**. They are synthetic
signals, not real or validated audio and not a dataset.
