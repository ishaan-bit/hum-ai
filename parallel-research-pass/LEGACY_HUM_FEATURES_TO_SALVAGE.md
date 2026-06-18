# Legacy Hum Features to Salvage

**Source:** Hum_Academic_Review_Technical_Specification.docx — Hum project team, draft 15 June 2026  
**Extraction status:** ✅ FULL TEXT EXTRACTED  
**Note:** Formulas extracted verbatim from the spec. These are authoritative.

---

## 1. Audio capture parameters to preserve

| Parameter | Value | Package |
|-----------|-------|---------|
| Target duration | 12 seconds | `@hum-ai/audio-features` |
| Minimum accepted duration | 8 seconds (after trim) | `@hum-ai/quality-gate` |
| MediaConstraints (preferred) | echoCancellation: false, noiseSuppression: false, autoGainControl: false | `@hum-ai/recorder` |
| MediaConstraints (fallback) | `{ audio: true }` | `@hum-ai/recorder` |
| MIME candidates (priority order) | audio/webm;codecs=opus, audio/webm, audio/mp4;codecs=mp4a.40.2, audio/mp4, audio/aac, browser default | `@hum-ai/recorder` |
| Audio channel | Channel 0 only (stereo not downmixed in current impl — known limitation) | `@hum-ai/audio-features` |

---

## 2. Preprocessing pipeline (verbatim from spec)

| Step | Formula | Package |
|------|---------|---------|
| DC offset removal | `x_centered[n] = x[n] - mean(x)` if `abs(mean(x)) >= 0.0001`; else unchanged | `@hum-ai/audio-features` |
| Edge trim | Remove `0.3 * Fs` from each edge; skip if removal > 20% of sample or would reduce ≥8s raw to <8s | `@hum-ai/audio-features` |
| Duration | `duration = trimmedSamples / Fs` | `@hum-ai/audio-features` |
| Peak | `peakAmplitude = max(abs(x_raw[n]))` | `@hum-ai/audio-features` |
| RMS | `rms(x) = sqrt(mean(x[n]²))` | `@hum-ai/audio-features` |
| Normalization gain | `gain = min(0.82 / peak, 10)` if not basically silent; clip to `[-1, 1]` | `@hum-ai/audio-features` |
| Silence ratio | `count(abs(x_norm[n]) < 0.02) / N` | `@hum-ai/audio-features` |
| Zero crossing rate | sign changes / sample transitions | `@hum-ai/audio-features` |

---

## 3. Loudness/noise window algorithm

```
frameSize = round(0.080 * Fs)
frameRms[i] = sqrt(mean(frame_i²))
medianRms = percentile(frameRms, 0.50)
noiseFloorRms = median(quietest ceil(500 / 80) RMS windows)
activeThreshold = max(0.008, min(noiseFloorRms * 3.2, medianRms * 0.6))
quietThreshold = max(0.0045, min(noiseFloorRms * 1.7, medianRms * 0.45))
activeFrameRatio = count(frameRms >= activeThreshold) / frameCount
quietFrameRatio = count(frameRms <= quietThreshold) / frameCount
clippedFrameRatio = count(frames with >2% samples at abs ≥ 0.98) / frameCount
```

**Package:** `@hum-ai/audio-features`  
**Type needed:** `RmsWindowAnalysis { frameRms: number[]; medianRms: number; noiseFloorRms: number; activeThreshold: number; quietThreshold: number; activeFrameRatio: number; quietFrameRatio: number; clippedFrameRatio: number; }`

---

## 4. Pitch estimation algorithm

```
frame size: 2048 samples, hop: 1024 samples
minLag = floor(Fs / 420)
maxLag = floor(Fs / 75)
correlation(lag) = sum(frame[i] * frame[i+lag]) / (frameLength - lag)
bestLag = argmax(correlation(lag))
pitchHz = Fs / bestLag IF bestCorrelation >= 0.002 AND frameRms >= 0.02
```

