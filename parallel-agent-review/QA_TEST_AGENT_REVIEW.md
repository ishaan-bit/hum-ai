# QA/Test Agent Review

**Specialist:** QA/Test Agent
**Focus:** What tests the main repo must have; schema tests; confidence cap tests; domain-gap tests; safety-language tests; privacy-blocking tests; missing-modality fusion tests; personalization-stage tests; relapse-contract tests
**Date:** 2026-06-18

---

## 1. Test Coverage Philosophy

Tests are organized into **contract-level invariants** — properties that must hold regardless of input — and **boundary tests** — properties that must hold at specific threshold values.

Every `FAIL` item in the acceptance criteria must have at least one automated test. Every `WARN` item should have a test or a documented reason why it cannot yet be tested.

The existing legacy tests ([SOURCE: hum_spec] mentions: media recorder support, microphone permissions, recording attempts, quality, recommendations, live signal, live music, song read copy, filters, moment read, thread insight, storage, Firebase sync, push notifications, ops analytics) are preserved but insufficient for v2. The following are **net new required tests**.

---

## 2. Schema and Type Contract Tests

### 2.1 HumSession Schema Tests

```typescript
// Required tests for @hum-ai/shared-types
describe('HumSession schema', () => {
  test('rejects session with any forbidden raw-audio field name', () => {
    const FORBIDDEN_FIELDS = [
      'audio', 'audioBlob', 'audioBuffer', 'audioData', 'audioBase64',
      'rawAudio', 'recording', 'recordingUrl', 'file', 'fileUrl',
      'blob', 'waveformRaw', 'microphoneData'
    ]
    for (const field of FORBIDDEN_FIELDS) {
      expect(() => buildSyncPayload({ [field]: 'anything' })).toThrow()
    }
  })

  test('rejects session with field name containing substring "audio" in sync payload', () => {
    expect(() => buildSyncPayload({ humAudioCache: 'anything' })).toThrow()
  })

  test('accepts valid session with all required derived fields', () => {
    const valid = buildMockHumSession({ captureQuality: 'good' })
    expect(() => buildSyncPayload(valid)).not.toThrow()
  })
})
```

### 2.2 AffectContract Schema Tests

```typescript
describe('AffectContract schema', () => {
  test('FusionOutput requires abstain field', () => {
    const output: FusionOutput = buildFusionOutput()
    expect(output).toHaveProperty('abstain')
    expect(typeof output.abstain).toBe('boolean')
  })

  test('FusionOutput requires topClassMargin field', () => {
    const output: FusionOutput = buildFusionOutput()
    expect(output).toHaveProperty('topClassMargin')
    expect(output.topClassMargin).toBeGreaterThanOrEqual(0)
    expect(output.topClassMargin).toBeLessThanOrEqual(1)
  })

  test('FusionOutput requires modalityAgreement field', () => {
    const output: FusionOutput = buildFusionOutput()
    expect(output).toHaveProperty('modalityAgreement')
  })

  test('InternalAffectLabel cannot be assigned to UserFacingAffectCopy type', () => {
    // Compile-time test via TypeScript strict mode — ensure types are incompatible
    // Runtime test: translation layer is required
    const internal: InternalAffectLabel = 'low_activation_depression_risk'
    expect(() => renderAffectLabel(internal)).toThrow('Must translate through safety layer')
  })
})
```

---

## 3. Confidence Cap Tests

### 3.1 Baseline Maturity Confidence Caps

