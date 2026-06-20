# ADR-0010: Model-led read from the first hum; the personal baseline is silent refinement

- **Status:** Accepted
- **Date:** 2026-06-20
- **Packages:** `@hum-ai/orchestrator` (new `axis-read`), `@hum-ai/safety-language`, `@hum-ai/signal-lab` (new `axis-prior` + `axes` CLI), `@hum-ai/app-web`
- **Supersedes (in part):** [ADR-0003](0003-personalization-and-relapse-model.md) (the calibration *ladder as a gate*), [ADR-0005](0005-public-datasets-as-priors-not-truth.md) (priors as the *primary* cold-start read), [ADR-0007](0007-dual-baseline-rolling-and-anchored.md) (baseline activation as a read gate)
- **Unchanged:** [ADR-0006](0006-two-head-affect-and-clinical-risk-separation.md) (two-head clinical separation, consent gate, 88% clinical-risk hard cap) — fully retained.

## Context

The deployed web client behaved as if every read were withheld until a 5-hum calibration completed: cold-start reads were forced to "Early baseline", the dimensional point was a neutral wash (4 of 6 audio "experts" are neutral-returning stubs), and personalization / longitudinal panels showed nothing until 5 / 20 hums. To users this read as "nothing works, and the pretrained models did nothing." That experience matched the letter of ADR-0003/0005/0007 — but contradicted the product intent that a hum should yield a meaningful read **immediately**, with personalization as a refinement, not a paywall.

Two empirical facts force the redesign to be honest rather than merely louder:

1. **There is no hum-validated affect model.** Every trained model in the repo is a far-domain **acted-speech** prior (RAVDESS). Measured on real RAVDESS rows the feature vector sits at `meanAbsZ ≈ 0.74`; on a hum it sits at `meanAbsZ ≈ 4.3` with ~26 % of features beyond |z|>3. The far-domain LogRegs therefore **saturate** on hum-like input (softmax → 0/1), i.e. confident-but-meaningless. They cannot be the *primary* read on a hum.
2. **The on-domain acoustic features are always meaningful.** Energy, brightness, pitch, clarity, and stability are deterministic functions of the hum itself. A transparent mapping of them to valence/arousal is the same honesty class as the existing `HumAcousticExpert` — a reflection of acoustic qualities, never a clinical or ground-truth label.

## Decision

### 1. The read LEADS with a valence + arousal axis read, available from hum #1

`@hum-ai/orchestrator` `axis-read.ts` produces the dimensional read two ways and combines them honestly (`resolveAxisRead`):

- **Acoustic axes (`acousticAffectAxes`)** — the transparent, on-domain mapping. Always the backbone of the read.
- **Trained axis priors (`AffectAxisPrior`)** — optional valence/arousal models injected through a contract (so the orchestrator never imports signal-lab). Each carries an **OOD distance** computed from its own standardizer and **abstains (`inDomain=false`) when the hum is outside its acted-speech domain** — the common case. When in-domain it *nudges* the acoustic value (weight capped at 0.5 — it refines, never overrides) and may lift confidence.

The fused-label distribution still produces a **secondary** 6-way affect-label hint; it is no longer the dimensional read.

### 2. Confidence is EARNED from the hum, not gated by a hum count

`@hum-ai/safety-language` `evidenceLevelFromConfidence` no longer forces "Early baseline" below 5 hums. The evidence level (High / Medium / Low) comes from the read's own earned confidence (signal clarity + in-domain trained agreement). A clear signal alone earns at most **Medium**; **High** requires an in-domain trained prior that agrees. `isEarlyBaseline` survives only as an **informational flag** ("baseline still forming"), never as the evidence level.

### 3. The personal baseline + longitudinal model are SILENT progressive refinement

The 5 / 10 / 20 thresholds remain in `stagePolicy` because they are honest (you cannot personalize against a baseline that does not exist, nor show a longitudinal trend without history). But they **no longer gate or hide the read**: personalization re-references the axis read once a baseline forms; the UI shows each layer's honest *engaging* state ("learning your baseline — N hums", "collecting longitudinal history — N hums") instead of nothing. The clinical/longitudinal surfacing stays consent-gated and hard-capped at 88 % (ADR-0006, unchanged).

### 4. Browser-runnable axis artifacts; honest provenance

`signal-lab axes` trains the coarse valence/arousal LogRegs from RAVDESS features and stages them to the client. Honest accuracy + gate status ride in `model_manifest.json`: arousal cleared the experimental 80 % gate (≈83 %), valence did not (≈69 %, "developing"). The gate-passing **valence mel-CNN (≈85 %) is Python-only and not browser-runnable**, so the browser valence axis is the below-gate feature model, surfaced as "developing". Capture also disables browser noise-suppression/AGC (which was attenuating sustained hums) and shows a live level/pitch meter.

> **Status correction (2026-06-20, post-diagnostic-audit).** The "gate-passing valence mel-CNN (≈85 %)" above reflects an earlier neural run that the **current tracked artifacts do not substantiate**: `data/processed/signal-lab/neural/neural_model_manifest.json` records `promoted: null` (only `arousal_binary` re-evaluated, 81.3 %, did not beat the 83.1 % classical baseline), and `research/model-cards/signal-lab-neural-affect-prior-v0.md` states "no neural model was promoted." A `model.neural.valence_binary.pt` checkpoint exists but is git-ignored and unreproduced. **Do not cite the ≈85 % valence figure as a deployed or validated capability.** The only gate-passing *tracked* artifact is the classical `arousal_binary` LogReg (≈83 %), surfaced as an auxiliary prior that does not steer the affect/intervention read. The deployed runtime affect read is **classical + heuristic regardless** — the conclusion of this section (browser valence = below-gate "developing" feature model) is unaffected. See [DIAGNOSTIC_ROADMAP](../validation/DIAGNOSTIC_ROADMAP.md) A2.

## Consequences

- A hum yields a real, varying valence + arousal read from the first capture; near-silent / rejected captures still abstain honestly (with the gate reason surfaced).
- The trained far-domain priors are surfaced honestly: they contribute only when in-domain and otherwise say so ("held back — outside its acted-speech domain"). No saturated value is ever presented as confident.
- Personalization, the longitudinal/relapse model, and the clinical view are visibly *wired*: they show their engaging state from hum #1 and progressively sharpen the read, rather than appearing broken.
- The honest ceiling stands: there is still no hum-validated affect model. A genuinely model-led read awaits either a hum-native dataset or porting the mel-CNN to the browser (mel filterbank + conv1d). Both are recorded as follow-ups.

## Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| Keep the 5/10/20 read gate (status quo) | Rejected | Matched the old ADRs but made the product feel broken; the read can be honest *and* immediate. |
| Lead with the trained far-domain models | Rejected | They saturate on hums (OOD); surfacing them as primary would be confidently wrong. They are kept as in-domain-only refiners. |
| Remove the ladder thresholds entirely | Rejected | Dishonest — you cannot personalize or trend without history. They are kept, but demoted from gate to silent refinement. |
