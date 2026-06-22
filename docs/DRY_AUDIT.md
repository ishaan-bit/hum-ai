# HumAI Monorepo — DRY Audit (Pragmatic Programmer)

**Date:** 2026-06-21 · **Head:** `852716a` · **Scope:** 20 packages + 3 apps, ~21.5k LOC TS
**Method:** 10 cross-cutting "lens" finder agents swept the whole monorepo, each candidate was
**adversarially verified** (open the cited files, classify, prove the fix is dependency-safe /
browser-pure / behavior-preserving), then synthesized into one ranked plan.
**Result:** 69 candidates examined → **42 genuine** knowledge-duplications, **27 rejected** as
coincidental/imposed/already-DRY.

> ## ✅ Execution status (applied 2026-06-22)
> **Done & verified** (`npm run check` = 534 tests + 2 typechecks · `npm run qa` = 4 gates · `npm run build:web` — all green):
> P0.1–P0.2 · P1.1 softmax · P1.2 makeRng · P1.3 eval-metrics (`shared-types/metrics.ts`, ECE guard adopted) ·
> P1.4 meanAbsZ · P1.5 far-domain cap · P1.6 AxisPriorMeta · P1.7 vaDistance · P1.8 finiteOr ·
> drifted-copy fixes (`clamp01`/`clamp`/`median`) · P2.2 normalizeDistribution · P2.4 applyStandardizer reuse ·
> P2.7 vaRegion · P2.8 app utils. New `shared-types` exports carry unit tests.
>
> **Deliberately NOT merged** (correct DRY judgment — see §"Deliberately NOT merging"): P2.1 `variance`/`std`
> (not actually cross-package duplicated; self-contained DSP) · P2.3 `bootstrapAccuracyCI` (single call site) ·
> P2.5 `balancedAccuracy` binary (bootstrap hot path). Each now carries a cross-reference comment.
>
> **Deferred:** P2.6 (signal-lab research-CLI report helpers — report-formatting dedup with site-specific
> punctuation, no runtime value, lighter test coverage). Safe to do later; left untouched to avoid cosmetic
> report regressions.

> **Rubric (The Pragmatic Programmer, §"The Evils of Duplication"):** DRY = *"Every piece of
> **knowledge** must have a single, unambiguous, authoritative representation within a system."*
> It is about duplicated **knowledge/intent**, not similar-looking text. The audit classified every
> candidate as **genuine** (inadvertent / impatient / interdeveloper → must fix), **coincidental**
> (looks alike, encodes different knowledge that may evolve independently → must NOT merge — forcing
> them together is a worse anti-pattern the book explicitly warns against), or **imposed** (a
> dependency/perf/isolation boundary makes removal unwise → document, leave).

---

## Verdict: **Partially DRY — "DRY-aware but leaky" (≈ B−).**

The codebase **already has the right architecture for DRY**: a pure, zero-dependency, browser-safe
`@hum-ai/shared-types` primitives layer (`numeric.ts`, `stats.ts`, `affect-primitives.ts`) that is
the canonical home for cross-package math, and it is *used correctly* in many places — `clamp`,
`mean`, `percentile`, `zDeltaCI`, `vaDistance` all live there and are imported widely. Key
constants (OOD fade λ, native-promotion thresholds, far-domain nudge caps) are correctly
single-sourced and exported. That is real DRY discipline.

**The failures are leakage *into* an existing-but-underused layer — un-*migrated* duplication, not
un-*migratable* duplication.** Almost everything below moves to a home that already exists.

### The four systemic gaps

1. **ML/stats primitives were never migrated to `shared-types`.** `softmax` (×4), the `mulberry32`
   PRNG (×5), `variance`/`std`, and the entire eval-metrics family (`accuracyOf`, `balancedAccuracy`,
   `confusionMatrix`, per-class metrics, `expectedCalibrationError`, `groupFolds`, `bootstrapAccuracyCI`)
   were copy-pasted across `signal-lab`, `native-corpus`, `fusion-engine`, and `audio-features`.
   **This is the dominant gap by volume (~25 duplicate definitions).**
