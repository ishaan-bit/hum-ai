# Hum Simulator — Validation Report (first run)

> **Superseded for the read math by v9.** This is the v8 first-run report (the fidelity→**arousal**
> leak). The v9 corrective calibration — which fixed the remaining arousal zero-point offset, the
> unreachable valence low pole, and replaced the per-cue fidelity fade with a single whole-read
> blend toward neutral — is documented in [`HUM_SIMULATOR_V2_REPORT.md`](./HUM_SIMULATOR_V2_REPORT.md)
> and [`STABLE_BUILD_V9.md`](./STABLE_BUILD_V9.md). Where this report describes the v8 `axis-read.ts`
> mechanism (noise-floor power subtraction + per-cue SNR fade), v9 has since replaced it.

**What this is.** A mechanistic, end-to-end validation of the hum-analysis pipeline using
synthesized hum **waveforms** run through the **exact production path**
(`computeFeatures → orchestrateHumRead`). It quantifies where output variation lives and
dies, diagnoses the center-clustering, fixes one genuine root-cause defect it uncovered,
and proves the fix with before/after evidence. It is **not** clinical validation; the
synthetic hums are a reproducible probe of the deployed code, not people. See
[`HUM_SIMULATOR.md`](./HUM_SIMULATOR.md) for architecture.

---

## 1. Commands run

```bash
# Build / verify
npx tsc --noEmit -p tsconfig.json          # 0 errors
npm test                                    # 656/656 pass (full repo, incl. hum-sim)
node --import tsx packages/hum-sim/src/cli.ts report          # the simulator (28 hum-sim tests pass)

# The simulator
npm run hum-sim                             # full report (markdown) + gate on fidelity leak
node --import tsx packages/hum-sim/src/cli.ts report --json after.json
node --import tsx packages/hum-sim/src/cli.ts fidelity        # fidelity → affect leak table
node --import tsx packages/hum-sim/src/cli.ts sweep           # extractor fidelity + read response
node --import tsx packages/hum-sim/src/cli.ts longitudinal    # pin/un-pin + personalization damp
```

The before/after comparison was captured by running `report --json` against the code
**before** and **after** the `axis-read.ts` fix (same deterministic scenarios + seeds).

---

## 2. Files added / changed

**Added — `packages/hum-sim/` (new workspace `@hum-ai/hum-sim`):**

| File | Role |
|---|---|
| `src/latent.ts` | `LatentHumProfile` (intended state, 18 controls) + `latentToControls` |
| `src/synth.ts` | deterministic DSP synthesizer (f0 contour, vibrato, jitter, shimmer, brightness, tremolo, pink noise, device band, reverb, clipping, gain, DC) → raw PCM |
| `src/context.ts` | consent / model-version / deterministic timestamps |
| `src/pipeline.ts` | `runHum` — exact production path; captures every stage into `SimResult` |
| `src/longitudinal.ts` | `runSequence` — stateful replay (personalization loop + acoustic ring) + canonical sequences |
| `src/scenarios.ts` | reachability sweeps, archetypes, interactions, fidelity-invariance, robustness, failure, malformed |
| `src/analysis.ts` | variance, sensitivity Jacobian, extractor fidelity, zone histogram, V-A reachability, fidelity-leak, collapse diagnosis |
| `src/report.ts` | runs the suite → machine-readable `AnalysisArtifact` + markdown |
| `src/cli.ts` | `report`/`fast`/`sweep`/`fidelity`/`longitudinal` |
| `test/*.test.ts` | synthesis-control, full-pipeline, robustness/safety, regression, responsiveness (28 tests) |

**Changed (production fix + harness contract evolution):**

| File | Change |
|---|---|
| `packages/orchestrator/src/axis-read.ts` | **THE FIX** — extend the valence ⊥ fidelity contract to AROUSAL: noise-floor energy de-noising + SNR-proportional fade of fidelity-fragile cues toward neutral. |
| `packages/sim-lab/src/reference.ts` | reference hum SNR 8 → 12 (a clean reference sits above the fade window) |
| `packages/sim-lab/src/scenarios.ts`, `src/report.ts`, `test/calibration.test.ts` | evolve the fidelity contract: noise-level cues (SNR, noise floor) may fade the read TOWARD NEUTRAL / de-noise, but never toward a wrong pole; spectral-color cues stay zero-effect |
| `tsconfig.json`, `package.json` | register `@hum-ai/hum-sim` workspace + `hum-sim*` scripts |
| `docs/HUM_SIMULATOR.md`, `docs/HUM_SIMULATOR_REPORT.md` | docs |

---

## 3. Discovered output inventory (implementation-derived)