Frames outside range → null. pitchCoverage = voiced / total.

**Package:** `@hum-ai/audio-features`  
**Type needed:** `PitchAnalysis { pitchContour: (number|null)[]; pitchMean: number|null; pitchCoverage: number; pitchVariance: number|null; pitchStability: number|null; jitter: number|null; }`

---

## 5. Spectral features

```
frame: 2048 samples, hop: 4096, bins: 160, maxFreq: min(6000, Fs/2)
spectralCentroid = sum(f[k] * mag[k]) / sum(mag[k])
spectralBandwidth = sqrt(sum((f[k] - centroid)² * mag[k]) / sum(mag[k]))
spectralRolloff = frequency where cumulative magnitude reaches 85%
spectralFlatness = geometricMean(mag + 1e-8) / arithmeticMean(mag)
spectralFlux = sqrt(mean((mag_t[k] - mag_{t-1}[k])²)) / arithmeticMean(mag_t)
```

**Package:** `@hum-ai/audio-features`

---

## 6. Key acoustic feature types to preserve (from `types/hum.ts`)

| Feature | Formula/method | Range | Primary use |
|---------|---------------|-------|-------------|
| `duration` | trimmedSamples / Fs | seconds | Quality gate |
| `inputRms` | sqrt(mean(raw²)) | 0..1 | Input strength |
| `meanRms` | mean of 80ms RMS windows | 0..1 | Quality, energy |
| `medianRms` | median of 80ms RMS windows | 0..1 | Robust level |
| `rmsEnergy` | sqrt(mean(normalized²)) | RMS | Normalized energy |
| `peakAmplitude` | max(abs(raw)) | 0..1 | Clipping check |
| `activeFrameRatio` | active frames / total | 0..1 | Continuity |
| `quietFrameRatio` | quiet frames / total | 0..1 | Quiet/silence |
| `clippedFrameRatio` | clipped frames / total | 0..1 | Rejection gate |
| `noiseFloorRms` | median of quietest 500ms equivalent | RMS | SNR proxy |
| `silenceRatio` | count(abs<0.02) / N | 0..1 | Continuity |
| `zeroCrossingRate` | sign changes / transitions | 0..1 | Texture/noise |
| `spectralCentroid` | sum(f*mag)/sum(mag) | Hz | Brightness |
| `spectralBandwidth` | weighted spread around centroid | Hz | Spectral width |
| `spectralRolloff` | 85% cumulative magnitude freq | Hz | Brightness |
| `spectralFlux` | normalized frame-to-frame change | unitless | Movement |
| `spectralFlatness` | geometric/arithmetic mean | 0..1 | Noisiness |
| `pitchMean` | mean voiced pitch | Hz | Baseline pitch |
| `pitchVariance` | mean squared deviation | Hz² | Movement |
| `pitchStability` | mean abs adjacent pitch diff | Hz/frame | Stability |
| `jitter` | SD of adjacent pitch diffs | Hz/frame | Micro-wobble |
| `amplitudeStability` | mean abs adjacent RMS diff | RMS/frame | Volume stability |
| `shimmerProxy` | mean adjacent active-RMS change / mean active RMS | unitless | Volume shimmer |
| `hnrProxy` | pitchCoverage * (1 - clamp(avgPitchDiff/18, 0,1)) | 0..1 | Harmonic clarity |
| `signalToNoiseProxy` | inputRms / max(noiseFloorRms, 0.0001) | ratio | Quality |
| `clarityScore` | avg(pitchCoverage, invFlatness, logSNR, HNR, invSilence) | 0..1 | Read confidence |
| `vibratoScore` | rate fit * oscillation regularity * cycle confidence | 0..1/null | Expression |
| `tremorProxy` | rateScore * depth/18 * (1-regularity) | 0..1/null | Irregular oscillation |
| `glideScore` | slope movement * direction consistency * residual fit | 0..1/null | Smooth pitch movement |
| `breakCount` | interior silent voiced gaps ≥ 0.25s | count | Continuity |
| `pauseCount` | interior silent segments ≥ 0.15s | count | Continuity |
| `avgPauseLength` | mean pause ≥ 0.25s | seconds | Interruption |
| `microBreakRatio` | interior raw silent frames < 0.15s / pitch frames | 0..1 | Tiny dropouts |
| `smoothnessScore` | 1 - avg(pitchInstability, jitterInstability, ampInstability) after relief | 0..1/null | Stability |
| `pitchDrift` | (mean last-quarter - mean first-quarter) / pitchMean | signed ratio/null | Pitch landing |
| `musicalityScore` | avg(vibrato, glide, melodic, plateau, stepwise, repeated, contour, rhythm, sustain, ...) | 0..1 | Structured movement |
| `controlledExpressionScore` | avg(voicing continuity, phrase continuity, melodic structure, ...) | 0..1 | Intentional control |
| `residualPitchInstability` | pitch scatter after musical relief | 0..1 | Irregular pitch |
| `residualAmplitudeInstability` | amplitude scatter after relief | 0..1 | Irregular volume |
| `residualInstabilityScore` | avg(residualPitch, residualAmp, dropout, noisy, lack of phrase) | 0..1 | Overall instability |
| `voicingContinuityCoverage` | avg(pitchCoverage, activeRatio, breakCont, pauseCont, microBreakControl) | 0..1 | Continuity |
| `pitchCoverage` | voiced frames / all pitch frames | 0..1/null | Voicing quality |
| `onsetDelay` | first voiced segment start * hopSeconds | seconds/null | Start latency |
| `longestStableSegment` | longest adaptive stable pitch segment | seconds/null | Stability |
| `breathinessProxy` | avg(flatness, invLogSNR, invHNR) | 0..1/null | Air/noise texture |
| `isTooFaint` | derived from raw signal thresholds | boolean | Quality flag |
| `isSilent` | rms ≤ 0.0035 AND peak ≤ 0.012 | boolean | Rejection |

