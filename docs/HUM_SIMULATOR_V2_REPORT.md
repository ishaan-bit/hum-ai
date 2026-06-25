# Hum Simulator — Validation Report v2 (the v9 corrective calibration)

**What this is.** The second Hum-Simulator pass: a mechanistic, end-to-end audit of the
hum-analysis pipeline (`computeFeatures → orchestrateHumRead`) that traces the v8 output
collapse to its root causes, fixes every genuine read-math defect, validates the fixes through
the simulator + full test suite, and **upgrades the simulator into a release gate**. It is **not**
clinical validation — the synthetic hums are a reproducible probe of the deployed code, not people.
See [`HUM_SIMULATOR.md`](./HUM_SIMULATOR.md) for architecture and [`STABLE_BUILD_V9.md`](./STABLE_BUILD_V9.md)
for the release spec. The v8 first-run report is [`HUM_SIMULATOR_REPORT.md`](./HUM_SIMULATOR_REPORT.md).

---

## 1. Mandate

> Use the Hum Simulator to trace, correct, validate, and ship every genuine implementation or
> calibration defect responsible for the remaining output collapse — without fabricating emotional
> variation, widening scores cosmetically, or making claims unsupported by hum audio.

This was an **execution** pass, not a reporting one: diagnose → fix the production path → add a
failing-without-the-fix regression → re-run the simulator + full suite → ship.

---

## 2. Phase 1 — tracing the variance funnel

A component-level diagnostic (a dev harness, since removed) printed each normalized arousal/valence
cue for every archetype + an energy sweep + max/min probes, so the collapse could be localized with
numbers, not guesses. The funnel — `waveform → features → normalized cues → raw read → fade → display`
— showed the break is **entirely in the read math**:

- **Extraction is healthy.** 9/9 synthesis controls are recovered (energy→meanRms, melody→pitch
  range, brightness→centroid, timbre→flux, instability→jitter/shimmer, noise→SNR).
- **The arousal zero-point is mis-located.** The neutral reference hum read **arousal ≈ −0.33** —
  because the loudness cue was normalized *linearly* (window 0.01–0.14), placing a moderate hum
  (rms ≈ 0.034) at only ≈ 0.18 of the cue. Loudness is perceptually logarithmic; the linear curve
  pushed the entire axis negative.
- **Activity dragged it further down.** `activeFrameRatio` was centred on 0.85 but the extractor
  yields ≈ 0.7–0.97 for sustained hums, so a normal hum scored < 0.5 on activity.
- **Two cue windows were unreachable.** Brightness topped at 2600 Hz and flux at 0.30, but the
  extractor produces ≤ ~1600 Hz and ≤ ~0.19 — so those cues capped ≈ 0.4–0.5.
- **Valence was pinned positive** by a 0.58-weight voice-quality block that leaned half on a
  **near-dead** `pitchStability` (≈ 0.94 for every hum) — a near-constant intercept that overpowered
  the mood-variable prosody, so the most-downbeat archetype bottomed at only **valence ≈ −0.14**.

(Full per-cue tables were captured during the run; the headline is each cue's distance from its
own midpoint for a neutral hum, and which cues were dead/saturated.)

---

## 3. Phase 2 — fixes (production read path)

All in [`packages/orchestrator/src/axis-read.ts`](../packages/orchestrator/src/axis-read.ts). See
[`STABLE_BUILD_V9.md` §2](./STABLE_BUILD_V9.md) for the full rationale; in brief:

| Fix | Defect closed | Regression test (fails on v8 math) |
|---|---|---|
| Perceptual (log) loudness normalization | arousal zero-point offset | `v9: a MODERATE neutral hum reads ~0 on both axes` |
| Re-centred `activeFrameRatio` (0.7 / 0.6) | activity offset | (covered by the neutral-zero + energy-sweep tests) |
| Reachable brightness/flux windows | arousal high pole capped | `v9: a genuinely energetic hum REACHES the high arousal pole` |
| Valence leads mood-variable prosody (0.58) + drop near-dead pitchStability | valence low pole unreachable | `v9: a genuinely subdued hum REACHES the low valence pole` |
| One whole-read fidelity blend toward neutral | noise crossing to the wrong pole | `v9: low capture fidelity only FADES toward neutral — never past it` |

Every fix is a no-op on a clean hum (high SNR ⇒ the fidelity blend is the identity; the log curve
and re-centring change the *shape*, not the endpoints), preserving the v8 clean-read behaviour and
every research-grounded sensitivity sign (sim-lab `calibration` 12/12).

---

## 4. Phase 3 — the release gate

`evaluateReleaseGate` ([`analysis.ts`](../packages/hum-sim/src/analysis.ts)) turns the audit into a
hard pass/fail contract; `npm run hum-sim` exits non-zero on any regression. Thresholds derive from
the observed baseline + implementation semantics (documented in `GATE`), not aesthetic targets.

