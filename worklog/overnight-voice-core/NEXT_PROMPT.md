# Next Prompt

Suggested prompt for the next implementation pass. It builds directly on the now-real
voice core and keeps every guardrail in place.

---

You are continuing Hum AI's voice-first implementation. The hum-only DSP voice core is
now real and green (see `worklog/overnight-voice-core/`): `computeFeatures` →
quality-gate → domain-classifier → experts → fusion → personalization → relapse →
intervention → safety-language, with an `orchestrateHumAudio(buffer)` entry point.

Work on a separate worktree + branch (do not touch `main` directly). Do not push,
deploy, force, commit binaries/audio/secrets, install heavy ML/DSP or camera packages,
add FER/visual capture, fake ML/WavLM inference, weaken tests, or make clinical/accuracy
claims. Keep naming locked (`hum-ai` / `@hum-ai/` / `HUM_AI`).

Pick ONE of these (in rough priority order):

1. **Real browser capture surface (still voice-first).** A minimal `apps/web` page with
   a single record button using `getUserMedia({ audio: true })` only — NO video, NO
   camera. Decode to mono PCM, hand it to `orchestrateHumAudio`, render only the safe
   `userFacing` read. Add explicit local-processing consent copy. Keep it small; reuse
   the existing pipeline; never upload raw audio. Add tests for the PCM-extraction glue
   (not the browser APIs).

2. **First real embedding expert behind the existing contract.** Add a hum-trained or
   sustained-phonation SSL embedding expert implementing `@hum-ai/affect-model-contracts`
   `AffectExpert`, fed by the derived features (or a lightweight on-device embedding) —
   honestly capped, domain-matched, and clearly labelled research-stage. NO heavy ML
   dependency in the core; if a model is needed, gate it as an optional, separately
   reviewed package and keep the default path pure-TS. Do not fake inference.

3. **Calibrate the DSP proxies against real hums.** Once a private, consented hum corpus
   exists (referenced via the dataset-registry, never committed), tune the
   pitch/spectral/expression proxies and the domain thresholds on real signal, and
   report honest before/after behavior. No accuracy claims without validation.

4. **Sharpen the domain guard.** Improve speech-vs-singing separation (documented v1
   limitation) using better fricative/voicing/rhythm features — without over-fitting to
   synthetic signals. Add real-feature tests.

Always finish with: `npm run typecheck && npm test && npm run qa` green, an updated
worklog, and a local commit on the new branch only (no push).