---

## 7. Quality gate thresholds (verbatim)

| Condition | Threshold | Gate action |
|-----------|-----------|-------------|
| Too short | duration < 8s | Rejected |
| Near silent | isSilent OR meanRms ≤ 0.006 | Rejected |
| Clipped | clippedFrameRatio > 0.08 | Poor/rejected |
| Too interrupted | silenceRatio > 0.72 | Rejected |
| Mostly quiet | quietFrameRatio > 0.78 | Poor (unless soft-baseline) |
| Too little active audio | activeFrameRatio < 0.22 | Poor/rejected |
| Poor voicing | pitchCoverage < 0.35 (when available) | Poor |
| Poor SNR | SNR/peak/noise checks fail | Poor/rejected |
| Soft but usable | decisionRms < 0.014, technically faint, < 70% baseline RMS | soft_usable |
| Good | stronger RMS, active ratio, pitch coverage, low silence/clipping, acceptable SNR | clean |

**Quality gate output type:** `{ decision: 'clean' | 'borderline' | 'rejected'; captureQuality: 'good' | 'usable' | 'soft_usable' | 'poor' | 'rejected'; reasons: string[]; }`

---

## 8. Baseline algorithm (verbatim)

```
Baseline activation: 5 eligible hums
Rolling window: 24 most recent eligible sessions
Eligibility: excludes missing/broken features, rejected captures, poor/rejected quality,
             too-short duration, silence, clipping, low active ratio with low RMS,
             poor pitch coverage, noisy captures, zero confidence

For each numeric feature:
  median = percentile(values, 0.50)
  MAD = percentile(abs(value - median), 0.50)
  IQR = percentile(values, 0.75) - percentile(values, 0.25)
  robustStd = MAD * 1.4826
  weightedMean = weighted average after outlier adjustment
  stdDev = max(weightedStd, robustStd)
  zDelta(feature) = (current - baselineMean) / max(stdDev, epsilon(feature))
  ratio(feature) = current / baselineMean, when baselineMean > 0

Outlier adjustment:
  Values > 2.5 * max(MAD * 1.4826, 0.02) from median → replaced by median, weight 0.25
  Values > 1.5 * scale from median → weight 0.6
```

