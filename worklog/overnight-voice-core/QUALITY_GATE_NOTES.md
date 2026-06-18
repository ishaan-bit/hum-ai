# Quality-Gate Notes

## Approach: wire, don't rewrite

`@hum-ai/quality-gate` already consumed `CaptureMetrics` (derived from
`AcousticFeatures` via `metricsFromFeatures`) and applied the legacy `HUM_THRESHOLDS`.
Those thresholds already mirror `hum_spec` §7–8, so **no gate logic or threshold was
changed**. The work was to make the *real* extractor produce metrics that drive the
gate correctly, and to prove it with integration tests.

## Legacy rules confirmed against the real extractor

| Rule | Threshold | Demonstrated by synthetic signal |
| --- | --- | --- |
| too short | duration < 8 s | (unit-tested in existing suite) |
| near silent | `isSilent` or meanRms ≤ 0.006 | `synthSilence` → rejected `near_silent` |
| clipped | clippedFrameRatio > 0.08 | `synthClippedHum` → rejected `clipped` |
| too interrupted | silenceRatio > 0.72 | `synthInterruptedHum` → rejected `too_interrupted` |
| mostly quiet | quietFrameRatio > 0.78 | (covered by existing unit tests) |
| too little active | activeFrameRatio < 0.22 | (guarded; soft hums no longer trip it — see below) |
| poor voicing | pitchCoverage < 0.35 | `synthMusicLike` → rejected `poor_voicing` |
| poor SNR | SNR < 2.5 AND peak < 0.05 | (covered by existing unit tests) |
| soft but usable | decisionRMS < softRMS OR < 70% baseline | clean hum @ baselineRmsRatio 0.5 → `soft_usable` |

## Calibration finding (fixed in the extractor, not the gate)

Initial active-frame threshold (0.028) sat *above* a soft hum's frame RMS, so a quiet
-but-clean hum produced `activeFrameRatio ≈ 0` and was wrongly rejected as
`too_little_active_audio`. Fix: lower the extractor's frame-activity floor to 0.012
(just below `softRms`). A soft hum now reads as mostly-active and grades `usable`; a
hum that is quiet *relative to the personal rolling baseline* still reaches
`soft_usable` via `baselineRmsRatio < 0.7` (the real product path). The gate itself was
untouched.

## Threshold-sync guard

`@hum-ai/audio-features` `DSP_PARAMS` duplicates a few energy constants (it can't
import `quality-gate` without a cycle). `quality-gate/test/threshold-sync.test.ts`
asserts the overlapping constants equal `HUM_THRESHOLDS`, so the two copies cannot
silently diverge.

## Tests added

`packages/quality-gate/test/extractor-integration.test.ts` — real extractor →
`metricsFromFeatures` → `evaluateQuality` for: clean→good, silence→rejected(near_silent),
clipped→rejected(clipped), interrupted→rejected(too_interrupted), music→rejected(poor_voicing),
noisy→usable, soft→usable(not rejected), soft_usable via baseline ratio, and the
confidence-cap on rejection. Existing `gate.test.ts` (hand-built metrics) is unchanged
and still passes.