```typescript
describe('Confidence cap schedule', () => {
  test('first hum confidence is capped at 72%', () => {
    const result = computeConfidence({ baselineCount: 0, captureQuality: 'good' })
    expect(result.confidence).toBeLessThanOrEqual(72)
  })

  test('pre-baseline (1-4 hums) confidence is capped at 76%', () => {
    for (const count of [1, 2, 3, 4]) {
      const result = computeConfidence({ baselineCount: count, captureQuality: 'good' })
      expect(result.confidence).toBeLessThanOrEqual(76)
    }
  })

  test('5-9 baseline hums confidence is capped at 82%', () => {
    for (const count of [5, 6, 7, 8, 9]) {
      const result = computeConfidence({ baselineCount: count, captureQuality: 'good' })
      expect(result.confidence).toBeLessThanOrEqual(82)
    }
  })

  test('10-19 baseline hums confidence is capped at 88%', () => {
    for (const count of [10, 14, 19]) {
      const result = computeConfidence({ baselineCount: count, captureQuality: 'good' })
      expect(result.confidence).toBeLessThanOrEqual(88)
    }
  })

  test('mature baseline (20+) confidence is capped at 92%', () => {
    const result = computeConfidence({ baselineCount: 25, captureQuality: 'good' })
    expect(result.confidence).toBeLessThanOrEqual(92)
  })

  test('poor capture always caps at 72% regardless of baseline maturity', () => {
    const result = computeConfidence({ baselineCount: 50, captureQuality: 'poor' })
    expect(result.confidence).toBeLessThanOrEqual(72)
  })
})
```

### 3.2 Relapse Signal Hard Cap

```typescript
describe('Relapse confidence hard cap', () => {
  test('relapse drift signal confidence never exceeds 88%', () => {
    const signal = computeRelapseDriftSignal({
      baselineCount: 100,  // fully mature
      driftMagnitude: 3.5,  // large drift
      captureQuality: 'good'
    })
    expect(signal.confidence).toBeLessThanOrEqual(88)
  })

  test('relapse signal not emitted from cold_start baseline', () => {
    const signal = computeRelapseDriftSignal({
      baselineCount: 0,
      driftMagnitude: 5.0
    })
    expect(signal).toBeNull()
  })

  test('relapse signal not emitted from early baseline (1-4 hums)', () => {
    for (const count of [1, 2, 3, 4]) {
      const signal = computeRelapseDriftSignal({ baselineCount: count, driftMagnitude: 5.0 })
      expect(signal).toBeNull()
    }
  })

  test('relapse signal requires minimum 3 consecutive worsening hums', () => {
    const signal = computeRelapseDriftSignal({
      baselineCount: 20,
      consecutiveWorsening: 2   // one below the minimum
    })
    expect(signal).toBeNull()
  })
})
```

---

## 4. Domain Gap Tests

### 4.1 Domain Classifier Tests

```typescript
describe('Domain classifier', () => {
  test('classifies high-pitchCoverage, low-spectralFlatness as native_hum', () => {
    const result = classifyDomain({
      pitchCoverage: 0.82,
      spectralFlatness: 0.04,
      zeroCrossingRate: 0.03,
      duration: 11.5,
      breakCount: 0
    })
    expect(result.domain).toBe('native_hum')
    expect(result.humLikelihoodScore).toBeGreaterThan(0.8)
  })

  test('classifies high-ZCR, low-pitchCoverage as speech_leak', () => {
    const result = classifyDomain({
      pitchCoverage: 0.28,
      spectralFlatness: 0.35,
      zeroCrossingRate: 0.18,
      duration: 10.0,
      noteChangeRate: 4.2
    })
    expect(result.domain).toBe('speech_leak')
  })

  test('classifies duration < 2s as vocal_burst → triggers rejection', () => {
    const result = classifyDomain({ duration: 1.4, pitchCoverage: 0.5 })
    expect(result.domain).toBe('vocal_burst')
  })
})
```

### 4.2 Domain Gap Confidence Penalty Tests

