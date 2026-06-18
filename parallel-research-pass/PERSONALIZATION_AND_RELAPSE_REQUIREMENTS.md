# Personalization and Relapse Requirements

**Sources:**  
- `longitudinal_voice_treatment_response_source` — Kim et al., Communications Medicine (2026)  
- `hum_spec` — Hum Technical Specification  
- `clinical_voice_biomarker_review` — Briganti & Lechien (2025)  
- `ser_mental_health_review` — Jordan et al. (2025)

---

## 1. Why within-person comparison is required

Briganti & Lechien (2025):
> "Longitudinal studies demonstrated that voice features change significantly over time in the same individual, with individual-specific models showing stronger predictive correlations compared with population-level approaches."

Jordan et al. (2025):
> "Future work should prioritize within-subject longitudinal tracking paradigms."

Kim et al. (2026):
> Paired pre/post design (DVDSA) comparing the SAME patient's voice before and after treatment. Only within-person change provides clinically meaningful signal. Population-level classification is insufficient.

**Hum requirement:** The primary inference engine is within-user, not population-comparative. A hum that is clinically "neutral" for one person may be elevated for another.

---

## 2. DVDSA study facts (Kim et al. 2026) — verbatim extraction

| Fact | Value |
|------|-------|
| n | 48 adolescent MDD patients |
| Gender | 15M / 33F |
| Mean age | 15.5 ± 2.7 years |
| Voice task | Stroop color-naming (read aloud) |
| Recording | 44.1 kHz, stereo |
| Pre→post interval | mean 107.15 days (SD 127.95) |
| Only significant feature (Holm-Bonferroni) | F0 (p=0.0016) |
| DVDSA categories (3-class) | recovery / worsening / unchanged |
| WavLM binary F1 | 78.05% |
| WavLM 3-class F1 | 70.58% |
| HuBERT binary F1 | 70.31% |
| Wav2Vec 2.0 binary F1 | 66.63% |
| Best ML (non-DL) | RF with log Fbank, F1 65.83% |

**Critical domain gap note:** The DVDSA task is Stroop color-naming (read-aloud speech), NOT humming. Performance numbers are not directly transferable to Hum.

---

## 3. DVDSA → Hum adaptation design

| DVDSA element | Hum extension | Notes |
|--------------|--------------|-------|
| Pre/post paired comparison | Rolling baseline vs current session | Continuous rather than one-time; baseline updated every session |
| 3-class output: recovery / worsening / unchanged | **5-class Hum output**: significant_improvement / mild_improvement / unchanged / mild_change / significant_change | Finer granularity for trend display; "change" direction inferred from baseline deviation sign |
| 107-day interval | Daily/weekly hums | Much shorter interval; captures micro-trends |
| Clinical population (treated MDD inpatients) | General self-monitoring users | No clinical diagnosis required; user defines their own "baseline" |
| Silence preserved (clinically informative) | Hum captures pauses explicitly as breakCount/pauseCount | Same rationale: don't remove pauses |
| LIME explainability | Future: highlight contributing features in user UI | Transparency layer required before clinical-adjacent claims |

---

## 4. Personalization ladder (from hum_spec)

The spec defines explicit confidence tiers based on how many baseline-eligible hums exist:

| Stage | Hum count | Behavior |
|-------|-----------|----------|
| Population prior | Hum 1 | No personal baseline; population statistics only |
| Early calibration | Hums 2–4 | Collecting baseline; limited personalization |
| Personal baseline active | Hums 5–10 | Median/MAD/IQR baseline active; z-deltas computed |
| Personalized fusion weights | Hums 10–20 | Fusion weights begin adapting per user |
| Relapse modeling active | Hums 20+ | Enough history for trend/relapse detection |

**Confidence caps by ladder stage:**
| Stage | Cap |
|-------|-----|
| Hum 1 (baselineCount = 0) | 72% |
| Hums 2–4 (baselineCount 1–4) | 76% |
| Hums 5–9 | 82% |
| Hums 10–19 | 88% |
| Hums 20+ | 90–92% |

---

## 5. Baseline statistics model (verbatim from hum_spec)

All computed per feature, over the rolling 24-hum eligibility window:

