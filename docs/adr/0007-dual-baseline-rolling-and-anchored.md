# ADR-0007: Dual Baseline — Rolling Short-Term and Anchored Long-Term

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** ML architecture, eng leads
- **Packages:** `@hum-ai/personalization-engine`, `@hum-ai/relapse-engine`, `@hum-ai/shared-types`
- **Related:** [ADR-0003](0003-personalization-and-relapse-model.md) · [ADR-0004](0004-confidence-and-abstention.md) · [PERSONALIZATION_AND_RELAPSE_ARCHITECTURE](../architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md)

## Context

Personalization rests on a per-user baseline of robust feature statistics (median / MAD / IQR; `computeRobustStats`, `zDelta` in `@hum-ai/shared-types`), built over eligible hums (`buildBaselineVector`, rolling window 24, per `hum_spec` §4.6). A single baseline is asked to do two jobs that pull in opposite directions:

- **Track genuine change quickly.** If a user's voice shifts (illness, a hard month, recovery), "your usual" must move with them, or every read drifts stale and z-deltas mislead.
- **Stay a stable reference for relapse/drift.** The relapse engine compares the current hum against personal references [longitudinal_voice_treatment_response_source]. If the reference itself chases every recent session, a slow slide toward a high-risk signature gets quietly absorbed into "your usual" and the drift signal is **masked** — the worst possible failure for an early-warning system.

One rolling window cannot be both fast and stable. The DVDSA design that inspires the relapse engine is explicitly a *paired* comparison against a held reference, not a comparison against a continuously-updated mean [longitudinal_voice_treatment_response_source].

## Decision

Maintain **two baselines** per user (`personalization-engine/src/dual-baseline.ts`):

### 1. Rolling short-term baseline — fast

`RollingBaseline`: robust stats over the last `ROLLING_WINDOW` (24) eligible hums (`buildRollingBaseline`). This is "your recent usual" and what day-to-day z-deltas are computed against. It adapts within weeks.

### 2. Anchored long-term baseline — slow, drift-resistant

`AnchoredBaseline`: a stable reference computed over a long window (`ANCHOR_LONG_WINDOW` = 180) and updated by a small-α EMA on its center (`updateAnchoredCenter`, `ANCHOR_EMA_ALPHA` = 0.05). It is **inactive until the account is mature** — `buildAnchoredBaseline` returns `active: false` with an empty vector below `ANCHOR_MIN_HUMS` (20), aligning with the `relapse_model` personalization stage (ADR-0004). We never anchor on a thin history. This is "your established usual" — the reference the relapse engine compares against.

### 3. Divergence is the signal

`baselineDivergence(dual)` measures how far the rolling center has drifted from the anchor, **per feature, in anchored robust-σ units** (`zDelta(rolling.median, anchorStats)`), plus a scalar `magnitude` (mean absolute drift). While the anchor is inactive, divergence is **undefined** (`anchored: false`, `magnitude: 0`) — not falsely reported as zero drift. Once active, a large divergence is precisely the short-vs-long-term separation that feeds the `relapse_drift` head: the recent self pulling away from the established self.

This maps onto the existing relapse references (`relapse-engine`: `baseline_7d`, `baseline_30d`, `previous_stable`, `previous_high_risk`) — the rolling baseline supplies the recent reference, the anchored baseline supplies the stable one. The profile carries both: `UserModelProfile.baseline_vector` (rolling) and the new optional `anchored_baseline_vector` (anchored), defaulting to `{}` for a new user.

## Consequences

**Positive**
- The drift signal can no longer be masked by a reference that chases recent sessions — the anchor holds still, by design, so a slide *shows up* as divergence.
- Day-to-day reads stay responsive (rolling window 24) without sacrificing the stable longitudinal reference.
- Maturity gating (`ANCHOR_MIN_HUMS = 20`) keeps the anchor honest: no anchored claims until there is enough history to anchor on, consistent with the confidence-cap ladder (ADR-0004).

**Negative / costs**
- Two baselines to store and update per user (still derived-only, no raw audio — privacy posture unchanged).
- The EMA α and anchor window (0.05 / 180) are principled defaults, not yet tuned on native hum data; revisit under the [VALIDATION_PLAN](../validation/VALIDATION_PLAN.md).
- Before maturity, there is no anchored reference — drift detection leans on the rolling baseline and abstains more readily, which is the correct conservative behavior for thin histories.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **Single rolling baseline (status quo)** | Rejected | Cannot be both fast and stable; absorbs slow drift into "your usual" and masks the early-warning signal. |
| **Single long-window baseline** | Rejected | Stable but sluggish; genuine recovery/decline takes too long to register, and early-account users (< window) get no useful baseline. |
| **Fixed first-N-hums anchor (frozen)** | Rejected | A frozen anchor never accommodates legitimate long-term change (puberty, aging, a new normal after recovery); the slow EMA lets the anchor move *deliberately*, not reactively. |
| **Anchor from hum 1** | Rejected | Anchoring on 1–4 hums encodes noise as "established usual." Gate at `ANCHOR_MIN_HUMS` so the anchor means something. |

## Sources

- [hum_spec] — Hum technical spec §4.6: robust baseline (median/MAD/IQR), rolling window 24, baseline activates at 5 eligible hums.
- [longitudinal_voice_treatment_response_source] — Kim et al., *Comms Med* 2026: DVDSA within-user *paired* comparison against a held reference (not a chasing mean) → motivates a stable anchor.
