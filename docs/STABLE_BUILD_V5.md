# Hum AI — Stable Build v5 · Investigational Screening Instrument (Phase 0)

**Build:** `stable-build-v5` · **Date:** 2026-06-23 · **Base HEAD:** `a1e7b1a`
**Status:** research-stage · **INVESTIGATIONAL · NON-CLINICAL · not a diagnosis · not FDA-cleared · not clinically validated**
**Verification:** `npm run typecheck` ✅ · `npm run typecheck:web` ✅ · `npm test` → **581/581** ✅ · `npm run qa` → **5/5 gates** ✅ · `npm run build:web` ✅

This document is the honest specification of the system after the v5 pass. It builds on
[STABLE_BUILD_V4.md](STABLE_BUILD_V4.md) (read that first for the v4 baseline) and keeps every v2–v4
invariant — two-head clinical separation (ADR-0006), no raw numbers in copy (ADR-0008),
live-from-hum-#1 reads (ADR-0010), gate-enforced model truth, render-layer safety proof, privacy +
consent guards. v5 is a **structural overhaul that turns hum into a data-collection + validation
instrument** for an early **depression + anxiety screening** claim — *without adding any new
user-facing claim*. The screening signal is **blinded** throughout the pilot.

> **One-line thesis of v5:** hum can now *earn* a medically-worthy claim instead of asserting one — it
> grows a clinical corpus (hum paired with **PHQ-9 / GAD-7**), validates a screening model against it
> with honest, leakage-free statistics (**AUC / sensitivity / specificity / calibration**), routes
> **PHQ-9 item-9 (suicidality) to a real-time crisis pathway**, and ships the pre-registration / IRB /
> analysis-plan evidence spine — all behind consent + enrollment, with the consumer experience
> untouched and the screening result never shown.

---

## 0. What "v5" is (changelog over v4)

| # | Area | v4 behaviour | v5 behaviour |
|---|------|--------------|--------------|
| 1 | **Goal** | Reflective, non-clinical tool (Tier 0–3 markers). | Same consumer tool **plus** an investigational **depression + anxiety screening** instrument validated against PHQ-9 ≥ 10 / GAD-7 ≥ 10, plus relapse monitoring (secondary) and wellness (exploratory). |
| 2 | **Clinical data** | None. Only the benign valence/arousal native corpus exists. | New **sanctioned clinical channel**: `ClinicalHumExample` (derived features paired with PHQ-9/GAD-7), a separate `@hum-ai/clinical-corpus`, and a registered `native_hum_clinical_screening_corpus` dataset entry. Clinical scores **cannot** enter the benign corpus (`assertNoClinicalLeak`). |
| 3 | **Screening model** | Far-domain RAVDESS priors only; no screening head. | New offline-only `@hum-ai/screening-model` + `signal-lab/evaluate-binary`: participant-grouped CV, **ROC AUC + grouped-bootstrap CI**, sensitivity/specificity/PPV/NPV, calibration (binary ECE + reliability diagram), permutation p-value, Youden operating point, and a strict pre-registered **promotion gate**. |
| 4 | **Safety** | "Reach out to someone you trust" text only. | **Deterministic crisis pathway** on PHQ-9 item 9: `assessCrisisFromPhq` (≥1 elevated, ≥2 active) + a non-dismissable, region-aware crisis surface (988 default) wired synchronously into instrument submission, audit-logged. |
| 5 | **Claims** | Tier 0–3, Tier 4 unreachable. | New **Tier-4a "investigational screening (pre-validation)"** rung; new forbidden phrases block premature `screens/detects (depression\|anxiety)` and `N% sensitivity/specificity` (bypassed only by `validatedRegulatoryMode`); investigational register added to `ALLOWED_TERMS`. |
| 6 | **Backend** | Local-first + owner-scoped `users/{uid}` Firestore. | **Partner-pluggable research backend**: `studies/{studyId}` collections (participants, **append-only immutable** consent records, clinicalExamples, phqResponses, gad7Responses, audit log, clinician views), `storage.rules` for the raw-audio research bucket, durable participant identity, versioned `ResearchConsentRecord`. |
| 7 | **Privacy egress** | Raw audio never leaves the device; derived-only sync. | Unchanged for consumers. **New** sole sanctioned raw-audio egress: `research-upload.ts` (gated on `research_audio_upload`, to Firebase Storage), physically isolated from derived sync. |
| 8 | **UX** | Reflective 3-window flow + signature card. | Consumer flow unchanged. **New study surfaces (behind enrollment):** clinical-grade informed e-consent, scheduled PHQ-9 + GAD-7 administration (item-9 → crisis), a non-dismissable crisis surface, a longitudinal dashboard, a clinician read-only view, and a study-status tray. |
| 9 | **Evidence** | Validation plan documented, not run. | New **study-ops docs**: PRE_REGISTRATION, IRB_PROTOCOL, ANALYSIS_PLAN, QUADAS2, POWER_ANALYSIS, DATA_DICTIONARY; VALIDATION_PLAN §3 + DIAGNOSTIC_ROADMAP §5 updated. |
| 10 | **Firewall enforcement** | Two-head separation by code + guards. | **New QA gate `no-screening-in-read-path`**: a build-time proof that the screening head is never imported into apps/web / orchestrator / render — it stays blinded (ADR-0006). |

