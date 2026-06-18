# DSP Implementation Notes

What was built in `@hum-ai/audio-features` and why each choice is honest and
dependency-free. Everything here is **deterministic signal processing**, not a
trained or clinically validated model.

## Files

| File | Role |
| --- | --- |
| `src/dsp/params.ts` | `DSP_PARAMS` — framing/threshold/search constants. Energy constants mirror the legacy `HUM_THRESHOLDS` (pinned by a sync test). |
| `src/dsp/fft.ts` | Minimal iterative radix-2 Cooley–Tukey FFT + `magnitudeSpectrum` (zero-pads any frame to a power of two). The only frequency-domain code; no FFT dependency. |
| `src/dsp/signal.ts` | Time-domain helpers: DC removal, framing, frame RMS, variance/CV, relative-step (jitter/shimmer basis), least-squares slope, run-length analysis. |
| `src/dsp/pitch.ts` | Autocorrelation F0 per frame, decimated to ~8 kHz, parabolic-interpolated, on the energy frame grid. |
| `src/dsp/spectral.ts` | Hann-windowed short-time spectral features (centroid/bandwidth/rolloff/flatness/flux) averaged over energetic frames. |
| `src/hum-extractor.ts` | `computeFeatures` / `HumDspExtractor` — assembles the full `AcousticFeatures`. |
| `src/synth.ts` | Deterministic synthetic test-signal generators (seeded PRNG). |

## Pipeline

```
toFloat64 + removeDcOffset (mono normalize)
  → 80 ms RMS frames (rmsWindowMs / rmsHopMs, clamped for short input)
  → energy scalars, frame activity/quiet classification, clipping detection
  → noise floor = mean of the quietest ~500 ms of frames; SNR proxy = median frame RMS / noise floor (capped 100)
  → autocorrelation pitch (decimate ×6 to ~8 kHz; 70–500 Hz lag band; parabolic refine)
  → voicing run-length → continuity, breaks, pauses, longest stable segment
  → spectral group via local FFT (40 ms Hann window, 20 ms hop, energetic frames only)
  → expression proxies (clarity, breathiness, shimmer, smoothness, musicality, residual instability, vibrato, attack)
  → flags (isSilent / isTooFaint)
```

## Key decisions & rationale

- **Pitch by decimated autocorrelation.** Decimating to ~8 kHz before the
  autocorrelation shrinks the lag search by the decimation factor (~6×) with no loss
  for F0 ≤ 500 Hz. Pitch frames are computed on the *same* grid as the energy frames,
  so `voiced[]` / `f0Hz[]` align 1:1 with the RMS series. Sub-sample lag is refined by
  parabolic interpolation around the autocorrelation peak.
- **Noise floor & SNR.** A pure synthetic tone has no noise reference, so the
  generators add a small background noise floor (and brief noise-only pads) — exactly
  like a real recording. The noise floor is the mean of the quietest ~500 ms of
  frames; SNR proxy = median (robust) frame RMS / noise floor, capped at 100 so a
  near-zero floor can't blow it up.
- **Frame activity floor = 0.012.** Set just below `softRms` (0.014) so a soft-but-
  clean hum still reads as mostly *active* and reaches the gate's `soft_usable` path
  instead of being wrongly rejected as "too little active audio". (Found and fixed
  during calibration — see PATCH_LOG.)
- **Voicing-weighted musicality.** `musicalityScore` is multiplied by `pitchCoverage`,
  because a polyphonic music chord has wide *apparent* pitch range but low voicing and
  must not read as melodic singing. (Also found during calibration; it moved the
  synthetic music case from "singing" to the correct "music".)
- **Clipping.** A frame is "clipped" when ≥ max(2, 1% of its samples) reach |x| ≥ 0.98.
  A heavily over-driven, hard-clipped hum trips this in nearly every frame.
- **Finiteness.** Every numeric output passes `finite()` / `finiteOrNull()` and the
  ratios are `clamp01`-ed, so no NaN/Infinity can escape into the contract.

## Honesty boundaries

- `jitter`, `shimmerProxy`, `breathinessProxy`, `clarityScore`, `musicalityScore`, the
  residual-instability scores, etc. are **proxies** computed from time/frequency
  measurements — *not* clinical perturbation measures (no real HNR, no cycle-accurate
  jitter/shimmer). They are named `*Proxy` / `*Score` to make that explicit.
- No WavLM / HuBERT / Wav2Vec2 / any embedding inference is implemented or faked.
  Those remain Phase-2 future experts behind the existing `AffectExpert` contract.
- No heavy DSP/ML library, no native binding, no camera/CV package was added
  (DEPENDENCY_POLICY). The FFT is local and small.

## Verified empirically (extractor → gate → classifier) on synthetic signals

| Signal | rmsEnergy | SNR | pitchCoverage | gate | domain |
| --- | --- | --- | --- | --- | --- |
| clean hum | 0.28 | 100 (cap) | 0.95 | clean / good | hum |
| soft hum | 0.034 | ~40 | 0.95 | clean / usable | hum |
| silence | ~0.001 | ~1 | 0.00 | rejected (near_silent) | silence |
| clipped | 0.73 | 100 | 0.95 | rejected (clipped) | hum |
| interrupted | 0.14 | ~1 | 0.28 | rejected (too_interrupted) | hum (low conf) |
| noisy hum | 0.18 | 3.7 | 0.95 | clean / usable | hum |
| speech-like | 0.10 | ~30 | 0.83 | clean / usable | singing (NOT hum) |
| music-like | 0.12 | ~1.3 | 0.33 | rejected (poor_voicing) | music |
