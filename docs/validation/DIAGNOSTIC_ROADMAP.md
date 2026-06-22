# Diagnostic Roadmap — from honest scaffold to validated early-warning tool

**Status date:** 2026-06-20 · **Owner:** TBD · **Companion docs:** [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md),
[VALIDATION_PLAN](./VALIDATION_PLAN.md), [ADR-0003](../adr/0003-personalization-and-relapse-model.md),
[ADR-0005](../adr/0005-public-datasets-as-priors-not-truth.md), [ADR-0006](../adr/0006-two-head-affect-and-clinical-risk-separation.md).

This document is the bridge between the *diagnostic architecture we have built* and the
*validated early-warning capability we intend*. It exists because a re-audit (2026-06-20)
confirmed a hard truth: **the diagnostic scaffold is serious and largely complete, but its
content is heuristic, uncalibrated, and unvalidated — it is not yet a working detector.**
Hum remains, today and until the gates below are cleared, a **non-clinical, research-stage
reflective tool that emits risk *markers*, never diagnoses, and never claims to prevent
relapse** (CLAIMS_LADDER Tiers 4–5 are unreachable / forbidden).

This is the intended state for a tool at this stage. The roadmap is how it becomes real.

---

## 0. Where we are (honest baseline)

**What is genuinely built and production-grade** (keep — these are the seams a real model drops into):
- Two-head separation + consent gate + `assertNoClinicalLeak` (clinical labels are firewalled
  from the wellness/intervention layer). ADR-0006.
- Dual baseline (rolling + anchored) with masking-resistant divergence ("undefined ≠ zero"). ADR-0007.
- Within-user DVDSA paired-comparison relapse engine (recovery/stable/worsening/relapse_drift),
  sustained-drift rule (≥3 consecutive, streak held on abstention), 88% hard cap, abstain-without-
  baseline/history. ADR-0003.
- The full closed learn loop (`ingestHum` → history → orchestrate → observe → ingest).

**What is NOT real yet** (the gap this roadmap closes):
1. **No native-hum corpus exists at all.** Every model is a far-domain *acted-speech* (RAVDESS)
   prior, penalty 0.45. `dataset-registry` code-gates `relapse_tracking`/`personalization`/
   `hum_finetune` to `native_hum` — which has zero training bytes. **Root blocker.**
2. **The model fails its own gate.** 6-class affect = 47.9% (fail); only coarse arousal-binary
   passes (~83%) and is deliberately unwired; no neural model promoted (`promoted: null`).
3. **`clinicalRiskScore` is heuristic and was structurally broken** — fixed for *reachability*
   (commit `3ed45af`) but still uncalibrated, and 5 of its intended risk heads
   (`depressive_affect_markers`, `stress_overload`, `emotional_instability`, `fear_like_activation`,
   `flattened_affect`) are not separable by v1 fusion at all.
4. **Every threshold is an uncalibrated principled default** (stable band 0.12, high-risk 0.6,
   strong-drift 0.5, min-drift 3 hums, signature routing 0.4/0.6, EMA rates, λ weights).
5. **Signature learning is self-referential** — it learns the shape of its own heuristic's output.
6. **Feature extraction is partly a stub** (DSP deferred); SER experts are honest untrained stubs.
7. **Zero validation has been run** — VALIDATION_PLAN studies (a)–(g) and the §4 pre-clinical gate
   are all NOT STARTED.

---

## 1. The dependency chain (what gates what)

```
  Native hum corpus (B1) ──┬──> Train real hum experts (B3) ──> Calibrate thresholds (B4)
                           │                                          │
  Clinical labels (B2) ────┘                                          ▼
                                                     Validation studies a–g (VALIDATION_PLAN §3)
                                                                       │
                                                                       ▼
                                                     Pre-clinical gate (VALIDATION_PLAN §4)
                                                                       │
                                                                       ▼
                                              Tier-4 "screening instrument" claim becomes *possible*
```

Nothing downstream is meaningful until **B1 (native hum data)** exists. Tier-A code fixes (below)
can proceed in parallel but do not, by themselves, make any claim more valid.

---

## 2. Tier A — correctness fixes (no data required)

These make the engine *internally coherent* so that, once real signals arrive, the plumbing behaves.
They do **not** add validity.

