# Personalization Agent Review

**Specialist:** Personalization Agent
**Focus:** Personal baseline, calibration ladder, user-specific fusion weights, recovery signatures, high-risk signatures, relapse drift and within-user comparison
**Date:** 2026-06-18

---

## 1. Personal Baseline System

### Source Evidence

[SOURCE: hum_spec] The hum spec defines a rolling personal baseline that:
- Activates after **5 eligible hums**
- Uses a rolling window of the **last 24 eligible hums**
- Computes robust statistics: `median`, `MAD`, `IQR`, `robustStd = MAD × 1.4826`
- Computes per-feature: `zDelta = (current - baselineMean) / max(stdDev, epsilon)` and `ratio = current / baselineMean`
- Outlier adjustment: values > 2.5× MAD replaced with median, weight penalty 0.25

This is technically sound for a **non-clinical within-user comparison** system.

### Assessment

**PASS:** The rolling baseline design is well-specified. Using MAD/IQR (robust to outliers) rather than mean/std is the correct choice for a volatile user time series.

**WARN:** The baseline activation threshold of **5 hums** is low for statistical reliability. With n=5, a single atypical day heavily distorts the rolling statistics. The architecture should:
- Distinguish between "baseline active" (5 hums) and "baseline reliable" (10+ hums)
- Expose `baselineReliability: 'nascent' | 'emerging' | 'established' | 'mature'`
- Use the existing confidence cap schedule as the primary safeguard (72%, 76%, 82%, 88%, 90–92%)

**WARN:** The 24-hum rolling window (~3.5 weeks of daily use) creates a recency bias. A user who improves significantly over weeks will see their baseline shift upward, potentially making new "normal" readings appear like regressions. The architecture must document this **baseline drift phenomenon** and consider anchoring long-term baseline alongside rolling short-term baseline.

---

## 2. Calibration Ladder

### Required Calibration Ladder Definition

The calibration ladder is the progression of baseline maturity states. It must be explicitly defined:

| Stage | Hum Count | Confidence Cap | Baseline State | Label Available? |
|---|---|---|---|---|
| Cold Start | 0 | 72% (first hum) | Not active | Absolute only (no comparison) |
| Early Calibration | 1–4 | 76% | Not active | Absolute only |
| Nascent Baseline | 5–9 | 82% | Active, low reliability | Relative (with heavy caveats) |
| Emerging Baseline | 10–19 | 88% | Active, medium reliability | Relative labels |
| Established Baseline | 20–24 | 90–92% | Active, high reliability | Full relative labels |
| Mature Baseline | 24+ (rolling) | 90–92% | Stable rolling | Full relative labels + relapse signal |

[SOURCE: hum_spec] These caps are confirmed in the spec: 72% first hum, 76% pre-baseline, 82% 5–9, 88% 10–19, 90–92% mature.

### Finding: Calibration Ladder Not Yet a First-Class Contract

The confidence caps are in the spec, but the calibration ladder as a named contract (with `baselineStage` as a typed enum) is not explicitly documented in any architecture doc. The `@hum-ai/personalization-engine` package must expose:

```typescript
type BaselineStage = 
  | 'cold_start'       // 0 hums
  | 'early'            // 1-4
  | 'nascent'          // 5-9
  | 'emerging'         // 10-19
  | 'established'      // 20-24
  | 'mature'           // 24+

interface PersonalizationState {
  stage: BaselineStage
  humCount: number
  rollingWindowSize: number
  confidenceCap: number
  isBaselineActive: boolean
  baselineReliabilityScore: number   // 0..1
}
```

**WARN if** this type is not in `@hum-ai/shared-types` and exposed from `@hum-ai/personalization-engine`.

---

## 3. User-Specific Fusion Weights

### Requirement

[SOURCE: trisense_architecture] TriSense's Logistic Regression meta-learner learns fusion weights globally from training data. Hum must extend this to per-user weights because:
- Individual users have systematically different hum patterns (pitch register, energy range, vibrato presence)
- A weight learned on the population may over-weight a feature that is not informative for a specific user
- DVDSA [SOURCE: longitudinal_voice_treatment_response_source] demonstrates that intra-patient comparison outperforms group-level analysis

### Required User-Specific Fusion Weight Architecture

```typescript
interface UserFusionProfile {
  userId: string                              // local device ID, never PII-resolved
  humCount: number
  featureReliabilityWeights: Record<FeatureName, number>   // per-feature weight
  dimensionWeights: {                         // relative importance per dimension
    energy: number
    stability: number
    clarity: number
    smoothness: number
    continuity: number
    control: number
  }
  fusionMetaWeights: {                        // if future multi-expert
    humAudio: number
    journal: number     // TER if available
  }
  updatedAt: number                           // epoch ms, local only
}
```

**Phase 1:** User fusion weights are derived from baseline reliability (confidence cap schedule) — simpler but tracked.
**Phase 2:** Weights adapt from explicit user feedback on read accuracy ("Was this read accurate? Yes/No").
**Phase 3:** Full Bayesian update from longitudinal patterns.

**FAIL if** the personalization engine stores no per-user weight state and the confidence cap is the only personalization mechanism.

---

## 4. Recovery Signatures

### Evidence

[SOURCE: longitudinal_voice_treatment_response_source] Kim et al. 2026 defines recovery as ≥50% reduction in CES-DC depressive symptoms. In the voice domain, the primary acoustic marker of recovery was **F0 change** (the only feature surviving Holm-Bonferroni correction). Deeper patterns required WavLM (F1 70.58% DVDSA) to detect.

### Required Recovery Signature Contract

A recovery signature is a **within-user longitudinal pattern** consistent with the DVDSA "recovery" class:

