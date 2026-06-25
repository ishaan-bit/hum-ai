# Hum AI — Stable Build v10

> **One line.** v10 is a **phone-native interaction + first-hum experience** build: it removes a
> real production defect where a vertical page-scroll that began on a control could silently mutate
> a reading / assessment value (and, on the mood field, mint **false HiTL training data**); makes
> the **Big Five (OCEAN) assessment available from the user's first completed hum**; gives the live
> listening orb a restrained, telemetry-driven sense of **presence**; hardens the **mic recording
> lifecycle** against backgrounding / incoming-call interruption; and closes a **documentation gap**
> (the long-cited but never-written **ADR-0012**). No read-math, privacy posture, or screening seam
> changed — the affect engine of [v9](STABLE_BUILD_V9.md) is preserved byte-for-byte.

Builds on [v9](STABLE_BUILD_V9.md). The capture-gate, axis-read calibration, fusion, personalization,
relapse/screening separation, and the `npm run hum-sim` release gate are all **unchanged**. v10 is an
**interaction-model + availability + lifecycle** build, plus an integrity/docs pass.

## 0. Coordinates

- **Starting commit:** `6debf64` (`docs(stable-build-v9): record final commit hash`), branch `main`.
- **Final commit:** `__FINAL_COMMIT__` (`feat(stable-build-v10): …`), branch `main` (this hash line is finalized in the immediately-following docs commit, per the v8/v9 convention).
- **Scope (code):** `apps/web/src/app/{render.ts, styles.css, orb.ts, capture.ts, main.ts}`,
  `packages/personality-signature/src/index.ts`. **Docs:** new `docs/adr/0012-…`, this spec, `README.md`.
  **No** change to `audio-features`, `orchestrator` read math, `fusion-engine`, `personalization-engine`,
  the screening/relapse heads, the consent/privacy gates, or the served model artifacts.

## 1. Highest priority — mobile interaction safety

### 1.1 Root causes (why a scroll could change a value)

| # | Root cause | Where | Class |
|---|---|---|---|
| **M1** | **The mood field claimed every touch.** The 2-D mood map carried inline `touch-action:none`, and `pointerdown` *immediately* set `dragging=true`, captured the pointer, and moved the dot; `pointermove` then `preventDefault()`-ed and kept moving it. A vertical page-scroll that merely **began** on the field was therefore captured as a drag — it moved the dot, blocked the scroll, **and** (because the mood field *is* the HiTL signal) staged a **false self-report** for retraining. | `render.ts` `renderMoodAdjust` + `moodField` | wrong interaction model |
| **M2** | **Native range sliders had no axis constraint.** The Mood/Energy sliders and all five **Big Five trait sliders** are `<input type="range">` with default `touch-action`, so a vertical drag that started on a thumb could move the value instead of scrolling the page. | `styles.css` `.mood-range`, `.trait-range`, `.fb-slider input` | missing touch-action |
| **M3** | **The window swipe didn't exclude the mood-field background.** The stage's horizontal swipe ignored `button, a, input, label, [data-no-swipe]` — but the mood map background is a `<div role="application">`, so an intentional horizontal drag to set valence could *also* flip to the next window. | `stage.ts` ∩ `render.ts` | gesture conflict |
| **M4** | **iOS focus-zoom.** The diary note `<input type="text">` was `0.88rem` (≈14px); iOS Safari auto-zooms the viewport when an editable field under 16px takes focus. | `styles.css` `.diary-note input` | iOS viewport |

### 1.2 The gesture strategy (and why it cannot accidentally change a value)

The fix is at the **interaction-model** level, not CSS cosmetics. The mood field is a 2-D control, so a
blanket "horizontal-only" rule is wrong — but a vertical *page scroll* must still always win. The model
distinguishes **four intentional gestures** from an incidental scroll:

1. **Tap** anywhere on the field → place the dot there (sets valence *and* energy at once). A press that
   never crosses a **10 px slop** is a tap, not a drag.
2. **Grab the dot handle** → free 2-D drag (the only way to set energy by dragging). The handle is the
   one element with `touch-action:none`; a *tap* on the handle does **not** nudge it — only a real drag does.
