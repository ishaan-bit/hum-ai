# Next Implementation Prompt

**Use this prompt verbatim as the opening message for the next implementation session.**

---

## PROMPT START

You are the implementation engineer for Hum v2, picking up from where the main foundation session left off.

**Your working directory:** `c:\Users\Kafka\Documents\humai`

**Your first task is verification, not implementation.** Before writing any new code:

---

### Step 1: Run the foundation check script

```bash
cd c:\Users\Kafka\Documents\humai
bash parallel-research-pass/CHECK_MAIN_FOUNDATION.sh 2>&1 | tee /tmp/hum_foundation_check.txt
```

Review the output. Count PASS / WARN / FAIL lines.

---

### Step 2: Compare against the checklist

Read `parallel-research-pass/MAIN_REPO_CHECKLIST.md` and verify each item against the current repo state. For any FAIL in the script or unchecked item in the checklist, note it as a gap to patch.

---

### Step 3: Patch missing architecture items first

Before implementing any features, patch any of these that are missing:

1. **Package structure** — create any missing `packages/@hum-ai/*` directories with correct package.json files
2. **ADRs** — create any missing architecture decision records covering:
   - TriSense adoption (with MELD-as-reference-only note)
   - Domain gap between training data and hum
   - Confidence caps (72/76/82/88/90-92%)
   - Privacy / raw audio policy
3. **Shared types** — add any missing types to `packages/@hum-ai/shared-types`:
   - `AudioFeatures`, `QualityGateResult`, `BaselineStats`, `EmotionOutput`
   - `FusionInput`, `FusionOutput`, `TrendClass`, `TrendOutput`, `StateLabelOutput`
   - `ForbiddenAudioFields` type guard
   - `PersonalizationTier` enum, `DatasetEntry` type
4. **Dataset registry** — populate `packages/@hum-ai/dataset-registry` with entries from `parallel-research-pass/DATASET_REGISTRY_RECOMMENDATIONS.md`
5. **Confidence guardrails** — ensure `packages/@hum-ai/fusion-engine` enforces confidence caps as HARD LIMITS

---

### Step 4: Implement legacy audio features

Using `parallel-research-pass/LEGACY_HUM_FEATURES_TO_SALVAGE.md` as your source of truth, implement the following in `packages/@hum-ai/audio-features/src/`:

**Preprocessing (`preprocessing.ts`):**
- DC offset removal: `abs(mean(x)) >= 0.0001` check
- Edge trim: `0.3 × Fs` from each side; skip if removal > 20% or drops ≥8s to <8s
- Gain normalization: `gain = min(0.82/peak, 10)`, clip to [-1,1]

**RMS/noise (`rms.ts`):**
- 80ms RMS frame windows: `frameSize = round(0.080 × Fs)`
- Noise floor: median of quietest `ceil(500/80)` RMS windows
- Active threshold: `max(0.008, min(noiseFloorRms × 3.2, medianRms × 0.6))`
- Quiet threshold: `max(0.0045, min(noiseFloorRms × 1.7, medianRms × 0.45))`

**Pitch (`pitch.ts`):**
- Frame 2048 samples, hop 1024 samples
- `minLag = floor(Fs/420)`, `maxLag = floor(Fs/75)`
- Autocorrelation: `correlation(lag) = sum(frame[i] × frame[i+lag]) / (frameLength - lag)`
- Voiced if `bestCorrelation >= 0.002 AND frameRms >= 0.02`
- Compute: `pitchMean`, `pitchVariance`, `pitchStability`, `jitter`, `pitchCoverage`

**Spectral (`spectral.ts`):**
- Frame 2048, hop 4096, 160 bins, `maxFreq = min(6000, Fs/2)`
- Compute: `spectralCentroid`, `spectralBandwidth`, `spectralRolloff` (85%), `spectralFlatness`, `spectralFlux`

**Derived features (`derived.ts`):**
- `shimmerProxy`, `hnrProxy = pitchCoverage × (1 - clamp(avgPitchDiff/18, 0, 1))`
- `signalToNoiseProxy`, `breathinessProxy`, `voicingContinuityCoverage`
- `vibratoScore`, `glideScore`, `tremorProxy` (Hum-specific)
- `musicalityScore`, `controlledExpressionScore`
- `residualPitchInstability`, `residualAmplitudeInstability`, `residualInstabilityScore`

---

### Step 5: Implement the quality gate

In `packages/@hum-ai/quality-gate/src/index.ts`, implement the gate using thresholds from `parallel-research-pass/LEGACY_HUM_FEATURES_TO_SALVAGE.md` §7:

| Check | Threshold | Output |
|-------|-----------|--------|
| Too short | duration < 8s | 'rejected' |
| Silent | isSilent OR meanRms ≤ 0.006 | 'rejected' |
| Clipped | clippedFrameRatio > 0.08 | 'poor' or 'rejected' |
| Too interrupted | silenceRatio > 0.72 | 'rejected' |
| Mostly quiet | quietFrameRatio > 0.78 | 'poor' |
| Too little active | activeFrameRatio < 0.22 | 'poor' / 'rejected' |
| Poor voicing | pitchCoverage < 0.35 | 'poor' |
| Soft usable | decisionRms < 0.014 | 'soft_usable' |
| Good | strong RMS, active ratio, low silence/clipping | 'clean' / 'good' |

