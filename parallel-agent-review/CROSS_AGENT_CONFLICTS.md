# Cross-Agent Conflicts and Tensions

**Produced by:** Synthesis of all 6 specialist agents
**Date:** 2026-06-18

This document records the genuine tensions and disagreements between specialist agent perspectives. These are not bugs — they are design tradeoffs that must be explicitly resolved, not papered over.

---

## Conflict 1: Investor Pitch Language vs Safety Claims

**Agent A (Architecture):** The product vision includes "anxiety/depression-risk markers," "early detection," and "relapse-risk prevention" as first-class features. These are compelling product differentiators.

**Agent B (Safety/Privacy/Claims):** These exact phrases are in the forbidden-claims list unless carefully qualified. "Anxiety/depression-risk markers" requires "associated with" framing. "Early detection" requires "screening signal" framing. "Relapse-risk prevention" is simply not supportable — only "relapse-risk monitoring" is.

**Resolution Required:**
- The product positioning document (CLAIMS_LADDER.md) must have two columns: internal product language and user-facing safe language.
- The investor pitch must use approved claims ladder language: "risk screening signal" not "risk detection," "relapse monitoring" not "relapse prevention."
- Marketing copy must pass the `@hum-ai/safety-language` check before publication.
- **Neither agent concedes on principle.** The product can be ambitious AND safe if the claims ladder is enforced.

**Owner:** CLAIMS_LADDER.md + @hum-ai/safety-language

---

## Conflict 2: First-Hum Cold Start vs Hum-Domain Data Scarcity

**Agent A (Personalization):** First-hum cold start is a known UX problem. The system knows nothing about the user on hum #1. Confidence is capped at 72%.

**Agent B (Audio Domain):** Even if the system had 1,000 user hums to learn from, it still lacks native-hum-domain training data. The cold start problem is WORSE than it appears because every model was trained on speech, not hums. The 72% cap is conservative for baseline maturity but potentially OPTIMISTIC for domain accuracy.

**Resolution Required:**
- The first-hum cap of 72% must be understood as a COMPOUND cap: baseline immaturity × domain uncertainty.
- A domain classifier running on hum #1 may further reduce this below 72% if the capture looks like speech-leak.
- Architecture must document this explicitly: "The confidence cap accounts for both baseline immaturity AND domain uncertainty."

**Owner:** ARCHITECTURE doc + @hum-ai/fusion-engine confidence pipeline

---

## Conflict 3: 90–95% Confidence Target vs Current Evidence Limitations

**Agent A (Personalization + Architecture):** The confidence schedule allows up to 90–92% for mature baselines. This is a product goal.

**Agent B (Clinical Evidence):** Clinical voice biomarker evidence (AUC 0.71–0.93) was measured on clinical speech in controlled settings. The 50% high-bias-risk evidence base means even the research upper bound is not reliable. For hum specifically, no AUC figure exists. A 90% confidence claim on hum-domain affect labeling is currently unsupported by any evidence.

