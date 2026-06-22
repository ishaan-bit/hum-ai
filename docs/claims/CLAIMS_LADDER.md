# Claims Ladder

This is the graded contract for what Hum may say to a user, and the evidence each
tier of claim requires. It is the human-readable companion to the machine
enforcement in `@hum-ai/safety-language`. Hum is a **non-clinical, research-stage**
reflective tool built on a standardized 12-second hum [hum_spec]. It produces
**risk markers and signals, never diagnoses**. Every tier below is bounded by that
fact; the top of the ladder is deliberately **unreachable** in the current build.

Related: [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md) ·
[VALIDATION_PLAN](../validation/VALIDATION_PLAN.md) ·
[ADR-0004](../adr/0004-confidence-and-abstention.md).

---

## 1. The tiered ladder

Tiers ascend from the weakest, always-permitted observational claim to the
forbidden tier. "Evidence bar" is what must hold before copy at that tier is
allowed to render; the gates are the personalization stage cap [hum_spec §4.8],
the capture-quality cap (`CAPTURE_QUALITY_CONFIDENCE_CAP`), the domain match, and
the abstention floor (ADR-0004).

| Tier | Claim register | Example user copy | Evidence bar | Reachable now? |
| --- | --- | --- | --- | --- |
| **0 — Reflective / observational** | within-user comparison; no state label | "more subdued than your usual" · "close to your usual pattern" | One eligible hum past the quality gate (`clean`/`borderline`); "vs. your usual" wording only after the baseline activates at 5 hums (`stagePolicy` → `personal_baseline`) | Yes |
| **1 — Emotional-state signal** | dimensional V-A + non-risk state heads | "an upbeat, positive pattern" · "a settled, regulated pattern" | Fused inference above the abstain floor; confidence under the binding cap (`population_prior` 0.72 → up). Non-risk heads only (`valence`, `arousal`, `calm_regulated`, `joy_positive_activation`, `mixed_state`) | Yes |
| **2 — Stress-load / recovery trend** | longitudinal within-user trend | "a higher stress-load signal than your usual" · recovery vs. worsening trend | `riskMarker` heads (`stress_overload`, `fatigue_low_recovery`) require an **active baseline** (`baselineActive`, ≥5 hums) plus a supported longitudinal signal; relapse/recovery class needs the relapse model (`relapseModelActive`, 20+ hums) | Yes (data-dependent) |
| **3 — Risk marker / screening signal / early-warning pattern** | anxiety/depressive/relapse-risk markers | "a lower-mood pattern worth gently noting" · "a drift away from your steadier pattern" | All of tier 2, **plus**: head is in `RISK_MARKER_HEADS`; sustained signal (not a single hum); explicit non-diagnostic framing; uncertainty surfaced. Caps still bind (≤0.92 mature) | Yes, as **markers only** — never as a verdict about the person |
| **4a — Investigational screening (pre-validation)** | research-participation framing; NO performance claim | "investigational · for research use only · not a diagnosis" · "you are participating in a research study" | IRB approval on file **and** a filed pre-registration ([PRE_REGISTRATION](../validation/PRE_REGISTRATION.md)) exist; the screening probability is **blinded** (computed, never shown). No accuracy/sensitivity figure may be stated. | Yes, **only inside the pilot**, as investigational framing — never a result |
| **4 — Clinical screening instrument** | "an investigational screening signal for depression/anxiety, validated against PHQ-9 ≥ 10 / GAD-7 ≥ 10" | — | Pre-registered cross-sectional validation: AUC + sensitivity/specificity at the locked cut, calibrated operating points, participant-grouped analysis, QUADAS-2 risk-of-bias control, external replication ([VALIDATION_PLAN](../validation/VALIDATION_PLAN.md), [ANALYSIS_PLAN](../validation/ANALYSIS_PLAN.md)) | **No — unreachable until the pilot reads out and §5 is satisfied** |
| **5 — FORBIDDEN** | diagnosis · clinical certainty · prevents relapse · medical device · FDA-cleared · clinically validated | — | Requires `validatedRegulatoryMode` (§5): real clinical validation **and** regulatory clearance. None exists | **No — categorically blocked** |

