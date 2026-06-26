# Hum AI — Stable Build v12

> **One line.** v12 reads a hum as a **trajectory**, not a single snapshot. The mood-variable
> parameters are tracked **live** across the 12 s; *after* the hum a rule-based **change-point**
> layer cuts it into the few **meaningful chunks** where it actually shifts; and the inner state is
> predicted from the **chunk-to-chunk variation** — *settling*, *winding up*, *brightening*,
> *easing off*, *restless*, or *steady*. The number and placement of shifts is itself a signal: a
> settled hum stays one chunk, a restless one fragments. Only the **chunks** are saved per hum.

Builds on [v11](STABLE_BUILD_V11.md). The capture-gate, the V/A backbone, fusion, the
quality/consent/privacy gates, the relapse/screening separation, the fidelity ⊥ affect contract, and
the existing `npm run hum-sim` + `npm run sim` release gates are all **preserved** — v12 adds a new,
additive *within-hum* layer alongside the whole-hum read; it never rewrites the backbone. Recorded as
[ADR-0014](adr/0014-within-hum-temporal-trajectory.md).

## 0. Coordinates

- **Starting commit:** `895d73f` (`fix(axis-read): correct low-arousal "quiet/subdued" pin + harden hum-sim harness`), branch `main`.
- **Final commit:** `8db000c` (`feat(stable-build-v12): within-hum temporal trajectory …`), branch `main`. This hash line is finalized in the immediately-following docs commit, per the v8–v11 convention.
- **Verified production deploy:** `hum-ai-beige.vercel.app` → HTTP 200, serving build asset `index-BcyBZPgx.js` (matches the local `npm run build:web` output) with the `within-hum-card` element present; aliased to deployment `hum-kplr5vvsz-ishaans-projects-f5eaf242.vercel.app`.
- **Scope (new):** `packages/audio-features/src/temporal.ts` (+ test), `packages/orchestrator/src/temporal-read.ts` (+ test), `packages/hum-sim/src/temporal-scenarios.ts`, `packages/sim-lab/src/temporal-scenario.ts`, this spec, `docs/adr/0014-…`.
- **Scope (changed):** `packages/audio-features/src/index.ts`, `packages/orchestrator/src/{orchestrator,index}.ts` (+ test), `packages/hum-sim/src/{synth,latent,cli}.ts`, `packages/sim-lab/src/report.ts`, `apps/web/src/app/{cycle,render}.ts`, `apps/web/{index.html,src/app/styles.css}`.
- **Unchanged:** the V/A acoustic backbone math, the served model artifacts, the raw-audio/clinical privacy guards (the new chunk summary is derived scalars only), the dual-baseline divergence/relapse signal, and the within-user display re-reference.

## 1. The idea

A 12-second hum is a short performance, not a held note. Research on vocal emotion is explicit that
the **local/dynamic** structure of an utterance carries affect that whole-utterance averages destroy:

- *"Local prosodic features represent the temporal dynamics in prosody … how features change over
  time greatly matters to listeners"* (Rao & Koolagudi, global+local prosody for SER).
- a **declining** vocal-energy contour marks fatigue/withdrawal; a sustained/rising one, vitality.
- **rising F0** across an utterance tracks rising arousal/activation; a **falling** contour, settling
  (calm and sadness both fall).
- pitch and intensity **fluctuate more** in high-arousal segments — so a *growing* fluctuation is
  building agitation, a *settling* one is self-regulation (the soothing function humming is used for).
- **utterance-final** segments are disproportionately informative to listeners.

## 2. The design (live track → post-hum chunking → chunk-to-chunk prediction)

1. **Live parameter track** (`audio-features/temporal.ts` `computeFrameTrack`) — energy, F0,
   brightness and flux sampled on the native **80 ms** frame grid, aligned one-to-one. This is the
   "tracking" half; it happens live across the hum.
