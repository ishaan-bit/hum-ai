# Cohesion + QA/QC — Prioritized Implementation Plan

**Source:** multi-agent cohesion/QA review (11 dimensions, adversarially verified).
**Baseline at review time:** `npm run typecheck` clean · `npm test` 202/202 · `npm run qa` 4/4 green.
**Result:** 27 findings confirmed, 3 refuted, **0 blockers, 0 high**. After de-duplication → **24 unique items**.
**Status:** PLAN ONLY — no fixes applied, no code/tests modified.

## Priority ↔ bucket mapping

- **P0 = Must fix now (before the domain classifier lands).**
- **P1 = Fix after classifier merge** (touches the confidence/dep-graph seam the classifier reshuffles, or non-urgent and safe to batch).
- **P2 = Documentation-only** and **real-but-lowest-value cleanup**.

> Classifier note: **no finding's fix touches `packages/domain-classifier/src/*` internals.** Finding F7 *reads from* the classifier's confidence-penalty output but is fixed entirely in `fusion-engine`. The "before/after classifier" call is about sequencing/merge-churn and validation against real classifier outputs, never about editing the classifier.

## Summary table

| ID | Sev | Area | Bucket | Before/after classifier |
|----|-----|------|--------|--------|
| F1 | P0 | DSP correctness — clipping metric | Must fix now | Before |
| F2 | P0 | Safety guard — clinical-leak scan | Must fix now | Before |
| F3 | P0 | Safety guard — raw-audio field detector | Must fix now | Before |
| F4 | P0 | Safety guard — confidence-copy regex | Must fix now | Before |
| F5 | P0 | Privacy gate — case sensitivity | Must fix now | Before |
| F6 | P0 | Privacy gate — archive extensions | Must fix now | Before (classifier may bring datasets/weights) |
| F7 | P1 | Fusion confidence — cap vs rounding | After merge | After |
| F8 | P1 | Fusion confidence — abstainReason "none" | After merge | After |
| F9 | P1 | Manifest — qa-gates zero deps | After merge | After (batch with graph reshuffle) |
| F10 | P1 | Manifest — dataset-harness phantom dep | After merge | After |
| F11 | P1 | Tooling — apps/web demo deps + typecheck | After merge | After |
| F12 | P1 | DSP — sub-70 Hz false F0 | After merge | Independent (defer by priority) |
| F13 | P1 | DSP — spectral RMS gate floor | After merge | Independent (defer by priority) |
| F14 | P2 | Docs — ADR-0000 bare "Hum" | Docs-only | Independent |
| F15 | P2 | Docs — TRISENSE intervention boundary | Docs-only | Independent |
| F16 | P2 | Docs — README LogReg vs Stub | Docs-only | Independent |
| F17 | P2 | Docs — README 14/18 package table | Docs-only | Independent |
| F18 | P2 | Docs — personalization dual-baseline | Docs-only | Independent |
| F19 | P2 | Docs — CONTRIBUTING pre-PR command | Docs-only | Independent |
| F20 | P2 | Cleanup — rolling window 24 ×3 | No-action/cleanup | Independent |
| F21 | P2 | Cleanup — anchor count 20 ×2 | No-action/cleanup | Independent |
| F22 | P2 | Cleanup — baseline activation 5 ×2 | No-action/cleanup | Independent |
| F23 | P2 | Cleanup — dead `decisionFor` / unreachable "poor" | No-action/cleanup | Independent |
| F24 | P2 | Cleanup — relapse rationale wording (nit) | No-action/cleanup | Independent |

**Likely false positives:** none. The 3 false positives were already removed by adversarial verification; all 24 below reproduce against real code.

---

## BUCKET 1 — MUST FIX NOW (P0, before classifier)

