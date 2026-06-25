# Hum AI — Stable Build v9

> **One line.** v9 is a **corrective calibration build**: it uses the [Hum Simulator](HUM_SIMULATOR.md)
> to trace, fix, and validate the genuine read-math defects behind v8's remaining output
> collapse — a mis-located **arousal zero-point**, an unreachable **valence low pole**, and a
> fidelity-fade that could cross neutral — and then **hardens `npm run hum-sim` into a release
> gate** so those fixes cannot silently regress. No score was widened, no variance injected: the
> reachable range moved only where the production pipeline now has a real, validated response to
> acoustic evidence.

Builds on [v8](STABLE_BUILD_V8.md) (the Hum Simulator + the fidelity→arousal leak fix). v9 keeps
the privacy/safety posture, the consumer flow, and the web bundle unchanged: it is an **engine
recalibration + a hardened audit gate**. The blinded screening head stays firewalled out of the
read path; ADR-0005/0006/0008/0009/0011 seams are preserved.

Full evidence: [`HUM_SIMULATOR_V2_REPORT.md`](HUM_SIMULATOR_V2_REPORT.md) (before/after + the gate).
Architecture: [`HUM_SIMULATOR.md`](HUM_SIMULATOR.md).

## 0. Coordinates

- **Starting commit:** `bb57733` (`docs(stable-build-v8): add STABLE_BUILD_V8.md release spec`), branch `main`.
- **Final commit:** see §10.
- **Scope:** `packages/orchestrator/src/axis-read.ts` (the recalibration), `packages/hum-sim/src/{analysis,report,cli}.ts`
  (the release gate), regression + gate tests, one test-fixture fix in `packages/native-corpus`, and docs. **No**
  change to extraction (`audio-features`), fusion, personalization, the screening head, the web bundle, or the
  privacy/safety gates.

## 1. What was wrong (root causes the simulator proved)

v8 fixed the fidelity→arousal *leak* but its report honestly flagged a remaining **calibration
ceiling**: 85% of varied hums read "Quiet/Subdued", displayed arousal never crossed 0, and the
valence low pole was unreachable. v9 traced the full variance funnel
(`waveform → features → normalized cues → read math → display`) with a component-level
diagnostic and controlled counterfactuals. The collapse was **not** in extraction (the extractor
recovers 9/9 synthesis controls) — it was five concrete read-math defects:

| # | Defect | Evidence (Hum Simulator) | Class |
|---|---|---|---|
| R1 | **Loudness normalized LINEARLY.** The arousal energy cue used `normalize(rms, 0.01, 0.14)`, but capture energy is geometric and loudness is perceptually logarithmic — so a *moderate* hum (rms ≈ 0.034) mapped to only ≈ 0.18 of the cue and read near-silent. | The neutral reference hum read **arousal ≈ −0.33**; the whole arousal axis carried a large negative offset. | wrong units / scaling |
| R2 | **`activeFrameRatio` mis-centred at 0.85.** The extractor reports ≈ 0.7–0.97 for sustained hums; the `0.5 + (a−0.85)/0.5` map sent a normal hum *below* neutral and collapsed a slightly-gappy one to 0. | A sustained 0.83-active hum scored 0.46 on activity, adding to the downward offset. | stale constant |
| R3 | **Arousal cue windows had unreachable tails.** Brightness window topped at 2600 Hz (real centroid ≤ ~1600) and flux at 0.30 (real flux ≤ ~0.19), so both cues capped ≈ 0.4–0.5 and could never reach high. | `brightN`/`fluxN` saturated mid-range across the whole archetype set. | unreachable calibration tail |
| R4 | **Valence pinned positive by a voice-quality floor.** The person-ish steadiness block carried 0.58 of valence and leaned half on `pitchStability` — which the simulator flagged **near-dead** (≈ 0.94 for every hum). That near-constant term overpowered the mood-variable prosody. | The most-downbeat archetype bottomed at only **valence ≈ −0.14**; neutral sat at +0.18. | neutral prior overpowering evidence |
| R5 | **The fidelity fade could cross neutral.** v8's per-cue fade + noise-floor power subtraction, once the cues were recalibrated, could push a near-neutral hum *past* 0 to the wrong pole when SNR and the noise floor were decoupled. | sim-lab `fidelity-leak` (SNR pushed arousal 0.14→0.05; noiseFloor 0.05→−0.13). | sign / overshoot |

