# Test Report

All commands run in the worktree
`c:\Users\Kafka\Documents\humai-overnight-voice-core`.

## Results (final)

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`, strict) | **PASS** |
| `npm test` | **201 / 201 pass**, 0 fail (baseline was 163) |
| `npm run qa` | **PASS** — all 4 gates green |
| `npm run demo:voice` | runs end-to-end, prints safe reads |

Net new tests this pass: **+38** (163 → 201). No existing test was modified, skipped,
weakened, or deleted.

## QA gates (`npm run qa`)

```
ok  no-clinical-leak       — RecommendationView carries only abstracted bands (ADR-0006)
ok  no-camera-deps         — no camera/CV/face package; expert-fer stays a placeholder (ADR-0009)
ok  no-raw-confidence-copy — confidence copy stays qualitative (ADR-0008)
ok  forbidden-files        — no tracked binaries/audio/weights/.env/credentials/datasets
```

## Coverage against the required test areas (from the brief)

| Required area | Where |
| --- | --- |
| real extractor on clean hum | `audio-features/test/hum-extractor.test.ts` |
| extractor on silence | `hum-extractor.test.ts` |
| extractor on clipped waveform | `hum-extractor.test.ts` |
| extractor on interrupted hum | `hum-extractor.test.ts` |
| extractor on noisy hum | `hum-extractor.test.ts` |
| quality-gate decisions | `quality-gate/test/extractor-integration.test.ts` |
| domain classification | `domain-classifier/test/domain-real.test.ts` |
| orchestrator happy path | `orchestrator/test/audio-path.test.ts` |
| orchestrator rejected/poor-capture path | `audio-path.test.ts` (silence abstains) |
| no raw audio fields in sync/view payloads | `audio-path.test.ts` |
| no clinical label leakage | `audio-path.test.ts` + existing `orchestrator.test.ts` |
| no raw numeric confidence in user copy | existing `orchestrator.test.ts` (still passing) |
| recommendation engine gets only safe view | existing `orchestrator.test.ts` |
| relapse gated before 20 eligible hums | `audio-path.test.ts` |
| `npm run qa` still passes | yes |

## Additional tests

- FFT correctness: pure-sinusoid peak bin, DC-only energy, zero-padding
  (`fft.test.ts`).
- Determinism: same seed → byte-identical features.
- Sample-rate awareness: 16 kHz and 48 kHz hums both track ~160 Hz.
- Mono normalization: a large DC offset does not inflate RMS energy.
- Degenerate input: empty / very short buffers handled; invalid sample rate throws.
- Threshold sync: `DSP_PARAMS` energy constants pinned to `HUM_THRESHOLDS`.
- Sync-payload tampering: a smuggled `audioBlob` makes `buildHumSyncPayload` throw.

## Honesty of the tests

Assertions are deliberately tolerant where the underlying quantity is a proxy or an
approximation (e.g. speech-vs-singing is asserted only as `!== "hum"`), and tight where
correctness is exact (FFT peak bin, gate decision, raw-audio/clinical-leak absence,
relapse gating). No test asserts accuracy or clinical validity.