### F1 — Clipping measured on the DC-removed signal, not raw samples
- **Severity:** P0 (medium correctness)
- **Files:** `packages/audio-features/src/hum-extractor.ts:186-196` (read `x` → should read `x0`)
- **Evidence:** `x = removeDcOffset(x0)` (line 138); clip loop tests `Math.abs(x[i]) >= DSP_PARAMS.clipSampleLevel` (0.98). `clipSampleLevel` is documented as a *raw full-scale rail* property.
- **Why it matters for Hum:** DC removal shifts rail-pinned samples below 0.98. Reproduced: a clipped capture (`clippedFrameRatio 0.947`) + a `+0.12` DC bias collapses to `0.000` → the quality gate (`gate.ts:66`, `maxClippedFrameRatio 0.08`) passes a heavily distorted hum as clean. Defeats clip rejection for cheap/uncalibrated ADCs — and the quality gate is the front door the classifier sits behind.
- **Recommended fix:** measure clipping on `x0[i]` (already in scope, NaN/Inf-sanitized) instead of `x[i]`. One-token change.
- **Risk of fixing:** very low. `x0` already exists; existing clip test still passes; `peakAmplitude`/`silence` intentionally keep using the AC signal.
- **Before/after classifier:** **Before** — keeps the pre-classifier quality gate honest.

### F2 — `assertNoClinicalLeak` scans only object *keys*, never string *values*
- **Severity:** P0 (medium safety — ADR-0006)
- **Files:** `packages/affect-model-contracts/src/two-head.ts:189-211`; mirror in `packages/qa-gates/src/clinical-leak.ts:50-62`
- **Evidence:** traversal does `if (forbidden.has(key))` only; never tests string values. Reproduced: `assertNoClinicalLeak({marker:'depressive_affect_markers'})` and `{tags:['relapse_drift']}` both pass. `relapse_drift` is simultaneously a forbidden head id **and** a live `RelapseClass` value.
- **Why it matters for Hum:** the guard's own docstring calls it "the last line of defense against a future refactor leaking raw labels"; it runs at 3 orchestrator seams (236, 282, 387). A refactor surfacing `relapse.class` / an intervention rationale / an `abstainReason` into a user-facing or sync field would not be caught — the exact regression class it advertises protection against. No live leak today (latent).
- **Recommended fix:** hoist a string check to the top of `visit()` — `if (typeof value === 'string') { if (forbidden.has(value)) offenders.push(value); return; }` and recurse array items; apply identically to `findClinicalLeakKeys`.
- **Risk of fixing:** low. Could surface a latent leak as a thrown error (desired). No false positives on current payloads (they carry no clinical-label strings). *Adds a regression test — deferred per your "no tests yet" instruction; flag for the same PR.*
- **Before/after classifier:** **Before** — the classifier widens the data flowing through these seams.

### F3 — Raw-audio field detector misses `pcmData`/`pcmBuffer`/`sampleArray`/`floatSamples`
- **Severity:** P0 (medium safety — invariant 4)
- **Files:** `packages/shared-types/src/privacy.ts:62-78`
- **Evidence:** `FORBIDDEN_RAW_AUDIO_FIELDS` adds bare `"pcm"`/`"samples"` with comment "substring matcher also covers variants," but the exact list is matched with `===` and `RAW_AUDIO_TOKENS` contains `"rawpcm"` (not `"pcm"`) and no sample token. Reproduced: `isRawAudioFieldName('pcmData'|'floatSamples'|'linearPcm'|...)` all return `false`.
- **Why it matters for Hum:** `assertNoRawAudioFields` is the documented "last line of defense" at the sync boundary (`orchestrator.ts:386`). The most natural raw-PCM carrier names slip through; a future payload attaching `pcmData` leaks raw audio off-device. The inline comment actively misleads reviewers. Latent (current payload has no such field).
- **Recommended fix:** add `"pcm"` to `RAW_AUDIO_TOKENS` (safe — no benign field contains it) + targeted `"audiosample"`/`"pcmsample"`. **Do NOT** add a bare `"sample"` token — it false-positives on `sampleRate`/`sampleCount`. Correct the misleading comment.
- **Risk of fixing:** low **if** you avoid bare `"sample"`. Bare `"sample"` would throw on legit `sampleRate` metadata — explicitly avoid.
- **Before/after classifier:** **Before.**

