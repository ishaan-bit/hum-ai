# ADR-0012: A consented, governed population corpus pools per-user hum truth into a community baseline — without ever steering a user from another user's raw data

- **Status:** Accepted (implemented; live cross-user write gated OFF pending the contributing-UI toggle + IRB sign-off)
- **Date:** 2026-06-24
- **Packages:** **`@hum-ai/population-corpus` (new)**, `@hum-ai/shared-types` (the `population_corpus_contribution` consent scope), `@hum-ai/personality-signature` (population OCEAN norms), `@hum-ai/app-web` (3-tier prior selection + the gated contribution write)
- **Builds on:** [ADR-0011](0011-hitl-native-hum-retraining-loop.md) (the within-user HiTL corpus + the on-device retrain→gate→promote loop), [ADR-0005](0005-public-datasets-as-priors-not-truth.md) (datasets are priors; only `native_hum` is hum truth)
- **Unchanged:** [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) (two-head separation, clinical cap), [ADR-0010](0010-model-led-read-from-first-hum.md) (the axis read + the 0.5 axis-nudge cap), all privacy guards.

## Context

[ADR-0011](0011-hitl-native-hum-retraining-loop.md) ends each read with a benign valence/arousal self-report, mints one `NativeHumExample` (derived features only), and retrains a **within-user** hum-native model on-device. Its final rejected alternative was explicit: *"Cross-user pooling needs its own research consent + IRB. … the corpus is sync-ready for a governed backend to pool later."* This ADR is that governed backend pathway.

Two problems motivate it:

1. **The cold start.** A brand-new user has zero confirmed hums, so they read entirely through the far-domain acted-speech prior, which abstains out-of-domain (the common case on a hum). They get the transparent acoustic backbone only — no community-learned in-domain signal — until they have personally confirmed enough hums to promote their own model.
2. **The Big Five norms.** The within-user personality signature ([personality-signature](../../packages/personality-signature/src/index.ts)) reads a trait against *protocol defaults* until it has a population to normalise against.

The accumulated, consented `native_hum` rows from many users can answer both — **if** pooling never leaks raw audio, never lets one person's data masquerade as another's read, and never claims more than it has earned.

## Decision

### 1. A new `@hum-ai/population-corpus` package pools contributions and trains a population baseline — with the SAME honest gate as the within-user loop

- **`contribution.ts`** — `buildPopulationContribution({ example, contributorKey, consentVersion, contributedAt })` wraps one already-validated `NativeHumExample` (derived features + benign self-report, ADR-0011) with a **pseudonymous** `contributorKey` (`contributorPseudonym(localId)` — a stable hash, never the raw id) and the consent-document version, for audit. The underlying example still passes `assertNoRawAudioFields` + `assertNoClinicalLeak`.
- **`pool.ts`** — `poolContributions(pool)` dedupes by example id and returns a `PooledCorpus` with a `foldKey` that maps every example to its contributor. This `foldKey` is the integrity hinge: it forces **group-by-contributor cross-validation** so one person's hums can never be split across train and test (no within-person leakage inflating the score).
- **`train.ts`** — `trainPopulationArtifact(pool, now)` runs the **identical** `buildHumNativeArtifact` retrain→gate→promote from [ADR-0011](0011-hitl-native-hum-retraining-loop.md), parameterised with the grouped `foldKey`. A population axis prior is `eligibleForPromotion` only when `contributorCount >= POPULATION_MIN_CONTRIBUTORS` (**8**) — a diversity guard so a handful of contributors can't define "the population" — **and** it clears the same promotion bar a personal model must. Below that, OCEAN norms + a provenance manifest are recorded, but **no axis prior steers anyone**.
- **`ocean-norms.ts`** — `computePopulationOceanNorms` derives the Big Five normalisation the signature reads against; surfaced via `PopulationArtifact.oceanNorms`.
- **`prior.ts`** — `populationAxisPriors(artifact)` exposes the promoted population model as an `AffectAxisPrior`, and `selectAxisPriors({ personal, population, farDomain })` picks **per axis across three tiers** (see §2).

### 2. Three-tier prior selection — the user's OWN model wins, the community baseline is the middle, the far-domain prior is the floor

`@hum-ai/app-web` `effectiveAxisPriors()` routes all three through the existing `AffectAxisPrior` seam, so the orchestrator is **unchanged** ([ADR-0010](0010-model-led-read-from-first-hum.md)):

```
personal (your promoted hum-native model)  >  population baseline (the community improved)  >  far-domain acted-speech prior (abstains OOD)
```

A brand-new user reads through the population baseline (in-domain, no far-domain penalty) instead of an abstaining acted-speech prior. As they confirm their own hums and promote a personal model, the read shifts onto their own, per axis. The 0.5 axis-nudge cap of ADR-0010 still bounds the contribution — a prior *refines*, never overrides.

### 3. Governance: contribution is a distinct, default-OFF consent scope; live write awaits the UI toggle + IRB

- A new consent scope **`population_corpus_contribution`** ([shared-types/privacy.ts](../../packages/shared-types/src/privacy.ts)) is **distinct from `derived_feature_sync`**: backup sync writes only to the user's *own* owner-scoped space; population contribution writes to the *pooled* corpus that retrains a community baseline. A user can back up privately without ever contributing to the pool.
- In `app-web`, the contribution write (`appendPopulationContributionCloud`) is gated behind `isGranted(consent, "population_corpus_contribution") && uid`. The scope defaults to **not granted**, and the contributing-UI toggle is intentionally **not yet shipped** — so this is a **no-op in production today**. Reading + training a served `PopulationArtifact` is **offline-capable** and needs no live data; the app falls back to the far-domain prior when none is served (identical to pre-ADR behaviour).
- Pooling and training run on the **same derived-only rows** as ADR-0011 (no raw audio is ever poolable), under **group-by-contributor CV**, with the **same promotion discipline that never rounds up**, and provenance that records contributor count, example count, and the grouped-CV note.

## Consequences

- The cold start has an honest answer: a new user can read through an **in-domain, community-learned** baseline instead of an abstaining far-domain prior — once the pool exists and clears the 8-contributor + promotion gate. Until then, behaviour is exactly as before.
- The personality signature gains real population OCEAN norms (still exploratory, non-clinical).
- Honesty holds end-to-end: derived-only rows, a separate opt-in that is OFF by default, a diversity floor, grouped CV that resists leakage, and a promotion gate identical to the within-user loop. The architecture is real and tested; **no production pooled data flows yet** — the docs say so plainly, which is the point of recording this decision.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| Reuse `derived_feature_sync` for pooling | Rejected | Conflates "back up my own data privately" with "contribute to a shared model." Pooling is a materially different disclosure and needs its own informed opt-in. |
| Pool client-side into a global model | Rejected | ADR-0011's standing position. Cross-user pooling is a backend step with its own governance; the client only *contributes* a consented, pseudonymous, derived-only row. |
| Random k-fold CV on the pooled corpus | Rejected | Splits one person's hums across train/test → within-person leakage inflates the score. Group-by-contributor CV is mandatory. |
| Promote a population prior at any contributor count | Rejected | A few contributors are not "the population." `POPULATION_MIN_CONTRIBUTORS = 8` is a diversity floor; below it, only norms + provenance are recorded. |
| Ship the contributing UI now | Deferred | The data pathway is in place and tested, but turning on live cross-user write awaits the contributing-UI toggle + IRB sign-off. Default-OFF until then. |
