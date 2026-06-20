# End-to-End Spine Wiring — FINAL STATUS

**Date:** 2026-06-19 · **Branch:** `end-to-end-spine-wiring` (off `longitudinal-diagnostic-state`)
**Scope:** wire the ONE disconnected stage of the HumAI spine — *pretrained/model
inference* — into the full runtime orchestrator, using the repo's existing contracts.
No redesign, no new architecture, no new training. Zero runtime deps added.

## The gap (traceable to the repo)

The runtime spine `orchestrateHumRead` / `orchestrateHumAudio`
(`packages/orchestrator/src/orchestrator.ts`) already wires every stage —
features → quality → domain → experts → fusion → personalization → relapse →
longitudinal-diagnostic → intervention → safety — **except** it could only run the
heuristic stub ensemble (`defaultAudioExperts()`, orchestrator.ts:249 pre-change).
The trained affect-PRIOR model lived only in `@hum-ai/signal-lab`:

- `LearnedAffectPriorExpert` (`signal-lab/src/expert.ts`) is documented as *"a
  drop-in for the `SpeechEmotionExpert` stub … drops into FusionEngine exactly
  where the SpeechEmotionExpert stub sits."*
- `inferFromHum` (`signal-lab/src/inference.ts`) is a **truncated** single-hum
  evidence-report path — it uses the model but has **no** personalization /
  relapse / longitudinal-diagnostic stages.
- README "Next steps #1": *"Replace heuristic experts with trained SER/embedding
  models."* Governance: ADR-0005 (public data = priors only, far-domain penalty).

So the trained model could not flow through the FULL spine. That is the missing wiring.

## What was implemented (only the missing/disconnected wiring)

1. **Orchestrator injection seam (decoupled, contract-based).**
   `OrchestratorInput` / `AudioOrchestratorInput` gain an optional
   `learnedAffectPrior?: { expert: AffectExpert; confidenceCap; capReason?; artifact? }`.
   When supplied, the trained prior is a **drop-in for the `expert-ser:speech-emotion`
   slot** (same acted-speech role → replaced, not double-counted) and contributes its
   **far-domain confidence cap** (ADR-0005) to `combineCaps` (strictest still wins).
   When absent, the heuristic ensemble runs **identically** (honest fallback). The
   orchestrator stays decoupled from signal-lab — only the `AffectExpert` contract
   crosses the seam. A new internal-only `modelProvenance` field records which model
   produced the read (transparency/eval; never rendered, never synced, no
   raw-audio/clinical key).

2. **signal-lab runtime bridge** (`signal-lab/src/runtime-bridge.ts`):
   - `loadLearnedAffectPrior(opts?)` — read-only load of the git-ignored
     `data/processed/signal-lab/model.json`; returns `null` when absent (fallback),
     wraps a present artifact as the orchestrator-ready prior (cap 0.45). Never
     trains, never writes.
   - `orchestrateHumWithLearnedPrior(input)` — **the single clean end-to-end path
     for a new hum**: auto-load the prior (or fall back) and run the full orchestrator
     spine. `signal-lab` now depends on `@hum-ai/orchestrator` (acyclic — orchestrator
     does not depend on signal-lab).

3. **Composition demo** `apps/web/demo/full-spine-demo.ts` + `npm run demo:spine`.
   Loads the trained prior if present, else heuristic fallback; prints the safe
   user-facing read + internal provenance. (`@hum-ai/signal-lab` added to `apps/web`.)

## End-to-end path now

```
orchestrateHumWithLearnedPrior(audio|features, consent, history)
  └─ loadLearnedAffectPrior() → LearnedAffectPriorExpert (or null → fallback)
  └─ orchestrateHumAudio/Read({ …, learnedAffectPrior })
        computeFeatures → quality-gate → domain-classifier
        → experts: heuristic ensemble with the trained prior dropped into the
          speech-emotion slot (pretrained/model inference)
        → fusion (+ caps incl. 0.45 far-domain prior penalty)
        → personalization (dual baseline re-reference)
        → relapse + assessLongitudinalState (diagnostic, 88% clinical hard cap)
        → intervention (sanitized RecommendationView only)
        → safety-language screen → stable UserFacingRead + sync-safe payload
```
Verified live: `npm run demo:spine` loaded a real `model.json`, fused it
(`model=learned_affect_prior`, `priorUsed=true`), bound the cap
(`appliedCap=0.45 … ADR-0005`), passed the raw-audio guard, and abstained on silence.

## Model artifacts: used vs fallback

- **Used (if present):** `data/processed/signal-lab/model.json` (git-ignored LogReg
  affect prior, RAVDESS acted speech) — loaded read-only, fused as a far-domain prior
  (penalty 0.45), never hum truth, never clinical.
- **Fallback (no artifact):** deterministic heuristic SER-family ensemble
  (`defaultAudioExperts()`) — `priorUsed=false`. No training launched; no artifact
  created, deleted, or overwritten.

## Safety / personalization / longitudinal / diagnostic / intervention wiring

Unchanged from the established design — the prior is fused *before* these stages, so
all of them now operate on the (optionally) model-driven read with no behavior change:
two-head consent gate, 88% `CLINICAL_RISK_CONFIDENCE_CAP`, qualitative-only confidence,
`assertNoClinicalLeak` on the recommendation view + user-facing output, and
`assertNoRawAudioFields` at the sync boundary.

## Tests added (8; suite 331 → 339)

- `orchestrator/test/learned-prior.test.ts` (4): injected prior is actually fused +
  recorded in provenance; heuristic fallback unchanged when absent; far-domain cap
  binds (strictest wins); claim/safety boundary holds with a risk-leaning prior + consent.
- `signal-lab/test/runtime-bridge.test.ts` (4): loader null-fallback when no artifact;
  loader wraps a present artifact (temp model written to OS tmpdir, never the repo);
  full-spine integration with a real trained prior (cap binds, no clinical leak);
  forced heuristic fallback.

## Gates

- `npm run typecheck` ✅  ·  `npm test` ✅ **339 pass / 0 fail**  ·  `npm run qa` ✅ 4/4
  (no-clinical-leak, no-camera-deps, no-raw-confidence-copy, forbidden-files).
- `git ls-files data/` → **0**. `model.json` confirmed git-ignored. No weights,
  checkpoints, raw audio, datasets, credentials, or env files tracked.

## What remains underspecified / blocked (reported, not invented)

- The fused model is a **far-domain acted-speech PRIOR** — not hum truth, not clinical,
  not gate-validated for affect (47.9% 6-way; see multidataset-modeling). Nothing here
  changes that; it stays penalized and capped.
- Face/Text experts (`expert-fer`/`expert-ter`) remain deliberately deferred
  (Phase 3, ADR-0009) — out of scope, not wired.
- The personalization LEARN loop (`ingestHum`) stays caller-driven by design
  (documented + tested); the bridge reads, it does not persist state.
