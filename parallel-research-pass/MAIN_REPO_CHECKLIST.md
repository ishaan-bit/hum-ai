# Main Repo Checklist

**Purpose:** Items the main foundation session must have produced for the Hum v2 architecture to be complete. Use this alongside `CHECK_MAIN_FOUNDATION.sh`.

---

## Package structure

- [ ] `packages/@hum-ai/audio-features/` exists with package.json
- [ ] `packages/@hum-ai/quality-gate/` exists with package.json
- [ ] `packages/@hum-ai/personalization-engine/` exists with package.json
- [ ] `packages/@hum-ai/fusion-engine/` exists with package.json
- [ ] `packages/@hum-ai/relapse-engine/` exists with package.json
- [ ] `packages/@hum-ai/intervention-engine/` exists with package.json
- [ ] `packages/@hum-ai/dataset-registry/` exists with package.json
- [ ] `packages/@hum-ai/shared-types/` exists with package.json

---

## Architecture decision records (ADRs)

- [ ] ADR exists for TriSense architecture adoption
- [ ] ADR for TriSense explicitly states: MELD accuracy numbers are reference figures, NOT Hum benchmarks
- [ ] ADR documents FER stream removal (no camera input)
- [ ] ADR documents SER as primary expert stream
- [ ] ADR documents domain gap between training data and hum
- [ ] ADR documents upgrade path: LR meta-learner → attention-based fusion
- [ ] ADR documents WavLM upgrade path for relapse engine
- [ ] ADR for confidence model and maturity caps (72/76/82/88/90-92%)
- [ ] ADR for privacy posture: raw audio not uploaded, forbidden field names

---

## Shared types

- [ ] `AudioFeatures` type with all 45+ features (from hum_spec)
- [ ] `QualityGateResult` type: `{ decision: 'clean' | 'borderline' | 'rejected'; captureQuality: 'good' | 'usable' | 'soft_usable' | 'poor' | 'rejected'; reasons: string[]; }`
- [ ] `BaselineStats` type per feature: `{ median, MAD, IQR, robustStd, weightedMean, stdDev }`
- [ ] `EmotionOutput` type with both categorical and dimensional V-A fields
- [ ] `FusionInput` type with optional/null per-expert probability vectors
- [ ] `FusionOutput` type with confidence, modality weights, V-A output
- [ ] `TrendOutput` type with 5-class TrendClass
- [ ] `StateLabelOutput` type with 6 dimension scores
- [ ] `ForbiddenAudioFields` type guard for Firestore write protection
- [ ] `DatasetEntry` type with domain_gap_to_hum, confidence_penalty, allowed/prohibited uses
- [ ] `PersonalizationTier` enum: population_prior / early_calibration / baseline_active / personalized_fusion

---

## Audio features implementation

- [ ] DC offset removal: `abs(mean(x)) >= 0.0001` check implemented
- [ ] Edge trim: 0.3 × Fs from each side; skip if removal > 20% or drops ≥8s to <8s
- [ ] Gain normalization: `min(0.82/peak, 10)`, clip to [-1,1]
- [ ] RMS frame windows: 80ms (round(0.080 × Fs) samples)
- [ ] Noise floor: median of quietest ceil(500/80) RMS windows
- [ ] Active threshold: `max(0.008, min(noiseFloorRms * 3.2, medianRms * 0.6))`
- [ ] Quiet threshold: `max(0.0045, min(noiseFloorRms * 1.7, medianRms * 0.45))`
- [ ] Pitch: 2048-frame, 1024-hop, autocorrelation, lag Fs/420 to Fs/75, confidence ≥ 0.002, frame RMS ≥ 0.02
- [ ] Spectral: 2048-frame, 4096-hop, 160 bins, maxFreq = min(6000, Fs/2)
- [ ] ZCR, jitter, shimmerProxy, hnrProxy, snrProxy all implemented
- [ ] vibratoScore, glideScore, tremorProxy implemented (Hum-specific features)
- [ ] MIME priority order: webm+opus, webm, mp4+mp4a, mp4, aac, browser default
- [ ] echoCancellation / noiseSuppression / autoGainControl: false in MediaConstraints

---

## Quality gate implementation