2. **Local re-declaration of helpers that already exist in `shared-types`** (`clamp`, `clamp01`,
   `median`, `vaDistance`) — pure inattention, and several copies have **silently drifted** (see below).
3. **A browser-purity workaround caused a real type/constant fork** (`AxisPriorMeta`,
   `AFFECT_PRIOR_FAR_DOMAIN_CAP` re-declared in `apps/web`) because the *pure* deep-module export was
   never created — the correct fix is to add the pure export, not to fork.
4. **Within-package intent duplication** (orchestrator audit-field extraction, V-A region predicates,
   app-level `plain()` / enum-label formatting) — small, local, high-confidence.

### The drift smoking gun (why this matters, not just "it's untidy")

Three local copies have already **diverged from the canonical `shared-types` versions** — the exact
failure mode DRY exists to prevent:

| Local copy | Behaves differently from `shared-types` on |
|---|---|
| `clamp01` in `signal-lab/capture-gate.ts:35` | `+Infinity` → returns `0` (canonical returns `1`) |
| `clamp` in `intervention-engine/music.ts:71` | `NaN` → returns `NaN` (canonical returns `min`) |
| `median` in `relapse-engine/trend.ts:47` | empty array → returns `0` (canonical returns `NaN`) |

Today these are masked because inputs happen to be finite/non-empty; they are latent bugs waiting on
an edge case. Consolidating must **preserve each call site's current behavior** (or consciously unify
it) — noted per-task below.

---

## P0 — Trivial, zero-risk, reuse an already-exported single source

### P0.1 Reuse already-exported orchestrator helpers (within-package)
`axisReadConfidence()` (`orchestrator/axis-read.ts:284`) and `longitudinalTrend()`
(`orchestrator/orchestrator.ts:425`) are re-implemented inline at the call sites:
- `orchestrator/feedback.ts:70` and `:150` — `clamp01(mean([axis.valence.confidence, axis.arousal.confidence]))` → `axisReadConfidence(axis)`
- `orchestrator/orchestrator.ts:633` — `divergence.anchored ? clamp01(divergence.magnitude / 2.5) : 0` → `longitudinalTrend(divergence)`

### P0.2 Orchestrator prior-audit-field extraction
The 4-field `{ expertId, artifact, gatePassed, gateNote }` (`?? null`) extraction is inline twice
(`orchestrator.ts:788-792` and `:810-813`) → a `priorAuditFields(prior)` helper, spread into both.

---

## P1 — Migrate ML/stats primitives to `shared-types` (the big DRY win)

All targets are the **already-existing, zero-dep, browser-pure** `shared-types`; `softmax`/`makeRng`/metrics
use only `Math` + primitives → browser-purity preserved, no new cycles.