### F4 — `isConfidenceCopySafe` only blocks a literal ASCII `%` (misses `0.87`, `87 percent`, unicode `%`)
- **Severity:** P0 (medium safety — ADR-0008). *De-dupes two findings (Q4 + Q5).*
- **Files:** `packages/safety-language/src/confidence-language.ts:100-109`
- **Evidence:** regex is `/\b\d{1,3}\s?%/`. Docstring promises it catches `"0.87 confidence"`. Reproduced: `"0.87 confidence"`, `"87 percent sure"`, `"92％ sure"` (U+FF05) all return safe.
- **Why it matters for Hum:** this is the orchestrator's runtime numeric-leak backstop over *every* composed user-facing string (`orchestrator.ts:277`), and the `no-raw-confidence-copy` QA gate reuses it (`confidence-copy.ts:51`). A regression interpolating `inference.confidence.confidence` (a 0..1 float — the exact diagnostic value ADR-0008 forbids) passes both guard and gate. Latent (today's copy is fixed templates with no numbers).
- **Recommended fix:** broaden to match ASCII/fullwidth/small `%`, the word `percent`/`pct`, and a bare decimal probability adjacent to confidence wording; align the docstring to what is actually enforced.
- **Risk of fixing:** low–moderate. A naive "reject any decimal" pattern could false-positive on future copy; constrain the decimal pattern to *near confidence wording* (verifier confirmed no false positives on current templates / "Based on 12 clean hums").
- **Before/after classifier:** **Before** — classifier output increases the variety of confidence values flowing toward copy.

### F5 — `forbidden-files` gate is case-sensitive on 6 of 7 rules
- **Severity:** P0 (medium privacy — invariant 6)
- **Files:** `packages/qa-gates/src/forbidden-files.ts:40,47,55,62,69,76` (only 87 uses `/i`); mirror in `.github/workflows/privacy-check.yml` rules 1–6,8; stray JSDoc at `:27-28`
- **Evidence:** uppercase variants `models/affect.ONNX`, `model.SafeTensors`, `private.PEM`, `api.TOKEN`, `.ENV`, `Datasets/…csv` all pass the gate (reproduced — return no match). Only the one `/i` clinical-label rule and lowercase exts trip.
- **Why it matters for Hum:** a privacy/secret gate that silently passes `.PEM`/`.ENV`/`.ONNX`/`.TOKEN` is trivially bypassed, and Windows/macOS contributors routinely produce capitalized extensions. The gate's own header promises public-safety. (0 currently-tracked files change behaviour — latent.)
- **Recommended fix:** add `/i` to the six `test` regexes **and their paired `allow` regexes**; switch `grep -E`→`grep -iE` (and `-vE`→`-ivE`) on the YAML twin; delete/fix the misplaced JSDoc above `readonly fix: string`.
- **Risk of fixing:** low. Verifier confirmed `/i` produces **zero** new matches / no false positives on the 252 tracked files.
- **Before/after classifier:** **Before** — see F6 (classifier may add model/dataset artifacts).

### F6 — Privacy gates miss dataset-archive extensions (`.zip`/`.tar`/`.tar.gz`/`.tgz`)
- **Severity:** P0 for sequencing (reviewer severity: low, but elevated because the classifier is the trigger)
- **Files:** `.github/workflows/privacy-check.yml:42`; `packages/qa-gates/src/forbidden-files.ts:40`
- **Evidence:** extension rule lists model/audio/doc exts but **no** `zip|tar|tgz|gz`. `.gitignore:81-84` was explicitly patched (commit `57b4fe0`) to block archives "so downloaded dataset archives can never be accidentally committed." A force-added `ravdess.zip` / `data/crema-d.tar.gz` matches neither the extension rule nor the `(datasets|recordings|raw_audio)/` dir rule.
- **Why it matters for Hum:** `.gitignore` is bypassable via `git add -f`; the CI gate is the real backstop. **Landing the domain classifier likely brings training datasets and/or model weights** — exactly the artifact class this gap fails to catch. Fix it before that work starts.
- **Recommended fix:** add `zip|tar|tgz|gz` to both gates (include `gz` — `foo.tar.gz` ends in `.gz`, not `.tar`). Optionally also add `data` to the dir rule to match `.gitignore data/`.
- **Risk of fixing:** very low (extension-anchored). *Test fixtures deferred per your instruction.*
- **Before/after classifier:** **Before** — strongest before-classifier argument of the set.