A parallel audit traced the runtime path and inventoried every meaningful output. Grouped
by stage (full table in the audit; the load-bearing subset):

- **Raw features** (`computeFeatures`): energy/loudness (`meanRms`, `rmsEnergy`, `peakAmplitude`…),
  pitch (`pitchMeanHz`, `pitchRangeSemitones`, `pitchStability`, `jitter`, `vibratoRegularity`…),
  spectral (`spectralCentroidHz`, `spectralFlux`, `spectralFlatness`…), continuity, expression
  proxies, capture flags. **Single-hum.**
- **Quality gate**: `decision`, `captureQuality`, `captureQualityScore`, `confidenceCap`,
  `baselineEligible`. **Single-hum.**
- **Domain**: `predicted`, `confidence`, `domainMatch`, `confidencePenalty`. **Single-hum.**
- **Experts + fusion**: per-expert distributions, fused `MultiHeadAffectInference` (broad
  states, fused dimensional, confidence). **Single-hum.**
- **Axis read (USER-FACING dimensional V-A)** — `acousticAffectAxes` → `resolveAxisRead` →
  `reReferenceDisplayRead`. This is what the headline/orb/meters show. **Single-hum** (the
  re-reference needs history).
- **Personalization / relapse / longitudinal / risk**: personalized read, divergence,
  relapse class/drift, trend, risk markers. **Mostly NOT single-hum** (need ≥3–20 hums).
- **Intervention**: suggestion + Intervention-of-the-Day. **Single-hum** (V-A band routed).
- **Safety/UI**: `axisHeadline` (9 zones, `T=0.2` band), `innerStateLine`, `userFacingConfidence`.

Outputs that are **not single-hum inferable** (personalization pull, divergence, relapse
drift, the within-user display re-reference, risk markers) were tested through the
**longitudinal harness**, never forced through one-shot synthesis (§6).

A key result the simulator established that the static audit could not: **the DSP extractor
faithfully recovers the synthesis controls** — so the collapse, where present, is NOT a
feature-extraction failure but lives in the read math.

---

## 4. Sample count & coverage

The full run drives **531 hums** through the exact production path (≈4.4 min):

| Battery | Count | Purpose |
|---|---:|---|
| Reachability sweeps | 378 | each unit control 0→1 × 3 seeded reps |
| Archetypes | 45 | 9 felt-state profiles × 5 realizations |
| Interactions | 8 | reinforcing / conflicting cue combinations |
| Fidelity-invariance | 45 | 3 moods × 3 controls × 5 levels |
| Robustness | 46 | duration, sample-rate, gain, clip, reverb, noise, mic, continuity, DC, register |
| Failure / boundary | 9 | near-silent, severe noise, too short/long, unstable, clipped, breathy |
| Malformed raw audio | 9 | empty / NaN / Inf / all-zero / DC / rail / bad sample-rate |
| Longitudinal | ~40 | pin/un-pin (18) + personalization-damp (23), stateful replay |

---

## 5. Center-collapse findings

### 5.1 The symptom

Across the realistic varied set (350 clean hums; definitive run), the user-facing read
clusters **low-arousal / mid-valence**. The headline-zone histogram:

| Zone | Share |
|---|---:|
| Quiet/Subdued (low arousal, mid valence) | **85%** |
| Calm/Content (low arousal, positive valence) | 9% |
| Steady/Even (centre) | 4% |
| Warm/Steady (positive valence) | 2% |

Only **4 of 9** zones are reached; **94%** are low-arousal. The displayed V-A box spans
**valence ≈ [−0.06, +0.39], arousal ≈ [−0.57, −0.17]** — a small positive-valence,
low-arousal patch of [−1,1]². Strikingly, even the deliberately **loud/bright/melodic
"energised" archetype** reads arousal only ≈ **+0.18** — a hair under the `T = 0.2` "high"
threshold — so the high-arousal half is effectively unreachable for realistic hums. (Before
the §7 fix, recording-noise contamination *inflated* some arousal reads to +0.11, partially
masking this compression; removing the leak makes the true compression plainly visible.)

### 5.2 Why — attributed to specific mechanisms

1. **A real fidelity→affect leak (FIXED — §7).** Broadband recording **noise** was the
   single **strongest arousal driver** — `noiseLevel` moved arousal by **0.84** across its
   range, *more than real loudness* (`energy` 0.40). Pure hiss (mood held fixed)
   manufactured up to **ΔA = 0.80** of arousal because noise inflates `spectralCentroidHz`,
   `spectralFlux`, frame-activity and `meanRms`. This pushed noisy captures toward
   high/mid arousal and shifted valence — a contract violation (fidelity ⊥ affect was
   enforced for valence but never for arousal).

