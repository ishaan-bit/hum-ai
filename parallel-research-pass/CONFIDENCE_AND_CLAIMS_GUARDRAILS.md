# Confidence and Claims Guardrails

**Sources:** All 7 source documents  
**Purpose:** Defines allowed/forbidden user-facing language, confidence gating rules, maturity caps, abstention logic, and the clinical responsibility ladder for Hum v2.

---

## 1. Allowed user-facing terms

These terms reflect the product's position as a self-monitoring wellness tool, not a diagnostic instrument.

| Allowed term | Use case |
|-------------|----------|
| "Your hum pattern" | Describing the current session's result |
| "Compared to your recent hums" | Referencing the personal baseline |
| "Closer to your energized pattern" | State label in relative terms |
| "This sounds like a calmer day for you" | Interpretation framed against personal baseline |
| "A shift in your voice pattern" | Change detection output |
| "Potential signal of change" | Trend / relapse alert framing |
| "Music that may help you unwind" | Intervention recommendation |
| "We've noticed this pattern in your recent hums" | Trend framing |
| "Still building your personal baseline" | Pre-baseline framing |
| "Your voice sounds different from your usual" | Within-user divergence framing |
| "Low confidence — try humming in a quieter spot" | Poor-quality capture framing |

---

## 2. Forbidden user-facing terms

These are categorically prohibited — they imply clinical diagnosis, predictive certainty, or scientific authority the product does not have.

| Forbidden term / framing | Why prohibited |
|-------------------------|----------------|
| "You are depressed" | No clinical diagnosis authority |
| "Your depression score is X" | No validated clinical scoring |
| "This predicts your mental health" | Not a validated predictor; domain gap not resolved |
| "Clinically validated" | Not clinically validated for Hum |
| "Your voice shows signs of depression" | Direct clinical claim without validation |
| "You are at risk of relapse" | Relapse modeling is statistical; not diagnostic |
| "This is 90% accurate" | Confidence caps ≤ 92%; accuracy claims require clinical validation |
| "Scientifically proven to detect X" | No hum-specific clinical proof |
| "AI diagnosis" | AI Act high-risk category; not compliant |
| "Medical-grade" | No CE marking, no FDA clearance |
| "Your cortisol is elevated" | Not measured; not inferred |
| "This music will treat your condition" | Music evidence supports stress reduction, not condition treatment |
| "You should see a doctor because your hum says..." | Product cannot prescribe clinical action based on its own output |

---

## 3. Confidence gating rules

### 3.1 When to show a result vs withhold it

| Condition | Action |
|-----------|--------|
| captureQuality = 'rejected' | Do not show any state label or trend. Show "We couldn't capture a clean hum — try again" |
| captureQuality = 'poor' | Borderline; show low-confidence framing only. No state label |
| captureQuality = 'soft_usable' | Show state label with explicit low-confidence notice |
| captureQuality = 'usable' or 'good' | Normal flow |
| baselineCount < 5 (pre-baseline) | Show "Still building your baseline — results are preliminary" |
| confidencePercent < 60 | Abstain from state label; show quality feedback only |
| trend detected but baselineCount < 20 | Do not trigger relapse alert; show "Not enough history yet" |

### 3.2 Confidence caps by maturity tier (verbatim from hum_spec)

| Stage | Cap |
|-------|-----|
| First hum (baselineCount = 0) | 72% |
| Pre-baseline (baselineCount 1–4) | 76% |
| 5–9 baseline hums | 82% |
| 10–19 baseline hums | 88% |
| 20+ baseline hums | 90–92% |

These are HARD CAPS. No raw model output, no matter how high, should produce a user-facing confidence above the cap for its maturity tier.

### 3.3 Conditions for reaching 90–92% (mature tier)

