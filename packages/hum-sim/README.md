# @hum-ai/hum-sim

Hum Simulator — synthesizes controlled-but-realistic hum **waveforms** from an explicit
latent profile, runs them through the **exact production pipeline**
(`computeFeatures → orchestrateHumRead`), and measures where output variation lives and
dies (center-collapse diagnosis).

It is **mechanistic pipeline-validation infrastructure, not clinical evidence** and not a
substitute for real-world validation data. It complements [`@hum-ai/sim-lab`](../sim-lab)
(which sweeps the read path from injected features) by closing the **audio → feature** seam.

```bash
npm run hum-sim                # full center-collapse report (markdown)
npm run hum-sim:fast           # quick, reduced sample count
npm run hum-sim:sweep          # extractor fidelity + per-control read response
npm run hum-sim:fidelity       # fidelity → affect leak table
npm run hum-sim:longitudinal   # pin/un-pin + personalization-damp (stateful)
```

See [`docs/HUM_SIMULATOR.md`](../../docs/HUM_SIMULATOR.md) for architecture, scenario model,
artifact format, and how to extend it, and
[`docs/HUM_SIMULATOR_REPORT.md`](../../docs/HUM_SIMULATOR_REPORT.md) for the first run's
findings, the defect fixed, and before/after evidence.

## Layout

| File | Role |
|---|---|
| `src/latent.ts` | `LatentHumProfile` (intended state) + `latentToControls` (synthesis knobs) |
| `src/synth.ts` | deterministic DSP synthesizer → raw PCM `AudioInput` |
| `src/pipeline.ts` | `runHum` — exact production path, captures every stage into a `SimResult` |
| `src/longitudinal.ts` | `runSequence` — stateful replay (personalization loop + display re-reference) |
| `src/scenarios.ts` | reachability sweeps, archetypes, interactions, robustness, failure/malformed |
| `src/analysis.ts` | variance, reachability, sensitivity Jacobian, extractor fidelity, fidelity-leak, collapse diagnosis |
| `src/report.ts` | runs the suite → machine-readable artifact + markdown |
| `src/cli.ts` | command-line entry (`report`/`fast`/`sweep`/`fidelity`/`longitudinal`) |
