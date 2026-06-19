# Diff Review — `main...overnight/voice-core-implementation`

Pre-merge review of the overnight change set. Merge base: `4c03609`.
35 files changed, +3092 / −45.

## Source / implementation (packages)

| File | Change | Notes |
| --- | --- | --- |
| `packages/audio-features/src/dsp/fft.ts` | new | local radix-2 FFT, magnitude spectrum, pow2 helpers. |
| `packages/audio-features/src/dsp/params.ts` | new | `DSP_PARAMS`; energy constants pinned to `HUM_THRESHOLDS`. |
| `packages/audio-features/src/dsp/pitch.ts` | new | autocorrelation pitch. |
| `packages/audio-features/src/dsp/signal.ts` | new | mono normalize, DC offset, RMS framing, SNR proxy. |
| `packages/audio-features/src/dsp/spectral.ts` | new | spectral group proxies. |
| `packages/audio-features/src/hum-extractor.ts` | new | `HumDspExtractor` / `computeFeatures`; sanitizes non-finite samples at ingestion. |
| `packages/audio-features/src/synth.ts` | new | deterministic synthetic test signals (test-time generation, no audio files). |
| `packages/audio-features/src/index.ts` | +4 exports | exports `hum-extractor`, `synth`, `DSP_PARAMS`, FFT utils. `NotImplementedExtractor` (from `./extract`) still exported. |
| `packages/domain-classifier/src/classifier.ts` | edited | graded + margin-aware confidence; transparent guard, no ML certainty. |
| `packages/orchestrator/src/orchestrator.ts` | +97 | `orchestrateHumAudio(buffer)`; `buildHumSyncPayload` runs `assertNoRawAudioFields` + `assertNoClinicalLeak`. |

## Tests (+39, all additive)

`audio-features/test/{fft,hum-extractor}.test.ts`,
`domain-classifier/test/domain-real.test.ts`,
`orchestrator/test/audio-path.test.ts`,
`quality-gate/test/{extractor-integration,threshold-sync}.test.ts`.
Per overnight TEST_REPORT: clean-hum / silence / clipped / interrupted / noisy
extraction; gate decisions; domain routing; orchestrator happy + abstain paths;
no-raw-audio / no-clinical-leak in payloads; relapse gated before 20 hums;
FFT correctness; determinism; sample-rate awareness. No existing test modified.

## Docs

`docs/architecture/VOICE_FIRST_ROADMAP.md` (+3), `docs/devops/DEPENDENCY_POLICY.md`
(new), `docs/packages/{audio-features,orchestrator}.md` (new),
`apps/web/{README.md,index.html}` (copy → real local pipeline).

## Build / config

`package.json` +`demo:voice` script. `package-lock.json` internal workspace
links only (`@hum-ai/dataset-harness`, `orchestrator`, `qa-gates`, etc.) — **no
external, ML, or camera deps**. New demo entry `apps/web/demo/voice-core-demo.ts`
(Node, no mic/camera).

## Worklog

`worklog/overnight-voice-core/*` (9 files) — overnight pass documentation; keep.

## Privacy / safety scan of the diff

- No `.pdf` / `.docx` / audio / weights / `.env` / credentials / datasets added.
- No `@hum` (non-`-ai`) scope introduced.
- No camera package, no `getUserMedia`, no FER runtime.
- DSP described as deterministic proxy, not trained ML — to re-verify in docs post-merge.

**Verdict:** safe to merge. No conflicts expected; no constraint violations in the diff.