3. **Intentional horizontal drag** on the field → once travel crosses the slop **and** `|dx| ≥ |dy|`, the
   gesture is *claimed*: pointer captured, `preventDefault`, dot follows.
4. **Keyboard** arrows nudge the focused field (the accessible path).

The decisive rule: **until horizontal intent is proven, nothing is claimed.** The field's CSS is
`touch-action: pan-y`, so the moment the finger moves more vertically than horizontally, the browser
takes the gesture for **native scrolling** and fires `pointercancel` — we release completely, and the dot
never moves. The native sliders use the same principle declaratively: `touch-action: pan-y` lets the
browser scroll on a vertical drag while the slider keeps horizontal thumb drags. Because the *only* code
paths that write a value are a claimed-horizontal drag, a deliberate handle drag, a tap, or a keypress, a
vertical scroll has **no path** to mutate a reading, a Big Five answer, or a logged value — and therefore
no path to mint a false HiTL row.

There is **no blanket `preventDefault`, no `touch-action: none` on a scroll surface, and no scroll-lock**.
`preventDefault` is called *only* on frames where a horizontal drag is already claimed.

### 1.3 Exact fixes

- `render.ts` — rewrote the mood-map pointer handling to the axis-locked model above (slop 10 px, tap-to-place,
  handle-grab, horizontal-claim, vertical-release); added `data-no-swipe` to `.mood-field` (fixes **M3**);
  removed the inline `touch-action:none` (fixes **M1**).
- `styles.css` — `.mood-map { touch-action: pan-y; user-select:none; -webkit-tap-highlight-color:transparent }`;
  `touch-action: pan-y` on `.mood-range`, `.trait-range`, and `.fb-slider input[type=range]` (fixes **M2**);
  `.diary-note input { font-size:16px }` (fixes **M4**).
- The diary chart (tap-only `data-at` stars, already `data-no-swipe`) and PHQ radios (tap targets) need no
  change — they cannot be moved by a scroll. Every value-selection surface in the app was audited.

### 1.4 Device / browser considerations covered

- **iOS Safari:** `touch-action: pan-y` + `pointercancel` release prevents scroll-capture; `user-select:none`
  + `-webkit-tap-highlight-color:transparent` stop text-selection/flash during a dot drag; the 16px input
  stops focus-zoom. Rubber-band is already bounded by `overscroll-behavior` (unchanged). The viewport keeps
  `maximum-scale=5` so intentional pinch-zoom (accessibility) still works.
- **Android Chrome:** Pointer Events + `touch-action` are the first-class path; the axis-lock matches the
  platform's own scroll heuristic.
- **Safe-area, dynamic viewport, address-bar, keyboard, landscape, reduced-motion:** already handled in CSS
  (`env(safe-area-inset-*)`, `100svh/100dvh`, landscape `@media`, `prefers-reduced-motion`); v10 preserves them.
- **Desktop (mouse):** unchanged where it matters — click-to-place, dot-drag, horizontal-drag, sliders, and
  keyboard all work. A purely vertical mouse-drag on the field background is a no-op (tap still places the dot),
  consistent with the touch model; no regression to the click/drag/keyboard paths.

## 2. Big Five (OCEAN) assessment from the first hum

- **Root cause (B1):** `EMERGING_HUMS = 5` in `@hum-ai/personality-signature` forced `status:"forming"`
  for a new user's first four eligible hums, which `renderSignature` short-circuits to a "still forming"
  message with **no traits and no sliders** — the assessment was invisible until hum #5.
- **Fix:** `EMERGING_HUMS = 1`. From the **first eligible (completed) hum** the signature is `"emerging"`:
  the full, **adjustable** five-trait surface appears (all of O/C/E/A/Emotional-stability, equal prominence),
  framed honestly as an early, exploratory **first impression to shape** ("In your first hum, …"), firming
  to `"tentative"` by hum 12. Before any eligible hum (count 0) it stays a gentle "forms as you hum"
  invitation — there is genuinely nothing to read yet.
- **Why this is defensible, not arbitrary:** the gate was a soft UX choice, not a statistical constraint. The
  values were always computed from hum #1 (they were merely hidden), the surface is **user-adjustable** (so it
  never over-claims a shaky read — the user calibrates it), and the copy names how little it rests on. This is
  "lightweight, contextually introduced," not "a survey dumped on a new user."
