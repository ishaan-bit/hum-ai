# Hum AI — Stable Build v7

> **One line.** v7 makes the **medical layer real and visible**: three named, within-user,
> non-diagnostic early signals (depressive-affect, anxiety-tension, relapse-drift) surfaced in a
> Diary that is now reachable at all times and carries a plain colour legend, plus a finished
> arousal recalibration and a funding-grade deeptech diligence brief — all without touching the
> privacy/safety posture or breaking the consumer flow.

Builds on [v6](STABLE_BUILD_V6.md) (calibration/sim harness, hybrid contract, population loop) and
the AURA UI. Non-clinical framing, within-user comparison, and the ADR-0005/0006/0008/0009 seams
are preserved. The blinded screening head stays firewalled out of the read path.

## 1. The medical layer — three within-user early signals (new)

The long-asked "anxiety risk / depression risk / relapse risk for early detection," surfaced
honestly. The unlock: `@hum-ai/safety-language` already sanctions the exact register
(`anxiety-risk marker`, `depressive-affect marker`, `relapse-risk drift`) — what is forbidden is a
*diagnosis/screening claim*, not the markers themselves.

### 1.1 The engine — `deriveRiskMarkers` (`packages/relapse-engine/src/risk-markers.ts`, new)

Pure, deterministic, tested (`test/risk-markers.test.ts`, 12 tests). Turns the user's own series of
hums (`{valence, arousal, risk}` over time, from `state.relapseHistory`) + the
`LongitudinalDiagnosticState` into a `RiskMarkerReport {depressive, anxiety, relapse}`, each a coarse
`RiskMarkerLevel` (`insufficient_data | settled | watch | elevated`).

- **Grounded in Russell's affective circumplex.** Depressive-affect = sustained **low-valence +
  flat/low-arousal**; anxiety-tension = sustained **high-arousal + negative-valence**;
  relapse-drift = the existing sustained divergence early-warning.
- **Quadrant-gated** so the same hum can never drive both acoustic markers for the same reason (a
  low-but-keyed-up hum is anxiety, not low mood — a real modelling bug the tests caught and fixed).
- **Within-user only.** Robust personal band (median ± MAD, ×1.4826, with a spread floor); "low" /
  "tense" always means *for you*, never a population cutoff. Abstains (`insufficient_data`) until a
  personal baseline exists.
- **Reuses the v6 sequential statistics** rather than reinventing them: Theil–Sen slope,
  Mann–Kendall significance, and **tabular CUSUM** (`cusumDrift`) for the *onset* of a sustained
  shift (early detection, not a long run). Sustained-ness (≥3 consecutive) escalates to `elevated`,
  mirroring `MIN_CONSECUTIVE_DRIFT_HUMS`.
- **Magnitudes are internal** (`intensity` ∈ [0,1], never a number to the user — ADR-0008); they
  drive only the coarse dot tone. Structurally `isDiagnostic: false`.

### 1.2 Surfacing + copy safety (`apps/web`)

- `risk-copy.ts` (pure) holds every user-facing string; engine ids map to **safe kebab DOM tokens**
  (`low-mood` / `tension` / `steadiness`) because `relapse_drift` is itself a forbidden head id and
  `depressive_affect_marker` / `anxiety_like_tension_marker` / `low_mood_state` are forbidden
  internal labels. Copy avoids "diagnos*" entirely ("a reflection, never a medical verdict").
- `render.ts` `riskLayersBlock` renders the three layers in the Diary, consent-gated, with PHQ-9 on
  the depressive row and GAD-7 on the anxiety row (when a self-report exists locally).
- **Two new copy/render proofs:** `risk-copy.test.ts` (forbidden-phrase + raw-number + clinical-id
  screen over every string) and `risk-layer-render.test.ts` (drives the real renderer with a
  consented diary history and asserts the layers render *and* stay safe).

## 2. Diary: always accessible + a colour legend

- **Always reachable.** `stage.ts` now allows the Diary window any time (it was gated behind the
  first hum). The diary is a private record that persists across sessions and is where the medical
  layer lives, so it must open cold. `renderLongitudinal` shows the mature view from *persisted*
  history even with no live read.
- **The colour legend** (the "I don't know what the colours mean" fix): a "What the colours mean"
  panel explains both the mood-ribbon bead colours (low / tense / neutral / calm / bright) and the
  early-signal dot tones (settled / worth noting / worth a check-in / still learning).
- `DiaryPoint` gained `arousal` (`main.ts` maps `s.dimensional.arousal`) so the two acoustic markers
  can separate low mood from tension.

## 3. Finished read work (the v6 "unpin arousal" trajectory)

- **Arousal recalibration completed.** `activeFrameRatio`'s near-constant push was re-centred in v6
  WIP to un-pin calm hums, but that left a tense/agitated *low-pitch* hum reading flat. v7 shifts
  arousal weight onto **spectral flux** (`0.08 → 0.20`, with small offsets elsewhere; weights still
  sum to 1) — flux is high for an agitated/keyed-up hum and low for a calm/low-flat one, so it lifts
  genuine tension without re-pinning calm hums. Validated by `npm run sim` (the four V-A archetypes
  land correctly: bright +0.43, calm −0.63, **tense +0.26**, low −0.86; **0 fail**) and
  `sim-lab/calibration.test.ts`.
- **Ineligible hums now enter the diary** (`personalization-engine/update.ts`): every accepted hum
  (eligible or not) records to the relapse history so the diary + count badge reflect the
  most-recent check-in, while the model baseline, ladder, and `eligibleHumCount` still advance only
  for quality-gated hums. The affected unit tests were updated to the new semantics.

## 4. Deeptech diligence brief (new) — `docs/DEEPTECH_FUNDING_BRIEF.md`

A funding-grade brief produced by a multi-agent research workflow (41 findings, 21 adversarially
verified external claims), grounded in the repo. It tags every claim **BUILT / INVESTIGATIONAL /
ASPIRATIONAL** and is honest about the field's replication crisis. Load-bearing context for fund­ing
strategy: **no voice mental-health screener has FDA authorization** (Kintsugi, the category leader,
shut down early-2026 after ~4 years / ~$30M on a De Novo); the replicable signal is prosody/timing,
not voice-quality; and Hum's wedge is the *stack* (humming / non-linguistic + on-device + within-user
longitudinal + non-diagnostic wellness framing) with the IRB screening instrument firewalled behind.
The new risk-marker thresholds are documented as **principled-but-uncalibrated** (DIAGNOSTIC_ROADMAP
Tier B4 calibration is the funded next step).

## 5. Verification

All green: `npm test` **628/628** · `typecheck` + `typecheck:web` · `npm run qa` **5/5** (incl.
`no-screening-in-read-path` + `no-clinical-leak`) · `npm run sim` **0 fail** · `build:web`. The read
calibration was changed only through the sim-lab harness, per the [[sim-lab-calibration-harness]]
discipline. Visual/in-browser QA of the new diary panel was not done locally (no headless browser);
eyeball after deploy.

Supersedes [v6](STABLE_BUILD_V6.md). See the medical-layer memory note and
`DEEPTECH_FUNDING_BRIEF.md`.
