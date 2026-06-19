# apps/web (placeholder + local demo)

The Hum web client (capture → quality gate → read → song). **The browser UI is
not built in this pass** — the foundation is the contracts and engines in
`packages/*`. `index.html` is a static preview placeholder.

## Local voice-core demo (no microphone, no camera)

The hum-only voice core is now real and runnable locally. From the repo root:

```
npm run demo:voice
```

`demo/voice-core-demo.ts` synthesizes a few test hums **in code** (a clean hum, a
noisy hum, and near-silence — no recording, no capture surface), runs each through
the full pipeline via `orchestrateHumAudio`, and prints only the safe user-facing
read plus a short internal summary. It also builds the derived sync payload through
`buildHumSyncPayload`, which runs `assertNoRawAudioFields` before returning. This is
a developer demo, not a product, and is non-clinical / not validated.

When implemented, the browser app will wire the same local-first pipeline:

1. Record a 12-second hum (`Recorder`, raw-ish constraints — see `hum_spec` §4.1).
2. Extract features on-device (`@hum-ai/audio-features`).
3. Gate quality (`@hum-ai/quality-gate`).
4. Classify domain + score hum-compatibility (`@hum-ai/domain-classifier`).
5. Run experts (`@hum-ai/expert-ser`, optional `@hum-ai/expert-fer`/`@hum-ai/expert-ter`).
6. Late-fuse with calibrated, capped confidence (`@hum-ai/fusion-engine`).
7. Personalize against the rolling baseline (`@hum-ai/personalization-engine`).
8. Compare longitudinally (`@hum-ai/relapse-engine`).
9. Suggest an intervention (`@hum-ai/intervention-engine`).
10. Render only safe, non-diagnostic copy (`@hum-ai/safety-language`).

**Privacy:** raw audio never leaves the device by default; only derived features
sync, and the sync payload passes `assertNoRawAudioFields` (`@hum-ai/shared-types`).
See [DATA_GOVERNANCE](../../docs/privacy/DATA_GOVERNANCE.md).