2. **Arousal compression & valence positive-bias (calibration ceiling — REPORTED, NOT
   force-fixed).** On clean hums, displayed arousal essentially never reaches its high pole
   (even the max-energy "energised" archetype tops out at ≈ +0.18) and valence's low pole is
   hard to reach. The live valence drivers are **pitch height (span 0.47) + melodic movement
   (0.40)**; the live arousal drivers are **energy (0.50) + pitch height (0.34) + flux/
   brightness**. The voice-quality terms are near-constant across hums (they carry the
   "settled" offset, not hum-to-hum variation). The team's prior recalibration deliberately
   set a "normal hum reads calm" baseline — but the simulator shows that conservatism extends
   so far that *no* realistic hum crosses into the high-arousal half. Whether an energetic
   hum *should* read high-arousal (and by how much) is a calibration question that needs
   **real labelled data**, not a simulator-driven widening. **We did not widen these scores**
   — doing so would be exactly the cosmetic fix the task forbids (§9 recommends the data step).

3. **The `T = 0.2` headline zone band** swallows a read this compressed: escaping a diagonal
   corner needs both axes past 0.2 with the right sign. This is a UI thresholding choice,
   not a defect; reported for context, not changed.

### 5.3 What the simulator REFUTED (false leads)

- **The extractor is not the bottleneck.** It recovers melodic movement
  (`pitchRangeSemitones` 0.6 → 6.8), brightness, flux, jitter and shimmer from realistic
  audio (§6). The "steady tone → zero melody" concern is correct *for a steady tone*, but
  the extractor does deliver the variation when the audio carries it.
- **Personalization does NOT over-damp a deviant hum (H3 refuted).** After 22 calm baseline
  hums, a strong hum's internal read **preserved** the deviation (it was not pulled to
  origin); personalization only damps a hum that is genuinely "usual," which is correct.
- **The within-user re-reference works (the un-pin countermeasure).** For a fixed-voice
  user, the absolute-acoustic read visited **1 zone** (pinned) while the displayed read
  fanned out to **8 zones** (valence span 0.23 → 1.23) as history accrued.
- **Malformed / degenerate audio is handled safely** — every empty/NaN/Inf/all-zero/DC/rail
  capture is **rejected and abstained** (never a confident neutral read); invalid sample
  rates throw `RangeError`. No non-finite value escaped into any read.

---

## 6. Output reachability & extractor fidelity

**Extractor fidelity** — does the DSP recover each synthesis control? (definitive run,
fidelity controls held clean) — **9 / 9 recovered**:

| Latent control | Target feature | Expect | Low → High | Recovered |
|---|---|:--:|---|:--:|
| energy | meanRms | ↑ | 0.007 → 0.129 | ✅ |
| pitchHeight | pitchMeanHz | ↑ | 86 → 277 | ✅ |
| melodicMovement | pitchRangeSemitones | ↑ | 0.69 → 7.39 | ✅ |
| brightness | spectralCentroidHz | ↑ | 1093 → 1271 | ✅ |
| timbralChange | spectralFlux | ↑ | 0.094 → 0.156 | ✅ |
| pitchInstability | jitter | ↑ | 0.012 → 0.022 | ✅ |
| amplitudeInstability | shimmerProxy | ↑ | 0.234 → 0.350 | ✅ |
| amplitudeInstability | amplitudeStability | ↓ | 0.781 → 0.652 | ✅ |
| noiseLevel | signalToNoiseProxy | ↓ | 78 → 1.4 | ✅ |

A ✅ means realistic audio carrying that quality produces the right feature movement — so
the collapse, where present, is **not** an extraction failure but lives in the read math.
(Note: with recording noise *jittered into* an affect sweep, `spectralCentroidHz` appears
contaminated — itself evidence of the centroid's noise-sensitivity, which the §7 fix
decouples from the affect read.)

**Read response** (per-control span of the user-facing read across a clean 0→1 sweep):

- **Valence** is driven by `pitchHeight` and `melodicMovement` (the mood-variable prosody);
  voice-quality controls move it weakly (they carry a near-constant offset, by design).
- **Arousal** is driven by `energy`, then `brightness`/`timbralChange`; after the fix
  `energy` is the #1 arousal driver (was `noiseLevel`).

---

## 7. Defect found and fixed — fidelity → arousal leak

**Root cause.** `acousticAffectAxes` (`orchestrator/src/axis-read.ts`) fed arousal from
`spectralCentroidHz` (brightness), `spectralFlux`, frame-activity and `meanRms`, and valence
from voice-quality steadiness — all of which broadband noise corrupts. Valence had already
been decoupled from fidelity; **arousal had not**. So a noisy capture manufactured arousal
from its hiss.

