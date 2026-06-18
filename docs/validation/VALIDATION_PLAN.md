# Validation Plan

Hum is a **non-clinical, heuristic, not-yet-validated** affective-modeling platform built on a
standardized 12-second hum. This document states *how* Hum would be validated, *what is already
exercised in code*, and — explicitly — *what is not yet validated*. Nothing here is a clinical
claim. See [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) for the claim-by-claim ladder and
[research/evaluation](../../research/evaluation/README.md) for the protocol stubs this plan summarizes.

## 1. Validation philosophy

Hum is validated on **trustworthiness of the read**, not on a single headline accuracy number.

| Principle | What it means | Where it lives |
| --- | --- | --- |
| **Calibration over raw accuracy** | A reported confidence must mean what it says (a "70%" should be right ~70% of the time). Headline accuracy on a fixed test set is secondary. | `ConfidenceModelV1`, `ConfidenceReport`, `ConfidenceCaps` |
| **Abstention as a first-class outcome** | When capture is poor, the domain is wrong, or evidence is out-of-distribution, Hum must say "I can't read this," not guess. | `ABSTAIN_REASONS`, `FusionEngine.fuse`, `neutralInference` |
| **Domain robustness** | Speech, music, and silence must not produce a confident hum-affect read; public-dataset priors are down-weighted by domain gap. | `HeuristicDomainClassifier`, `HumDomainAdapter`, `domainGapPenalty` |
| **Within-user comparison** | Recovery/worsening is a *paired, intra-user* judgement against a personal baseline, never a population-level classification [longitudinal_voice_treatment_response_source]. | `assessRelapse`, `zDeltasAgainstBaseline`, `stagePolicy` |

The architecture spine is expert-based **late fusion** [trisense_architecture]; the affect contract is
**multi-head dimensional + categorical** with explicit abstention because dimensional valence–arousal
is under-explored in the SER literature [ser_mental_health_review].

## 2. Test layers already in code (10 areas) — what they prove vs. don't

Run with `npm test` (`node --import tsx --test`). Each area is a unit/contract test; **none is an
empirical evaluation on human hum data.**

| # | Test area | Proves | Does **not** prove |
| --- | --- | --- | --- |
| 1 | `shared-types/numeric` | `clamp`/`clamp01`/`median`/`percentile`/`normalize` are numerically correct (incl. NaN handling). | That robust stats track real affect. |
| 2 | `shared-types/privacy` | `assertNoRawAudioFields`/`findRawAudioFields` block exact + substring raw-audio fields, nested; consent defaults to local-only. | Field list is exhaustive against all future schemas. |
| 3 | `affect-model-contracts/contracts` | All 22 heads exist (`ALL_AFFECT_HEADS`); `RISK_MARKER_HEADS` flagged; `neutralInference` abstains & is centered. | That heads are *separable* in real signal. |
| 4 | `dataset-registry/rules` | 7 entries pass `assertValidRegistry`; `DOMAIN_FORBIDDEN_USES` enforced (music ≠ diagnosis; clinical-speech ≠ hum truth; only `native_hum` → personalization/relapse). | That registered datasets transfer to hums. |
| 5 | `audio-features/extract` | `rms`/`peakAmplitude`/`silenceRatio`/`zeroCrossingRate` math; `NotImplementedExtractor` rejects rather than faking features. | The full `AcousticFeatures` dictionary is extractable on-device. |
| 6 | `quality-gate/gate` | `evaluateQuality` decisions (`clean`/`borderline`/`rejected`, capture quality, `baselineEligible`) and `CAPTURE_QUALITY_CONFIDENCE_CAP` on synthetic `CaptureMetrics` [hum_spec]. | Thresholds are right for real-world mic/room variation. |
| 7 | `domain-classifier/domain` | Sustained narrow-range → `hum`; silence/broadband → not hum; `adaptPrior` penalty `native_hum > singing > clinical_speech > music`; mismatch lowers `domainMatch`. | Classifier accuracy on real diverse audio. |
| 8 | `expert-{ser,fer,ter}` | 6 audio experts; outputs normalize to 1 and stay **low self-confidence** (untrained stubs); silent/empty → missing modality; clinical expert most off-domain. | Any expert is predictive — all are stubs/heuristics. |
| 9 | `fusion-engine/{confidence,fuse}` | Confidence never exceeds the applied cap; first-hum 0.72 holds under strong evidence; `combineCaps` picks strictest; off-domain experts down-weighted; dimensional output ∈ [-1,1]; all-missing → abstain. | Calibration on real data (caps are *ceilings*, not calibration). |
| 10 | `personalization` / `relapse` / `intervention` / `safety` | 5-stage ladder with monotonic caps; baseline at 5 / relapse model at 20; robust baseline ignores outliers; `assessRelapse` → `uncertain` with no/conflicting references; abstain → `none` intervention; `validateUserFacingText` flags forbidden phrases. | That stages, drift thresholds, and copy generalize to users. |