---

## BUCKET 2 — FIX AFTER CLASSIFIER MERGE (P1)

### F7 — `confidencePercent` can round above `appliedCap × 100`
- **Severity:** P1 (low correctness/contract). *De-dupes two findings.*
- **Files:** `packages/fusion-engine/src/confidence.ts:37`; contract/doc `affect-model-contracts/src/confidence.ts`, `docs/adr/0004-confidence-and-abstention.md:68`
- **Evidence:** `confidencePercent: round(confidence*100)` with half-up `round`. A fractional binding cap like `0.715` → `round(71.5)=72 > 71.5`, breaking ADR-0004's "provably never exceeds appliedCap×100." All *current* production caps are integer-×100, so latent.
- **Why it matters for Hum:** the binding cap is fed by `domainAdaptation.confidencePenalty = clamp01(0.25 + 0.75*domainMatch)` — **a classifier output**. When the real classifier lands, fractional caps become routinely reachable, so the guarantee should be enforced and validated against real classifier distributions.
- **Recommended fix:** `Math.floor(confidence*100)` (or `Math.min(round(...), Math.floor(cap*100))`); fix the stray `inference.ts:59` citation to `confidence.ts` class comment.
- **Risk of fixing:** very low (off-by-≤1pp internal value; not user-surfaced under ADR-0008).
- **Before/after classifier:** **After** — validate the floor against real classifier-derived caps; co-locate with F8 in the same file.

### F8 — Abstaining read can report `abstainReason: "none"`
- **Severity:** P1 (low correctness — diagnostic only)
- **Files:** `packages/fusion-engine/src/confidence.ts:31-32, 46-55`
- **Evidence:** `abstained` gates on combined confidence; `chooseAbstainReason` re-derives from per-signal thresholds and falls through to `"none"`. Reproduced at floor 0.45 with boundary inputs → `abstained:true, abstainReason:"none"` (the not-abstained sentinel).
- **Why it matters for Hum:** ADR-0004 frames `abstainReason` as the typed explanation of *why* a read declined. Downstream gates on the boolean `view.abstained`, so behaviour is correct — impact is audit/eval interpretability only. The reproduction inputs include `domainMatch` (classifier output), so the boundary shifts once the classifier lands.
- **Recommended fix:** coalesce in the abstained branch — `const r = chooseAbstainReason(...); abstainReason = abstained ? (r === 'none' ? 'low_margin' : r) : 'none'`.
- **Risk of fixing:** very low.
- **Before/after classifier:** **After** — same `confidence.ts` edit window as F7; validate against real classifier inputs.