Key constraint: **moving up a tier never raises the confidence ceiling.** The caps
(0.72 / 0.76 / 0.82 / 0.88 / 0.90–0.92 across `PERSONALIZATION_STAGES`) and the
capture/domain caps are applied regardless of tier; a tier-3 risk marker is still
clamped to ≤0.92 and abstains below the floor [hum_spec].

---

## 2. Allowed vs. forbidden vocabulary

The sanctioned register is `ALLOWED_TERMS`; the blocklist is `FORBIDDEN_PHRASES`,
both in `@hum-ai/safety-language`.

**Allowed (`ALLOWED_TERMS`):** risk marker · anxiety-risk marker ·
depressive-affect marker · relapse-risk drift · stress load · emotional-state
signal · early-warning pattern · screening signal · recovery trend · worsening
trend.

**Forbidden (`FORBIDDEN_PHRASES`), with the substitution the matcher suggests:**

| Forbidden pattern | Why | Suggested replacement |
| --- | --- | --- |
| `diagnos(is\|e\|ed\|ing\|tic)` | implies clinical diagnosis | screening signal / risk marker |
| `you have (depression\|anxiety\|a disorder\|…)` | diagnostic claim about the user | "your hums show a {marker}-like pattern" |
| `clinical(ly) (certain\|certainty\|confirmed)` | asserts clinical certainty | "an early-warning pattern (non-clinical)" |
| `clinically validated` | Hum is not clinically validated | research-stage signal |
| `guaranteed (prevention\|recovery)` | guarantees an outcome | "may support / is associated with" |
| `prevents relapse` | claims relapse prevention | relapse-risk drift signal |
| `medical device` | regulatory status Hum lacks | reflective self-awareness tool |
| `FDA-cleared` | regulatory status Hum lacks | research-stage prototype |
| `treats\|cures\|therapy for` | implies treatment | supports reflection / regulation |

### Enforcement

`validateUserFacingText(text, opts)` scans copy against every `FORBIDDEN_PHRASES`
entry and returns a `SafetyCheckResult` (`ok`, `violations[]` with `phrase`,
`index`, `reason`, `suggestion`). `assertSafeUserFacingText(text, opts)` calls it
and **throws `UnsafeLanguageError`** on any violation. This is meant to run at the
copy/render boundary so unsafe strings cannot reach a screen. The forbidden list is
bypassed **only** when `opts.validatedRegulatoryMode === true` (§5); by default it
is `false`, so the diagnostic register is unreachable from normal code paths.

---

## 3. Internal research label vs. user-facing copy

The model reasons in clinical-ish **internal labels**; the user only ever sees
reflective phrasing. The two namespaces are kept separate by design.

- **Internal side:** each head in `AFFECT_HEADS` (`@hum-ai/affect-model-contracts`)
  carries an `internalLabel` used in logs and eval — e.g.
  `depressive_affect_markers` → `internalLabel: "depressive_affect_marker"`,
  `relapse_drift` → `"relapse_drift_score"`. These are **never shown verbatim**.
- **User side:** `INTERNAL_TO_USER_FACING` (`@hum-ai/safety-language`) is the one-way
  map keyed by those `internalLabel` values; `userFacingLabel(internalLabel)`
  returns the safe copy, falling back to `"a pattern in your hum"` for unknown
  keys.

| Head `id` | `internalLabel` | User-facing copy |
| --- | --- | --- |
| `depressive_affect_markers` | `depressive_affect_marker` | "a lower-mood pattern worth gently noting" |
| `anxiety_like_tension` | `anxiety_like_tension_marker` | "more tension than your usual" |
| `stress_overload` | `stress_load_high` | "a higher stress-load signal than your usual" |
| `flattened_affect` | `flattened_affect_marker` | "a flatter, more muted pattern" |
| `relapse_drift` | `relapse_drift_score` | "a drift away from your steadier pattern" |
| `neutral_close_to_usual` | `neutral_close_to_usual` | "close to your usual pattern" |

Two labels are **internal-only** (`isInternalOnly` → `true`): `abstain_reason` and
the reserved `cognitive_attention_strain_later` (`internalLabel:
"attention_strain_future"`, `userVisible: false`). Their map entries are explicitly
neutralized ("(internal)", "(reserved — not shown yet)"). The translation is
deliberately lossy in the safe direction: a clinical-sounding internal marker is
narrowed to a tentative, comparative observation before any user sees it.