```typescript
interface RecoverySignature {
  signalType: 'recovery_trajectory'
  evidenceFeatures: FeatureName[]   // which features drove the signal (primarily F0/pitchHz)
  trajectoryDirection: 'converging_to_prior_stable' | 'exceeding_prior_stable'
  windowHums: number                // how many hums used in pattern
  confidence: number                // capped at 88% (relapse signals can never exceed established cap)
  note: string                      // non-clinical copy: "Your hum patterns have been more stable recently"
}
```

**WARN:** Recovery signatures must trigger **positive, non-clinical copy** only. They must not say "You are recovering from depression."

---

## 5. High-Risk Signatures and Relapse Drift

### Evidence

[SOURCE: longitudinal_voice_treatment_response_source] DVDSA worsening class: intra-patient F-scores 70.58% on 3-class task. WavLM detected worsening patterns that classical ML missed. The individual-level acoustic marker was F0.

[SOURCE: clinical_voice_biomarker_review] Depressive states associated with: reduced vocal intensity, slower speech tempo, increased acoustic perturbations (jitter, shimmer, HNR degradation).

### Required High-Risk Signature Contract

A high-risk signature / relapse drift signal is:

```typescript
interface RelapseDriftSignal {
  signalType: 'relapse_drift'
  driftDirection: 'worsening' | 'diverging_from_stable'
  evidenceFeatures: FeatureName[]   // primaryally F0/pitchHz, energy, stability
  driftWindowHums: number
  driftMagnitude: number            // zDelta magnitude vs prior stable period
  confidence: number                // HARD CAPPED at 88% regardless of baseline maturity
  triggerThreshold: {
    consecutiveWorsening: number    // e.g., 5 consecutive hums below stable band
    zDeltaThreshold: number         // e.g., |zDelta| > 1.8 for 3+ features
  }
  userAction: 'monitoring_prompt' | 'check_in_prompt' | null
  note: string                      // non-clinical copy: "Your patterns have shifted outside your usual range"
}
```

### Relapse Drift Rules

1. A single hum MUST NOT trigger a relapse drift signal.
2. Minimum **3 consecutive hums** showing drift before a signal is raised.
3. Signal confidence is HARD CAPPED at 88%.
4. User-facing copy must use approved safety language (see SAFETY_PRIVACY_CLAIMS_AGENT_REVIEW.md).
5. No signal is emitted if baseline is in `cold_start` or `early` stage.
6. If relapse drift is detected, the system suggests checking in — never tells the user they are relapsing.

**FAIL if** any relapse drift signal bypasses the 88% confidence cap, is emitted from cold-start baseline, or uses clinical language.

---

## 6. Within-User Comparison vs Population Norms

### Core Design Principle

[SOURCE: hum_spec] Explicitly: "within-user comparison over population norms." The hum spec is clear that population-level inference is not the goal.

[SOURCE: longitudinal_voice_treatment_response_source] DVDSA directly confirms this: the within-patient design outperforms cross-sectional group analysis.

### Requirement

The personalization engine must enforce:
- No comparison against population distributions as primary output
- Population data only used as a prior for feature scaling (epsilon values, range normalization)
- All user-facing outputs are framed as "compared to your usual pattern" not "compared to most people"

**FAIL if** any user-facing output uses population percentile language (e.g., "your energy is in the top 30% of users").

---

## 7. Paired-Sample Comparison

[SOURCE: longitudinal_voice_treatment_response_source] DVDSA's key insight is **paired-sample comparison**: pre-treatment vs post-treatment voice. Hum generalizes this to **rolling paired comparison**: current hum vs stable-baseline window.

The personalization engine must maintain:
- A **stable reference window** (the most recent 24-hum baseline)
- A **pre-event snapshot** (optional: user-set markers for "I started medication / therapy / major life event")
- A **rolling delta** computed between current hum and both windows

---

## 8. Personalization Agent Summary

| Check | Status | Notes |
|---|---|---|
| Rolling personal baseline | PASS | Well-specified in hum_spec |
| Calibration ladder stages | WARN | Not yet a named typed enum in shared-types |
| Confidence cap schedule | PASS | Documented: 72/76/82/88/90-92% |
| User-specific fusion weights | FAIL | No per-user weight contract exists |
| Recovery signatures | WARN | Not yet contracted in relapse engine |
| High-risk / relapse drift signals | WARN | Not yet contracted with min-hum rules |
| Relapse confidence cap (88% hard cap) | FAIL | Not explicitly enforced in any contract |
| Within-user vs population norm | PASS | Explicit in hum_spec |
| Paired-sample comparison | WARN | DVDSA-inspired design not yet in architecture doc |
| Baseline drift documentation | WARN | 24-hum recency bias not documented |

---

## Personalization Agent Top 3 Findings

1. **No per-user fusion weight contract exists.** The confidence cap schedule is a coarse personalization mechanism, but user-specific feature weights are critical for making the affect model reliable per individual. The DVDSA paper proves that intra-patient comparison dramatically outperforms group-level analysis. Without per-user weights, Hum is still a population-norm system in a within-user costume.

2. **Relapse drift confidence cap is not explicitly enforced in any contract.** The 88% hard cap for relapse signals is the most safety-critical personalization rule. It must be a named constant in `@hum-ai/shared-types` and enforced as a unit-tested invariant in `@hum-ai/relapse-engine`. Without this, a high-baseline-maturity user could receive an 92% confident "relapse signal" — which is a de-facto clinical claim.

3. **The calibration ladder is implicit, not typed.** The hum spec documents confidence caps, but no shared-types contract exposes `BaselineStage` as a first-class enum. Downstream packages (safety-language, quality-gate, fusion-engine) all need to branch on calibration stage. Without a typed enum, each package will independently re-derive the same breakpoints with the risk of divergence.