```
## 0. Release gate — ✅ PASS
| Check | Status | Detail |
| fidelity-no-manufacture | ✅ | no fidelity sweep manufactures affect |
| extractor-recovery      | ✅ | 9/9 controls recovered |
| arousal-separation      | ✅ | bright−low arousal = 1.09 (need ≥ 0.6) |
| arousal-high-reachable  | ✅ | energised arousal = 0.50 (need ≥ 0.35) |
| arousal-low-reachable   | ✅ | low-flat arousal = -0.59 (need ≤ -0.3) |
| valence-separation      | ✅ | bright−low valence = 0.80 (need ≥ 0.4) |
| valence-high-reachable  | ✅ | bright valence = 0.44 (need ≥ 0.25) |
| valence-low-reachable   | ✅ | low-flat valence = -0.36 (need ≤ -0.2) |
| neutral-zero-point      | ✅ | neutral read = (-0.01, -0.24) (|each| ≤ 0.3) |
| malformed-abstains      | ✅ | all malformed audio throws or abstains |
| near-silent-abstains    | ✅ | near-silent hums abstain/reject |
| diagonal-ordering       | ✅ | tense vs calm order on both axes |
```

The gate has teeth: unit tests feed it a manufactured fidelity leak and a non-abstaining malformed
read, and assert it fails.

---

## 5. Before / after

| Metric | v8 | v9 |
|---|---|---|
| Distinct zones reached (of 9) | 4 | **8** |
| Displayed arousal P05…P95 | −0.57…−0.17 | −0.38…**+0.20** |
| Displayed valence P05…P95 | −0.06…0.39 | **−0.20**…0.33 |
| Neutral reference hum (V, A) | (0.18, −0.33) | (−0.01, −0.05) |
| `low_flat` valence | −0.14 | **−0.36** |
| `tense_woundup` arousal | +0.03 | **+0.37** |
| Zone histogram top entry | Quiet/Subdued ~85% | Quiet/Subdued 60%, Steady/Even 23%, +6 more |
| Extractor recovery | 9/9 | 9/9 |
| Fidelity→affect leaks | 0/9 | 0/9 |
| Release-gate checks | — | **12/12 ✅** |

The 531-hum run still raises ONE informational verdict — `AROUSAL COMPRESSED` (single-control
sweep P05…P95 ≈ 0.58 < 0.6). It is reported, not gated, and not widened: it reflects loudness
correctly dominating arousal, so a hum that varies *only* a non-energy cue moves arousal modestly.
Resolving it honestly needs real labelled data, not a simulator tweak.

---

## 6. Phase 4 — full validation

| Check | Result |
|---|---|
| `tsc` (repo + web) | 0 errors |
| `npm test` | **663/663** |
| `npm run qa` | 5/5 (incl. no-clinical-leak, no-screening-in-read-path, forbidden-files) |
| `npm run sim` (sim-lab) | 12/12 contracts hold |
| `npm run hum-sim` | release gate **12/12 ✅**, 531 hums, 9/9 recovery, 0/9 leaks |

The validation runs the **real production integration path** end-to-end (raw PCM →
`orchestrateHumAudio` → `computeFeatures` → read), never a narrowed stub.

---

## 7. Limitations & honesty

- Residual single-control arousal compression is **reported, not hidden** (§5).
- Synthetic audio is mechanistically realistic, **not perceptually human**.
- This is **implementation validation, not clinical validation** — none of these numbers is
  evidence of clinical accuracy. The read stays a transparent reflection of acoustic qualities.
- Reachability is a property of the **current** weights/windows; re-run after any `axis-read` /
  fusion / DSP change (the gate enforces this).

---

## 8. Files changed

| File | Change |
|---|---|
| `packages/orchestrator/src/axis-read.ts` | the recalibration (log loudness, re-centred activity, reachable windows, prosody-led valence, whole-read fidelity blend) |
| `packages/hum-sim/src/analysis.ts` | `evaluateReleaseGate` + `GATE` thresholds |
| `packages/hum-sim/src/report.ts`, `src/cli.ts` | gate wired into the artifact, markdown (§0), and CLI exit code |
| `packages/orchestrator/test/axis-read.test.ts` | 4 v9 regression tests |
| `packages/hum-sim/test/gate.test.ts` | 3 gate tests (live reachability + two "has teeth" failures) |
| `packages/hum-sim/test/regression.test.ts` | docstring updated to the v9 fidelity contract |
| `packages/native-corpus/test/benefit.test.ts` | trusted-anchor fixture (the pure-sine BASE now correctly fades to neutral under the v9 fidelity contract) |
| `docs/STABLE_BUILD_V9.md`, `docs/HUM_SIMULATOR*.md` | docs |