---

## 4. Reference accuracy figures are NOT Hum accuracy

This is a hard rule, not a style preference.

- The TriSense MELD numbers — Visual **18.4%**, Audio **38.0%**, Text **54.0%**,
  Late Fusion **66.0%** — are **architecture-reference numbers on TV-dialogue
  multimodal data** [trisense_architecture]. They justify the late-fusion / meta-
  learner topology and the expected synergistic gain, nothing more.
- The voice→depression figures — **AUC 0.71–0.93**, accuracy **78–96.5%**
  [clinical_voice_biomarker_review] — and the SER mental-health review
  [ser_mental_health_review] are **clinical priors** on *read/clinical speech*,
  with **6/12 studies at high risk of methodological bias** and unproven
  generalizability. The DVDSA F1 (78.05% binary / 70.58%)
  [longitudinal_voice_treatment_response_source] is inspiration for the within-user
  relapse engine, not a Hum metric.

None of these figures may be presented, implied, or aggregated as **Hum's
accuracy**. Hum has produced no validated performance number; any user-facing or
marketing claim of accuracy is fabrication and is forbidden. Hum's own honesty
mechanism is the earned **confidence percent**, hard-capped per stage (max
0.90–0.92) and floored by abstention [hum_spec] (ADR-0004) — not a borrowed
benchmark. The domain gap between clinical speech and a hum is itself penalized
upstream (`DOMAIN_GAP_PENALTY`, `domainGapPenalty` in `@hum-ai/shared-types`); see
[DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md).

---

## 5. The future validated/regulatory mode gate

`validatedRegulatoryMode` (a field on `SafetyOptions` in `@hum-ai/safety-language`) is
the single switch that would unlock tier 4–5 language by suppressing
`FORBIDDEN_PHRASES`. It defaults to `false` and **must stay false** until every one
of the following is met, audited, and documented in
[VALIDATION_PLAN](../validation/VALIDATION_PLAN.md):

1. Prospective clinical validation of the specific claim against an accepted
   reference standard, with pre-registered endpoints and calibrated operating
   points — not a literature prior. For the depression/anxiety screening claim
   this is the cross-sectional pilot ([PRE_REGISTRATION](../validation/PRE_REGISTRATION.md),
   [ANALYSIS_PLAN](../validation/ANALYSIS_PLAN.md)) meeting its co-primary AUC /
   sensitivity / specificity endpoints at PHQ-9 ≥ 10 and GAD-7 ≥ 10, with
   acceptable calibration (binary ECE) and a passing QUADAS-2 review, and the
   `@hum-ai/screening-model` promotion gate cleared on participant-grouped CV.
2. External, independent replication across populations and devices addressing the
   generalizability and bias concerns flagged in
   [clinical_voice_biomarker_review] and [ser_mental_health_review], and the
   self-recruited-cohort spectrum bias declared in the pre-registration.
3. The corresponding regulatory clearance for the exact intended-use claim
   (e.g. medical-device authorization). Until then "medical device" and
   "FDA-cleared" remain blocked. (Research-grade credibility — a peer-reviewable
   validated screening signal — is reachable WITHOUT this; a medical-device claim
   is not.)
4. A governance sign-off recorded per ADR, scoping the mode to the **specific**
   validated claim only — never a blanket bypass. Biostatistics + clinical + ethics
   collaborators must co-sign that the locked analysis plan was followed.

Setting `validatedRegulatoryMode` for any other reason — demos, "it reads better,"
loosening copy review — is a safety violation. The flag exists so the
non-regulatory default is explicit and so a future validated path has a defined,
auditable entry point, not so the ladder can be skipped.

---

### Sources

[trisense_architecture] · [hum_spec] · [clinical_voice_biomarker_review] ·
[ser_mental_health_review] · [longitudinal_voice_treatment_response_source] ·
[vocal_biomarker_and_singing_protocol_support] · [intervention_support_source].
Full facts in [docs/source/INDEX.md](../source/INDEX.md).
