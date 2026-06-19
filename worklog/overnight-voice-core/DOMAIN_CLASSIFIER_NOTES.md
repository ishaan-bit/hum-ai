# Domain-Classifier Notes

## What changed

`HeuristicDomainClassifier` was upgraded from v1 hard-threshold booleans to **graded
evidence terms** that are less brittle on real, continuous extractor output, plus a
**margin-aware confidence**. It remains a transparent, rule-based **hum-vs-not-hum
domain GUARD** — not a trained model, not fine-grained audio-event recognition. The
`DomainClassifier` interface is unchanged, so a trained classifier still slots in
behind it later.

### Graded terms (replacing v1 booleans)

- `voicedness = clamp01((pitchCoverage − 0.35) / 0.5)`
- `narrowness = clamp01((6 − pitchRangeSemitones) / 6)` (0 when range unknown)
- `smoothness`, `musicality`, `continuity` from the corresponding features
- `sustainment = voicedness × clamp01(longestStableSegmentSec / 3)` — gated by voicing
  so a non-voiced capture cannot accrue "sustained tone" credit
- `breakiness` from `breakCount` + `microBreakRatio` (speech evidence)

Scores: `hum` (voiced + narrow + smooth + sustained + low-musicality + continuous),
`singing` (voiced + musical + wide), `speech` (bright/ZCR + flux + breaks), `music`
(broadband + flux + weak voicing), `vocal_burst` (short + low continuity),
`noisy_unknown` (poor-SNR catch-all). Softmax-normalized as before.

### Confidence

`confidence = clamp01(topProb × (0.55 + 0.45 × margin) × snrTemper)` where
`margin = (p1 − p2) / p1` and `snrTemper = 1` if SNR > 3 else 0.7. A dominant,
well-separated class is trusted; a near-tie (ambiguous capture) honestly reports low
confidence. This is strictly more honest than v1's top-probability-only confidence.

## Behaviour on real extracted synthetic signals

| Signal | predicted | confidence | note |
| --- | --- | --- | --- |
| clean hum | **hum** | 0.62 | correct |
| silence | **silence** | 0.90 | short-circuit |
| clipped hum | **hum** | 0.62 | clipping is a *quality* issue, not a domain — correct |
| interrupted hum | hum | 0.18 | low confidence (honest) |
| noisy hum | **hum** | 0.53 | still voiced |
| speech-like | **singing** | 0.21 | NOT hum (see limitation) |
| music-like | **music** | 0.11 | correct (after voicing-weighted musicality fix) |

## Known, documented limitation

Distinguishing **speech from singing** heuristically is genuinely hard (both are
voiced, both can be wide-range). The classifier reliably separates **hum from
not-hum**; within not-hum, speech and singing may be confused. That is acceptable for
a domain guard — both are off-domain and are down-weighted by `HumDomainAdapter`
(`scoreCapture`). The crude synthetic speech reads as "singing"; the test asserts only
`!== "hum"` and documents this honestly. No over-fitting of the classifier to the
synthetic signals was done.

## Tests added

`packages/domain-classifier/test/domain-real.test.ts` — extractor-driven: clean→hum,
silence→silence, clipped handled (not silence/invalid), interrupted handled with lower
confidence than clean, speech-like NOT hum, music-like NOT hum, ambiguous captures have
lower confidence than clean (honest confidence), and `HumDomainAdapter.scoreCapture`
penalises a real music capture more than a real hum. The existing hand-built
`domain.test.ts` is unchanged and still passes (the musicality fix lives in the
extractor, not the classifier, so those fixtures are unaffected).