### F9 — `qa-gates` imports three `@hum-ai/*` packages but declares zero dependencies
- **Severity:** P1 (medium cohesion — invariant 7)
- **Files:** `packages/qa-gates/package.json:1-10`
- **Evidence:** no `dependencies` key; source imports `@hum-ai/affect-model-contracts`, `@hum-ai/shared-types`, `@hum-ai/safety-language`. Only typechecks because root tsconfig `paths` resolves globally. It's the sole importing package declaring no edges.
- **Why it matters for Hum:** breaks per-package install/build/publish and any manifest-derived dep graph (incl. qa-gates' own `camera-deps` scan iterating manifests). No runtime bug today.
- **Recommended fix:** add the three real edges as `"*"` workspace deps. (Do not add others.)
- **Risk of fixing:** none (manifest-only, resolution unchanged).
- **Before/after classifier:** **After** — the classifier merge adds/moves graph edges (e.g. an `orchestrator → domain-classifier` edge); batch all manifest hygiene (F9–F11) into one pass to avoid double-editing.

### F10 — `dataset-harness` declares a phantom dep on `@hum-ai/dataset-registry`
- **Severity:** P1 (low cohesion)
- **Files:** `packages/dataset-harness/package.json:10-12`
- **Evidence:** declares `@hum-ai/dataset-registry` but no source imports it (grep clean; all imports are node builtins / relative).
- **Why it matters for Hum:** misrepresents the dep graph for tooling and readers; implies a coupling that doesn't exist. Dev-tooling scope only.
- **Recommended fix:** drop the dep (or wire `validate.ts` to actually consume the registry's rules if that was the intent).
- **Risk of fixing:** none (workspace `"*"` resolves regardless; baseline stays green).
- **Before/after classifier:** **After** — batch with F9/F11.

### F11 — `apps/web` demo: undeclared deps + excluded from typecheck
- **Severity:** P1 (low cohesion/tooling). *De-dupes two findings.*
- **Files:** `apps/web/package.json:1-7`; `tsconfig.json:45`; demo `apps/web/demo/voice-core-demo.ts`
- **Evidence:** demo imports `@hum-ai/{shared-types,audio-features,orchestrator}` (all undeclared); root `include:["packages/**/*.ts"]` excludes `apps/`, no per-app tsconfig. CI has no `demo:voice` step.
- **Why it matters for Hum:** the only non-placeholder app code consuming cross-package public signatures has **zero type coverage** — a renamed `orchestrateHumAudio`/`buildHumSyncPayload` export passes CI green and only breaks the advertised `npm run demo:voice`.
- **Recommended fix:** declare the three deps; extend `include` to `["packages/**/*.ts","apps/web/demo/**/*.ts"]` (paths already resolve).
- **Risk of fixing:** low — extending `include` could surface a pre-existing demo type error (would be a real catch; verify it currently typechecks first).
- **Before/after classifier:** **After** — the classifier touches `orchestrator` signatures the demo consumes; batch.

### F12 — Sub-70 Hz tones reported as a confident, wrong ~500 Hz F0
- **Severity:** P1 (low correctness)
- **Files:** `packages/audio-features/src/dsp/pitch.ts:64-66, 87-105`
- **Evidence:** for F0 below `minPitchHz` (70), autocorrelation can't reach the true lag; global-max picker locks a sub-period. Reproduced: a 55–60 Hz tone → `f0=500.0`, strength ~0.71–0.75, passes the `[70,500]` gate as fully voiced. **Verifier corrected the root cause:** false reports occur at the *low-lag* edge (`bestLag===minLag`), and the original "reject `bestLag===maxLag`" fix is ineffective.
- **Why it matters for Hum:** a confident wrong pitch is worse than `null`; closed-mouth hums can dip near 70 Hz. Out-of-band edge case; no test guards it.
- **Recommended fix (corrected):** reject frames whose autocorrelation is still climbing at the low-frequency edge — e.g. `if (norm[maxLag] > norm[maxLag-1]) return {f0:null,strength:0}` — distinguishing a true in-band 500 Hz (value ~1.0) from sub-harmonic alias (~0.73).
- **Risk of fixing:** moderate — pitch edge logic; must not kill legitimate 500 Hz. Needs a couple of targeted test signals (deferred).
- **Before/after classifier:** **Independent** of the classifier; placed here purely by priority — safe anytime.

### F13 — Spectral energy gate compares Hann-windowed RMS to the time-domain quiet-frame threshold
- **Severity:** P1 (low correctness)
- **Files:** `packages/audio-features/src/dsp/spectral.ts:63-72`
- **Evidence:** `frameRms` is computed from Hann-windowed samples (~0.61× true RMS) but compared to `DSP_PARAMS.quietFrameRms` (0.012), the constant applied to *un-windowed* RMS elsewhere → effective floor ~0.020, materially stricter.
- **Why it matters for Hum:** inconsistent definition of "active" between time-domain and spectral feature groups; a soft-but-clean hum contributes fewer/zero frames to centroid/bandwidth/flatness. Values are ratios so only frame *selection* is biased — bounded, deterministic.
- **Recommended fix:** gate on un-windowed frame RMS (accumulate a second raw-energy sum) while still windowing for the FFT.
- **Risk of fixing:** low.
- **Before/after classifier:** **Independent**; deferred by priority.

---

## BUCKET 3 — DOCUMENTATION-ONLY (P2)

> All doc-only; zero runtime/safety impact; independent of the classifier. Each is "edit the doc to match the code."

### F14 — ADR-0000 forbids bare "Hum" but shipped docs use it ~120×
- **Files:** `docs/adr/0000-product-naming.md:34,40` (+ ~120 sites across docs/apps).
- **Evidence:** ADR-0000: "the *only* sanctioned use of bare 'Hum' as a product noun" = "legacy Hum"; yet sibling ADRs/READMEs use bare "Hum" as the live product noun.
- **Why it matters:** doc-vs-doc contradiction of the naming constitution; naming-check can't see it.
- **Fix:** relax ADR-0000 to permit bare "Hum" as in-prose shorthand after "Hum AI" is introduced (don't churn 120 sites).
- **Risk:** none. **Independent.**

### F15 — TRISENSE doc says intervention engine reads raw state scores
- **Files:** `docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md:162-164`
- **Evidence:** doc says `selectIntervention` reads "the state scores"; code reads only the sanitized `RecommendationView` via `toRecommendationView`.
- **Why it matters:** misstates the exact ADR-0006 sanitization boundary the clinical-leak invariant depends on.
- **Fix:** reword to reflect the sanitization boundary; keep the accurate V-A half.
- **Risk:** none. **Independent.**

### F16 — README presents LogReg meta-learner as active fusion (code uses Stub)
- **Files:** `README.md:15,23`
- **Evidence:** README "Architecture at a glance" names a Logistic-Regression meta-learner; `fuse.ts:43` defaults to `StubWeightedMetaLearner`, `LogisticRegressionMetaLearner.combine` throws.
- **Why it matters:** lightly brushes invariant 1 (overclaiming a trained model). Same README elsewhere is honest ("No models are trained"), so impact is low.
- **Fix:** label the at-a-glance meta-learner as the deterministic reliability-weighted stub (LogReg = target). No code change.
- **Risk:** none. **Independent.**

### F17 — README package table lists 14 of 18 packages as complete
- **Files:** `README.md:36-55`
- **Evidence:** "All packages are `@hum-ai/*`" + 14-row table omitting `orchestrator`, `qa-gates`, `dataset-harness`, `naming-check`.
- **Why it matters:** omits the architecturally central orchestrator and the qa-gates package backing `npm run qa`.
- **Fix:** add the four rows (or reword the completeness claim).
- **Risk:** none. **Independent.**

### F18 — Personalization architecture doc omits the dual/anchored baseline (ADR-0007)
- **Files:** `docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md:61-75`
- **Evidence:** doc describes only a single rolling baseline; no mention of `dual`/`anchor`/ADR-0007/divergence, though code implements `buildDualBaseline`/`AnchoredBaseline` and it's wired live in the orchestrator.
- **Why it matters:** canonical subsystem doc describes less than the code; could mislead a contributor on how relapse references form.
- **Fix:** expand the section to cover the anchored baseline (window 180, EMA 0.05, gated at 20) + `baselineDivergence`; add ADR-0007 to the decisions list.
- **Risk:** none. **Independent.**

### F19 — CONTRIBUTING's "run before every PR" command omits the qa gates CI enforces
- **Files:** `CONTRIBUTING.md:41,58`
- **Evidence:** docs say run `npm run check` (typecheck+test); CI runs `npm run qa` as a hard step. `qa:all` exists but is undocumented.
- **Why it matters:** a contributor can be green locally, red in CI on a safety/privacy gate. (CI still blocks merge — no leak path.)
- **Fix:** point CONTRIBUTING at `npm run qa:all`. (README already lists `qa` — don't "add qa to README".)
- **Risk:** none. **Independent.**

---

## BUCKET 4 — REAL BUT LOWEST-VALUE / NO ACTION THIS CYCLE (P2)

> All verified real (not false positives), but no runtime/safety impact and no urgency. Fix opportunistically or skip.

### F20 — Rolling-baseline window `24` hand-copied in 3 places, no shared constant/sync test
- **Files:** `quality-gate/src/thresholds.ts:37`, `personalization-engine/src/dual-baseline.ts:29`, `…/profile.ts:58`
- **Why it matters:** only `ROLLING_WINDOW` is operative; `rollingBaselineSize` is never read (false impression the gate enforces the window); `profile.ts` uses a bare `24` next to its sibling constant.
- **Fix (minimal):** `profile.ts` import `ROLLING_WINDOW`; delete/annotate the orphan `rollingBaselineSize`.
- **Risk:** low. **Independent.** Recommendation: defer — no live drift possible (non-production helper).

### F21 — Anchor/relapse activation `20` duplicated (`ANCHOR_MIN_HUMS` vs magic `n<=19`)
- **Files:** `personalization-engine/src/dual-baseline.ts:25`, `…/ladder.ts:65-76`
- **Why it matters:** invariant-8 maturity gate encoded as two unlinked numbers; editing one desyncs anchored baseline from relapse-model activation. Both are 20 today — no current bug.
- **Fix:** `ladder.ts` import `ANCHOR_MIN_HUMS`, use `n < ANCHOR_MIN_HUMS`.
- **Risk:** low. **Independent.** Recommendation: fix opportunistically.

### F22 — Baseline-activation `5` duplicated (`baselineActivationCount` vs magic `n<=4`)
- **Files:** `quality-gate/src/thresholds.ts:36`, `personalization-engine/src/ladder.ts:43-54`
- **Why it matters:** `baselineActivationCount` is never read (dead spec constant); soft maturity step.
- **Fix:** delete the orphan field, or link it to the ladder boundary.
- **Risk:** low. **Independent.** Recommendation: defer.

### F23 — Dead `decisionFor()` helper + unreachable `"poor"` CaptureQuality
- **Files:** `quality-gate/src/gate.ts:21-25` (+ union line 7), `thresholds.ts:49`
- **Why it matters:** `decisionFor` is never called; `evaluateQuality` never emits `"poor"`. `noUnusedLocals` isn't on, so it accumulates silently. No drift yet (logic still matches).
- **Fix:** delete `decisionFor` and the `"poor"` tier (or wire `"poor"` into `evaluateQuality` if intended); consider enabling `noUnusedLocals`.
- **Risk:** low. **Independent.** Recommendation: fold into a cleanup pass.

### F24 — Relapse rationale says "multiple references" when one reference can trigger (nit)
- **Files:** `packages/relapse-engine/src/relapse.ts:132-134`
- **Why it matters:** the `(>=1 && drift>=0.5)` arm fires on a single reference, but the hard-coded rationale says "multiple references." Internal-only string (never surfaced to users) — log/eval interpretability only.
- **Fix:** branch the rationale string by which arm fired.
- **Risk:** none. **Independent.** Recommendation: nit — fix only if touching the file.

---

## Recommended execution order

1. **Now / before classifier (P0):** F1 (clipping) → F5, F6 (privacy gates) → F2, F3, F4 (safety guards). One PR, ~6 small edits; each ships with a regression test (test work currently deferred per instruction).
2. **With/after classifier merge (P1):** batch the confidence-pipeline pair F7+F8 (one file, validate against real classifier caps); batch manifest/tooling F9+F10+F11; then DSP F12, F13 when convenient.
3. **Docs sweep (P2):** F14–F19 in a single docs PR.
4. **Cleanup (P2):** F20–F24 opportunistically (or skip F24).

**Constraints honored:** no fixes applied · no classifier internals referenced for editing (F7 reads classifier output, fixed in fusion-engine) · no tests modified (regression tests flagged, not written).