| # | Item | Status |
|---|------|--------|
| A1 | `clinicalRiskScore` must reach its own 0.6 band; high-risk signature must be learnable | ✅ done (`3ed45af`) |
| A2 | Reconcile model-promotion truth across ADR-0010 / model cards / `neural_model_manifest.json` (currently disagree on valence ~85% vs `promoted: null`) | ☐ open |
| A3 | Decide `anger_frustration` (high-arousal-negative) taxonomy: risk-bearing or not? Currently unscored → angry hums route to *recovery* signature | ☐ open (design call) |
| A4 | Expand the fusion label space (or expert outputs) so the 5 currently-unreachable clinical markers (depressive/stress/instability/fear/flat) can be *distinguished* — needed before they can be scored. Likely requires B3, not pure code | ☐ open (depends on B3) |
| A5 | Calibration harness scaffolding (reliability diagrams, ECE) wired to run on data when it exists | ☐ open |

---

## 3. Tier B — the data + model program (the real work)

> **Progress (2026-06-20, ADR-0011).** The root blocker now has a *bootstrap path that does not
> wait on an external study*: a **human-in-the-loop** ([ADR-0011](../adr/0011-hitl-native-hum-retraining-loop.md))
> grows the `native_hum` corpus one self-report at a time, on-device. The `native_hum` **dataset
> entry now exists** in `dataset-registry` (`native_hum_self_report_corpus`), an on-device store +
> retrainer ships (`@hum-ai/native-corpus`), and a hum-native axis model is promoted only when it
> beats the acoustic backbone on held-out hums — at which point it is **in-domain** and contributes
> (no far-domain penalty). This is a **partial** B1 + a first cut of B3/B4's affect track: *benign
> valence/arousal self-report*, on-device, non-clinical. It does **not** deliver B2 (clinical PHI
> labels, IRB), the longitudinal/relapse corpus (C2), pooled cross-user training, or any of the
> Tier-C validation studies. Those remain as written below.

### B1 — Native hum corpus *(root blocker — bootstrap path now live; full study still required)*
- Standardised 12-second hum capture protocol (already specced: `hum_legacy_spec`), across
  representative demographics and devices (phones/laptops/headsets).
- Longitudinal: repeated daily hums per consenting participant over a multi-month horizon
  (the DVDSA inspiration spans ~107 days pre→post — within-user trajectories are the point).
- Register as the single `native_hum` dataset; it is the *only* lawful source of hum truth
  for personalization/relapse (ADR-0005, `dataset-registry`).
- Privacy: raw audio stays local/private storage; only derived features + consented research
  uploads leave the device (`research_audio_upload` / `clinical_label_capture`, off by default).

### B2 — Clinical ground-truth labels
- Capture **PHQ-9 / GAD-7 / CES-DC** (and, for relapse cohorts, clinician-anchored relapse/recovery
  events) under the existing `clinical_label_capture` consent scope.
- These are PHI: never tracked in git (forbidden-files gate), referenced only via the registry.
- Purpose is **convergent validity (correlation), not classification** (VALIDATION_PLAN §3e).

### B3 — Train real experts on hums (replace the stubs)
- Replace the heuristic SER stubs and the stub meta-learner with models trained on B1 features
  (or hum embeddings). Only then can the finer clinical heads (A4) be separated.
- Keep the far-domain acted-speech models strictly as *penalized cold-start priors* (ADR-0005);
  they abstain OOD on hums (they saturate at meanAbsZ ≈ 4.3) and must never be the primary read.

### B4 — Calibrate thresholds on real outcomes
- Replace every "principled default" (§0.4) with values fit to B1/B2: stable band, high-risk band,
  strong-drift, min-consecutive-drift *window*, signature-routing thresholds, λ weights, EMA rates.
- Re-derive `clinicalRiskScore` severities (currently placeholders) from labelled outcomes.
- Success criterion is **calibration (ECE) + within-user agreement, not headline accuracy**
  (VALIDATION_PLAN §1).

---

## 4. Tier C — validation studies (VALIDATION_PLAN §3, all NOT STARTED)

Each gates the next; run in order on B1/B2 data:

- **(a)** Capture & feature reliability across devices (test–retest ICC).
- **(b)** Confidence calibration & cap verification (reliability diagrams, ECE per head; caps never exceeded).
- **(c)** Abstention precision/recall on adversarial poor-capture / domain-mismatch / OOD inputs.
- **(d)** Within-user DVDSA recovery/worsening study — the relapse study; per-user agreement, not group accuracy.
- **(e)** Construct/convergent validity vs PHQ-9 / GAD-7 / CES-DC (correlation).
- **(f)** Privacy-invariant fuzzing (`assertNoRawAudioFields` at any depth).
- **(g)** Safety-copy CI sweep over the full corpus (`FORBIDDEN_PHRASES`).

Then the **pre-clinical gate (VALIDATION_PLAN §4)**: prospective pre-registered studies on native
hum data; external held-out validation with QUADAS-2 bias control; demonstrated calibration +
abstention quality on real data with clinician review; regulatory pathway assessment.

