# Clinical Evidence Agent Review

**Specialist:** Clinical Evidence Agent
**Focus:** Depression voice biomarker evidence; SER mental health evidence; adolescent treatment-response / recovery-worsening-unchanged modeling; what can and cannot be claimed; early detection and relapse-risk logic
**Date:** 2026-06-18

---

## 1. Evidence Inventory

### 1.1 Voice–Depression Biomarker Evidence

[SOURCE: clinical_voice_biomarker_review] Briganti & Lechien (2025), Journal of Voice — Systematic review:
- **12 studies** meeting inclusion criteria (from 108 records)
- **16,872 participants** total; MDD patients n=1,535; controls n=1,204
- AUC **0.71–0.93**; classification accuracy **78–96.5%**
- Voice features: F0, jitter, shimmer, HNR, MFCC, spectral tilt, speech rate, intensity variation
- Recording contexts: clinical settings, smartphone, telemedicine, conversational AI

**CRITICAL LIMITATION from source:** "Six studies demonstrated high risk of methodological bias, primarily in patient selection and validation techniques." "Methodological heterogeneity and generalizability concerns must be addressed before widespread clinical adoption."

**Evidence strength assessment:**
- AUC 0.71–0.93 represents a wide band. The upper bound (0.93) is from favorable conditions; the conservative central estimate is closer to AUC 0.79.
- All studies use **speech** as the recording modality. Zero studies use hum. The domain gap is non-trivial (see Audio Domain Agent Review).
- 6/12 studies with high risk of bias = **50% of the evidence base is methodologically suspect**.

### 1.2 Singing/Sustained Phonation as Bridge Evidence

[SOURCE: vocal_biomarker_and_singing_protocol_support] Rodrigo & Duñabeitia (2025), Brain Sciences — Vocal biomarkers in digital health:
- Pitch, jitter, shimmer, speech rate, pause duration are well-established biomarkers for stress, MDD, PD, dementia.
- **Acoustic features are language-independent and highly transferable.**
- **Singing engages multiple neural networks** — relevant to hum protocol validation.
- Spectral features are robust across impairment severity.
- Field still emerging; "no formal clinical use yet."

This paper is the strongest direct scientific support for the hum modality. The hum capture is essentially a form of sustained phonation, and this source argues that sustained melodic vocalization can serve as a biomarker source.

### 1.3 SER in Mental Health

[SOURCE: ser_mental_health_review] Jordan et al. (2025), JMIR Mental Health — Systematic review of SER in mental health:
- **14 studies**: suicide risk (3), depression (8), psychotic disorders (3)
- Categorical (Ekman "big six," Plutchik) vs **dimensional valence–arousal** approaches
- Dimensional approach "comparatively underexplored but more nuanced"
- SER used mostly **indirectly** (not as primary diagnostic)
- Architecture/dataset/pathology diversity makes direct comparison hard
- QUADAS-2 risk-of-bias assessment used

**Key implication:** The evidence supports **dimensional valence–arousal modeling** over discrete emotion categories for mental health applications. This reinforces the architecture choice to use a multi-head (discrete + dimensional) affect contract.

### 1.4 Adolescent Treatment Response Evidence (DVDSA)

[SOURCE: longitudinal_voice_treatment_response_source] Kim et al. (2026), Communications Medicine:
- 48 adolescent MDD patients, pre/post treatment voice (mean interval 107 days ± 128 days)
- **Paired intra-patient design** — the most direct inspiration for Hum's relapse engine
- Only F0 changed significantly at the individual-feature level (Holm-Bonferroni corrected)
- WavLM: F1 **78.05%** binary, **70.58%** DVDSA (3-class: recovery/worsening/unchanged)
- Classical ML best: F1 **65.83%**
- Deep learning substantially outperforms classical ML for this task

**DVDSA 3-class breakdown:** recovery / worsening / unchanged — Hum v2 should extend this to: `recovery | stable | worsening | relapse_drift | uncertain`

**Critical limitation:** n=48 is very small. Mean interval = 107 days (not daily tracking). All subjects were hospitalized or outpatient psychiatric patients — not a general-population daily self-monitoring context.

---

## 2. What CAN and CANNOT Be Claimed

### PERMITTED Claims (Risk-Marker / Screening Signal Framing)

| Claim | Evidence Level | Permitted Framing |
|---|---|---|
| Acoustic features correlate with depressive states | Moderate [SOURCE: clinical_voice_biomarker_review] | "Voice features have been associated with mood-related changes in research settings" |
| F0 changes within individuals during depression treatment | Moderate [SOURCE: longitudinal_voice_treatment_response_source] | "Pitch patterns may shift during periods of low or improved mood — this is what we track" |
| Sustained phonation can carry biomarker-relevant features | Moderate [SOURCE: vocal_biomarker_and_singing_protocol_support] | "Your daily hum captures signals that voice science associates with mood and energy" |
| Music interventions reduce stress/anxiety | Strong [SOURCE: intervention_support_source] | "Listening to music can reduce stress — Hum helps you find music that matches your moment" |
| Within-user longitudinal comparison is valuable for tracking | Moderate [SOURCE: longitudinal_voice_treatment_response_source] | "Comparing your hums over time reveals patterns unique to you" |
| Patterns may indicate energy, activation, or mood-adjacent states | Weak-Moderate [SOURCE: hum_spec] | "Your hum today suggests lower activation than your usual pattern" |

### FORBIDDEN Claims (Diagnosis / Clinical / Prevention)

