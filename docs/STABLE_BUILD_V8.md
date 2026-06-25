# Hum AI — Stable Build v8

> **One line.** v8 adds the **Hum Simulator** — permanent, run-anytime infrastructure that
> synthesizes realistic hum *waveforms* and pushes them through the **exact production
> pipeline** to audit, end-to-end, where the read responds and where it collapses — and uses
> it to find and fix one genuine root-cause defect (a fidelity→**arousal** leak), while
> honestly reporting (not papering over) a calibration ceiling it surfaced.

Builds on [v7](STABLE_BUILD_V7.md) (medical early-signal layer, always-on diary, finished
arousal recal). No change to the privacy/safety posture, the consumer flow, or the web bundle:
v8 is an **engine fix + a new developer-facing audit package**. The blinded screening head
stays firewalled out of the read path; ADR-0005/0006/0008/0009 seams are preserved.

Full detail: [`HUM_SIMULATOR.md`](HUM_SIMULATOR.md) (architecture/usage) and
[`HUM_SIMULATOR_REPORT.md`](HUM_SIMULATOR_REPORT.md) (findings + before/after evidence).

## 1. The Hum Simulator — `@hum-ai/hum-sim` (new)

A first-class, **anytime end-to-end audit** of the whole read system. Where
[`@hum-ai/sim-lab`](../packages/sim-lab) sweeps the read path from *injected* `AcousticFeatures`
(its `reference.ts` says so on purpose: "the clean path is NOT synth-PCM → `computeFeatures`"),
hum-sim closes the seam sim-lab deliberately skips — **audio → feature extraction** — which is
exactly where center-clustering can hide. The two are complementary: sim-lab proves the read
*can* span when fed spanning features; hum-sim proves whether realistic **audio** *delivers*
spanning features and where the end-to-end read collapses.

### 1.1 Four strictly-separated layers (so a finding is causal, never circular)

```
LatentHumProfile → SynthControls → renderHum (PCM) → computeFeatures → orchestrateHumRead
   intended           concrete        WAVEFORM         REAL extractor      REAL read
```

A latent profile only shapes the **waveform**; it never sets an expected output or feeds a
hidden label into the pipeline. The production code derives everything else. So if a latent
control moves but an output doesn't, the break is in extraction or read math — not a label we
smuggled through.

### 1.2 The synthesizer — `synth.ts` (real DSP, not bare sines)

Deterministic, seeded. Unlike `audio-features` `synthHum` (clean steady tones — which pin the
mood-variable features the read leans on: `pitchRangeSemitones≈0`, `spectralFlux≈0`,
`jitter≈0`), it can independently vary a voiced harmonic tone's **f0 register + slow melodic
contour** (→ `pitchRangeSemitones`), **vibrato** (depth + regularity), **frame-scale jitter**
and **shimmer**, **harmonic roll-off** (brightness) swept for **timbral change** (→
`spectralFlux`), amplitude **tremolo** + **voicing duty**, plus **pink (1/f) background noise**,
**device low-pass**, **room reverb**, **clipping**, **gain**, **DC**, and **sample-rate**.

> Pink (not white) noise is used deliberately: white noise is flat to Nyquist and its many
> high-frequency bins swamp a tonal hum's few harmonic bins, decoupling `spectralCentroidHz`
> from timbre. Pink keeps the noise floor realistic.

### 1.3 Pipeline runner + longitudinal harness

- `runHum` renders PCM and calls **`orchestrateHumAudio`** (the raw-audio entry point —
  `computeFeatures` runs *inside* it), capturing every stage into a `SimResult`: synthesis
  controls, audio summary, full feature vector, quality/domain/axis-acoustic/displayed/internal
  reads, broad states, risk, user-facing copy, longitudinal fields, warnings. No bypass.
- `runSequence` replays a scripted **sequence** through the full stateful loop
  (`humHistoryFromState → orchestrateHumAudio → ingestHum` + the within-user acoustic ring) —
  the only way to exercise the outputs that are **not single-hum inferable** (personalization
  pull, divergence, relapse drift, the display re-reference). One-shot synthesis would
  mis-report those.

### 1.4 Scenario library + analysis

Five batteries (the coverage matrix): **reachability sweeps**, **archetypes**, **interactions**,
**robustness**, **failure/malformed**. The analysis harness emits descriptive statistics over
the real pipeline's outputs (nothing widened): feature variance, **extractor fidelity** (does
the DSP recover each control?), a sensitivity **Jacobian**, the **zone histogram** + V-A
reachability by stage, the **fidelity→affect leak**, and a **center-collapse diagnosis**.

### 1.5 Run it — anytime, anywhere in the dev loop

```bash
npm run hum-sim              # full report (markdown) — gates a build on a re-opened fidelity leak
npm run hum-sim:fast         # quick pass (reduced sample count)
npm run hum-sim:sweep        # extractor fidelity + per-control read response
npm run hum-sim:fidelity     # fidelity → affect leak table
npm run hum-sim:longitudinal # pin/un-pin + personalization-damp (stateful)
```

Deterministic, reproducible, CI-ready. **Re-run it before/after any change to `axis-read.ts`,
the fusion anchors, or the DSP params.**

## 2. The defect it found and fixed — fidelity → AROUSAL leak

`acousticAffectAxes` (`packages/orchestrator/src/axis-read.ts`) fed **arousal** from
`spectralCentroidHz`, `spectralFlux`, frame-activity and `meanRms` — all of which broadband
noise corrupts. **Valence** had already been decoupled from fidelity ([[valence-fidelity-decoupling]]);
arousal had not. The simulator measured the consequence directly: with the mood held fixed,
**recording noise was the single strongest arousal driver** (`noiseLevel` span **0.84** > real
loudness **0.40**), manufacturing up to **ΔA = 0.80** and *flipping* a quiet hum to high-arousal
(+0.26).