- [ ] Rejection gates: duration < 8s, isSilent, clippedFrameRatio > 0.08, silenceRatio > 0.72
- [ ] Poor gate: pitchCoverage < 0.35, quietFrameRatio > 0.78, activeFrameRatio < 0.22
- [ ] soft_usable: decisionRms < 0.014 (faint but technically usable)
- [ ] Output type includes reasons array
- [ ] Unit tests: each rejection threshold produces 'rejected' output
- [ ] Unit tests: clean capture produces 'clean' / 'good'

---

## Personalization engine implementation

- [ ] Baseline activation at 5 eligible hums
- [ ] Rolling 24-hum window for baseline computation
- [ ] Eligibility rules: excludes rejected captures, poor/rejected quality, short/silent/clipped/noisy
- [ ] `median`, `MAD`, `IQR`, `robustStd = MAD * 1.4826` computed per feature
- [ ] Outlier adjustment: > 2.5 × scale → weight 0.25; > 1.5 × scale → weight 0.6
- [ ] `zDelta = (current - mean) / max(stdDev, epsilon)` per feature
- [ ] `ratio = current / baselineMean` per feature (when > 0)
- [ ] 6 dimension scores: activation, stability, clarity, smoothness, continuity, control
- [ ] Label selection: neutral band 0.85, threshold 0.34, gap ≥ 0.12
- [ ] "Close to your usual pattern" returned when conditions not met

---

## Confidence model implementation

- [ ] baselineMaturity levels: 0.45/0.52/0.66/0.78/0.90 at count 0/1-4/5-9/10-19/20+
- [ ] featureAgreement = `clamp(evidenceCount / 4, 0.25, 1)`
- [ ] Raw confidence formula: `avg(signal, capture, maturity, agreement, deviation, cleanliness) × musicalityConflict`
- [ ] Confidence caps enforced as hard limits: 72/76/82/88/90-92%
- [ ] Domain gap penalty applied before maturity cap
- [ ] Unit test: confidence > cap for any tier → test fails

---

## Fusion engine implementation

- [ ] Late fusion over probability vectors (not raw features)
- [ ] SER is primary expert; TER and FER are nullable/optional
- [ ] Meta-learner is LR (first version); calibrated
- [ ] Confidence downgraded when only 1 modality present
- [ ] Output includes: label, V-A coordinates, confidence, modality weights, present modalities
- [ ] Unit test: null SER input → abstention (no label output)
- [ ] Unit test: null TER, non-null SER → lower confidence than dual-modality

---

## Relapse engine implementation

- [ ] Only activates at 20+ eligible hums (personalized_fusion tier)
- [ ] 5-class TrendClass output (not 3-class)
- [ ] WavLM encoder noted as upgrade path in ADR
- [ ] "significant_change" detected → no clinical language in output; only "potential signal"
- [ ] Unit test: < 20 hums → returns null (abstention)

---

## Intervention engine implementation

- [ ] Triggered only when fusion confidence ≥ 72% (first-hum threshold)
- [ ] V-A coordinates → music region mapping documented
- [ ] Track catalog schema includes: valence, arousal, bpm, genre
- [ ] Slow-tempo (60–80 bpm) preference implemented for high-arousal negative states
- [ ] No diagnostic language in recommendation copy

---

## Privacy and security

- [ ] `ForbiddenAudioFields` type guard implemented in `@hum-ai/shared-types`
- [ ] Type guard throws before Firestore write if forbidden field present
- [ ] Unit test: Firestore payload with `audio` field → throws
- [ ] Unit test: Firestore payload with `rawAudio` field → throws
- [ ] Firestore security rules: owner-scoped reads/writes only
- [ ] Raw audio NOT in any Firestore payload (field list validated)

---

## Tests

- [ ] Unit tests for each quality gate threshold
- [ ] Unit tests for confidence cap enforcement per maturity tier
- [ ] Unit test: confidence never exceeds cap
- [ ] Unit test: abstention when captureQuality = 'rejected'
- [ ] Unit test: Firestore write throws on forbidden audio field
- [ ] Unit test: fusion output null when SER input is null
- [ ] Integration test: 12-second hum → features → quality gate → baseline → label → confidence

---

## Documentation

- [ ] Dataset registry populated with entries for MELD, DVDSA, RAVDESS, DAIC-WOZ, Briganti population
- [ ] Each registry entry has allowed_model_uses and prohibited_model_uses
- [ ] Governance flag documented: MELD accuracy ≠ Hum accuracy
- [ ] Claims guardrails doc or CONTRIBUTING note: forbidden user-facing terms
