# ADR-0011: A human-in-the-loop builds the native-hum corpus; an on-device model retrains and escapes the far-domain ceiling

- **Status:** Accepted
- **Date:** 2026-06-20
- **Packages:** `@hum-ai/affect-model-contracts` (new `feedback`), `@hum-ai/personalization-engine` (new `axis-calibration` + `ingestFeedback`), `@hum-ai/orchestrator` (new `feedback`, axis-calibration in the read), **`@hum-ai/native-corpus` (new)**, `@hum-ai/dataset-registry` (the `native_hum` dataset entry), `@hum-ai/app-web`
- **Builds on:** [ADR-0005](0005-public-datasets-as-priors-not-truth.md) (datasets are priors, only `native_hum` is hum truth), [ADR-0010](0010-model-led-read-from-first-hum.md) (the axis read; the trained-prior seam)
- **Unchanged:** [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) (two-head separation, consent gate, 88% clinical cap), all privacy guards.

## Context

Every trained model in the repo is a far-domain **acted-speech** prior (RAVDESS). On a real hum it is out-of-domain, so it saturates and **abstains** ([ADR-0010](0010-model-led-read-from-first-hum.md)). The honest ceiling stated there is explicit: *"there is still no hum-validated affect model … a genuinely model-led read awaits a hum-native dataset."* And the [DIAGNOSTIC_ROADMAP](../validation/DIAGNOSTIC_ROADMAP.md) is blunt: every downstream capability is code-gated to a `native_hum` dataset that **does not exist** — `git ls-files` of real hum data = 0.

The product already produces a read the user reacts to (the valence + arousal axis read, the `innerState` sentence). That reaction is the missing data source. If, after a read, the user simply **confirms or adjusts** how they actually feel, each confirmation pairs the hum's derived features with a benign affect label — one row of hum truth. Accumulated, those rows are the `native_hum` corpus the whole roadmap is blocked on, and a model trained on them is **in-domain for hums** and so escapes the far-domain penalty.

## Decision

### 1. A HiTL feedback step turns each read into one row of native-hum truth

`@hum-ai/affect-model-contracts` `feedback.ts` defines `HumLabel` (benign self-reported **valence + arousal** only), `HumSelfReport`, and `NativeHumExample` (derived features + label + the model's prediction + provenance). `@hum-ai/orchestrator` `feedback.ts` binds a report to a read:

- `buildFeedbackRequest(read)` — **active learning**: scores how informative a label would be (low confidence / no in-domain trained agreement / quadrant boundary) so prompts land on the hums that teach the model most, and never on an abstained read.
- `applyFeedback(read, report, binding)` — mints the `NativeHumExample` and a `PersonalAxisCorrection`. The example is validated against **both** `assertNoRawAudioFields` and `assertNoClinicalLeak` before it can exist.

The label is **benign dimensional affect**, never a clinical-risk marker or a clinical instrument (PHQ/GAD/CES-DC). Those are PHI requiring `clinical_label_capture` consent, a separate channel, and IRB ([NATIVE_HUM_DATA_SPEC](../validation/NATIVE_HUM_DATA_SPEC.md) §4/§7); a self-report on two coarse axes is not, and is exactly what trains the axis read.

### 2. One correction feeds two tracks — personal (instant) and global (batch)

- **Personal (within-user, online).** `@hum-ai/personalization-engine` `axis-calibration.ts` learns a bounded EMA offset per axis from the residual `reported − predicted` and re-centres the read on this person immediately (`ingestFeedback` → `applyAxisCalibration`, wired into `orchestrateHumRead` before personalization re-reference). It only **shifts**; it never amplifies, and shrinks toward 0 until enough corrections back it.
- **Global (cross-session, batch).** The same row is appended to the native-hum corpus that the model retrains on.

### 3. A hum-native model retrains, gates, and promotes — entirely on-device

`@hum-ai/native-corpus` (new) runs the loop in **pure TypeScript** (reusing signal-lab's deterministic `trainLogReg`), so it executes **client-side on the user's own device, on their own hums**:

- **Train** a coarse valence/arousal LogReg on the eligible, non-ambiguous corpus rows.
- **Gate honestly:** cross-validate the challenger and compare it to the transparent acoustic backbone (`acousticAffectAxes`) on held-out hums. Promote an axis **only** when there are enough examples, both poles are represented, the challenger clears an absolute floor, **and** it beats the backbone by a margin. This is *not* the rigorous 0.80 / p<.01 / ECE offline gate, and *not* a clinical claim — it is "this model reads **your** hums better than the generic hand-mapping does."
- **Deploy with zero orchestrator change:** a promoted model is wrapped as an `AffectAxisPrior` whose standardizer is fit on hums, so a hum is **in-domain** — it **contributes** instead of abstaining, and carries **no far-domain penalty**. It still only *refines* (the 0.5 axis-nudge cap of ADR-0010 stands).
- **Calibration tracking:** `calibration.ts` reports sign-agreement / MAE / correlation / ECE of the read against the accumulated self-reports, and a chronological **trend** — the honest, user-visible answer to "is my read getting better as I teach it?" (convergent validity, correlation not classification).

### 4. Governance: the `native_hum` corpus becomes real, safely

`@hum-ai/dataset-registry` gains a `kind: "dataset"` `native_hum` entry (`native_hum_self_report_corpus`) — the switch the roadmap named. It allows `hum_finetune` / `personalization` / `affect_prior` / `evaluation` and forbids `clinical_prior` / `relapse_tracking` (benign self-report ≠ clinical truth; relapse needs clinician-anchored longitudinal events). The corpus stores **derived features only** under `local_processing` (on by default); with `derived_feature_sync` it backs up to the user's **own** private space (`users/{uid}/labels`, owner-scoped). **Pooling across users** into a shared global model is a separate backend step requiring its own research consent + IRB — never done client-side.

## Consequences

- The product now has a path **off** the far-domain ceiling that does not wait on an external dataset: it grows its own, one confirmation at a time. The read demonstrably shifts from "far-domain prior abstains" to "your hum-native model contributes" as a user gives feedback (`AxisResolution.trainedContribution`).
- Personalization is no longer self-supervised-only: an explicit human signal re-centres the read immediately, and the bandit/signature learners have a real feedback source to grow into.
- Honesty holds end-to-end: benign labels only, derived features only, both privacy guards on every row, a promotion gate that never rounds up, and provenance that never presents a small-n self-report model as clinically validated.
- It advances [DIAGNOSTIC_ROADMAP](../validation/DIAGNOSTIC_ROADMAP.md) B1 (capture→corpus infrastructure) and seeds B3/B4 (on-domain affect model + calibration) — the corpus and the loop exist; the *validated, pooled, IRB-governed* version remains future work.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| Wait for an external hum-native dataset | Rejected | Indefinite block; the product can grow its own corpus now, governed and on-device. |
| Let users self-report clinical-risk markers | Rejected | That is PHI — needs `clinical_label_capture`, a separate channel, and IRB. Benign valence/arousal is on-domain, ethically clean, and is what trains the axis read. |
| Let the native model override the acoustic read | Rejected (for now) | Small-n, self-report-noisy. It *refines* under the existing 0.5 cap; raising that awaits more data + a stricter gate. |
| Pool labels across users client-side for a global model | Rejected | Cross-user pooling needs its own research consent + IRB. The on-device loop yields a personal hum-native model; the corpus is sync-ready for a governed backend to pool later. |
| Server-side retraining only | Rejected | Breaks local-first; the loop runs in pure TS and works offline, syncing only with consent. |