**The fix** (causally honest, no score-widening) extends the valence ⊥ fidelity contract to the
whole affect read:

- **Noise-floor energy de-noising** — the loudness cue uses `sqrt(meanRms² − noiseFloorRms²)`
  (signal energy above the floor): physically exact, barely touches a loud hum, removes the
  inflation from a quiet hum buried in noise, monotone.
- **SNR-proportional fade** — fidelity-fragile cues (brightness, flux, melodic range, activity;
  and the voice-quality steadiness terms) are faded **toward neutral (0.5)** in proportion to
  capture fidelity (`fidelity = normalize(SNR, 3, 10)`). The noise-robust core (true loudness,
  pitch register) carries a low-SNR read.
- **No-op on clean hums** — at high SNR `fade` is the identity and the floor subtraction ≈ 0, so
  a clean hum's read is **unchanged** (verified by a regression test + the clean reachability
  sweeps).

This lives in the **read layer** (where fidelity-handling already lives), not the extractor.

### 2.1 sim-lab contract evolved (honestly)

`@hum-ai/sim-lab` previously asserted *no* fidelity feature may move affect at all — which
forbade the very mechanism that fixes the leak. The contract was evolved with the simulator as
the driver: **noise-level** cues (SNR, noise floor) may fade the read **toward neutral / de-noise**
but never toward a **wrong pole**; **spectral-color** cues (clarity, flatness, breathiness) stay
strictly zero-effect. The reference hum's SNR was set 8 → 12 so a clean baseline sits above the
fade window. Both harnesses now agree.

### 2.2 Before / after

| Metric | Before | After |
|---|---|---|
| #1 arousal driver | **`noiseLevel`** (0.84 > energy 0.40) | **`energy`** (0.50); noise demoted to 0.33 |
| Quiet hum + heavy noise → arousal | flips to **+0.26** (manufactured) | **−0.19** (fades toward neutral, stays low) |
| Fidelity sweeps that manufacture/invert affect | present (`calm:noise` ΔA 0.80) | **0 / 9** |
| A clean hum's read at high SNR | — | **unchanged** (fix is a no-op) |
| Extractor-fidelity recovery | 7/9 (centroid noise-confounded) | **9/9** |

## 3. What the simulator REFUTED (false leads) and REPORTED (not force-fixed)

**Refuted:**
- **The extractor is not the bottleneck** — it recovers melodic movement
  (`pitchRangeSemitones` 0.6 → 7.4), brightness, flux, jitter and shimmer from realistic audio
  (9/9). The collapse lives in the read math, not extraction.
- **Personalization does NOT over-damp a deviant hum** — after 22 calm baseline hums, a strong
  hum's internal read *preserved* its deviation (it was not pulled to origin).
- **The within-user re-reference works** — for a fixed-voice user, the absolute-acoustic read
  visited **1 zone** (pinned) while the displayed read fanned to **8 zones** as history accrued.
- **Malformed / degenerate audio is handled safely** — every empty/NaN/Inf/all-zero/DC/rail
  capture is **rejected and abstained**; invalid sample rates throw; no non-finite value escapes.

**Reported, deliberately NOT widened** (per "don't artificially widen scores"): displayed arousal
never reaches its high pole (even the max-energy "energised" archetype tops out ≈ **+0.18**, so
**85%** of varied hums read "Quiet/Subdued") and valence's low pole is hard to reach. This is a
**calibration ceiling** that needs **real labelled data** to resolve — not a simulator-driven
tweak. (The fidelity leak had been *masking* it by inflating some arousal reads; removing the leak
makes the true compression plainly visible.)

## 4. Files

- **Added** — `packages/hum-sim/**`: `latent`, `synth`, `context`, `pipeline`, `longitudinal`,
  `scenarios`, `analysis`, `report`, `cli`, `index`, `README` + 5 test files (28 tests:
  synthesis-control, full-pipeline, robustness/safety, regression, responsiveness).
- **Changed** — `packages/orchestrator/src/axis-read.ts` (the fix);
  `packages/sim-lab/{reference,scenarios,report}.ts` + `test/calibration.test.ts` (contract
  evolution); `tsconfig.json` + `package.json` (register the workspace + `hum-sim*` scripts).
- **Docs** — `docs/HUM_SIMULATOR.md`, `docs/HUM_SIMULATOR_REPORT.md`, this file.

## 5. Verification

All green before commit: `tsc` **0 errors** · `typecheck:web` **0** · `npm test` **656/656** ·
`npm run qa` **5/5** (incl. `no-clinical-leak`, `no-screening-in-read-path`, `forbidden-files`) ·
`npm run sim` **0 fail** (sim-lab 12/12) · the new `npm run hum-sim` audit (531 hums) reports
**0/9 fidelity leaks** and **9/9** extractor recovery. The read calibration was changed only
through the harnesses, per the [[sim-lab-calibration-harness]] discipline. The simulator validates
**implementation behaviour, not clinical validity** — it is a mechanistic pipeline-validation tool,
not a substitute for real-world validation data.

Supersedes [v7](STABLE_BUILD_V7.md). See [`HUM_SIMULATOR.md`](HUM_SIMULATOR.md) +
[`HUM_SIMULATOR_REPORT.md`](HUM_SIMULATOR_REPORT.md).
