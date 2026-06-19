# Orchestrator Notes

## What was already there (kept intact)

`orchestrateHumRead(features)` already wired the whole read path over derived
`AcousticFeatures` and enforced the closed architecture decisions (two-head split,
dual baseline, qualitative confidence) at the seams. **None of that logic was
changed.** All 9 existing orchestrator tests still pass.

## What was added

### 1. Audio-buffer entry point — `orchestrateHumAudio(input)`

```ts
const features = computeFeatures(input.audio); // extract on-device
return orchestrateHumRead({ features, consent, modelVersion, now, history });
```

- Accepts a raw `AudioInput` buffer (typed audio in).
- Extraction happens here; the raw buffer is then **dropped** — never stored, synced,
  or placed in the returned object. Everything downstream sees `AcousticFeatures` only.
- Returns the same `OrchestratedRead` shape as the feature-based entry.

### 2. Derived features exposed on `internal`

`InternalRead.features` now carries the derived `AcousticFeatures` the read was
computed from (internal-only; never handed to UI/recommendation). This lets the sync
helper and the demo read the derived features from the read alone.

### 3. Sync boundary — `buildHumSyncPayload(read, meta)`

Builds the derived, sync-safe projection (derived features + abstracted quality/domain
summaries + qualitative evidence level + counts) and runs **both** guards BEFORE
returning:

- `assertNoRawAudioFields(payload)` — privacy guard; throws on any raw-audio-like field.
- `assertNoClinicalLeak(payload)` — ADR-0006; throws on any clinical-risk label.

A tampering test (`audioBlob` grafted onto the features) confirms the guard throws.

## Invariants verified by the new tests (`orchestrator/test/audio-path.test.ts`)

- Clean synthetic hum → commits to a read, surfaces a suggestion, quality `clean`,
  domain `hum`, real derived features present (`pitchMeanHz !== null`).
- Silent capture → abstains, no suggestion, quality `rejected`.
- `findRawAudioFields(read) === []` and no key in the whole read is a raw-audio name.
- Sync payload is derived-only: no raw-audio field, no clinical head id/label, no raw
  confidence number; carries `derivedFeatures` + qualitative `evidenceLevel`.
- **Relapse gating:** 19 eligible hums → stage ≠ `relapse_model`, `internal.relapse`
  is `null`; 30 eligible → `relapse_model`, relapse verdict present. (Gate at 20+.)
- Consent gating for the clinical head is unchanged (covered by the existing tests).

## Not changed

- No clinical label is ever sent to the intervention engine (still only
  `toRecommendationView`).
- Hard confidence caps (`combineCaps`) unchanged.
- All user-facing strings still pass through `safety-language` screening.
- Voice-first: no camera/visual modality wired.
