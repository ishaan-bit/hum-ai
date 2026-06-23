# Hum AI — Stable Build v4 · End-to-End Specification & Status

**Build:** `stable-build-v4` · **Date:** 2026-06-22 · **Base HEAD:** `725b0b1`
**Status:** research-stage · **NON-CLINICAL, not a diagnosis, not FDA-cleared, not clinically validated**
**Verification:** `npm run check` (typecheck + web typecheck + full test suite) ✅ · new gate/personality/UI tests added · `npm run qa` (governance gates) ✅

This document is the current, honest specification of the deployed system after the v4 pass. It
supersedes nothing in [docs/adr/](adr/) (the decision records remain authoritative) and builds on
[STABLE_BUILD_V3.md](STABLE_BUILD_V3.md); read that first for the v3 baseline. v4 keeps every v2/v3
invariant — two-head clinical separation (ADR-0006), no raw numbers in copy (ADR-0008), live-from-hum-#1
reads (ADR-0010), gate-enforced model truth (v3 Part A), render-layer safety proof (v3 Part B) — and adds
a **UX + assessment overhaul plus one new science source**, without adding any new claim.

> **One-line thesis of v4:** the gate now understands that a real hum *breathes* (bursts + pauses are
> accepted, and a rejected take says exactly why); the read *speaks plainly* and *unfurls* instead of
> hiding behind a ripple; mood/energy is a *place you can see*; today's step depends on *recent days, not
> one hum*; and the longitudinal within-you assessment is now *first-class on screen* — including a
> tentative, exploratory **hum-personality signature** (Big Five + a playful 4-letter type — the
> 4-letter type was **removed in v5.x**, see §3 note, leaving an OCEAN-only read foregrounding
> Openness & Conscientiousness) that personalises the experience. One new source — **Brocal et al.
> (DALI)** — grounds the gate's pause
> tolerance and the HiTL loop.

---

## 0. What "v4" is (changelog over v3)

| # | Area | v3 behaviour | v4 behaviour |
|---|------|--------------|--------------|
| 1 | **Capture gate** | Strict `assessCapture` penalised silence flatly (`-2.5 × silenceRatio`) → legitimate **paused hums were falsely rejected**; rejection reason was a generic "hum again". | **Pause-tolerant** gate (Brocal/DALI voiced-content lens): the silence penalty is *discounted by voiced-tone evidence*, so burst-voiced hums pass while noise/speech/silence still fail (melodic-range + ZCR/flatness/brightness cues are gap-independent). Emits a **specific `reasonCode`** so the UI tells the user exactly what went wrong. |
| 2 | **Rejection copy** | One generic "Didn't catch a clear hum" for every cause. | Six specific, kind messages — `too_short / too_quiet / too_noisy / sounded_like_speech / not_voiced / too_choppy` — each with a concrete "do this instead". |
| 3 | **Read copy** | Poetic, cryptic ("running on a smaller flame"). | **Direct state-of-mind** lead ("Right now you're tense and wound-up …") — still tentative + non-clinical, still safety-screened. |
| 4 | **Reveal UX** | A persistent orb/ripple sat over the read (read as noise). | The read **unfurls cinematically** (staggered scroll-unroll); the orb is **quieted** (opacity 0.4) behind the result windows so the read card is the hero. |
| 5 | **Mood/energy** | Two horizontal slider meters. | A **gamified 2-D mood–energy field** — the read plotted as a glowing marker on the valence–arousal circumplex, with the four zones (Calm / Energised / Tense / Low) lit; magnitude stays in position + glow, never a number. |
| 6 | **Feedback** | "Yes that's right" + a separate **"Adjust" toggle** revealing hidden sliders. | Sliders are **always visible** (pre-set to the read); one **"Save how I feel"** + a "Spot on — leave it" shortcut. The redundant toggle is gone. |
| 7 | **Breath step** | Static instructions only. | A **follow-along breath pacer** (~3 cycles) whose timing is tied to the read — a longer exhale when more activated (paced-exhale down-regulation). Respects reduced-motion. |
| 8 | **Today's step** | Depended on **today's hum** only (+ a sustained-drift longitudinal flag). | **History-aware**: today's read is blended 70/30 with a **recent-reads summary** for state selection, plus a "Lately you've sounded…" line — about today, but informed by recent days. |
| 9 | **Within-you assessment** | Longitudinal panel lived only in the tray. | A **first-class signature card in the State window**: a tentative, exploratory **hum-personality signature** (Big Five tendencies + a playful 4-letter "hum type") computed from the longitudinal baseline, plus a compact within-you trend line. The deep longitudinal panel remains in the tray. |
| 10 | **Sources** | 7 sources. | **+ Brocal et al. (DALI, ISMIR 2018)** registered (`singing_voice_detection_dataset`) — sung-voice detection + teacher-student self-training. |

Everything else (the spine, two-head separation, dual baseline, relapse engine, native-corpus HiTL, AURA
theming, consent model, privacy guards) is unchanged from v3.

---

## 1. The new science source — Brocal et al. (DALI)

