# Hum AI — Stable Build v11

> **One line.** v11 is a **trait-decoupling** build: it stops the read from mistaking a person's
> **natural voice** for their **mood**. A heavier/huskier voice and a brighter voice that *feel the
> same* now read alike on the very first hum (they used to read "calmer" vs "unsettled"); mood is
> carried by what the person *does* with the hum (loudness, melodic movement, steadiness), and the
> identity offset that remains is removed as a personal baseline forms. The trained models now
> retrain on **within-person standardized deviations**, not absolute values, and a new **cross-voice
> invariance** release gate locks the contract in. Privacy posture, the two-head/screening seams, the
> fidelity ⊥ affect contract, and the divergence/relapse signal are all **unchanged**.

Builds on [v10](STABLE_BUILD_V10.md). The capture-gate, fusion, the quality/consent/privacy gates, the
relapse/screening separation, and the existing `npm run hum-sim` + `npm run sim` release gates are
preserved; v11 adds the trait/state taxonomy, the first-hum cue rebalance, deviation-based retraining,
and the cross-voice gate. Recorded as [ADR-0013](adr/0013-trait-decoupled-within-person-standardized-read.md).

## 0. Coordinates

- **Starting commit:** `6b8a28a` (`docs(stable-build-v10): record final commit hash + verified production deploy`), branch `main`.
- **Final commit:** `5de8045` (`feat(stable-build-v11): trait-decoupled within-person standardized read — voice identity is not read as mood`), branch `main`. The build's code+docs landed in `5de8045`; this hash line is finalized in the immediately-following docs commit, per the v8–v10 convention.
- **Verified production deploy:** `hum-ai-beige.vercel.app` → HTTP 200, serving build asset `index-Clcxeqsi.js` (matches the local `npm run build:web` output); aliased to deployment `hum-imvpofz1n-ishaans-projects-f5eaf242.vercel.app`.
- **Scope (new):** `packages/audio-features/src/feature-taxonomy.ts` (+ test),
  `packages/orchestrator/test/cross-voice.test.ts`, `packages/signal-lab/test/feature-schema-standardize.test.ts`,
  this spec, `docs/adr/0013-…`.
- **Scope (changed):** `packages/orchestrator/src/axis-read.ts`, `packages/personalization-engine/src/salience.ts`
  (+`package.json`), `packages/signal-lab/src/feature-schema.ts`,
  `packages/native-corpus/src/{train,prior,manifest,index}.ts`, `packages/population-corpus/src/{train,prior}.ts`,
  `packages/personality-signature/src/index.ts`, `packages/hum-sim/src/{scenarios,analysis,report}.ts`,
  `packages/sim-lab/src/{scenarios,report,fifty-hums}.ts`, `apps/web/src/app/main.ts`, `README.md`.
- **Unchanged:** the served model artifacts, raw-audio/clinical privacy guards, dual-baseline **divergence**
  (stays absolute), the transparent `acousticValue` provenance, and the within-user display re-reference math.

## 1. The defect

The first-hum read mapped the **absolute** level of identity-bearing features straight onto affect:

| Cue | Was | Problem |
|---|---|---|
| `pitchMeanHz` (register) | valence 0.30 + arousal 0.12 | a husky/low voice → low valence/arousal; a bright/high voice → high — **regardless of mood** |
| `spectralCentroidHz` (brightness) | arousal 0.10 | a dark voice → calmer, a bright voice → more activated |
| `meanRms` et al. (loudness) | arousal 0.40 | identity (projection/mic) **⊕** mood (effort) — only the deviation is mood |

So two people who felt the same but had different natural voices got different reads on hum #1 ("the
husky voice is calmer, the bright voice is unsettled"). The OCEAN signature had the same bug
(loudness/brightness → Extraversion/Agreeableness).

## 2. The fix (six wired pieces)

1. **Shared taxonomy** — `@hum-ai/audio-features` `FEATURE_KIND` classifies every feature `timbre` /
   `state` / `fidelity` / `structural` (exhaustive over the schema). One source of truth for the read,
   the salience, the model vector, and the personality signature.
2. **First-hum cue rebalance** (`axis-read.ts`) — the purest IDENTITY cues get the *smallest* mood
   weight (pitch register 0.30→0.18 / 0.12→0.06; brightness 0.10→0.06); the read leads on loudness +
   **melodic movement** (relative) + within-hum dynamics. Poles still reachable, every axis-read
   regression green. `acousticValue` stays absolute. Vibrato stays a valence cue, never tension.
3. **Within-person opening, applied once** — owned by the existing output-level `reReferenceDisplayRead`
   (the read does NOT also standardize at the feature level — that would double-count + break
   provenance). Personal **salience** down-weights `timbre` (×0.4) so the mood deviation leans on
   `state` cues. Divergence/relapse stays ABSOLUTE.
4. **Models retrain on standardized deviations** (`toFeatureVector(f, baseline?)`) — `timbre` features
   become within-person/within-contributor **z-deltas** (winsorized); `state`/`fidelity` stay as-is;
   no-baseline = byte-identical to before. Native = self-baseline; population = **per-contributor**
   standardization before pooling; inference standardizes the live hum identically (population prior
   rebuilt per-hum against the live user's rolling baseline).
5. **Personality population-decoupling** — the identity cues feeding Extraversion/Agreeableness read
   through `PopulationOceanNorms` (a *between-person* reference — correct for a stable trait; within-
   person would conflate trait with baseline maturation).
6. **Cross-voice invariance gate** — `hum-sim` + `sim-lab`: mood fixed, five voices husky→bright must
   read within a bounded displayed span (valence ≤ 0.45, arousal ≤ 0.30). The inverse of the pin/un-pin
   check. Updated the `fifty-hums` probe to the two-part contract (mood spreads, identity clusters).

## 3. Evidence

- **`npm run check`** — typecheck + web typecheck + **675 tests pass** (12 new: taxonomy, standardized
  vector, cross-voice invariance).
- **`npm run hum-sim`** — release gate **✅ PASS (13 checks)**; new `cross-voice-invariance`: 5 voices,
  same mood → displayed span **V 0.25 / A 0.26** (≤ 0.45 / 0.30); the corner-archetype separation,
  reachability, neutral zero-point, fidelity-no-manufacture, and longitudinal pin/un-pin all still hold.
- **`npm run sim`** — **0 fail**; cross-voice span **V 0.31 / A 0.16**; pin/un-pin still opens a fixed
  voice across 5 zones (span 1.52).
- **fifty-hums probe** — a husky-low voice now reads `v=-0.07` and a bright-high voice `v=0.24` at the
  same mood (was opposite zones); 4 of 5 land in "Steady/Even".

## 4. Honest limits

- The **first hum** still carries a small, bounded residual identity offset — it is mathematically
  un-removable without personal data. It is hedged by the population-prior confidence cap and dissolves
  within a few hums as the within-user re-reference and the deviation-trained models take over.
- The deviation-based retraining is wired end-to-end but **inert in the current deployment** (no served
  population artifact; the within-user native model needs a HiTL corpus) — it is the architecture for
  "going ahead", validated by tests, with cold-start behaviour byte-identical to v10.

## 5. Deploy

Prebuilt Vercel deploy of `apps/web` (same pipeline as v8–v10). Public URL: **hum-ai-beige.vercel.app**.