**Summary:** the suite proves the *contracts, invariants, and guardrails* hold (privacy, caps,
abstention, domain down-weighting, safety copy). It proves **nothing** about predictive validity on
real hums — every expert is an untrained heuristic stub and every threshold is a design prior.

## 3. Staged study plan

Each stage gates the next. No stage has been run in this pass.

**(a) Capture & feature reliability across devices.** Record the same controlled hums across phones,
laptops, and headsets; compute test–retest reliability (ICC) of each `AcousticFeatures` field and
agreement of `evaluateQuality` decisions. Confirm `clippedFrameRatio`/`silenceRatio`/`pitchCoverage`
gates behave consistently and that `baselineRmsRatio` normalizes device gain [hum_spec].

**(b) Confidence calibration & cap verification.** Build **reliability diagrams** and compute
**Expected Calibration Error (ECE)** per confidence bin and per `AffectStateHead`. Verify caps are
*never* exceeded in production traces: first-hum ≤ 72%, pre-baseline ≤ 76%, then 82/88/90–92% by
stage [hum_spec], and that `combineCaps` applies the strictest of stage + capture caps. Calibration —
not the cap itself — is the success criterion.

**(c) Abstention precision/recall.** Curate adversarial inputs: poor-capture, domain-mismatch
(speech/music/silence), and out-of-distribution. Measure abstain precision/recall against
`ABSTAIN_REASONS` (`poor_capture_quality`, `domain_mismatch`, `out_of_distribution`,
`insufficient_baseline`, `low_margin`, `modality_conflict`, `first_hum`). Target: high recall on
genuinely unreadable input with few false abstentions on clean hums.

**(d) Within-user DVDSA-style recovery/worsening.** Following the paired pre/post design of
[longitudinal_voice_treatment_response_source], collect longitudinal hums with consented self-report
anchors and evaluate `assessRelapse` against the four reference kinds (`previous_stable`,
`previous_high_risk`, `baseline_7d`, `baseline_30d`). Report per-user agreement on
`recovery | stable | worsening | relapse_drift | uncertain`, mapped to DVDSA `recovery/unchanged/worsening`.
Evaluate **within-user**, not group accuracy; expect F0-family features to carry most signal per that source.

**(e) Construct / convergent checks (research consent only).** Under explicit research consent only
(`research_audio_upload` / `clinical_label_capture` are off by default), correlate Hum's
dimensional/marker outputs against self-report instruments (PHQ-9, GAD-7, CES-DC) for **convergent
validity** — *correlation, not classification*. These are markers and screening signals, never labels.

**(f) Privacy invariant fuzzing.** Property-test/fuzz randomized sync payloads; `assertNoRawAudioFields`
must throw on any raw-audio-like field (`audio`, `audioBlob`, `rawAudio`, `recording`, `waveformRaw`,
`microphoneData`, substring variants) at any nesting depth. Confirm `derived_feature_sync` carries only
derived fields and that default consent is local-only [hum_spec].

**(g) Safety-copy checks.** Run `validateUserFacingText` over the entire generated-copy corpus in CI;
verify `userFacingLabel` translations are themselves safe and `INTERNAL_TO_USER_FACING` never leaks
internal-only labels (`abstain_reason`, `relapse_drift_score`). Any `FORBIDDEN_PHRASES` hit fails the build.

## 4. What would be required before ANY clinical claim

Hum makes **no** clinical claim today, and the literature shows why the bar is high: voice→depression
performance is reported at AUC 0.71–0.93 / accuracy 78–96.5% **but 6/12 studies carry high
methodological-bias risk and generalizability is unproven** [clinical_voice_biomarker_review], and SER
mental-health work is heterogeneous with dimensional VA under-explored [ser_mental_health_review].
Before any clinical claim, Hum would require, at minimum:

- Prospective, pre-registered studies on **native hum data** (not transferred public priors), with
  representative demographics and devices.
- External validation on held-out cohorts and sites; QUADAS-2-style risk-of-bias control.
- Demonstrated calibration *and* abstention quality on real data, plus clinician-collaborative review.
- Regulatory pathway assessment. Until all of the above, Hum stays a **non-clinical reflective tool**.

## 5. Current status

- **Non-clinical, heuristic, not clinically validated.** All experts are untrained stubs; all
  thresholds are design priors from [hum_spec]. No empirical evaluation has been run.
- Outputs are **risk markers / screening signals / early-warning patterns**, never diagnoses.
- **MELD and clinical-review numbers are NOT Hum metrics.** The TriSense MELD stream/fusion accuracies
  (18.4 / 38.0 / 54.0 → 66.0%) are architecture-reference figures on TV dialogue [trisense_architecture];
  the AUC/accuracy ranges in [clinical_voice_biomarker_review] describe other cohorts. Neither has ever
  been measured on a hum and neither may be presented as Hum's performance.

Related: [CLAIMS_LADDER](../claims/CLAIMS_LADDER.md) · [research/evaluation](../../research/evaluation/README.md)