- **Flow verified end-to-end:** first hum → `ingestHum` (eligible) bumps `eligibleHumCount` and feature windows
  → `currentSignature()` → `assessPersonalitySignature` returns `emerging` → `renderSignature` shows the sliders
  → user adjusts → `saveOceanOverride(localId)` persists per-trait (localStorage, local-first) → the saved
  override is merged over the acoustic read on every subsequent render → the signature `lean` feeds the
  intervention's optional personal note. Anonymous/local, signed-in (state synced), and re-entry (override
  reloaded) states all consume it. All personality-signature tests still pass (the `forming` tests assert at
  count 0; the `emerging` test asserts at count 1).

## 3. The live hum state — restrained, real presence

- **Root cause (V1):** the capture orb only ever *grew* with mic level (`1 + level*0.5`), so **silence,
  too-quiet, and an active hum looked nearly the same size** — the listening state read as static.
- **Fix (`orb.ts`):** a single derived **presence** value (eased voicing + level, 0..1, *from the telemetry
  the meter already reports* — no invented signal) now drives both the capture inflate
  (`lerp(0.84, 1.5, presence)`) and the core brightness. The orb **contracts + dims** to a small, quiet
  "listening" pose when it hears little, and **blooms** as the hum carries — a clear silence → too-quiet →
  active → about-to-land gradient, reinforcing the existing voiced-motes, pitch line, and 12-second timer ring.
- **Discipline kept:** no fake diagnostic telemetry, no precision claims, nothing that implies medical
  analysis. It is purely the orb breathing with your actual sound. `prefers-reduced-motion` still suppresses
  the autonomous breath/ripple/grain (presence is a response to input, not an idle loop). Performance is
  unchanged: one capped `requestAnimationFrame` loop that **pauses on `visibilitychange`/blur**, delta-clamped,
  no per-frame allocation. The breath pacer is `destroy()`-ed before every re-render — **no loop survives
  navigation, no listener leaks.**

## 4. Audio recording lifecycle (interruption / backgrounding / call recovery)

- **Root cause (A1):** `recordHum` did a fixed `await delay(12s)` with **no interruption detection**. On iOS,
  backgrounding (app switch, screen lock) or an incoming call freezes the page and cuts the mic mid-record; the
  resulting buffer is truncated/silent and was surfaced either as a confusing false "didn't catch a hum"
  rejection or a generic "Mic unavailable".
