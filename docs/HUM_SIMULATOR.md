# Hum Simulator

`@hum-ai/hum-sim` — permanent internal validation infrastructure for the hum-analysis
pipeline. It synthesizes controlled-but-realistic hum **waveforms** from an explicit
latent profile, runs them through the **exact production path** a real microphone capture
takes, and measures where output variation lives and dies — so center-clustering and other
sensitivity failures are a **measured fact**, not a guess.

> **Validation scope.** This validates *implementation behaviour* — the mechanical
> input→feature→output transfer of the deployed code. It is **not** clinical evidence, not
> a dataset, and not a substitute for real-world validation with consented recordings. The
> synthetic hums are not people; they are a reproducible way to push the real pipeline
> across its reachable range.

---

## 1. Why it exists (and how it differs from `@hum-ai/sim-lab`)

`@hum-ai/sim-lab` sweeps the read path by **constructing `AcousticFeatures` directly** and
varying one field at a time (`reference.ts` documents this on purpose: "the clean path for
sensitivity analysis is NOT synth-PCM → `computeFeatures`"). That isolates the *read math*
but, by design, **never exercises the extractor**. The audio → feature seam — whether
realistic audio actually produces features that span the read's input windows — was
therefore untested. That seam is exactly where center-collapse can hide.

`hum-sim` closes the loop:

```
LatentHumProfile → SynthControls → renderHum (PCM) → computeFeatures → orchestrateHumRead
   intended          concrete         WAVEFORM          REAL extractor      REAL read
```

The two harnesses are complementary: sim-lab proves the read *can* span when fed
spanning features; hum-sim proves whether realistic **audio** *delivers* spanning features
and where the end-to-end read collapses.

---

## 2. Architecture — the four layers

The simulator keeps four layers strictly separated so a finding is causal, never circular
(a latent control only shapes the waveform; the production code derives everything else):

| Layer | Module | What it is |
|---|---|---|
| 1. Intended latent state | [`latent.ts`](../packages/hum-sim/src/latent.ts) | `LatentHumProfile` — generic, extensible controls in `[0,1]`, each mapped to a real feature family with its research role (`prosody`/`energy`/`voice_quality`/`fidelity`/`structural`). |
| 2. Synthesis controls | `latentToControls` | Concrete DSP knobs (Hz, harmonic roll-off, vibrato depth, noise RMS…). A transparent, inspectable projection. |
| 3. Extracted features | `computeFeatures` (production) | The real DSP extractor — **not re-implemented**. |
| 4. Predicted outputs | `orchestrateHumRead` (production) | The real read — **not re-implemented**. |

### Synthesizer ([`synth.ts`](../packages/hum-sim/src/synth.ts))

A deterministic, seeded DSP "function generator". Unlike `audio-features`' `synthHum`
(clean steady tones), it can independently vary the **mood-variable** structure the affect
read leans on:

- voiced harmonic tone with controllable **f0 register** and a **slow melodic contour**
  (→ `pitchRangeSemitones`, the melody term);
- **vibrato** (depth + regularity), **frame-scale jitter** (→ `jitter`, `pitchStability`)
  and **shimmer** (→ `shimmerProxy`, `amplitudeStability`);
- **harmonic roll-off** (brightness → `spectralCentroidHz`) swept slowly for **timbral
  change** (→ `spectralFlux`);
- amplitude envelope with **tremolo** and **voicing duty** (→ `activeFrameRatio`);
- **pink (1/f) background noise**, **device low-pass**, **room reverb**, **DC offset**,
  **gain**, and hard **clipping** — the fidelity/structural factors.

> Pink (not white) noise is used deliberately: white noise is flat to Nyquist and its
> thousands of high-frequency bins swamp a tonal hum's few harmonic bins, decoupling
> `spectralCentroidHz` from timbre. Pink noise keeps the floor realistic.

### Pipeline runner ([`pipeline.ts`](../packages/hum-sim/src/pipeline.ts))

`runHum(id, latent, opts)` renders PCM and calls **`orchestrateHumAudio`** (the raw-audio
entry point — `computeFeatures` runs *inside* it). It captures a `SimResult` with every
stage: the synthesis controls, an audio summary, the full feature vector, quality / domain
/ axis-acoustic / displayed / internal-fusion reads, broad states, risk, the user-facing
copy, longitudinal fields, and any warnings (NaN / abstain / reject). The pre-personalization
stages are observed by re-running the **same pure read functions** the orchestrator calls —
no bypass.

### Longitudinal harness ([`longitudinal.ts`](../packages/hum-sim/src/longitudinal.ts))

`runSequence(steps)` replays a scripted sequence through the **full stateful loop**
(`humHistoryFromState → orchestrateHumAudio → ingestHum`) plus the within-user acoustic
ring that feeds the display re-reference. This is the only way to exercise the outputs that
are **not single-hum inferable** (personalization pull, divergence, relapse/longitudinal
drift, and the within-user **re-reference** — the design's counter-measure to the
person+mic pin). Single-hum harnesses pass those through at cold start and would mis-report
them.

### Scenario library ([`scenarios.ts`](../packages/hum-sim/src/scenarios.ts))

Five batteries (the coverage matrix):

1. **Reachability sweeps** — each unit latent control 0→1, multiple seeded realizations.
2. **Archetypes** — combined felt-state profiles (bright/energised, calm/content,
   tense/wound-up, low/flat, + 5 single-axis/neutral), several realizations each.
3. **Interactions** — reinforcing / offsetting / conflicting cue combinations, plus a
   **fidelity-invariance** probe (mood fixed, recording quality varied).
4. **Robustness** — duration, sample-rate, gain, clipping, reverb, noise, device band,
   voicing continuity, register, DC offset.
5. **Failure / boundary** — near-silent, severe noise, too-short/long, unstable pitch,
   heavy clip, barely-voiced, and **malformed raw audio** (empty / NaN / zero-rate) fed
   directly to the extractor.

### Analysis harness ([`analysis.ts`](../packages/hum-sim/src/analysis.ts))

Descriptive statistics over the real pipeline's outputs (nothing widened or fabricated):

- **feature variance** (lowest-variance / dead first);
- **extractor fidelity** — does the DSP recover each synthesis control? (`FEATURE_RECOVERY`);
- **sensitivity Jacobian** — latent → feature and latent → output span / direction /
  monotonicity / saturation;
- **zone histogram** + **V-A reachability** by stage (acoustic backbone → displayed →
  internal fusion);
- **fidelity → affect leak** (drift of the affect read across a fixed-mood fidelity sweep);
- **center-collapse diagnosis** — the synthesis, with human-readable verdicts.

### Report layer ([`report.ts`](../packages/hum-sim/src/report.ts))

`analyze(opts)` runs the suite and returns a machine-readable `AnalysisArtifact`;
`renderMarkdown(artifact)` formats it.

---

## 3. Usage

```bash
# Full center-collapse report (markdown to stdout; non-zero exit if collapse verdicts fire)
npm run hum-sim                       # = cli.ts report
node --import tsx packages/hum-sim/src/cli.ts report --json out.json

# Quick iteration (reduced sample count)
node --import tsx packages/hum-sim/src/cli.ts fast --no-long

# Focused views
node --import tsx packages/hum-sim/src/cli.ts sweep         # extractor fidelity + read response
node --import tsx packages/hum-sim/src/cli.ts fidelity      # fidelity → affect leak table
node --import tsx packages/hum-sim/src/cli.ts longitudinal  # pin/un-pin + personalization damp
```

Programmatic:

```ts
import { runHum, makeLatent, analyze, renderMarkdown } from "@hum-ai/hum-sim";

const r = await runHum("demo", makeLatent({ energy: 0.9, pitchHeight: 0.85, melodicMovement: 0.7 }));
console.log(r.zone, r.displayAxis);

const artifact = await analyze({ skipLongitudinal: false });
console.log(renderMarkdown(artifact));
```

---

## 4. Artifact format

`AnalysisArtifact` (JSON) carries: `meta` (counts, timing), `diagnosis` (zone histogram,
stage V-A boxes, dead features, ranked drivers, failing fidelity leaks, verdicts),
`extractorFidelity`, `featureVariance`, `sensitivities`, `fidelityLeaks`, `robustness`,
`failures`, `malformed`, and `longitudinal`. Each `SimResult` is fully reconstructible from
its `latent` (the raw PCM is not stored — re-render with `renderHum(latent)`, matching the
product's "derived only, raw audio ephemeral" posture).

---

## 5. Extending it

- **Add a latent control:** add the field to `LatentHumProfile`, its role to
  `LATENT_ROLES`, a default to `NEUTRAL_LATENT`, the key to `UNIT_LATENT_KEYS` (if unit
  range), and a mapping line in `latentToControls`. Add a `FEATURE_RECOVERY` row asserting
  which feature it should move, then `npm run hum-sim sweep` to confirm recovery.
- **Add a scenario:** add a generator to `scenarios.ts` and include it in
  `fullScenarioSuite` (or a sequence to `longitudinal.ts`).
- **Add an output to track:** extend `probeVector` in `analysis.ts` so the sensitivity /
  reachability machinery picks it up automatically.

---

## 6. Limitations

- Synthetic audio is **mechanistically realistic, not perceptually human**. It exercises the
  DSP and read code; it does not certify accuracy against felt states.
- Outputs that depend on longitudinal / contextual / non-audio state are tested through the
  **longitudinal harness** or noted as not-single-hum-inferable — they are *not* forced
  through one-shot waveform synthesis.
- Reachability is a property of the **current** weights/windows; it must be re-run after any
  change to `axis-read.ts`, the fusion anchors, or the DSP params.
- This is **not** a clinical or accuracy benchmark. See the validation-scope note at the top.

See [`HUM_SIMULATOR_REPORT.md`](./HUM_SIMULATOR_REPORT.md) for the findings, defects fixed,
and before/after evidence from the first run.