---

## 5. Claim-tier unlock map

| Milestone reached | Highest honest claim | Notes |
|---|---|---|
| Today (scaffold) | **Tier 0–3 marker, unvalidated** | "a drift away from your steadier pattern" — reflective, consent-gated, ≤88%, never a verdict |
| IRB approval + pre-registration filed + crisis protocol tested (Phase 0) | **Tier 4a investigational screening (pre-validation)** | register "investigational · for research · not a diagnosis" — **no performance claim**; the `@hum-ai/screening-model` head exists but is **blinded** (study artifact only) |
| B1+B3+B4 + studies a–d | Tier 3 marker, *internally validated within-user* | early-warning drift with demonstrated calibration & within-user agreement |
| Study e (cross-sectional classification) + §4 pre-clinical gate | **Tier 4 screening instrument** *(becomes possible)* | "screens for depression/anxiety with sensitivity/specificity"; requires the pre-registered co-primary endpoints met (AUC + sens/spec at **PHQ-9 ≥ 10** and **GAD-7 ≥ 10**), adequate calibration (binary ECE), passing QUADAS-2, the **`@hum-ai/screening-model` promotion gate cleared on participant-grouped CV**, governance sign-off, and `validatedRegulatoryMode` **scoped to that specific claim** |
| Tier 5 (diagnosis / "prevents relapse" / medical device) | **Forbidden** | categorically blocked in code (`FORBIDDEN_PHRASES`) until regulatory clearance |

**The screening-claim path (Tier-3 → Tier-4 leap).** Study (e) is no longer "correlation, not
classification": [VALIDATION_PLAN §3e](./VALIDATION_PLAN.md) now frames it as the **pre-registered
cross-sectional classification co-primary endpoint** — depression at PHQ-9 ≥ 10 *and* anxiety at
GAD-7 ≥ 10, AUC + sensitivity/specificity, participant-grouped CV. Its implementing head is the new
third head `@hum-ai/screening-model` (ADR-0006), which is **structurally isolated from the consumer
read/render path during the entire pilot**: the screening probability is internal-only and blinded,
never reaches `render.ts`, the orchestrator, or `safety-language`. That isolation is enforced at
build time by the **`no-screening-in-read-path` QA gate** in `@hum-ai/qa-gates` (the import-graph
analogue of the runtime `assertNoClinicalLeak` gate), so a developer cannot wire the head into the
consumer surface before the claim is earned. Post-validation surfacing happens only via the new
`phq_screening_signal` / `gad_screening_signal` labels in `@hum-ai/safety-language`.

**`validatedRegulatoryMode` unlock conditions (the Tier-4 gate).** The flag stays `false` until
**all** of: (1) the pre-registered co-primary endpoints are met — AUC + sens/spec at PHQ-9 ≥ 10 and
GAD-7 ≥ 10 — with acceptable calibration and the `@hum-ai/screening-model` promotion gate cleared on
participant-grouped CV; (2) QUADAS-2 risk-of-bias review passes; (3) clinician-collaborative review;
and (4) a recorded governance sign-off **scoping the mode to that specific validated claim only —
never a blanket bypass** ([CLAIMS_LADDER §5](../claims/CLAIMS_LADDER.md);
[PRE_REGISTRATION](./PRE_REGISTRATION.md); [ANALYSIS_PLAN](./ANALYSIS_PLAN.md)). Diagnosis,
"prevents relapse," and "medical device / FDA-cleared" remain categorically blocked regardless.

"Early detection" is legitimately a **Tier-3 early-warning marker** that prompts a *human* to look,
or — once the study reads out — a **Tier-4 cross-sectional screening signal** that routes to clinical
judgment; never detection of a condition as a verdict, and never **prevention** (Tier 5, mechanically
blocked).

---

## 6. Definition of done — "a serious early-warning tool"

1. A native-hum, clinically-labelled, longitudinal corpus exists and is registered.
2. Experts are trained on hums; the far-domain priors are demoted to abstaining OOD refiners.
3. Every diagnostic threshold is calibrated on outcomes; `clinicalRiskScore` severities are fit, not guessed.
4. Studies (a)–(e) pass with reported calibration (ECE) and within-user agreement; abstention has high recall on unreadable input.
5. The §4 pre-clinical gate is cleared with external replication and a regulatory pathway.
6. Only then may `validatedRegulatoryMode` be considered, scoped to a single validated claim — and even then, the tool surfaces **markers that route to human clinical judgment**, not autonomous diagnosis.

Until 1–5, the correct and honest posture is exactly what ships today: a research-stage, consent-gated,
non-diagnostic early-warning *layer* over an honest reflective read.