**Resolution Required:**
- 90–92% confidence must be understood as a **measurement quality indicator** (how clean, consistent, and mature this user's baseline is), NOT as a claim about the probability of correctly identifying an emotional state.
- User-facing copy must frame confidence as "how clear your hum was today" not "how sure we are about your emotional state."
- The architecture must document this reframing: confidence = signal quality × baseline maturity, NOT prediction accuracy.

**Owner:** CLAIMS_LADDER.md + confidence copy in @hum-ai/safety-language

---

## Conflict 4: Public Speech Datasets vs Hum Target Domain

**Agent A (Audio Domain):** MELD, RAVDESS, DAIC-WOZ, Kim 2026 — all trained on speech. Using these as priors introduces systematic domain gap. Confidence must be penalized.

**Agent B (Architecture):** The TriSense architecture uses MELD-trained models. Hum adapts TriSense. The system has to start somewhere. Refusing to use speech priors would mean starting with zero pretrained features.

**Resolution Required:**
- The architecture must adopt "priors not truth" framing formally.
- Speech priors ARE usable for: feature extraction weights, F0 range normalization, jitter/shimmer sensitivity.
- Speech priors are NOT usable for: accuracy claims, AUC claims, confusion matrix benchmarks.
- A HumDomainAdapter is required to convert speech-pretrained model outputs to hum-appropriate probability vectors before fusion.
- The dataset registry must enforce this boundary: every dataset must declare `permittedUse` and `forbiddenUse`.

**Owner:** @hum-ai/dataset-registry + HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md

---

## Conflict 5: Local-First Privacy vs Model Training Needs

**Agent A (Safety/Privacy):** Raw audio must not be uploaded. Derived features only. This is non-negotiable for privacy.

**Agent B (Audio Domain + Architecture):** To build a hum-native domain classifier and a personalized fusion weight model, the system needs hum training data. Derived features may not be sufficient for training deep learning SER models (Wav2Vec 2.0 requires raw waveforms).

**Resolution Required:**
- Privacy-by-default: raw audio stays local. This is the non-negotiable baseline.
- Research mode (consent-gated): users who opt in to research audio upload may contribute raw audio to a federated training pool.
- The architecture must reserve a `researchAudioUpload: boolean` consent gate now, even before research mode is implemented.
- The model training pipeline (future) must be designed around federated/consent-collected data, not scraped or assumption-based data.
- This conflict is **not resolved in v2** — it is documented and deferred to a future research phase.

**Owner:** DATA_GOVERNANCE.md + UserConsentState

---

## Conflict 6: Broad Emotional State Detection vs Clinical Relapse-Risk Modeling

**Agent A (Architecture + Personalization):** The product includes broad emotional state detection: energy, activation, mood-heaviness, tone color. These are valuable as standalone features for a reflective self-awareness tool.

**Agent B (Clinical Evidence):** The clinical evidence base (Briganti 2025, Kim 2026) focuses on depression-specific biomarkers. The generalization to "broad emotional states" lacks the same level of evidence support. Mixing broad affect labels and clinical risk signals in the same output pipeline creates label confusion.

**Resolution Required:**
- The affect model must have **explicitly separated heads**:
  - **Head 1: Broad affect** (energy, activation, mood-adjacent) — suitable for default user display
  - **Head 2: Clinical risk signals** (depression-adjacent, relapse-risk) — consent-gated, never default
- The two heads share acoustic features but have different output types, different confidence caps, and different safety-language requirements.
- Head 2 must never be silently promoted to Head 1's display slot.

**Owner:** @hum-ai/affect-model-contracts + architecture ADR

---

## Conflict 7: Personalization Engine Confidence vs Safety Language

**Agent A (Personalization):** A mature 24-hum baseline with consistent clean hums justifies 90–92% confidence.

**Agent B (Safety/Privacy/Claims):** High confidence (90–92%) displayed alongside mood-adjacent labels creates an implicit clinical accuracy claim. A user reading "90% confident: lower energy than usual" may believe this is 90% accurate about their psychological state, not 90% about signal quality.

**Resolution Required:**
- User-facing confidence display must be reworded to avoid scientific accuracy connotations.
- Options:
  - "Signal clarity: High" (instead of 90%)
  - "Based on 24 clean hums"
  - No numeric confidence shown to users; numeric only in research/debug views
- The architecture must decide between these options in the CLAIMS_LADDER.md. Showing raw numeric confidence to users is a communication risk.

**Owner:** CLAIMS_LADDER.md + UI copy guidelines

---

## Conflict 8: Rolling Baseline Recency Bias vs Long-Term Recovery Tracking

**Agent A (Personalization):** The 24-hum rolling baseline is appropriate for recent pattern tracking. It adapts to a user who has genuinely improved.

**Agent B (Clinical Evidence / Relapse):** Recovery tracking requires a **stable pre-episode baseline** to detect relapse drift. A rolling baseline that shifts toward "new normal after improvement" will fail to detect a return to a prior depressed state.

**Resolution Required:**
- The personalization engine must maintain TWO baselines simultaneously:
  - **Rolling short-term baseline** (24 hums) — for day-to-day variation
  - **Anchored long-term baseline** (set when user is in a stable state, refreshed by explicit event or algorithmic stable-period detection)
- Relapse drift is computed against the anchored long-term baseline.
- The rolling baseline is used for daily read labels.

**Owner:** @hum-ai/personalization-engine + @hum-ai/relapse-engine

---

## Summary Table

| Conflict | Severity | Can It Be Resolved in Foundation? | Owner |
|---|---|---|---|
| Investor pitch vs safety claims | HIGH | YES — CLAIMS_LADDER.md | Claims doc + safety-language |
| Cold start vs domain scarcity | MEDIUM | YES — compound cap documentation | Architecture doc |
| 90–95% confidence target vs evidence | HIGH | YES — reframe as signal quality | CLAIMS_LADDER.md |
| Public speech datasets vs hum domain | HIGH | YES — dataset registry + HumDomainAdapter | Dataset registry + audio architecture |
| Local-first privacy vs model training | MEDIUM | PARTIAL — consent gate now, defer training | DATA_GOVERNANCE.md |
| Broad affect vs clinical relapse | HIGH | YES — two-head affect contract | affect-model-contracts + ADR |
| Personalization confidence vs safety language | MEDIUM | YES — reframe numeric confidence | CLAIMS_LADDER.md + UI |
| Rolling baseline vs long-term recovery | HIGH | YES — dual baseline architecture | personalization-engine + relapse-engine |