```
median = percentile(values, 0.50)
MAD = percentile(abs(value - median), 0.50)
IQR = percentile(values, 0.75) - percentile(values, 0.25)
robustStd = MAD * 1.4826
weightedMean = weighted average after outlier adjustment
stdDev = max(weightedStd, robustStd)
zDelta(feature) = (current - baselineMean) / max(stdDev, epsilon(feature))
ratio(feature) = current / baselineMean, when baselineMean > 0

Outlier adjustment:
  Values > 2.5 * max(MAD * 1.4826, 0.02) from median → replaced by median, weight 0.25
  Values > 1.5 * scale from median → weight 0.6
```

This ensures robust statistics (resistant to individual outlier sessions) rather than mean/variance (which are sensitive to extreme values).

---

## 6. Typed model requirements for `@hum-ai/personalization-engine`

```typescript
// Personalization ladder position
type PersonalizationTier = 
  | 'population_prior'     // < 5 eligible hums
  | 'early_calibration'    // 5–9 eligible hums  
  | 'baseline_active'      // 10–19 eligible hums
  | 'personalized_fusion'  // 20+ eligible hums

// Per-feature robust stats
interface FeatureBaselineStats {
  feature: string;
  median: number;
  MAD: number;
  IQR: number;
  robustStd: number;
  weightedMean: number;
  stdDev: number;
  count: number;  // eligible hum count
}

// Per-session z-deltas against baseline
interface SessionDelta {
  feature: string;
  current: number;
  zDelta: number;
  ratio: number | null;  // null when baselineMean = 0
}

// Relapse/trend output (5-class Hum extension of DVDSA 3-class)
type TrendClass =
  | 'significant_improvement'
  | 'mild_improvement'
  | 'unchanged'
  | 'mild_change'
  | 'significant_change'

interface TrendOutput {
  trendClass: TrendClass;
  confidence: number;     // capped per maturity tier
  dominantFeatures: string[];  // which features drove the classification
  tier: PersonalizationTier;
}

// State label output
type StateLabel = 
  | 'energized'
  | 'calm'
  | 'steady'
  | 'low_energy'
  | 'scattered'
  | 'tense'
  | 'close_to_usual_pattern'  // when gap < 0.12 or score < 0.34

interface StateLabelOutput {
  label: StateLabel;
  confidence: number;    // caps applied
  dimensionScores: {
    activation: number;
    stability: number;
    clarity: number;
    smoothness: number;
    continuity: number;
    control: number;
  };
  baselineDistanceScore: number;
}
```

---

## 7. Relapse engine design requirements (`@hum-ai/relapse-engine`)

| Requirement | Rationale |
|-------------|-----------|
| Only activates at tier `personalized_fusion` (20+ hums) | Not enough data for relapse pattern before this point |
| Compares current session against 20+ hum rolling window | DVDSA insight: change detection requires sufficient history |
| Uses WavLM as primary encoder (future) | F1 78.05% binary, 70.58% 3-class in DVDSA; best within-speaker tracker |
| LIME feature attribution layer | Required for explainability before clinical claims |
| 5-class trend output (not 3-class) | Hum extension for finer granularity |
| Trend confidence capped at 90–92% max | Mature cap from hum_spec confidence model |
| "Potential relapse signal" framing, NOT "you are relapsing" | Forbidden clinical language |
| Abstention when data is insufficient | < 20 hums → no relapse signal; return null |
| Device-change flag | If user changes phone, reset baseline confidence for device-sensitive features |

---

## 8. Rationale for individual-specific approach (evidence summary)

1. Kim et al. (2026): Only F0 changed significantly across the group (p=0.0016), but WavLM still achieved 78.05% F1 — because within-person patterns are learnable even when group means don't diverge.
2. Briganti & Lechien (2025): "Individual-specific models showing stronger predictive correlations compared with population-level approaches."
3. Jordan et al. (2025): Within-subject longitudinal tracking explicitly endorsed as the research direction.
4. hum_spec: The entire baseline algorithm is within-user by design.

**Takeaway:** Population-level normative comparisons should be a secondary layer, not primary. The relapse engine must always compare to the user's own prior state.