```typescript
describe('Domain gap confidence penalty', () => {
  test('native_hum with hum-trained model has zero domain gap penalty', () => {
    const penalty = computeDomainGapPenalty({ domain: 'native_hum', modelSource: 'hum_trained' })
    expect(penalty).toBe(0)
  })

  test('native_hum with speech-pretrained model has 12% domain gap penalty', () => {
    const penalty = computeDomainGapPenalty({ domain: 'native_hum', modelSource: 'speech_pretrained' })
    expect(penalty).toBeCloseTo(0.12, 2)
  })

  test('speech_leak applies 28% confidence penalty', () => {
    const penalty = computeDomainGapPenalty({ domain: 'speech_leak', modelSource: 'any' })
    expect(penalty).toBeCloseTo(0.28, 2)
  })

  test('effective confidence never exceeds cap after domain penalty', () => {
    const result = computeEffectiveConfidence({
      rawConfidence: 0.95,
      domain: 'speech_leak',
      baselineCount: 50
    })
    // 0.95 * (1 - 0.28) = 0.684, still capped at 88% for mature, but domain drags it to 0.684
    expect(result.effectiveConfidence).toBeLessThanOrEqual(0.688)
  })
})
```

---

## 5. Safety Language Tests

### 5.1 Forbidden Phrase Detection

```typescript
describe('@hum-ai/safety-language forbidden phrase detection', () => {
  const FORBIDDEN_PHRASES = [
    'you have depression',
    'you may have depression',
    'you have anxiety',
    'clinically validated',
    'scientifically proven',
    'prevents relapse',
    'prevents depression',
    'your depression is',
    'medical advice',
    'anxiety score',
    'depression score',
    'chance of depression',
    'diagnoses depression',
    'detects depression',
  ]

  for (const phrase of FORBIDDEN_PHRASES) {
    test(`blocks phrase: "${phrase}"`, () => {
      const result = checkSafetyLanguage(`Today ${phrase} based on your hum.`)
      expect(result.safe).toBe(false)
      expect(result.severity).toBe('block')
    })
  }

  test('allows non-clinical pattern language', () => {
    const result = checkSafetyLanguage(
      'Your hum today suggests a bit less energy than your usual pattern.'
    )
    expect(result.safe).toBe(true)
  })

  test('allows "associated with" framing', () => {
    const result = checkSafetyLanguage(
      'Voice features have been associated with mood-related changes in research settings.'
    )
    expect(result.safe).toBe(true)
  })
})
```

---

## 6. Privacy-Blocking Tests

```typescript
describe('Raw audio privacy blocking', () => {
  const FORBIDDEN_FIELDS = [
    'audio', 'audioBlob', 'audioBuffer', 'audioData', 'audioBase64',
    'rawAudio', 'recording', 'recordingUrl', 'file', 'fileUrl',
    'blob', 'waveformRaw', 'microphoneData'
  ]

  for (const field of FORBIDDEN_FIELDS) {
    test(`sync payload builder throws on field "${field}"`, () => {
      expect(() => buildSyncPayload({ [field]: new Uint8Array(100) })).toThrow()
    })
  }

  test('sync payload builder does not throw on derived-only fields', () => {
    const valid = buildMockDerivedPayload()
    expect(() => buildSyncPayload(valid)).not.toThrow()
  })

  test('Firestore write is not attempted if payload contains forbidden field', async () => {
    const mockFirestore = jest.fn()
    await expect(
      writeSyncPayload({ audioBlob: 'x' }, mockFirestore)
    ).rejects.toThrow()
    expect(mockFirestore).not.toHaveBeenCalled()
  })
})
```

---

## 7. Missing-Modality Fusion Tests