Everything else (the spine, dual baseline, relapse engine, native-corpus HiTL, AURA theming, capture
gate, personality signature) is unchanged from v4.

---

## 1. Clinical data channel — `@hum-ai/affect-model-contracts`, `@hum-ai/clinical-corpus`

- **`clinical-feedback.ts`** — `Phq9Response` / `Gad7Response` (standard 0–3 items, totals, severity
  bands), with **item 9 broken out as a first-class field** (null for PHQ-8) so the crisis rule is
  deterministic. `ClinicalHumExample` carries derived features + the instrument(s) keyed by a
  `participantPseudonym`. `assertValidClinicalExample` enforces instrument ranges + `assertNoRawAudioFields`
  and **deliberately does not call `assertNoClinicalLeak`** — it is the one sanctioned place a PHQ/GAD
  score lives. Binary mappers `phqToBinaryLabel` / `gadToBinaryLabel` at the locked ≥10 cuts.
- **`@hum-ai/clinical-corpus`** — separate from the benign corpus; ring-buffered, JSON round-tripping,
  re-validated on every insert, with `dropParticipant` (right-to-deletion) and stats reporting screening
  class balance at the cut, distinct-participant count, device/stratum spectrum coverage (QUADAS-2), and
  item-9 endorsement count (audit only).
- **Registry** — `native_hum_clinical_screening_corpus` (`clinical_status: clinical`, gated by
  `clinical_label_capture` + IRB) documents pseudonymisation, retention, and the raw-audio separation.

## 2. Screening model + validation engine — `@hum-ai/screening-model`, `signal-lab/evaluate-binary`

A **study artifact, never wired into the consumer read path** (ADR-0006; enforced by a QA gate).
`evaluateBinary` runs participant-grouped k-fold CV (group key = pseudonym → zero leakage), pooling
out-of-fold P(positive) to compute **AUC** (rank/Mann-Whitney with tie-averaging), a **participant-grouped
bootstrap 95% CI**, operating-point metrics at the default and **Youden-optimal** thresholds, a
**reliability diagram + binary ECE**, and a label-permutation **p-value** (now divided by the valid-null
count). `assessScreeningPromotion` applies a strict pre-registered gate (AUC floor + CI-lower floor +
p-value + ECE + sensitivity/specificity + min N/participants) — defaults are placeholders pending
biostatistics sign-off. New shared primitives live in `shared-types/metrics.ts`: `rocAuc`,
`binaryMetricsAtThreshold`, `reliabilityDiagram`.

## 3. Crisis safety protocol — `crisis.ts` (contract) + apps/web crisis surface

PHQ-9 item 9 ≥ 1 fires synchronously, before any model or backend round-trip: `assessCrisisFromPhq`
returns `elevated` (≥1) or `active` (≥2), `requiresInterstitial`, the audit event, and direct
non-euphemistic copy. The apps/web surface renders region-aware resources (988 default + international
fallback) through the existing `copy()`/`esc()` safety chokepoint and records the escalation in the
audit log. **This is the mandatory IRB gate and ships in Phase 0.**

## 4. Claims evolution — `@hum-ai/safety-language`, `CLAIMS_LADDER.md`

New **Tier-4a** rung ("investigational screening, pre-validation": IRB + pre-registration on file, **no
performance claim**, result blinded). New forbidden patterns block premature screening claims; the
investigational register is sanctioned in `ALLOWED_TERMS`; `phq_screening_signal` / `gad_screening_signal`
internal labels map to investigational copy surfaced **only** post-validation under `validatedRegulatoryMode`.
§5 unlock conditions now reference the specific pre-registered endpoints + governance sign-off.

