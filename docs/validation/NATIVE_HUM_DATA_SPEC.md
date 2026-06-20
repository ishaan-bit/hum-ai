# Native-Hum + Clinical-Label Data Spec (Roadmap B1 + B2)

**Status date:** 2026-06-20 · **Status:** PROPOSED (not started) · **Roadmap:** [DIAGNOSTIC_ROADMAP](./DIAGNOSTIC_ROADMAP.md) B1/B2
**Grounded in:** [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md), [ADR-0005](../adr/0005-public-datasets-as-priors-not-truth.md),
[VALIDATION_PLAN](./VALIDATION_PLAN.md), `@hum-ai/dataset-registry`, the `hum_legacy_spec` capture protocol.

> **Why this is the root blocker.** Every downstream capability — trained hum experts, calibrated
> thresholds, the relapse study, any clinical claim — is code-gated to a `native_hum` dataset that
> **does not exist yet** (`git ls-files` of real hum data = 0; the only `native_hum` registry entry is
> a *spec*, not data). `dataset-registry` forbids `personalization`/`relapse_tracking`/`hum_finetune`
> on every non-`native_hum` source. So: no native-hum corpus ⇒ no validated early-warning. This spec
> is how that corpus comes into being, **safely**.
>
> Final cohort sizes, inclusion criteria, instruments, and statistical power MUST be set with
> clinical + biostatistics + ethics/IRB collaborators. Numbers below are **starting targets to size
> the engineering and consent infrastructure**, not a finalized study protocol.

---

## 1. What this data unblocks (traceability to the validation studies)

| Dataset component | Unblocks (VALIDATION_PLAN §3) |
|---|---|
| Cross-device repeated hums (same person, short interval) | (a) capture/feature reliability (test–retest ICC) |
| Labelled hums spanning affect range | (b) calibration / ECE; B3 trained experts; B4 threshold calibration |
| Adversarial / poor-capture / OOD captures | (c) abstention precision/recall |
| **Longitudinal** daily hums + clinician-anchored relapse/recovery events | (d) within-user DVDSA relapse study — *the* relapse validation |
| Hums + PHQ-9 / GAD-7 / CES-DC | (e) convergent validity (correlation, not classification) |

---

## 2. Capture protocol (B1)

- **Stimulus:** the standardized **12-second sustained hum** (`hum_legacy_spec`), one clear even tone.
- **Pipeline:** the production capture path (`apps/web` capture → `audio-features` → `quality-gate`).
  A capture counts toward the corpus only if it passes the quality gate (else logged as an
  abstention example for study (c)).
- **Device coverage:** each participant captures on ≥2 device classes (phone / laptop / headset) for
  the reliability study (a). Record device + capture-environment metadata (never raw identifiers).
- **Cadence:**
  - *Cross-sectional cohort* — a short session of repeated hums (e.g. 3–5 within one sitting) for
    reliability + a concurrent label snapshot.
  - *Longitudinal cohort* — **one hum per day** over a multi-month horizon (the DVDSA inspiration
    spans ~107 days pre→post; the within-user trajectory is the signal). This is what powers the
    relapse engine validation and is the highest-value, hardest-to-collect component.
- **On-device first:** raw audio is processed locally to derived `AcousticFeatures`; **raw audio
  never leaves the device** unless the participant separately grants `research_audio_upload`
  (see §4). The corpus of record is *derived features + labels*, not raw audio.

---

## 3. Cohorts & minimum viable dataset (to be powered with biostatistics)

| Cohort | Purpose | Starting target (engineering sizing — NOT final power) |
|---|---|---|
| **C0 Reliability** | study (a) | ~30–50 participants × ≥2 devices × repeated hums |
| **C1 Cross-sectional labelled** | studies (b),(e); B3/B4 | ~200–400 participants, one labelled session each, balanced across affect/symptom range and demographics/devices |
| **C2 Longitudinal** | study (d) relapse | ~50–150 participants with clinical follow-up, daily hums ≥3 months, clinician-anchored relapse/recovery events |

Representativeness (age, gender, language/accent, device, recording condition) is a **validity
requirement**, not a nice-to-have — QUADAS-2 risk-of-bias control (VALIDATION_PLAN §4) depends on it.

---

## 4. Consent model (already scaffolded — extend, don't invent)

Consent is **granular, explicit, revocable, and OFF by default** (`DATA_GOVERNANCE` §4). The scopes:

| Scope | Default | Governs |
|---|---|---|
| `local_processing` | on | on-device read; no upload |
| `derived_feature_sync` | off | derived-only summaries → user's private cloud |
| `research_audio_upload` | off | **raw hum audio** → research storage (dedicated channel, never the derived sync payload) |
| `clinical_label_capture` | off | capture of PHQ-9 / GAD-7 / CES-DC / clinician events (PHI) |
| `clinical_risk_surfacing` | off | whether risk markers are shown back to the user |

Research participation requires **informed consent under IRB/ethics review**: purpose, what's collected
(derived features always; raw audio + clinical labels only if separately granted), retention, withdrawal
(including data deletion), and the explicit statement that **Hum is non-clinical and does not diagnose
or treat** (CLAIMS_LADDER). Consent for research ≠ consent to be diagnosed.