2. **Post-hum change-point chunking** (`detectChangePoints`) — *after* the capture completes, a
   rule-based **binary segmentation** finds the points of greatest between-segment separation on the
   four **within-hum z-scored** channels. The gain statistic `(nL·nR/N)·Δμ²` compares *whole*
   segments, so it fires on both an abrupt **step** and a **gradual ramp** (a local step-detector
   misses the latter — a linear glide has no local peak). A scale-free gain floor (≈0.62, validated by
   the hum-sim gate: flat ≈0.4 vs contoured ≈1.0+) keeps a steady-mood hum whole; min chunk length
   2.5 s and a 5-chunk cap keep chunks feature-stable. Each chunk's features come from re-running the
   **production extractor** on its own samples, so a chunk feature means exactly what a whole-hum
   feature means.
3. **Chunk-to-chunk prediction** (`orchestrator/temporal-read.ts`) — each chunk is read with the same
   transparent acoustic V/A backbone; the inner state is predicted from the **variation across chunks**
   (valence/arousal/energy arcs, instability trend, volatility) into a reflective, non-diagnostic
   shape: *steady / settling / winding up / brightening / fading / restless*. Surfaced on
   `userFacing.temporal`, kept in full on `internal.temporal`, and screened with the rest of the copy.
4. **Persisted as chunks** — `HumSyncPayload.temporal` carries a derived chunk summary (count, shape,
   the arcs, per-chunk V/A + energy, boundary times) to Firestore. The **live frame track is not
   synced** — only the chunks, per the design directive.
5. **Surface** — `apps/web` renders a within-hum trajectory card: a colour strip (one band per chunk,
   coloured by that chunk's own V/A), the live energy contour drawn over it with the boundaries
   marked, the shape badge, and the reflective phrase. Computed post-capture in `cycle.ts`.

**Trait-decoupling holds for free.** Every channel is z-scored *within* the hum and every comparison
is chunk-to-chunk *within the same hum*, so a husky vs bright **voice** cannot manufacture a
trajectory — the v11 contract is preserved without any extra machinery.

## 3. Evidence

- **`npm run check`** — typecheck + web typecheck + **687 tests pass** (12 new: live track, change-point
  detection on steps + ramps, chunk-cap/min-length, degenerate audio, and the chunk-to-chunk prediction
  incl. the not-skewed contract + copy safety).
- **`npm run hum-sim`** — release gate **✅ PASS (15 core + 8 temporal)**. The synth gained a
  zero-default net contour (`energyShift` / `pitchShiftSemis`), so all existing scenarios stay
  byte-identical (the 15 core checks confirm it). New temporal checks: a flat hum stays one steady
  chunk (no manufactured trajectory); a swell/fade is chunked and read rising/easing; rise vs fall
  energy arcs separate (1.03); a pitch glide chunks the hum and its chunks track the pitch (+94 / −87
  Hz); the mid-hum boundary lands near centre; all surfaced copy is safe.
- **`npm run sim`** — **0 fail**; the temporal trajectory scenario classifies flat→steady (arc 0),
  rising→winding_up, fading→fading, settling→settling, and the cross-voice / pin-unpin / fidelity
  contracts all still hold.
- **`npm run qa`** — **5/5** (the chunk summary trips no raw-audio / clinical / confidence guard).

## 4. Honest limits

- The chunk **boundaries** are a heuristic (binary segmentation with a fixed scale-free gain floor),
  tuned on synthesized contours; they are a reflective phrasing of the hum, not a clinical event
  marker. The threshold is conservative — it favours leaving a hum whole over over-fragmenting it.
- The trajectory is an **additive surfaced layer**: it complements the whole-hum read and is persisted
  per hum, but it does **not** yet feed the longitudinal/relapse model or the diary timeline (the
  chunks are saved for that future use). The whole-hum V/A backbone is unchanged.

## 5. Deploy

Prebuilt Vercel deploy of `apps/web` (same pipeline as v8–v11). Public URL: **hum-ai-beige.vercel.app**.