**Meseguer-Brocal, Cohen-Hadria, Peeters — "DALI: A Large Dataset of Synchronized Audio, Lyrics and Notes…",
ISMIR 2018.** Registered in [docs/source/INDEX.md](source/INDEX.md) as `singing_voice_detection_dataset`.
Two ideas are load-bearing:

1. **Voiced-content detection.** DALI converts audio to a frame-level singing-voice probability `p(t) ∈ [0,1]`
   and judges a track on its *voiced content over time*, not on the absence of gaps. → Hum's capture gate now
   forgives breath-pauses in proportion to voiced-tone evidence (§2).
2. **Teacher → student self-training.** A teacher trained on little data labels a larger imperfect set; the
   student trained on it generalises *better*. → This is exactly Hum's HiTL native-corpus loop (the far-domain
   prior is the teacher; the user's confirmed hums are the growing student set; the promoted hum-native model is
   the student). DALI is the methodological citation for that loop.

It is a **music/MIR** dataset: used for *detection methodology and self-training discipline only*, never as hum
affect/clinical ground truth (ADR-0005 domain gap). No DALI audio is downloaded or shipped.

---

## 2. Capture gate — pause tolerance + specific reasons (`@hum-ai/signal-lab/capture-gate`)

There are two gates. The **strict Stage-① `assessCapture`** (the one users hit first) was the sole cause of the
paused-hum false rejections; the spec-transcribed **`evaluateQuality` grader** was already pause-tolerant (it
accepts ≥ ~40%-voiced hums and only rejects > 72% silence) and its thresholds are provenance-locked, so it was
left unchanged.

`assessCapture` now computes a **voiced-tone evidence** score `e = 0.5·voicing + 0.3·clarity + 0.2·heldSegment`
and an **effective silence** `silence · (1 − 0.78·e)` — so a clearly-voiced burst hum keeps almost none of its
silence penalty, while an unvoiced/noisy clip keeps all of it. A **melodic-range penalty** (free for natural hum
wobble ≤ 2 semitones, lethal above) separates a *paused hum* (one held pitch) from *speech/song* (wide pitch
movement), so pause tolerance never lets speech through. On rejection it returns a specific `reasonCode`
(`too_short / too_quiet / too_noisy / sounded_like_speech / not_voiced / too_choppy / unclear`), surfaced as kind,
concrete copy in `renderCaptureRejected`.

**Leniency rebalance (post-first-deploy fix).** The first v4 cut still rejected *real* hums in the field: a genuine
hum drifts and re-pitches after breaths, so its `pitchRangeSemitones` is several semitones — and the initial
speech-guard penalty bit at just 2 semitones (calibrated only on dead-steady synthetic tones). Real audio also has
higher flux / lower clarity than synth. So the Stage-① gate is now **explicitly lenient**: its job is to reject
*clear* non-hums (silence, noise, speech), not to be a quality bar — the downstream quality gate + the read's own
abstention handle marginal quality. Changes: accept threshold 0.5 → **0.4**; the melodic-range penalty now leaves a
**generous ~6-semitone band free** and only bites on clearly-melodic input; flux is a soft late cue; speech/noise
rejection leans on the robust **brightness + zero-crossing + flatness** cues (a real hum scores low on all three).
The specific rejection reason is also now shown on the **Hum window** (`humAgainMessage(reasonCode)` in the capture
status) — previously it rendered only into the read card on the locked State window, so users never saw it.

**Validated** (`packages/signal-lab/test/capture-gate.test.ts`, real extractor + constructed real-hum profiles):
clean hums 6/6 accepted; silence → `too_quiet`; speech-like 6/6 → `sounded_like_speech`; music rejected; **burst
hums at 50–75% voiced accepted**; constructed *wobbly / quiet / low-clarity / paused* real-hum profiles all accept
(0.62–0.72); an over-fragmented (~14% voiced) take rejects with `too_choppy`. The quality-gate suite is unchanged
and still green.

---

## 3. Hum-personality signature (`@hum-ai/personality-signature`, new package)

A **pure, DOM-free** package that reads only the longitudinal baseline's derived feature windows (no new privacy
surface) and produces a tentative, **exploratory** signature:

- **Substrate — Big Five (OCEAN) tendencies**, each a within-user value in `[-1, 1]` mapped from robust feature
  centres by directional heuristics (openness ← pitch range / musicality; conscientiousness ← control/steadiness;
  extraversion ← loudness/energy/pitch-variation; agreeableness ← warmth/smoothness; emotional steadiness ←
  inverse vocal perturbation). "Apparent personality from voice" has a *real but modest* basis, which is why the
  read is framed as exploratory.
- **Foregrounded traits — Openness & Conscientiousness** (the two most reliably voice-recoverable, and the two
  that map cleanly onto a sustained hum). They lead the card (a two-tile lede) and the headline; the other three
  axes show as trait bars below. Explicitly "a mirror of your voice, not a personality test." See
  `docs/research/voice-big-five.md` for the cited basis.
