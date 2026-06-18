# Next Prompt — Hum AI

Paste this to start the next pass. State at handoff: foundation + architecture-hardening complete and green (109/109 tests, typecheck clean, naming clean); committed and pushed **private** to `github.com/ishaan-bit/hum-ai` (`6c5a45e`); CI + privacy-check workflows live; three architecture decisions closed (ADR-0006/0007/0008) + voice-first/camera-later (ADR-0009). No LICENSE yet; repo private by owner choice.

---

You are acting as Hum AI's Plan → Build → Validate controller. Working dir: `c:\Users\Kafka\Documents\humai`.

Naming is locked: **Hum AI** / `hum-ai` / `@hum-ai` / `HUM_AI`. "legacy Hum" = old spec only. Never introduce HumAI, Hum-AI, Hum v2, @hum.

**Do not regress these invariants:** voice-first only (no camera packages/visual extraction; FER stays placeholder — ADR-0009); raw audio never leaves device by default; no diagnosis (markers only); recommendation engine consumes the sanitized `RecommendationView` only (ADR-0006); clinical-risk head stays consent-gated (`clinical_risk_surfacing`); user-facing confidence stays qualitative (ADR-0008); keep `npm run check` green; don't weaken tests; don't commit source binaries/datasets/audio/weights/secrets.

## Goal: wire the end-to-end orchestrator over the closed decisions

1. **Orchestrator package** (`@hum-ai/orchestrator` or in an app surface) connecting the full path:
   `audio-features → quality-gate → domain-classifier → expert-ser → fusion-engine → personalization-engine (dual baseline) → relapse-engine → intervention-engine → safety-language`.
   - Feed the **dual baseline**: build `buildDualBaseline` from eligible-hum features; use `baselineDivergence` to inform the `relapse_drift` head and `longitudinalTrendStrength`.
   - Apply the **two-head split** at the output boundary: `splitInference(inf, consent)`; pass only `toRecommendationView(inf)` to the intervention engine; gate the clinical-risk head on `clinical_risk_surfacing`.
   - Render confidence via `userFacingConfidence(report, eligibleHumCount)` — never the raw number; screen all copy with `validateUserFacingText` + `assertSafeUserFacingText`.
   - Compute the relapse `riskScore` from the clinical head (behind the consent gate), not from raw labels in the engine.

2. **Tests** for the orchestrator: end-to-end happy path, abstention path, consent-withheld path (clinical head absent, recommendations still work), early-baseline path (qualitative confidence = "Early baseline"), and a guard test that `assertNoClinicalLeak` holds on whatever the recommendation engine receives.

3. **Optional, scoped:** begin replacing heuristic experts with trained SER/embedding models — but register every dataset in `@hum-ai/dataset-registry` first, and keep clinical-speech evidence as a prior, not hum truth (ADR-0005). No heavy ML deps in the foundation CI.

## Validate
`npm test`, `npm run typecheck`, `checkNaming`, privacy scan, `git status`. Commit only if green + privacy-safe. Push to the existing private `origin`.

## Carry-over (before any public flip)
- Scrub `c:\Users\Kafka\…` absolute path + Windows username from the pre-existing note packs.
- Remove/clear the "Prof. Arvind Sahay" / private-draft framing in `docs/source/INDEX.md`.
- Replace "Hum v2" and stale `packages/@hum/…` references in `parallel-*` notes (or archive them).
- Add a `LICENSE` and review full git history, then `gh repo edit --visibility public`.
- (Optional) Link the Vercel project + branch protection (`docs/devops/`).