**Type needed:** `BaselineStats { median: number; MAD: number; IQR: number; robustStd: number; weightedMean: number; stdDev: number; }` per feature.  
**Package:** `@hum-ai/personalization-engine`

---

## 9. State label selection algorithm

```
activationScore = avg(relativeDelta(energyRatio), -0.7*silenceZ, 0.45*activeFrameRatioZ)
stabilityScore = avg(steadyComponents, -variableComponents)
clarityScore = avg(clarityZ, 0.7*pitchCoverageZ, -0.6*breathinessZ, -0.35*spectralFlatnessZ)
smoothnessScore = avg(smoothnessZ, melodicSmoothnessZ, -0.45*absPitchDriftZ, -0.35*spectralFluxZ)
continuityScore = avg(-breakCountZ, -pauseCountZ, -avgPauseLengthZ, -0.45*onsetDelayZ, 0.5*pitchCoverageZ)
controlScore = avg(-residualPitchInstabilityZ, -residualAmplitudeInstabilityZ, attackConsistencyZ, 0.4*vibratoRegularityZ)
baselineDistanceScore = avg(abs(componentScores))

Label selection:
  neutralBand = 0.85
  Must clear 0.34 threshold, be outside neutral band, top-runner-up gap ≥ 0.12
  Otherwise: "Close to your usual pattern"
```

**Package:** `@hum-ai/personalization-engine`

---

## 10. Confidence model (verbatim caps)

```
baselineMaturity:
  0.45 if baselineCount <= 1
  0.52 if baselineCount < 5
  0.66 if baselineCount < 10
  0.78 if baselineCount < 20
  0.90 otherwise

featureAgreement = clamp(evidenceCount / 4, 0.25, 1)
deviation = clamp(0.45 + deviationStrength * 0.24, 0.45, 0.90)
rawConfidence = avg(signal, capture, baselineMaturity, featureAgreement, deviation, cleanliness) * musicalityConflict
confidencePercent = round(clamp(rawConfidence * 100, lowerBound, cap))

Caps:
  72%  → first hum (baselineCount = 0)
  76%  → pre-baseline (baselineCount 1–4)
  82%  → 5–9 baseline hums
  88%  → 10–19 baseline hums
  90–92% → mature (20+ hums, varies by captureQuality/evidence)
```

**Package:** `@hum-ai/personalization-engine` (feeds `@hum-ai/fusion-engine`)

---

## 11. Privacy posture (implementation-critical)

| Rule | Implementation |
|------|---------------|
| Raw audio not uploaded by default | `audioKey: null` in HumScreen; no audio field in Firestore payload |
| Forbidden Firestore field names | `audio, audioBlob, audioBuffer, audioData, audioBase64, rawAudio, recording, recordingUrl, file, fileUrl, blob, waveformRaw, microphoneData` |
| Local derived-data only sync | Firestore payload contains quality, feature summaries, read metadata only |
| Firebase rules | Owner-scoped reads/writes only |

**Type needed:** `ForbiddenAudioFields` type guard in `@hum-ai/shared-types` that throws before any Firestore write.  
**Test required:** Raw audio field in Firestore payload throws before write.

---

## 12. Feature ratios and z-deltas (implementation mapping)

| Derived field | Formula | Use |
|--------------|---------|-----|
| `energyRatio` | `current.rmsEnergy / baselineMean.rmsEnergy` | Activation dimension |
| `zDelta(feature)` | `(current - mean) / max(stdDev, ε)` | All dimension scores |
| `ratio(feature)` | `current / baselineMean` when baselineMean > 0 | Secondary comparison |

These are computed in `@hum-ai/personalization-engine` at session evaluation time.