- **Fix (`capture.ts` + `main.ts`):** during recording we now watch `visibilitychange`, `pagehide`, and the
  live track's `ended` event. If the page leaves the foreground mid-capture, or the buffer comes back empty or
  shorter than ~2 s, `recordHum` throws a **specific, kind** error; `runMic` recognises the
  interruption/too-short/no-audio class and shows an in-ritual retry line ("Recording interrupted — the app
  left the foreground. Tap Hum to try again.") instead of a broken-mic message. All listeners are removed and
  the stream/contexts closed in `finally` (no leak). This honestly fails a capture we cannot trust rather than
  reading garbage.

## 5. Integrity pass (docs · diagnostics · personalization · HiTL)

A full end-to-end wiring audit (the read path, the feedback loop, the population loop, diagnostics, and the
docs) found the runtime **sound** — and one real documentation gap:

- **HiTL retraining is real, not faked.** `onFeedback` → `applyFeedback` (mints a derived-only
  `NativeHumExample`, validated by `assertNoRawAudioFields` + `assertNoClinicalLeak`) → `appendExample` →
  `maybeRetrain` → `buildHumNativeArtifact` actually **trains** a hum-native LogReg and promotes it only behind
  an honest gate (≥ examples/pole, beats the acoustic backbone on held-out hums, calibration not worsening).
  The within-user axis calibration re-centres immediately. Terminology in UI/docs matches the implementation.
- **Population loop is real and correctly gated OFF.** `@hum-ai/population-corpus` pools **derived-only**,
  pseudonymous contributions under **group-by-contributor CV**, promotes a community axis prior only at
  `≥ POPULATION_MIN_CONTRIBUTORS (8)` with the same gate, and is selected per-axis *above* the far-domain prior
  (`personal > population > far-domain`). Live cross-user write is behind the distinct, default-OFF
  `population_corpus_contribution` consent — a **no-op in production today** (no contributing UI yet). This is
  honest: the pathway exists; no pooled data flows.
- **Feedback never contaminates the read circularly.** The self-report trains a *challenger* that must beat the
  transparent backbone on held-out hums before it can steer; it cannot self-confirm the live read.
- **Diagnostics are functional and privacy-safe.** The one runtime breadcrumb (`console.debug` on a Stage-①
  rejection) logs a derived **reason code**, never raw audio. The only raw-audio egress is the physically
  isolated, consent-gated research-upload channel.
- **Personalization is consumed.** `featureImportance`, `metaLearner`, three-tier `axisPriors`, `recentReads`,
  `acousticAxisHistory`, and `personalityLean` are all threaded `main.ts → cycle.ts → orchestrator`.
- **First-hum data flows correctly** into `relapseHistory` (diary), `eligibleHumCount` (ladder/stage),
  `recentReads`/`acousticRing` (re-reference), and the corpus — with no first-vs-subsequent divergence.
- **Docs fix:** wrote the long-cited but missing **[ADR-0012](adr/0012-cross-user-population-corpus-loop.md)**
  (referenced ~7× across `main.ts`, `prior.ts`, the package, and the funding brief, with no record); updated
  `README.md` (latest-spec pointer was stale at v2 → now v10; ADR index now lists 0011 + 0012; the "next steps"
  reconcile the now-implemented-but-gated pooling pathway).

## 6. Bugs fixed / intentionally deferred

**Fixed:** M1–M4 (interaction safety), B1 (Big Five availability), A1 (recording interruption), V1 (orb
presence legibility), D1 (ADR-0012 + README staleness). Plus: a tap on the mood dot no longer nudges its value;
empty/short recording buffers fail clearly instead of decoding garbage.

**Deferred (out of scope, no defect):** in-progress **cancel-recording** control (today a hum runs its full
12 s); **code-splitting** the 994 kB / 270 kB-gzip bundle (pre-existing, not a regression); shipping the
population **contributing-UI** toggle (gated pending IRB by design). None affect correctness or the goals above.

## 7. Validation (this build)

```bash
npm run typecheck            # tsc (root)  — 0 errors
npm run typecheck:web        # tsc (web)   — 0 errors
npm test                     # full repo   — 663/663 pass
npm run qa                   # privacy/safety gates — 5/5
npm run sim                  # sim-lab read-path contracts — pass (exit 0)
npm run hum-sim              # release gate — ✅ PASS (12/12 checks); 1 informational diagnostic (not gated)
npm run build:web            # vite production build — OK (dist built)
```

All green before commit. The interaction changes are interaction-layer (no read-math touched), which is why
the entire affect/calibration test surface — including the v9 `hum-sim` release gate — is unaffected.

## 8. Deployment

- **Method:** Vercel CLI, project `hum-ai` (prebuilt). `vercel build --prod` → `vercel deploy --prebuilt --prod`.
- **Production URL:** `https://hum-ai-beige.vercel.app` (the public alias; see [memory/web-deploy]).
- **Status:** `__DEPLOY_STATUS__`.

## 9. Known limitations

- **Synthetic validation only.** Every gate runs on synthesized audio + unit tests; touch behaviour is verified
  by code path and platform semantics, not on-device QA in this environment. Real-device smoke on a physical
  iPhone (Safari) and a mid-range Android (Chrome) is the recommended next confirmation.
- **The mood field's energy axis by drag** is set via the dot handle or the Energy slider (a background drag is
  horizontal-valence or scroll, by design) — discoverable via the handle, the slider, and the keyboard.
- **Implementation ≠ clinical validation.** Nothing here is evidence of clinical validity. The read remains a
  transparent reflection of a hum's acoustic qualities, not a diagnosis.

Supersedes nothing in the engine; extends [v9](STABLE_BUILD_V9.md) with the phone-native interaction layer,
first-hum Big Five availability, a live-presence orb, recording-lifecycle resilience, and ADR-0012.