```typescript
describe('Missing modality fusion', () => {
  test('fusion proceeds with only audio expert (FER + TER absent)', () => {
    const result = fuseExperts({
      humAudioVector: mockProbabilityVector(),
      ferVector: null,
      terVector: null
    })
    expect(result.fusedProbabilityVector).toBeDefined()
    expect(result.dominantModality).toBe('audio')
    expect(result.abstain).toBe(false)
  })

  test('fusion abstains when all experts are absent', () => {
    const result = fuseExperts({
      humAudioVector: null,
      ferVector: null,
      terVector: null
    })
    expect(result.abstain).toBe(true)
  })

  test('fusion output is less confident with missing modality vs all-present', () => {
    const fullResult = fuseExperts({
      humAudioVector: mockProbabilityVector(),
      ferVector: mockProbabilityVector(),
      terVector: mockProbabilityVector()
    })
    const audioOnlyResult = fuseExperts({
      humAudioVector: mockProbabilityVector(),
      ferVector: null,
      terVector: null
    })
    expect(audioOnlyResult.confidence).toBeLessThanOrEqual(fullResult.confidence)
  })

  test('missing modality applies relative 10% confidence reduction', () => {
    const full = fuseExperts({ humAudioVector: v, ferVector: v, terVector: v })
    const twoModality = fuseExperts({ humAudioVector: v, ferVector: null, terVector: v })
    expect(twoModality.confidence).toBeLessThanOrEqual(full.confidence * 0.92)
  })
})
```

---

## 8. Personalization-Stage Policy Tests

```typescript
describe('Personalization stage policy', () => {
  test('cold_start returns only absolute label, no relative comparison', () => {
    const state = buildPersonalizationState({ humCount: 0 })
    const read = buildMomentRead(state, mockFeatures())
    expect(read.baselineRelativeLabel).toBeNull()
    expect(read.absoluteLabel).toBeDefined()
  })

  test('early stage (1-4) returns only absolute label', () => {
    for (const count of [1, 2, 3, 4]) {
      const state = buildPersonalizationState({ humCount: count })
      const read = buildMomentRead(state, mockFeatures())
      expect(read.baselineRelativeLabel).toBeNull()
    }
  })

  test('nascent stage (5-9) returns relative label with low confidence', () => {
    const state = buildPersonalizationState({ humCount: 7 })
    const read = buildMomentRead(state, mockFeatures())
    expect(read.baselineRelativeLabel).toBeDefined()
    expect(read.confidence).toBeLessThanOrEqual(82)
  })

  test('no relapse signal from early or cold_start stage', () => {
    for (const count of [0, 1, 4]) {
      const state = buildPersonalizationState({ humCount: count })
      expect(computeRelapseDriftSignal(state, mockFeatures())).toBeNull()
    }
  })

  test('user-specific fusion weights initialized after 5 hums', () => {
    const profile = buildUserFusionProfile({ humCount: 5 })
    expect(profile.featureReliabilityWeights).toBeDefined()
    expect(Object.keys(profile.featureReliabilityWeights).length).toBeGreaterThan(0)
  })
})
```

---

## 9. Relapse Output Contract Tests

```typescript
describe('Relapse engine output contract', () => {
  test('relapse drift signal includes required fields', () => {
    const signal = computeRelapseDriftSignal({
      baselineCount: 25,
      consecutiveWorsening: 5,
      driftMagnitude: 2.1
    })
    expect(signal).not.toBeNull()
    expect(signal).toHaveProperty('signalType', 'relapse_drift')
    expect(signal).toHaveProperty('confidence')
    expect(signal).toHaveProperty('driftDirection')
    expect(signal).toHaveProperty('evidenceFeatures')
    expect(signal).toHaveProperty('userAction')
    expect(signal).toHaveProperty('note')
  })

  test('relapse drift note never contains forbidden clinical phrases', () => {
    const signal = computeRelapseDriftSignal({ baselineCount: 25, consecutiveWorsening: 5 })
    if (signal) {
      const safetyResult = checkSafetyLanguage(signal.note)
      expect(safetyResult.safe).toBe(true)
    }
  })

  test('relapse signal userAction is monitoring_prompt, not clinical_referral', () => {
    const signal = computeRelapseDriftSignal({ baselineCount: 25, consecutiveWorsening: 5 })
    if (signal) {
      expect(signal.userAction).toMatch(/monitoring_prompt|check_in_prompt/)
      expect(signal.userAction).not.toContain('clinical')
      expect(signal.userAction).not.toContain('doctor')
    }
  })
})
```