## 2. The fixes (production read path — `axis-read.ts`)

Each fix corrects broken math, not appearances. Weights still sum to 1; every research-grounded
sign is preserved (validated by sim-lab `calibration`).

1. **Perceptual (log) loudness** — `logUnit(meanRms, 0.01, 0.14)`. A moderate hum now lands near
   the cue midpoint, so the arousal **zero-point sits where a neutral hum actually reads**. This is
   the single biggest correction (fixes R1, the dominant offset). Endpoints unchanged — the curve,
   not the range, was wrong.
2. **Re-centred activity** — `ACTIVE_CENTRE = 0.7`, `ACTIVE_SCALE = 0.6`: a normal sustained hum is
   ~neutral on activity (no offset); only genuine choppiness pulls it down (fixes R2).
3. **Reachable cue windows** — brightness `250–2200`, flux `0.01–0.22`, matched to the extractor's
   real output so a genuinely bright/animated hum reaches the high pole (fixes R3).
4. **Arousal re-weighting** — lead with the cues that *demonstrably* discriminate arousal in-domain:
   loudness `0.32 → 0.40`, brightness `0.16 → 0.10`, activity `0.12 → 0.10`; flux stays `0.20`.
5. **Valence leads with mood-variable prosody** — pitch-height + melody `0.42 → 0.58` of the weight;
   the voice-quality block follows at `0.42`, and `stabilityN` leans `0.75/0.25` onto the responsive
   `amplitudeStability` away from the near-dead `pitchStability` (fixes R4). The low pole is now
   reachable; neutral sits ~0.
6. **One provably-safe fidelity contract** — replace the per-cue fade + noise-floor subtraction with a
   single blend of the **whole read toward neutral** in proportion to capture fidelity:
   `affect01 = 0.5 + fidelity·(raw − 0.5)`. At high SNR it is the **identity** (clean hums unchanged);
   as SNR falls the read decays **monotonically toward neutral and can never cross a pole** (fixes R5).
   This is the strongest possible form of the valence/arousal ⊥ fidelity contract: noise can only ever
   *remove* affect, never add or invert it.

## 3. The release gate (`npm run hum-sim` now fails the build)

v8's CLI only failed on a fidelity leak. v9 adds `evaluateReleaseGate` — a hard pass/fail contract
whose thresholds derive from the observed baseline + implementation semantics (not aesthetic
targets). `npm run hum-sim` **exits non-zero** if any check regresses:

| Check | What it catches |
|---|---|
| `fidelity-no-manufacture` | recording noise manufacturing/​inverting affect |
| `extractor-recovery` (9/9) | a clean acoustic difference disappearing before prediction |
| `arousal-separation` / `valence-separation` | high- and low-energy mood families no longer separable |
| `*-high-reachable` / `*-low-reachable` | an output pole becoming mathematically unreachable |
| `neutral-zero-point` | a global offset re-appearing (e.g. the v8 arousal −0.33) |
| `malformed-abstains` / `near-silent-abstains` | invalid/near-silent audio becoming a confident emotional read |
| `diagonal-ordering` | the tense↔calm diagonal collapsing |

The compression **verdicts** (§1 of the report) remain *informational, not gated* — widening a score
to clear them is exactly what this build refuses to do.

## 4. Before / after (same deterministic scenarios + seeds)

| Metric | v8 (before) | v9 (after) |
|---|---|---|
| Distinct zones reached (of 9) | **4** | **8** |
| Displayed **arousal** P05…P95 | −0.57…−0.17 (entirely **below 0**) | −0.38…**+0.20** (crosses 0) |
| Displayed **valence** P05…P95 | −0.06…0.39 (low pole unreached) | **−0.20**…0.33 (low pole reached) |
| Neutral reference hum (V, A) | (0.18, **−0.33**) | (**−0.01**, **−0.05**) |
| `low_flat` archetype valence | **−0.14** (pole missed) | **−0.36** |
| `tense_woundup` arousal | **+0.03** (collapsed) | **+0.37** |
| `bright_energised` arousal | +0.32 | **+0.60** |
| Corner separation (arousal / valence) | — | **1.09 / 0.80** |
| Extractor recovery | 9/9 | 9/9 |
| Fidelity→affect leaks | 0/9 | **0/9** |
| Release-gate checks | (none) | **12/12 ✅** |