- **Confidence gating:** `forming` (< 5 hums, no primary read) → `emerging` (5–11) → `tentative` (≥ 12). Never
  beyond "tentative". All surfaced strings pass the safety-language screen (test-enforced) — warm, plain pole words
  ("steady ↔ sensitive", never "neurotic").

> **Update (v5.x, 2026-06-23):** the **Myers-Briggs-style 4-letter "hum type" overlay was removed entirely** (no
> acoustic evidence base) in favour of an OCEAN-only surface that foregrounds **Openness** and **Conscientiousness**.
> `humType`/`TYPE_NICKNAME` and the `type`/`typeNickname`/`typeBlurb` fields are gone; the signature now exposes
> `primaryTraits` and a per-trait `label`/`primary`. See `docs/research/voice-big-five.md`.

**Wired across:** the signature is computed in the web client from the baseline and (a) rendered first-class in the
State window (`renderSignature`), and (b) reduced to a `{adjective, steadiness}` **lean** that is threaded
`main.ts → cycle → orchestrator → selectInterventionOfDay`, adding one personalised sentence to the daily step
(packages stay decoupled — the intervention engine sees only the minimal lean shape, never the package).

**Validated** (`packages/personality-signature/test/signature.test.ts`): maturity gating, expressive-vs-steady
separation, all five axes present, and a full safety-language screen across profiles/maturities.

---

## 4. History-aware Intervention of the Day (`@hum-ai/intervention-engine`)

`selectInterventionOfDay` now accepts an optional `recentAffect` summary (count + mean valence/arousal over the
last few reads) and `personality` lean. State derivation **blends today's read with the recent mean at 70/30**
(`TODAY_WEIGHT`), so a single off hum no longer whipsaws the suggestion and a steady recent pattern gently
reinforces it — today still dominates, so a strongly tense/low hum today still routes correctly. Two new optional,
safety-screened copy fields appear on the step: `recentContext` ("Lately you've sounded…") and `personalNote`
("This leans into your steadier way of humming…"). The orchestrator builds `recentAffect` from a new
`history.recentReads` buffer (the web client keeps the last 8 reads in session) and passes the lean through
`history.personalityLean`.

---

## 5. UI / UX (apps/web)

- **Direct read copy** (`orchestrator/copy.ts`): `innerStateLine` and `axisHeadline` now lead with a plain
  present-tense statement of the user's state of mind, still tentative and screen-safe (verified: every branch
  passes `validateUserFacingText` + `isConfidenceCopySafe`).
- **The unfurl** (`styles.css` + `main.ts`): on reveal, the read column plays a staggered `unfurl-in` animation
  (a scroll unrolling); reduced-motion disables it.
- **Orb de-emphasis**: `<body data-step>` mirrors the active window; CSS drops `#orb-canvas` opacity to 0.4 behind
  the State/Today windows so the read card leads.
- **Gamified mood field** (`renderRead` → `moodField`): a 2-D circumplex with a glowing marker + lit zones; the
  overall confidence band sets marker sharpness. Replaces the two slider meters; honest provenance line retained.
- **Simplified feedback** (`renderFeedbackPrompt`): sliders always visible (pre-set to the read), one Save + a
  confirm shortcut; the Adjust toggle is removed. Unmoved sliders are recorded as a confirmation.
- **Breath pacer** (`breath.ts`): a follow-along disc that expands (in), holds, and contracts (out) for ~3 cycles,
  exhale lengthened with arousal; reduced-motion-aware; torn down on re-render.
- **Signature card** (`index.html` `#signature-card` + `renderSignature`): the within-you assessment, first-class
  in the State window.

---

## 6. Invariants preserved (regression surface)

- **No raw numbers / no clinical labels in any user copy** — all new strings (rejection reasons, direct read copy,
  signature, recent-context, personal note, mood-field) are screened by `@hum-ai/safety-language`; the render-safety
  test still passes.
- **Two-head separation, consent gating, raw-audio + clinical-leak guards** — untouched; the personality signature
  reads only derived feature windows.
- **Live-from-hum-#1, gate-enforced model truth, abstention discipline** — untouched.
- **Rejected captures still learn/sync nothing** and now additionally explain themselves.

---

## 7. Verification

```
npm run check     # tsc (engines, DOM-free) + tsc (web, DOM) + full test suite — all green
npm run qa        # governance gates (naming / forbidden files / privacy / safety) — green
npm run build:web # production bundle
```

New/updated tests: `signal-lab/test/capture-gate.test.ts` (pause tolerance + reason codes),
`personality-signature/test/signature.test.ts` (new), plus the unchanged quality-gate, intervention,
orchestrator, and render-safety suites.

---

## 8. Known limitations (unchanged honesty posture)

- The personality signature is **exploratory**, not validated; the feature→trait map is directional, not
  population-calibrated — hence the hard "tentative" ceiling and "not a test" framing throughout.
- The capture gate is the TS-native runtime heuristic; the CV-validated reference remains the Python gate
  (`capture_gate.json`). The pause-tolerance weights are calibrated on synthetic fixtures and should be
  re-checked against real paused-hum recordings when available.
- Recent-reads history is per-session (in-memory) in the web client; it is not yet persisted across reloads.