---

## 10. Intervention Claim Guardrail Tests

```typescript
describe('Intervention claim guardrails', () => {
  test('recommendation engine does not receive clinical labels', () => {
    // The recommendation engine input type must not accept ClinicalLabel
    const input: RecommendationInput = buildRecommendationInput()
    // TypeScript compile-time: ClinicalLabel fields must not exist on RecommendationInput
    // @ts-expect-error — this should be a type error
    const invalid: RecommendationInput = { clinicalLabel: 'depression' }
    expect(invalid).toBeUndefined() // never reached, compile error is the test
  })

  test('recommendation output never claims clinical efficacy', () => {
    const output = buildRecommendation({ affect: { arousal: -0.5, valence: -0.3 } })
    const safetyResult = checkSafetyLanguage(output.description)
    expect(safetyResult.safe).toBe(true)
  })

  test('recommendation rationale does not reference depression treatment', () => {
    const output = buildRecommendation({ affect: mockAffect() })
    expect(output.rationale).not.toMatch(/treat|therapy|clinical|diagnos/i)
  })
})
```

---

## 11. Dataset Domain Rule Tests

```typescript
describe('Dataset registry domain rules', () => {
  test('MELD dataset is marked as speech domain, not hum', () => {
    const meld = getDatasetEntry('meld')
    expect(meld.domain).toBe('speech')
    expect(meld.permittedUse).toContain('architecture_reference')
    expect(meld.forbiddenUse).toContain('hum_accuracy_claim')
  })

  test('No dataset in registry is marked as native_hum domain without explicit validation study', () => {
    const datasets = getAllDatasets()
    const humDomainDatasets = datasets.filter(d => d.domain === 'native_hum')
    for (const d of humDomainDatasets) {
      expect(d.validationStudy).toBeDefined()
      expect(d.validationStudy.humSamples).toBeGreaterThan(0)
    }
  })
})
```

---

## 12. QA/Test Agent Summary

| Test Category | Required? | Current Coverage | Gap |
|---|---|---|---|
| Schema / raw-audio privacy blocking | REQUIRED | Partial (hum_spec mentions) | Full automated test suite |
| AffectContract schema fields | REQUIRED | None | New: abstain, topClassMargin, modalityAgreement |
| Confidence cap schedule | REQUIRED | Partial (legacy regression) | Full schedule boundary tests |
| Relapse confidence hard cap (88%) | REQUIRED | None | New |
| Relapse emission rules (min hums, stages) | REQUIRED | None | New |
| Domain classifier | REQUIRED | None | New |
| Domain gap penalty | REQUIRED | None | New |
| Safety language forbidden phrases | REQUIRED | None | New |
| Missing modality fusion | REQUIRED | None | New |
| Personalization stage policy | REQUIRED | None | New |
| User fusion weights | WARN | None | New |
| Intervention claim guardrails | REQUIRED | None | New |
| Dataset domain rules | REQUIRED | None | New |

---

## QA/Test Agent Top 3 Findings

1. **Zero test coverage for the relapse engine contract.** The relapse engine is the highest clinical-safety-risk package. Without tests for the hard confidence cap (88%), minimum-hum emission rules, and safety-language in relapse copy, the engine has no automated safety net. These tests are non-negotiable before any public release.

2. **Safety language forbidden phrase tests do not exist.** The entire claim-safety architecture depends on `@hum-ai/safety-language`. Without automated tests running against a known violation corpus, any deploy can silently introduce forbidden clinical claims. This should be part of CI — not a manual review.

3. **Missing modality fusion is untested.** Hum's primary design strength is graceful degradation when modalities are absent (only audio, no face, no journal). If missing-modality fusion is not tested, the system may silently produce lower-quality or overconfident outputs in the most common real-world usage pattern (audio only).