Return type: `{ decision: 'clean' | 'borderline' | 'rejected'; captureQuality: 'good' | 'usable' | 'soft_usable' | 'poor' | 'rejected'; reasons: string[]; }`

---

### Step 6: Implement the personalization engine baseline algorithm

In `packages/@hum-ai/personalization-engine/src/baseline.ts`:

```typescript
// Rolling window: 24 most recent eligible hums
// Activation: 5 eligible hums
// Per feature:
median = percentile(values, 0.50)
MAD = percentile(abs(value - median), 0.50)
IQR = percentile(values, 0.75) - percentile(values, 0.25)
robustStd = MAD * 1.4826
weightedMean = weighted average after outlier adjustment
stdDev = max(weightedStd, robustStd)
zDelta = (current - baselineMean) / max(stdDev, epsilon)
ratio = current / baselineMean (when > 0)

// Outlier adjustment:
// >2.5 × max(MAD*1.4826, 0.02) from median → replace by median, weight 0.25
// >1.5 × scale from median → weight 0.6
```

Implement the 6 dimension scores and state label selection (see `LEGACY_HUM_FEATURES_TO_SALVAGE.md` §9):
- Neutral band 0.85
- Clear threshold 0.34
- Gap from runner-up ≥ 0.12

---

### Step 7: Implement the confidence model

In `packages/@hum-ai/personalization-engine/src/confidence.ts`:

```typescript
baselineMaturity:
  count <= 1 → 0.45
  count < 5  → 0.52
  count < 10 → 0.66
  count < 20 → 0.78
  else       → 0.90

featureAgreement = clamp(evidenceCount / 4, 0.25, 1)
deviation = clamp(0.45 + deviationStrength * 0.24, 0.45, 0.90)
raw = avg(signal, capture, maturity, agreement, deviation, cleanliness) * musicalityConflict
confidencePercent = round(clamp(raw * 100, lowerBound, cap))

CAPS (hard limits, must enforce):
  baselineCount == 0  → cap = 72
  baselineCount 1-4   → cap = 76
  baselineCount 5-9   → cap = 82
  baselineCount 10-19 → cap = 88
  baselineCount 20+   → cap = 90-92
```

Apply `dataset_confidence_penalty` (from dataset registry) before cap.

---

### Step 8: Wire the ForbiddenAudioFields type guard

In `packages/@hum-ai/shared-types/src/privacy.ts`:

```typescript
const FORBIDDEN_AUDIO_FIELDS = [
  'audio', 'audioBlob', 'audioBuffer', 'audioData', 'audioBase64',
  'rawAudio', 'recording', 'recordingUrl', 'file', 'fileUrl',
  'blob', 'waveformRaw', 'microphoneData'
] as const;

export function assertNoRawAudio(payload: Record<string, unknown>): void {
  for (const field of FORBIDDEN_AUDIO_FIELDS) {
    if (field in payload) {
      throw new Error(`Firestore payload contains forbidden audio field: ${field}`);
    }
  }
}
```

Call `assertNoRawAudio(payload)` before every Firestore write.

---

### Step 9: Write the critical unit tests

At minimum, before considering any package "done":

1. Each quality gate threshold → correct rejection output
2. Confidence cap: raw > cap → output is capped, not raw
3. `assertNoRawAudio` throws for each of the 13 forbidden field names
4. Fusion: null SER input → abstention (no state label)
5. Relapse engine: < 20 eligible hums → returns null
6. Baseline: outlier > 2.5× scale → weight 0.25 applied

---

### References (all in parallel-research-pass/)

- `LEGACY_HUM_FEATURES_TO_SALVAGE.md` — formulas, thresholds, feature types (authoritative)
- `TRISENSE_REQUIREMENTS_EXTRACT.md` — fusion engine architecture
- `PERSONALIZATION_AND_RELAPSE_REQUIREMENTS.md` — typed models, relapse engine design
- `CONFIDENCE_AND_CLAIMS_GUARDRAILS.md` — caps, abstention, forbidden language
- `DATASET_REGISTRY_RECOMMENDATIONS.md` — registry entries with domain gap and confidence penalties
- `VOICE_BIOMARKER_EVIDENCE_MAP.md` — evidence tiers for each feature
- `HUM_VS_SPEECH_DOMAIN_GAP.md` — domain gap confidence penalty multipliers
- `MUSIC_INTERVENTION_REQUIREMENTS.md` — intervention engine constraints
- `MAIN_REPO_CHECKLIST.md` — complete verification checklist

---

### Critical governance rules (must never violate)

1. MELD accuracy numbers (18.4% / 38.0% / 54.0% / 66.0%) are reference figures only. Never display or log as Hum accuracy.
2. Confidence caps are hard limits. No raw model output overrides them.
3. `assertNoRawAudio` must be called before every Firestore write.
4. State labels, trend classes, and relapse signals use non-clinical language only (see `CONFIDENCE_AND_CLAIMS_GUARDRAILS.md`).
5. Music intervention supports wellness; it does not diagnose or treat any condition.
6. Relapse engine does not activate before 20 eligible hums (personalized_fusion tier).
7. All models trained on non-hum datasets have their confidence multiplied by the dataset registry's `confidence_penalty` before the maturity cap is applied.

## PROMPT END