| Forbidden Claim | Why Forbidden | Source Evidence Against |
|---|---|---|
| "Hum detects depression" | Not validated; 6/12 studies high risk of bias; domain gap | [SOURCE: clinical_voice_biomarker_review] |
| "Hum diagnoses anxiety" | No hum-specific evidence; anxiety disorders n=224 only in meta-review | [SOURCE: clinical_voice_biomarker_review] |
| "Hum prevents relapse" | No evidence for prevention; only monitoring/tracking | None in any source |
| "Hum is clinically validated" | No clinical validation study has been run | [SOURCE: hum_spec] explicitly states not validated |
| "90–95% accurate at detecting depression" | MELD accuracy (66%) is for TV speech; clinical speech AUC varies; no hum data | [SOURCE: trisense_architecture], [SOURCE: clinical_voice_biomarker_review] |
| "Scientifically proven to detect mood changes" | Systematic review bias acknowledged; no hum studies | [SOURCE: clinical_voice_biomarker_review] |
| "Treatment tracking" (implied medical treatment) | Not a medical device; not cleared/approved | [SOURCE: hum_spec] |

---

## 3. Anxiety/Depression Risk Markers

### Required Treatment

Anxiety and depression risk markers ARE appropriate product goals, provided:
1. They are framed as **"patterns associated with"** not **"indicating"**
2. They are computed from **within-user longitudinal comparison**, not population norms
3. They trigger **relapse-risk monitoring** language, not clinical diagnosis language
4. They are consent-gated behind a **research/wellness mode** opt-in
5. They never appear in user-facing output without the appropriate confidence ceiling

### Required Affect Taxonomy

Following [SOURCE: ser_mental_health_review] (dimensional vs categorical), Hum must implement a **multi-head affect contract**:

```
AffectHead {
  discrete: {
    label: 'low_energy' | 'activated' | 'subdued' | 'stable' | 'elevated'
    confidence: float
  }
  dimensional: {
    valence: float      // -1 to +1, maps to Russell circumplex
    arousal: float      // -1 to +1
    uncertainty: float  // high when evidence is weak
  }
  clinicalRiskSignal: {  // CONSENT-GATED, internal research only
    label: 'risk_marker_present' | 'nominal' | 'insufficient_data'
    confidence: float   // always capped at 88%
  }
}
```

---

## 4. Early Detection Framing

Early detection is a valid product goal. The evidence base supports it as **a screening/risk-signal function**, not a diagnostic function.

### Acceptable Early Detection Language

- "Your vocal patterns over the past two weeks suggest lower energy and mood than your baseline — this might be worth paying attention to."
- "We've noticed a drift in your daily hums that sometimes occurs during periods of low mood."
- "Consider checking in with someone you trust."

### Unacceptable Early Detection Language

- "We've detected early signs of depression."
- "Your hum shows a clinical risk of relapse."
- "You may be developing an anxiety disorder."

---

## 5. Relapse Prevention Framing

[SOURCE: longitudinal_voice_treatment_response_source] The DVDSA study demonstrates that within-patient voice comparison can classify treatment response as recovery/worsening/unchanged. This is the strongest evidence for relapse **monitoring**. It does not provide evidence for relapse **prevention**.

### Required Relapse Engine Framing

Hum's `@hum-ai/relapse-engine` must output:
- `relapse_drift` — longitudinal divergence from baseline that matches patterns associated with worsening
- `recovery_signal` — convergence toward stable baseline
- `monitoring_flag` — user's trajectory is outside normal variation

It must NOT claim:
- That it prevents relapse
- That it detects relapse (only that it detects patterns associated with relapse in research populations)
- That the user should or should not change their clinical treatment

---

## 6. Clinical Evidence Agent Summary

| Check | Status | Notes |
|---|---|---|
| Depression voice biomarker evidence | PASS | Briganti 2025 provides strong prior with caveats |
| Singing/hum as bridge evidence | PASS | Rodrigo 2025 directly supports hum modality |
| SER mental health evidence | PASS | Jordan 2025 supports dimensional modeling |
| DVDSA as relapse engine basis | PASS | Kim 2026 provides within-patient comparison method |
| Anxiety/depression risk markers included | WARN | Must be consent-gated, not default output |
| Broad emotional states included | PASS | Multi-head affect contract supports this |
| Early detection framing correct | WARN | Language rules must be enforced in @hum-ai/safety-language |
| Relapse framing correct | WARN | Monitoring vs prevention must be enforced contractually |
| Forbidden claims list specified | PASS | See Section 2 above |
| Clinical validation absence acknowledged | PASS | hum_spec explicitly states not validated |

---

## Clinical Evidence Agent Top 3 Findings

1. **50% of the depression voice biomarker evidence base has high methodological bias.** The 78–96.5% accuracy range cited from Briganti 2025 cannot be used in any form in user-facing claims. The ONLY valid framing is "voice features have been associated with mood-related changes in research settings with varied methodology."

2. **DVDSA is a powerful inspiration, but its n=48 and clinical-speech-not-hum limitations are disqualifying for clinical claims.** The methodology is correct; the domain gap and sample size prevent any accuracy figure from Kim 2026 being cited as a Hum performance claim.

3. **The dimensional (valence–arousal) + discrete multi-head affect contract is required by the evidence.** Jordan 2025 explicitly states that dimensional modeling is underexplored but superior for mental health applications. Hum must implement both heads, or the product is misaligned with its own clinical prior.