All of the following must be true:
- baselineCount ≥ 20
- captureQuality is 'good' or 'usable'
- evidenceCount ≥ 4 contributing features (from different feature families)
- No musicalityConflict flag (high musicality score doesn't conflict with state label)
- deviationStrength ≥ moderate (features agree on direction of deviation)

---

## 4. Abstention requirements

Hum must produce no state label or trend output — returning null or an explicit "no result" UI — in the following cases:

| Abstention trigger | Minimum conditions |
|-------------------|-------------------|
| Capture quality too low | captureQuality in ('rejected', 'poor') |
| Signal too faint | isTooFaint or isSilent |
| Duration too short | duration < 8s |
| Clipping | clippedFrameRatio > 0.08 |
| Pre-baseline (no label possible) | baselineCount < 5, AND user on first-session |
| Domain gap too high | Model domain_gap = 'very_high' AND no fallback feature model |
| All dimension scores below threshold | All 6 dimension scores < 0.34 |
| Insufficient feature agreement | evidenceCount < 2 |

**Abstention must be shown with a reason**, not a blank screen. Example messages:
- "The hum was too quiet to read. Try humming a little louder."
- "We're still learning your pattern. Check back after a few more hums."
- "This result didn't meet our confidence threshold. Not all days produce a clear signal."

---

## 5. Domain gap disclosure requirements

When a model trained on non-hum data is used:
- The dataset registry entry must have `confidence_penalty` < 1.0
- The `confidence_penalty` must be applied as a multiplier before the maturity cap
- The `domain` source must be logged in the session record (for audit)
- User-facing copy must NOT reference the source dataset's accuracy figures

Example: WavLM trained on DVDSA has confidence_penalty 0.75. If raw model output confidence = 0.88, applied confidence = 0.88 × 0.75 = 0.66, then capped at maturity tier ceiling.

---

## 6. Clinical responsibility ladder

This defines who is responsible for which level of clinical inference:

| Level | Responsible party | Hum's role |
|-------|------------------|------------|
| **Voice capture and feature extraction** | Hum app | ✅ Hum handles this |
| **Within-user pattern comparison** | Hum app | ✅ Hum handles this |
| **Self-monitoring signal** | User | ✅ Hum provides signal; user interprets |
| **Trend observation** | User + Hum (with confidence caps) | ✅ Hum surfaces trend; user decides meaning |
| **Potential clinical relevance** | User + healthcare provider | ⚠️ Hum may suggest "share with your provider" — not diagnose |
| **Clinical diagnosis** | Licensed healthcare provider | ❌ Not Hum's role; never implied |
| **Treatment decision** | Licensed healthcare provider | ❌ Not Hum's role; explicitly disclaimed |

**Safe escalation language** (for significant change detected):
- "This is different from your recent pattern — it might be worth paying attention to."
- "If you're concerned about patterns you're seeing, talking to someone can help." (general, not "see a psychiatrist")
- NEVER: "Your hum indicates you should seek immediate help" (creates false urgency based on unvalidated signal)

---

## 7. Privacy-based claims constraints

From hum_spec and GDPR/EU AI Act context (Rodrigo 2025):

| Rule | Implementation |
|------|---------------|
| Raw audio is NOT uploaded | Type guard enforces; Firestore write rejected if raw audio field present |
| Voice patterns are biometric data (GDPR) | Privacy notice must disclose voice processing; user must consent |
| EU AI Act: voice biomarker tools → high-risk AI | If deployed in EU: conformity assessment, technical documentation, human oversight requirement |
| No sale/sharing of voice features without explicit consent | Data use agreement must cover derived features, not just raw audio |
| Right to erasure | Deleting Firestore docs must cascade to baseline history |

---

## 8. Non-clinical framing test

Before any user-facing string ships, apply this test:

1. Does it make a clinical claim? → REWRITE
2. Does it cite a performance number from a non-Hum study? → REMOVE or REWRITE with source attribution
3. Does it create urgency based on AI output? → REWRITE (use "might be worth noticing" not "you should act now")
4. Does it imply diagnosis, prognosis, or treatment? → BLOCK — requires legal and ethics review
5. Is the confidence displayed above the maturity cap? → BUG — fix the cap logic

If all 5 tests pass: copy is safe to ship.