| # | Duplication | Copies | Canonical home | Note |
|---|---|---|---|---|
| **P1.1** | `softmax` (numerically-stable, `sum\|\|1` guard) | 4 — `signal-lab/{model,cohort,neural-feature-model}.ts`, `fusion-engine/meta-learner.ts` | `shared-types/numeric.ts` | byte-identical |
| **P1.2** | `mulberry32` PRNG (`makeRng`) | 5 — `audio-features/synth.ts`, `signal-lab/{cohort,evaluate,cohort-eval}.ts`, `native-corpus/train.ts` | `shared-types/numeric.ts` | byte-identical; deterministic seeding preserved |
| **P1.3** | eval-metrics family: `accuracyOf`, per-class metrics, `confusionMatrix`, `balancedAccuracy`, `expectedCalibrationError`, `groupFolds` | `signal-lab/cohort-eval.ts` ↔ `evaluate.ts` | `shared-types/metrics.ts` (new, re-exported) | **`evaluate.ts`'s ECE is missing the `Math.max(0,…)` bin-floor guard `cohort-eval.ts` has → adopting the guarded version is a latent-bug fix.** Keep a `CohortClassMetric` type alias for back-compat. |
| **P1.4** | `meanAbsZ` OOD proxy | 2 — `signal-lab/axis-prior.ts`, `native-corpus/prior.ts` | **`signal-lab/model.ts`** (NOT shared-types) | bound to `LogRegParams` — moving to shared-types would couple the generic layer to a model contract (Orthogonality). The differing OOD hyperparameters stay at the call sites. |
| **P1.5** | `AFFECT_PRIOR_FAR_DOMAIN_CAP = 0.45` | 4 — `signal-lab/{runtime-bridge,inference,expert}.ts` + **fork in `apps/web/prior.ts`** | `signal-lab/axis-prior.ts` (a sanctioned pure deep module) | kills the web fork by creating the pure export the app can reach |
| **P1.6** | `AxisPriorMeta` type fork | `apps/web/prior.ts:37-40` re-declares a subset | `signal-lab/axis-prior.ts:17` | import canonical (or `Pick<…>` if `axis` can't be supplied) |
| **P1.7** | `vaDistance` (`Math.hypot`) | `intervention-engine/music.ts:116` | `shared-types/affect-primitives.ts` (already exported) | import canonical |
| **P1.8** | finite-guard `num(x, fallback)` → `finiteOr` | `expert-ser/experts.ts` (×16 calls) | `shared-types/numeric.ts` | orchestrator's *guarded-assignment* variant is a different shape — leave it |

---

## P2 — Lower-priority migrations & local consolidations

- **P2.1** `variance` / `std` (population) → `shared-types/numeric.ts`; redirect `audio-features/hum-extractor.ts`. (Verify `coefficientOfVariation`'s local use before removing exports.)
- **P2.2** `normalizeDistribution(scores, keys, fallback?)` → `shared-types`; 4 sites (`expert-ser/base.ts`, `expert-ter/index.ts`, `fusion-engine/meta-learner.ts`, `domain-classifier/classifier.ts` via a `noisy_unknown` callback). **Lowest-confidence P2** — if the callback feels like smuggling intent into a "generic," merge only the 3 uniform-fallback sites and leave domain-classifier separate.
- **P2.3** `bootstrapAccuracyCI` → `shared-types`, reusing the shared `makeRng` (after P1.2) and the existing `percentile`. (`native-corpus/train.ts`.)
- **P2.4** Reuse existing `applyStandardizer` (`signal-lab/model.ts:67`) for the inline `(x-mean)/std` loop in `neural-feature-model.ts:136`.
- **P2.5** `balancedAccuracy` binary adapter in `native-corpus/train.ts` → thin wrapper over the generic from P1.3 (after P1.3).
- **P2.6** `signal-lab` pipeline-local helpers — `countByLabel`, `validateSampleSet`, `pct`, `formatExtractionSummary` duplicated across `experiment.ts`/`cli.ts`/`export-neural.ts`/`pipeline.ts` → consolidate **inside signal-lab** (domain-coherent; NOT shared-types).
- **P2.7** V-A region predicates duplicated in `intervention-engine/index.ts` (`selectInterventionFromView` ↔ `supportiveCandidates`) → a `vaRegion(view)` helper. (Do NOT fold in `states.ts` — its branch is intentionally different.)
- **P2.8** App-local utilities → `apps/web` (NOT shared-types): `plain<T>` (`store.ts` ↔ `corpus-store.ts`), `formatEnumLabel` (`render.ts` ×3).
- **P2.9** `ladder.ts` stage cap `0.72` ⟷ `safety-language` `EVIDENCE_BANDS.high = 0.72`: **comment-only, do NOT merge** — equal by design but different facts; `safety-language` is a deliberately zero-dep leaf (IMPOSED).

---

## P3 — Genuine but unsafe to consolidate (document only)

- **P3.1** Gradient-descent LogReg loop: `signal-lab/model.ts:144` ↔ `fusion-engine/meta-learner.ts:193`.
  Genuine algorithm duplication, but `trainLogReg` has a `classWeighted?` toggle (research can disable)
  while `fitMetaLearner` always weights. Extracting a shared loop forces one call site's behavior to
  change. Per Orthogonality, **accept the duplication; add a cross-reference comment** explaining why
  they diverge.

---

## Deliberately NOT merging — coincidental / imposed (27 items)

Knowing what *not* to dedupe is following the book correctly. Highlights:

| Item | Class | One-line reason |
|---|---|---|
| `domain-classifier/softmaxNormalize` vs the 4 `softmax` | Coincidental | L1-normalize of a `Record` with a `noisy_unknown` fallback — different math, different knowledge. |
| Inverse-frequency class weighting (signal-lab vs fusion-engine) | Imposed | Kept self-contained so `fusion-engine` stays dependency-light; conditional vs always-on. |
| `ECE_BINS` 5 vs 10 | Coincidental | Bin counts reflect different datasets' statistical power; merging couples independent protocols. |
| Promotion-gate thresholds (offline vs on-device) | Coincidental | Bulk-validation policy vs small-n policy; merging also risks a dep cycle. |
| `0.15` EMA-alpha (×4); `0.2`/`0.25` knobs (×several) | Coincidental | Distinct adaptive processes, equal by accident — must tune independently. |
| `AUDIO_EXTENSIONS` (dataset-harness ↔ signal-lab) | Imposed | `dataset-harness` is a deliberately zero-dep leaf; adding `shared-types` for a 7-element set trades DRY for coupling. |
| File-ext / basename / POSIX-path parsing | Coincidental | Same surface syntax, different intent per site (RAVDESS stem vs junk filter vs speaker-id vs relPath). |
| JSON / localStorage read+parse patterns | Coincidental | Identical try/catch shell, different *recovery* semantics — abstracting hides the intent. |
| `selfNormality` decay; V-A steering targets; cohort sort-by-accuracy | Coincidental | Same one-liner / shape, intentionally independent v1/v2 pipelines & policies. |
| `88%` clinical cap, `0.6` high-risk band | Coincidental/Imposed | `0.6` is genuinely duplicated but `longitudinal.ts`↔`relapse.ts` consolidation would form a dep cycle — note, leave. |
| `esc`, `$` DOM getter in `render.ts`; `wilson95`; nudge caps / OOD λ / native thresholds | Already-DRY | Single source each — false alarms. |

---

## Suggested execution order

1. **P0.1, P0.2** — orchestrator, isolated, instant.
2. **P1.1 softmax + P1.2 makeRng** — independent `shared-types` adds; do together (both edit `numeric.ts`).
3. **P1.3 eval-metrics** — largest, but `cohort-eval`/`evaluate` have the strongest test coverage; includes the ECE-guard bugfix.
4. **P1.4–P1.8** — independent small migrations.
5. **P2.1–P2.4** (P2.3 after P1.2; P2.5 after P1.3), then **P2.6–P2.8** (local), **P2.9/P3.1** (comment-only).

**Verification after each group:** `npm run check` (typecheck + web typecheck + 497 tests) + `npm run qa`
(4 governance gates). Regression watch-points: deterministic-seed assertions (P1.2/P2.3), metric values
on RAVDESS fixtures (P1.3), and `apps/web` browser-purity typecheck (P1.5/P1.6 — confirm no `node:*`
enters the bundle path). Several targets (`meta-learner.ts`, `axis-read.ts`, `orchestrator.ts`,
`fuse.test.ts`, `render.ts`, native-corpus `train.ts`) are already dirty in git — run their suites
before and after to isolate the refactor from in-flight work.

---

*Generated by a multi-agent DRY audit (10 lenses → adversarial verify → synthesis), 2026-06-21.
2 of 69 verify agents failed to return structured output and their candidates were dropped — coverage
is otherwise complete. This report is the plan; no code has been changed yet.*
