# `@hum-ai/orchestrator`

The end-to-end read path. One module runs the full hum read over **derived features
only** and enforces the closed architecture decisions at the seams.

```
audio-features → quality-gate → domain-classifier → expert-ser → fusion-engine →
personalization (dual baseline) → relapse-engine → intervention-engine → safety-language
```

## Entry points

- **`orchestrateHumRead(input)`** — input is the derived `AcousticFeatures`. The
  original, unchanged contract.
- **`orchestrateHumAudio(input)`** — input is a raw `AudioInput` buffer. Feature
  extraction (`computeFeatures`) happens **here, on-device**; the raw buffer is then
  dropped — it is never stored, synced, or placed in the returned object. Downstream
  sees `AcousticFeatures` only. This is the typed-audio entry a real capture surface
  would call.

Both return an `OrchestratedRead`:

| Field | Audience | Guarantees |
| --- | --- | --- |
| `userFacing` | safe to render | qualitative confidence (never a number), plain non-diagnostic copy, one suggestion; **no** clinical-risk key |
| `recommendationView` | the intervention engine | abstracted bands only; **no** clinical-risk head id / internal label |
| `internal` | logging / eval / consent-gated risk | full inference, two-head split (clinical head consent-gated), quality, domain, baseline, relapse, and the derived `features` |

## Invariants enforced at the seams

- **Two-head separation (ADR-0006).** `splitInference(inf, consent)` gates the
  clinical head; only `toRecommendationView(inf)` reaches the intervention engine;
  `assertNoClinicalLeak` guards both the recommendation view and the user-facing
  output. Clinical-risk labels never leave the internal object.
- **No raw clinical labels into engines.** The relapse engine receives only an opaque
  `riskScore`; the intervention engine receives only the sanitized view.
- **Hard confidence caps.** The strictest of the personalization-stage cap, the
  capture-quality cap, and the domain-match penalty is applied (`combineCaps`).
- **Relapse gating.** The within-user relapse model is active only at 20+ eligible
  hums (`relapse_model` stage); below that, `internal.relapse` is `null`.
- **Qualitative confidence (ADR-0008).** The raw number is collapsed to High/Medium/
  Low evidence (or "Early baseline") via `userFacingConfidence`; every user-facing
  string is screened by `safety-language` (`assertSafeUserFacingText`) and checked for
  a stray percentage.
- **Voice-first (ADR-0009).** Only audio-derived features are consumed; no camera /
  visual modality is wired.

## Sync boundary — `buildHumSyncPayload(read, meta)`

Builds the derived, sync-safe projection (derived features + abstracted quality/
domain summaries + qualitative evidence level) and runs the privacy guards
**before** returning it:

- `assertNoRawAudioFields(payload)` — the last line of defense against any
  raw-audio-like field reaching a sync payload (there is none; the guard proves it).
- `assertNoClinicalLeak(payload)` — no clinical-risk label may sync (ADR-0006).

Either guard throws rather than letting an unsafe payload through.

## Try it

`npm run demo:voice` drives synthetic hums (clean / noisy / silent) through
`orchestrateHumAudio` and prints the safe read — no microphone, no camera.
