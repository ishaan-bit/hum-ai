import { test } from "node:test";
import assert from "node:assert/strict";
import { DSP_PARAMS } from "@hum-ai/audio-features";
import { HUM_THRESHOLDS } from "@hum-ai/quality-gate";

/**
 * `@hum-ai/audio-features` intentionally duplicates a handful of legacy energy
 * constants in `DSP_PARAMS` (it cannot import `@hum-ai/quality-gate` without
 * creating a dependency cycle). This test pins the overlap so the two copies can
 * never silently drift — change one and this fails until the other matches.
 */
test("DSP_PARAMS energy constants stay in sync with HUM_THRESHOLDS", () => {
  const shared: [number | string, number | string][] = [
    [DSP_PARAMS.featureMode, HUM_THRESHOLDS.featureMode],
    [DSP_PARAMS.rmsWindowMs, HUM_THRESHOLDS.rmsWindowMs],
    [DSP_PARAMS.noiseFloorWindowMs, HUM_THRESHOLDS.noiseFloorWindowMs],
    [DSP_PARAMS.silenceThreshold, HUM_THRESHOLDS.silenceThreshold],
    [DSP_PARAMS.basicallySilentRms, HUM_THRESHOLDS.basicallySilentRms],
    [DSP_PARAMS.basicallySilentPeak, HUM_THRESHOLDS.basicallySilentPeak],
    [DSP_PARAMS.nearSilenceMeanRms, HUM_THRESHOLDS.nearSilenceMeanRms],
    [DSP_PARAMS.softRms, HUM_THRESHOLDS.softRms],
    [DSP_PARAMS.strongRms, HUM_THRESHOLDS.strongRms],
  ];
  for (const [a, b] of shared) assert.equal(a, b);
});