**Center-collapse status:** materially resolved. The four mood corners separate and reach their
poles; a neutral hum sits at the origin; 8/9 zones are reachable by realistic combined hums.

**Output reachability:** both poles of both axes are reachable in absolute terms (a max-everything
probe reaches arousal ≈ 0.85, valence ≈ 0.43; a min probe ≈ −0.83). The displayed range remains
honestly compressed for *single-control* sweeps (see §6).

**Fidelity / uncertainty:** a degraded capture now strictly fades toward neutral and lowers
confidence — it can never manufacture or invert affect (proved by the gate + sim-lab contract).

## 5. What was intentionally NOT changed (and why)

- **The extractor / DSP** — it already recovers 9/9 controls; the collapse was in read math. Touching
  it would have been treating a symptom.
- **The synthesizer windows** — not narrowed to the synth's exact output (that would overfit the
  harness). Cue windows were matched to the extractor's *reachable* range with headroom.
- **No random variance, no lowered zone thresholds, no relabelling.** The residual compression is
  *reported*, not papered over.
- **The within-user re-reference, personalization, fusion, relapse, screening head, web bundle.**
  Untouched; all their tests still pass.

## 6. Known limitations (require real labelled data)

- **Residual single-control compression.** Across the *one-at-a-time* reachability sweeps (energy held
  neutral while one other cue moves), displayed arousal still spans only P05…P95 ≈ 0.58 — the simulator
  still raises the informational `AROUSAL COMPRESSED` verdict. This is conservative-by-design: loudness
  is correctly the dominant arousal cue, so a hum that varies *only* its brightness or melody (not its
  energy) moves arousal modestly. Realistic combined hums (the archetypes) span the full range. Closing
  this honestly needs **real labelled recordings**, not a simulator tweak.
- **Synthetic, not perceptual.** The hums are mechanistically realistic, not human; this validates the
  *implementation transfer function*, never felt-state accuracy.
- **Implementation validation ≠ clinical validation.** Every number here is a property of the deployed
  code on synthetic audio. None is evidence of clinical validity, sensitivity, or specificity. The
  read remains a transparent reflection of a hum's acoustic qualities, not a diagnosis.

## 7. Commands

```bash
npm run typecheck && npm run typecheck:web   # tsc — 0 errors
npm test                                     # full repo — 663/663
npm run qa                                   # privacy/safety gates — 5/5
npm run sim                                  # sim-lab read-path contracts — 12/12
npm run hum-sim                              # the release gate — 12/12 ✅ (exits non-zero on regression)
npm run hum-sim -- --json out.json --no-long # machine-readable artifact (incl. gate)
```

## 8. Verification (this build)

All green before commit: `tsc` **0** · `typecheck:web` **0** · `npm test` **663/663** ·
`npm run qa` **5/5** (incl. `no-clinical-leak`, `no-screening-in-read-path`, `forbidden-files`) ·
`npm run sim` (sim-lab) **12/12** · `npm run hum-sim` release gate **12/12 ✅** on **531** synthesized
hums (9/9 extractor recovery, 0/9 fidelity leaks). New regression coverage: 4 `axis-read` zero-point /
pole-reachability / fidelity-fade tests + 3 gate tests (incl. two "the gate has teeth" failure cases).

## 9. Release risks & next steps

- **Risk:** the recalibration shifts every user's *absolute* read (more responsive, less compressed).
  The within-user re-reference and personalization (unchanged) re-anchor each user to their own usual,
  so the headline read is unaffected in shape; only the cold-start absolute read moves.
- **Risk:** the gate thresholds are baseline-derived; if the synth or extractor changes materially they
  must be re-derived (documented in `analysis.ts` `GATE`).
- **Next:** collect consented HiTL labels to (a) replace the synth-derived cue windows with
  data-derived ones, (b) resolve the residual single-control arousal compression, and (c) promote a
  native in-domain affect prior (ADR-0011) that can lead the read where it agrees.

## 10. Final commit

`fix(hum): calibrate responsive reads and harden simulator validation` — hash recorded post-commit
(see git log on `main`).

Supersedes [v8](STABLE_BUILD_V8.md). See [`HUM_SIMULATOR_V2_REPORT.md`](HUM_SIMULATOR_V2_REPORT.md).
