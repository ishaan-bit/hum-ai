# Lane B — Architecture Decision Closer

Three open decisions closed with typed contracts, tests, and ADRs. **+20 tests, all green.**

## 1. Two-head separation (ADR-0006)

**Decision:** split the flat affect output into a **broad affect head** (dimensional + benign states; drives copy + recommendations) and a **consent-gated clinical-risk marker head** (anxiety/depressive/relapse markers; non-diagnostic, opt-in).

**Implemented** — `packages/affect-model-contracts/src/two-head.ts`:

- `BROAD_AFFECT_STATE_HEADS` / `CLINICAL_RISK_STATE_HEADS` — partition of the 15 state heads by `riskMarker`.
- `BroadAffectHead`, `ClinicalRiskMarkerHead` (`isDiagnostic: false`), `ConsentGatedClinicalRiskHead`.
- `splitInference(inf, consent)` — withholds the clinical head unless the **new consent scope** `clinical_risk_surfacing` (added to `@hum-ai/shared-types`) is granted. Default consent (`local_processing` only) withholds it.
- `RecommendationView` + `toRecommendationView(inf)` — sanitized projection with **abstracted risk bands** (`elevatedRegulationNeed`, `lowEnergyPattern`, `lowMoodPattern`, `mixedOrUncertain`) and benign dimensional signal; **no clinical-marker keys**.
- `assertNoClinicalLeak(view)` / `ClinicalLeakError` — runtime guard.

**Recommendation engine hardened** — `intervention-engine` now reasons over `RecommendationView` only. `selectIntervention(inf, ctx) = selectInterventionFromView(toRecommendationView(inf), ctx)`. The engine reads **zero raw clinical labels** (independent adversarial audit confirmed). All 6 pre-existing intervention tests still pass unchanged.

**Internal-label leak hardened** — `safety-language` `userFacingLabel` now consults `isInternalOnly` so internal-only labels can't surface even as placeholder copy (audit warning fixed).

**Tests:** `affect-model-contracts/test/two-head.test.ts` (6) — disjoint head sets, consent withholding/surfacing, no-clinical-keys-in-view, `assertNoClinicalLeak` catches a leak, abstaining view clean.

## 2. Dual baseline (ADR-0007)

**Decision:** keep a **rolling short-term** baseline (fast, window 24) and an **anchored long-term** baseline (slow, drift-resistant, maturity-gated). Divergence between them is the drift signal.

**Implemented** — `packages/personalization-engine/src/dual-baseline.ts`:

- `RollingBaseline` / `AnchoredBaseline` / `DualBaseline`.
- `buildRollingBaseline` (window `ROLLING_WINDOW=24`), `buildAnchoredBaseline` (inactive below `ANCHOR_MIN_HUMS=20`; long window `ANCHOR_LONG_WINDOW=180`), `buildDualBaseline`.
- `updateAnchoredCenter` (EMA `ANCHOR_EMA_ALPHA=0.05`) — slow, drift-resistant center nudge.
- `baselineDivergence(dual)` — per-feature rolling-vs-anchor drift in anchored robust-σ + scalar `magnitude`; **undefined (not zero)** while the anchor is inactive.
- `UserModelProfile` extended with optional `anchored_baseline_vector` (defaults `{}` for new users — non-breaking; the `baseline_vector == {}` test still passes).

**Tests:** `personalization-engine/test/dual-baseline.test.ts` (7) — anchor activation threshold, rolling-window recency, undefined-divergence-pre-anchor, real drift produces positive divergence, EMA moves slowly, inactive anchor ignores updates.

## 3. User-facing confidence language (ADR-0008)

**Decision:** do not surface raw clinical-looking numeric confidence by default. Surface "Signal clarity" (High/Medium/Low evidence / Early baseline) + "Based on N clean hums". Internal numeric confidence stays for model logic.

**Implemented** — `packages/safety-language/src/confidence-language.ts`:

- `EvidenceLevel`, `evidenceLevelFromConfidence(c, eligibleHumCount)` (pre-baseline → `early_baseline`; abstain → `low`; bands 0.80/0.60).
- `signalClarityLabel`, `basedOnCleanHums`, `userFacingConfidence` → `{ evidenceLevel, signalClarity, basedOn, isEarlyBaseline, summary }` with **no raw number**.
- `isConfidenceCopySafe(text)` — rejects copy embedding a `%` (regression guard).

**Tests:** `safety-language/test/confidence-language.test.ts` (7) — pre-baseline framing, band mapping, abstain→low, plural phrasing, no-percent-in-copy, guard trips on `"87% confident"`, copy passes `validateUserFacingText`.

## Architecture-hardening checklist (from the brief)

| Requirement | Status |
| --- | --- |
| Two-head output separation (broad vs consent-gated clinical-risk) | ✅ `splitInference` |
| Internal labels cannot leak to user-facing copy | ✅ `userFacingLabel`+`isInternalOnly` (hardened), `validateUserFacingText` |
| Recommendation engine cannot receive direct clinical labels | ✅ `RecommendationView` + `assertNoClinicalLeak`; engine reads 0 clinical labels (audited) |
| Dual baseline contracts: rolling + anchored | ✅ `buildDualBaseline`, `baselineDivergence` |
| User-facing confidence language helpers | ✅ `userFacingConfidence` |
| Voice-first roadmap | ✅ Lane C |
| Camera-later ADR | ✅ ADR-0009 |

ADRs created: `docs/adr/0006-…`, `0007-…`, `0008-…` (all `Status: Accepted`, full Context/Decision/Consequences/Alternatives/Sources, cited to the source corpus).
