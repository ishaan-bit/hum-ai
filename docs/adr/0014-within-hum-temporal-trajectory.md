# ADR-0014: A hum is read as a within-hum TRAJECTORY — parameters are tracked live, the hum is chunked post-hoc at its own change-points, and the inner state is predicted from the chunk-to-chunk variation

- **Status:** Accepted (implemented; `npm run check`, `npm run sim`, `npm run hum-sim`, `npm run qa` all green)
- **Date:** 2026-06-26
- **Packages:** **`@hum-ai/audio-features` (new `temporal.ts`)**, **`@hum-ai/orchestrator` (new `temporal-read.ts`)**, `@hum-ai/hum-sim` (synth net-contour + temporal gate), `@hum-ai/sim-lab` (temporal trajectory + not-skewed gate), `@hum-ai/app-web` (within-hum trajectory card + persistence).
- **Builds on:** [ADR-0013](0013-trait-decoupled-within-person-standardized-read.md) (the `state` vs `timbre` taxonomy; the within-hum dynamics this layer reads are exactly the `state` cues), [ADR-0010](0010-model-led-read-from-first-hum.md) (the transparent acoustic V/A backbone reused per chunk), [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) (the surfaced trajectory carries no clinical label).
- **Unchanged:** the whole-hum V/A backbone math, all privacy guards (`assertNoRawAudioFields`, `assertNoClinicalLeak` — the chunk summary is derived scalars only), the two-head separation, the fidelity ⊥ affect contract, and the dual-baseline divergence/relapse signal.

## Context

The read collapsed a 12-second hum to one static (valence, arousal) point — the *average* of the hum.
But a hum is a short performance: it can swell, fade, settle, or wind up over its course, and the
vocal-emotion literature is explicit that the **local/dynamic** structure carries affect that an
utterance-average destroys (rising F0 → activation; a declining energy contour → withdrawal; settling
micro-instability → self-regulation; utterance-final segments are the most informative). None of that
reached the user — two hums with the same mean but opposite arcs (one settling, one winding up) read
identically.

A first attempt (fixed clock-time thirds) was rejected in favour of **data-driven** chunking: cut the
hum where its *parameters actually shift*, so the chunks are meaningful (a phrase, a swell, a settle)
and their count is itself a signal — a steady hum stays one chunk, a restless one fragments.

## Decision

### 1. Track parameters LIVE; chunk POST-hoc (`@hum-ai/audio-features` `temporal.ts`)

`computeFrameTrack` samples the mood-variable parameters (energy, F0, brightness, flux) on the native
**80 ms** frame grid, aligned one-to-one with the production feature grid. This is the live half. The
chunking runs **once, after** the capture completes (not streamed during recording).

### 2. Change-points via BINARY SEGMENTATION, not a step detector

`detectChangePoints` builds four **within-hum z-scored** channels (log-energy, pitch in semitones,
log-brightness, flux), then recursively splits at the point of greatest between-segment separation,
`gain(t) = Σ_channels (nL·nR/N)·(meanL − meanR)²`, normalized by segment length. Because the statistic
compares **whole segments**, it fires on both an abrupt **step** and a **gradual ramp** — the decisive
correction over a local sliding-window step detector, which is *blind to a linear trend* (a constant
slope produces no local peak, and within-hum z-scoring shrinks it further). A split is accepted while
its normalized gain clears a **scale-free** floor (`splitGain ≈ 0.62`; measured gap: a steady hum's
oscillatory wander ≈ 0.4, a real contour ≈ 1.0+), the chunks stay ≥ 2.5 s, and the count stays ≤ 5.
Each chunk's features come from re-running the **production extractor** (`computeFeatures`) on its own
samples, so a chunk feature is identical in meaning to a whole-hum feature.

### 3. Predict from the chunk-to-chunk VARIATION (`@hum-ai/orchestrator` `temporal-read.ts`)

Each chunk is read with the same transparent `acousticAffectAxes` backbone; the inner state is
predicted from the variation *across* chunks (first→last valence/arousal/energy arcs, instability
trend, V/A volatility) into a reflective, non-diagnostic shape — *steady / settling / winding_up /
brightening / fading / unsettled* — with safe copy screened by `@hum-ai/safety-language`. It is an
**additive** layer: surfaced on `userFacing.temporal`, kept in full on `internal.temporal`, and it does
**not** rewrite the whole-hum V/A backbone (so every existing read/gate is unchanged).

### 4. Trait-decoupling holds for free

Every channel is z-scored within the hum and every comparison is chunk-to-chunk within the *same* hum,
so a husky vs bright **voice** (a fixed identity offset) cancels and cannot manufacture a trajectory —
the [ADR-0013](0013-trait-decoupled-within-person-standardized-read.md) contract is preserved with no
extra machinery. The temporal layer reads only `state`-kind dynamics, never absolute timbre.

### 5. Persist only the CHUNKS

`HumSyncPayload.temporal` carries a derived chunk summary (count, shape, arcs, per-chunk V/A + energy,
boundary times). The **live frame track is never synced** — only the chunks, per the directive. Field
names avoid the raw-audio token guard; the summary is derived scalars, so it trips no privacy gate.

## Validation

- `@hum-ai/hum-sim`: the synth gained a **zero-default net contour** (`energyShift` / `pitchShiftSemis`,
  a logistic late-vs-early transition that preserves the mean) so existing scenarios stay byte-identical;
  a new **temporal gate (8 checks)** asserts flat-stays-steady, swell/fade detection + direction
  separation, pitch-glide chunking + feature-level pitch-direction recovery, mid-hum boundary placement,
  and copy safety. Release gate: **15 core + 8 temporal**, all green.
- `@hum-ai/sim-lab`: a temporal trajectory scenario (feature-injection) with the **not-skewed** contract
  — identical chunks must read *steady* with arc ≈ 0, never a manufactured trajectory.
- `npm run check` 687 tests (12 new), `npm run qa` 5/5.

## Consequences

- The user sees *how their hum moved*, not only where it landed — a settling arc reads as self-soothing,
  a fading arc as withdrawal, a winding-up arc as building activation.
- The chunks are persisted per hum, ready to feed a future longitudinal/diary trajectory view (not yet
  wired into the relapse model — the backbone-only signal there is unchanged).
- The change-point boundaries are a tuned heuristic (a reflective phrasing), not a clinical event marker;
  the threshold is deliberately conservative (favours leaving a hum whole over over-fragmenting it).