---

## 5. Privacy & data handling (invariants the code already enforces)

- **Raw-audio firewall:** `assertNoRawAudioFields` throws on any raw-audio field in a sync payload at
  any depth. Raw audio rides ONLY the `research_audio_upload` channel to access-controlled research
  storage, never the derived payload. (study (f) fuzzes this.)
- **PHI never in git:** PHQ/GAD/CES-DC / clinical-label files are blocked by the forbidden-files gate
  and referenced only via the registry; stored in access-controlled, encrypted research storage.
- **De-identification & linkage:** hum captures ↔ labels linked by a study-local pseudonymous id, held
  separately from any contact/identity. Re-identification keys are not in the product or the repo.
- **Right to withdraw / delete:** participant can revoke and trigger deletion of their contributed data.

---

## 6. Dataset-registry entry (how `native_hum` becomes real)

> **Status update (2026-06-20, [ADR-0011](../adr/0011-hitl-native-hum-retraining-loop.md)).** A
> `kind: "dataset"` `native_hum` entry now exists — `native_hum_self_report_corpus` — populated by
> the in-app human-in-the-loop: derived features + a **benign valence/arousal self-report** label,
> stored on-device (`local_processing`) and backed up to the user's own private space under
> `derived_feature_sync`. It allows `hum_finetune` / `personalization` / `affect_prior` / `evaluation`
> and forbids `clinical_prior` / `relapse_tracking`. This covers the **affect/calibration** track of
> §1 (b)/(e) at the self-report level; it does **not** cover the **clinical-label** components below
> (§7's PHQ/GAD/CES-DC and the §2 longitudinal/relapse cohort), which still require
> `clinical_label_capture`, IRB, and the §10 collaborators. Cross-user **pooling** of the self-report
> corpus into a shared model is likewise a separate, consent-and-IRB-gated backend step.


Register the collected corpus as a `native_hum` entry in `@hum-ai/dataset-registry` so the code gates
open lawfully:

- `domain: native_hum` · `kind: dataset` (not `reference`) · `label_type:` the captured instruments.
- Allowed uses (per ADR-0005, `native_hum` is the only source of hum truth): `hum_finetune`,
  `personalization`, `relapse_tracking`, `affect_prior`, plus eval. `assertValidRegistry` must pass.
- Provenance, consent basis, IRB ref, retention, and access policy recorded in the entry metadata.
- This is the switch that lets B3 (train on hums) and the relapse study run **without violating
  governance** — until it exists, `clinical_used_as_hum_truth` / domain-forbidden checks correctly block.

---

## 7. Labels (B2)

- **Self-report instruments:** PHQ-9 (depression), GAD-7 (anxiety), CES-DC (where age-appropriate),
  captured under `clinical_label_capture`, time-aligned to hum sessions.
- **Clinician-anchored events (C2):** relapse / recovery / stable transitions from clinical follow-up,
  for the within-user DVDSA study (d).
- **Use:** convergent validity is **correlation, not classification** (VALIDATION_PLAN §3e); labels
  anchor calibration and within-user agreement — they do **not** turn Hum into a diagnostic instrument
  (that needs the full §4 pre-clinical gate + regulatory pathway).

---

## 8. Quality control & exclusions

- Every capture runs the production `quality-gate`; rejected captures are retained **as labelled
  abstention examples** for study (c), not silently dropped.
- Pre-registered exclusion criteria (device/environment/protocol violations) decided with clinical input.
- Capture/feature reliability (ICC, study a) is computed before any modeling, so a noisy feature is
  caught before it pollutes B3/B4.

---

## 9. Milestone gates

1. **Infra ready** — consent scopes wired (mostly done), research-upload channel + encrypted storage +
   pseudonymous linkage + deletion flow built and fuzz-tested (study f).
2. **IRB/ethics approval** — protocol, consent forms, retention, withdrawal.
3. **C0/C1 collected** → run studies (a),(b),(c),(e); B3 train hum experts; B4 calibrate thresholds.
4. **C2 collected** → run study (d) (the relapse validation).
5. **Pre-clinical gate (VALIDATION_PLAN §4)** → external replication + QUADAS-2 + regulatory pathway.

Only after milestone 5 may a Tier-4 "screening instrument" claim even be *considered*; a Tier-3
within-user early-warning *marker* (validated for calibration + within-user agreement) is the realistic
near-term destination. Relapse **prevention** (Tier 5) remains forbidden until regulatory clearance.

---

## 10. What is needed from non-engineering collaborators (explicitly flagged)

- **Clinical / psychiatry:** instrument choice, clinician-event definitions, inclusion/exclusion, safety
  escalation pathways for participants who screen high.
- **Biostatistics:** final cohort sizes + power for each study; calibration/agreement targets; QUADAS-2 plan.
- **Ethics / IRB + privacy/legal:** approval, consent language, data-protection (PHI), regulatory pathway.

Engineering can build §4–§6 (consent, channels, storage, registry) now; the corpus itself cannot and
must not be collected without §10 in place.