## 5. Compliant research backend — `firestore.rules`, `storage.rules`, apps/web

`studies/{studyId}` collections with deny-by-default rules: participants, **append-only immutable** consent
records (update/delete denied), clinicalExamples/phqResponses/gad7Responses, a create-only audit log, and
clinician-claim-gated `clinicianViews`. `storage.rules` scopes the raw-audio research bucket. apps/web adds
`participant.ts` (durable identity + pseudonym + withdraw/delete), `clinical-store.ts` (local-first→cloud on
the pseudonym path), and `research-upload.ts` (the **only** raw-audio egress, gated on `research_audio_upload`,
physically isolated from derived sync). `ResearchConsentRecord` (versioned, append-only) lives in
`shared-types/privacy.ts`. The consumer `users/{uid}` rules + raw-audio firewall are unchanged.

## 6. Study UX (behind enrollment) — apps/web

`study-consent.ts` (clinical-grade multi-step informed e-consent + versioned acknowledgment),
`phq-admin.ts` (scheduled PHQ-9 + GAD-7, item-9 → synchronous crisis), `crisis.ts` surface, `dashboard.ts`
(qualitative PHQ/GAD trajectories + relapse output, ADR-0008-safe), `clinician/` (read-only sanctioned
projection), and `study-ui.ts` (study-status tray entry). A non-participant sees the **unchanged** v4 app.

## 7. Study-operations evidence — `docs/validation/`

PRE_REGISTRATION, IRB_PROTOCOL, ANALYSIS_PLAN, QUADAS2, POWER_ANALYSIS, DATA_DICTIONARY — the pre-registered
co-primary endpoints (AUC vs PHQ-9≥10 and GAD-7≥10), secondary (sens/spec, calibration, abstention,
longitudinal relapse), exploratory (intervention helpfulness), blinding, multiplicity, stopping rules, and
the crisis/safety protocol. VALIDATION_PLAN §3 elevates the cross-sectional classification endpoint;
DIAGNOSTIC_ROADMAP §5 updates the unlock map.

---

## 8. Invariants preserved (regression surface)

- **No raw numbers / no clinical labels in user copy** — all new copy is safety-screened; the screening
  probability is **blinded** (never rendered) during the pilot.
- **Two-head separation (ADR-0006)** — now additionally enforced by the `no-screening-in-read-path` QA gate:
  the screening head is never imported into apps/web / orchestrator / render.
- **Raw-audio firewall** — unchanged for consumers; the single new egress (`research-upload.ts`) is
  consent-gated and isolated from derived sync.
- **Clinical-leak guard** — the benign corpus still rejects clinical scores; clinical scores live only in the
  sanctioned clinical channel.

## 9. Verification

```
npm run typecheck      # engines (DOM-free) — green
npm run typecheck:web  # web (DOM) — green
npm test               # full node:test suite — 581/581 green
npm run qa             # governance gates (incl. no-screening-in-read-path) — 5/5 green
npm run build:web      # production bundle — built
```

New/updated tests: `affect-model-contracts/test/{clinical-feedback,crisis}.test.ts`,
`clinical-corpus/test/corpus.test.ts`, `shared-types/test/binary-metrics.test.ts`,
`screening-model/test/screening.test.ts`, `safety-language/test/screening-claims.test.ts`,
`qa-gates/test/screening-isolation.test.ts`.

## 10. Known limitations (honesty posture)

- **Investigational, not validated.** v5 ships the *instrument and study scaffolding* (Phase 0). The
  screening result is **blinded**; no screening claim is made or shown. The claim is unlocked only after the
  pre-registered endpoints are met, biostatistics/clinical/ethics co-sign, and `validatedRegulatoryMode` is
  scoped to the specific claim.
- **Deploying this build does NOT start a study.** Live PHQ-9/GAD-7 collection must not begin until IRB
  approval + pre-registration are filed and the crisis protocol is operationally tested (the Phase 0 → Phase 1
  gate). The promotion-gate thresholds are placeholders pending biostatistics sign-off.
- **The study UX is verified by typecheck + unit tests, not yet click-tested in a live browser session.**
- **Spectrum bias:** a self-recruited remote cohort is QUADAS-2 patient-selection biased; external replication
  is required and is declared in the pre-registration.