**Fix (causally honest, no score-widening).** Extend the valence ⊥ fidelity contract to the
whole affect read:
- **Noise-floor energy de-noising:** the loudness cue uses
  `sqrt(meanRms² − noiseFloorRms²)` — the signal energy above the floor. Physically exact:
  it barely touches a loud hum (signal ≫ floor) yet removes the inflation from a quiet hum
  buried in noise, and is monotone (more noise ⇒ never more signal energy).
- **SNR-proportional fade:** fidelity-fragile cues (brightness, flux, melodic range,
  frame-activity; and the voice-quality steadiness terms) are faded **toward neutral (0.5)**
  in proportion to capture fidelity (`fidelity = normalize(SNR, 3, 10)`). The noise-robust
  core — true loudness above the floor, pitch register — carries a low-SNR read.
- **No-op on clean hums:** at high SNR `fade` is the identity and the floor subtraction is
  ≈ 0, so a clean hum's read is **unchanged** (verified: the clean V-A box and zone
  histogram are identical before/after).

This is the same posture the team already used for the valence/fidelity decoupling — applied
in the read layer (where fidelity-handling lives), not the extractor.

**Harness contract evolution.** `@hum-ai/sim-lab` previously asserted *no* fidelity feature
may move affect at all. That forbade the very mechanism that fixes the leak. The contract
was evolved (honestly, with the simulator as the driver): **noise-level** cues (SNR, noise
floor) may fade the read **toward neutral / de-noise** but must never push it toward a wrong
pole; **spectral-color** cues (clarity, flatness, breathiness) stay strictly zero-effect.
Both harnesses now agree.

### Before / after evidence

| Metric | Before | After |
|---|---|---|
| **#1 arousal driver** | **`noiseLevel`** (strongest, span 0.84 > energy 0.40) | **`energy`** (span 0.50); `noiseLevel` demoted to 0.33, below energy *and* pitch height |
| Quiet hum + heavy noise → arousal (direct probe) | flips to **+0.26** (manufactured high arousal) | **−0.19** (stays low; only fades toward neutral) |
| Fixed-mood fidelity sweeps that **manufacture/invert** affect | present (`calm:noise` raw ΔA **0.80**, a directional flip) | **0 / 9** (residual raw drift ≤ 0.29 is honest fade-to-neutral; manufactured = 0) |
| Extractor-fidelity recovery | 7 / 9 (centroid noise-confounded by the harness) | **9 / 9** (fidelity held clean) |
| A clean hum's read at high SNR | — | **unchanged** — `fade` is the identity at fidelity 1, floor subtraction ≈ 0 (regression test + the clean reachability sweeps are untouched) |
| sim-lab calibration contracts | 12/12 (strict contract) | **12/12** (evolved noise-level contract) |
| Full repo test suite | 648/648 | **656/656** (648 prior + 8 new; 28 hum-sim tests total) |

The fix **removes the manufactured affect** while **leaving clean reads untouched** and
**without widening any score**.

---

## 8. Remaining limitations

- **Clinical validity is out of scope.** This validates implementation behaviour only.
  Synthetic hums are mechanistically realistic, not perceptually human.
- **Arousal compression / valence positive-bias are reported, not fixed.** They are a
  calibration property; changing the windows/weights is a product decision that needs
  real-data grounding, not a simulator-driven widening.
- **Reachability is current-weights-specific** — re-run after any change to `axis-read.ts`,
  the fusion anchors, or the DSP params.
- **The fade keys on the SNR proxy**, an imperfect contamination estimate; a hum with a
  clean spectrum but moderate SNR is faded slightly. The window (3–10) is tuned so genuinely
  clean hums (SNR ≫ 10) are untouched.

---

## 9. Recommended next validation steps (with real recordings)

1. **Re-run the fidelity-leak probe on real noisy vs clean captures** of the same hummer to
   confirm the decoupling holds outside synthesis.
2. **Ground the arousal/valence windows** on a small labelled corpus (self-reported V-A) —
   decide whether the conservative compression is correct or should be widened, with data.
3. **Wire `npm run hum-sim` into CI** as a regression gate on the fidelity contract (it
   already exits non-zero on a re-opened leak).
4. **Exercise the longitudinal pathways on real sequences** (relapse drift, divergence, risk
   markers) — the simulator can script them, but real within-user series are the real test.
5. **Add a perceptual-realism check** (or real audio fixtures behind a flag) to confirm the
   synthesizer's feature distributions track real hums.
