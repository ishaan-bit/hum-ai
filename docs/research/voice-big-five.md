# Voice-Inferred Big Five (OCEAN) from Hums — Research Basis

> **Role.** Cited basis for `@hum-ai/personality-signature` — the tentative, within-user,
> EXPLORATORY OCEAN "hum signature" that foregrounds **Openness** and **Conscientiousness**.
> Provenance: compiled from a verified multi-source literature sweep (84 raw findings across 10
> search angles → 16 adversarially fact-checked → 14 defensible). Every feature→trait mapping in
> `packages/personality-signature/src/index.ts` traces to a numbered reference below.
>
> **Governance.** This is paralinguistic *trait-impression* evidence, not clinical evidence. It
> grounds a reflective mirror, never a diagnosis or a validated test (ADR-0004, ADR-0005,
> CLAIMS_LADDER). The honest ceiling (below) is load-bearing, not boilerplate.

## 1. Evidence summary

Voice/acoustic-prosodic features carry a **real but modest, above-chance** signal for the Big
Five, and the recoverable signal is uneven across traits. The most consistent caveat across the
corpus is that most positive results measure **perceived (observer-attributed) personality** —
what listeners hear in a stranger's voice — which is documented to diverge from the speaker's
**self-reported** trait; on the one corpus where self-report was tested directly (Mairesse et al.
2007, EAR), no self-report acoustic model beat baseline, and the reliable results were all for
observer ratings. Where self-report *is* predicted at scale (Lukac 2024, *Scientific
Reports*, n=2,045 natural speech), correlations are modest (predicted-vs-self r ≈ 0.26–0.39) and —
critically for a wordless instrument — **Openness and Conscientiousness are the two LEAST
acoustically-driven traits** (acoustic embeddings contributed only ~19% and ~16% of model
importance; linguistic/lexical content did ~81–84% of the work). On *perceived*-personality
challenge corpora the picture inverts for one of them: **Conscientiousness** and Extraversion are
the *most* robustly classifiable from acoustics alone (≈79–80% unweighted-average recall for
Conscientiousness vs 50% chance on INTERSPEECH-2012; ≈72.5% on SSPNet), while **Openness** is
consistently among the **hardest** (≈59–64%). Binary accuracies cluster at 60–80% (chance 50%), so
every claim is "above chance," not "strong." Most challenge results are also **black-box**
(6,000+-feature → label), so signed per-feature directions are largely borrowed from the older
human-sciences literature, not freshly established. **Net: an acoustic-only hum instrument should
expect weak, within-user signal for O and C, foreground tendency not accuracy, and never claim
test-like validity.**

**Why foreground O and C anyway?** Two reasons that survive the caveats: (a) Conscientiousness has
the *strongest* acoustic basis of any OCEAN trait on perceived-personality corpora, and its cue
(vocal control/evenness) transfers cleanly to a sustained hum; (b) Openness's *one* recurring
acoustic cue — pitch-range / melodic variation — is precisely the dimension a hum expresses most
directly (how much the note wanders). They are the two OCEAN axes a wordless, sustained vocalisation
can speak to at all, so the read leads with them and frames them as tendencies, never scores. (For
broader surveys of the field, see Schuller et al. 2015 [4] and Vinciarelli & Mohammadi 2014 [12].)

## 2. Openness — acoustic correlates

Honest framing: Openness is the *weakest* trait for acoustics; the one prosodic cue that recurs and
transfers to a hum is **pitch-range / F0 variability**.

- **Wider F0 (pitch) range / greater pitch variability → higher (perceived) openness.** Perception
  studies find a narrower F0 range rated lower on a blended extraversion+openness component (Kim et
  al. 2025 [6]) and a wider F0 range rated higher on perceived openness in both sexes (Song, Kim &
  Park 2023 [7]). Effect small-to-moderate, perception-based. **→ Transfers to a HUM** (pitch range
  is directly measurable in a sustained tone).
- **Full prosodic feature set (pitch mean/extrema/SD + intensity + speech rate) = best single model
  of observer-rated openness** — 64.6% binary accuracy vs ~48% baseline, beating the all-features
  model (Mairesse et al. 2007 [1]). Modest, single-classifier, observer-perception. The
  *melodic-variation* portion transfers to a hum; **speech rate / voiced-time do not** (no words in
  a hum).
- **Lower formant dispersion → higher perceived openness (female speakers only).** Small,
  female-only, uncorrected, perception-based (Song et al. 2023 [7], β ≈ −0.089). **Partially
  transfers** (formant spacing exists in a hum) but weak and sex-specific — not a primary cue.
- **Linguistic/lexical content (richer vocabulary, abstraction) dominates real openness prediction
  (~81% of importance).** **Speech-only — does NOT transfer to a wordless hum** (Lukac 2024
  [5]). This is the main reason a hum can only ever give a *tentative* openness read.

Hum-transferable openness cues: **pitch range, melodic/contour variation, vibrato/pitch-variability.**
Speech-only (excluded): lexical content, speech rate, voiced-time.

## 3. Conscientiousness — acoustic correlates

Honest framing: Conscientiousness is among the *better-classified* traits on perceived-personality
corpora, but on self-report it is again language-driven; the transferable acoustic story is
**vocal control / evenness / low perturbation**.

- **Conscientiousness is the most robustly classifiable OCEAN trait from large acoustic feature sets
  (perceived personality).** ≈79–80% UA-recall on INTERSPEECH-2012 (openSMILE energy/spectral/voicing
  LLDs, RF/SVM; Schuller et al. 2012 [3]) and ≈72.5% binary on SSPNet (prosody + voice-quality;
  Mohammadi & Vinciarelli 2012 [8]; voice-quality + intonation mapping in Mohammadi et al. 2012,
  ACM MM [9]). Black-box, perceived not self-reported, single-corpus.
  **→ Transfers** (these are timbre/voicing statistics present in a hum).
- **Lower shimmer (less cycle-to-cycle amplitude variation) → higher self-rated conscientiousness.**
  Strong but fragile: r = −0.713 only within an n≈12 functional-dysphonia subgroup, null in the full
  sample (Saeedi et al. 2023 [11]). **→ Transfers** (shimmer is measurable on sustained phonation —
  this study used a sustained vowel) but treat as exploratory.
- **Higher/more-modal voice (CPP/HNR) → higher perceived conscientiousness (females); faster
  articulation rate → higher perceived conscientiousness (males).** Marginal, sex-specific (Song et
  al. 2023 [7]). The **voice-quality (modal/even tone) part transfers**; **articulation/speech rate
  is speech-only**.
- **Faster speech rate → higher perceived competence** (classic; Smith et al. 1975 via Mairesse [2];
  Ray 1986 via Mohammadi [10]). **Speech-only — does NOT transfer to a hum**, and is a
  perception/impression effect, not proof conscientious people speak faster.
- **Real (self-reported) conscientiousness is ~84% linguistic / ~16% acoustic** (Lukac 2024
  [5]). **The dominant cue is speech-only.**

Hum-transferable conscientiousness cues: **low jitter/shimmer, steady amplitude, steady pitch,
even/modal tone, overall vocal control.** Speech-only (excluded): speech/articulation rate, word
precision.

## 4. Recommended hum feature → trait mapping

Weights are *relative within-trait* suggestions, grounded in §2–§3. "Direction" = sign of the
contribution (↑ feature pushes trait toward the named pole). These are **directional within-user
heuristics**, not calibrated regression weights — which is why the read stays "tentative."

### Openness (high pole = "exploratory")

| Hum feature | Weight | Direction | Grounding |
|---|---|---|---|
| `pitchRangeSemitones` | **high** | ↑ range → ↑ openness | Wider F0 range → higher perceived openness (Kim 2025 [6]; Song 2023 [7]); prosodic set best for openness (Mairesse 2007 [1]) |
| `musicalityScore` | **med** | ↑ variation → ↑ openness | Melodic variation is the hum-surviving part of the "full prosodic set" cue (Mairesse 2007 [1]) |
| `vibratoRegularity` | **low** | ↑ movement → ↑ openness | Pitch variability is the most repeated openness correlate; weak (Song 2023 [7]) |

### Conscientiousness (high pole = "deliberate")

| Hum feature | Weight | Direction | Grounding |
|---|---|---|---|
| `controlledExpressionScore` | **high** | ↑ control → ↑ conscientiousness | Conscientiousness = control/evenness; best-classified trait from voice-quality+prosody (Schuller 2012 [3]; Mohammadi 2012 [8]) |
| `amplitudeStability` | **high** | ↑ stability → ↑ conscientiousness | Steady intensity / low amplitude variation (Saeedi 2023 [11]; Song modal-voice [7]) |
| `pitchStability` | **med** | ↑ stability → ↑ conscientiousness | Steady, well-held tone (voice-quality cluster) [3][8] |
| `residualInstabilityScore` | **low–med** | ↓ instability → ↑ conscientiousness | Composite micro-instability ↔ control/evenness [3][8] |
| `shimmerProxy` | **low** | ↓ shimmer → ↑ conscientiousness | Lower shimmer → higher self-rated conscientiousness (Saeedi 2023 [11], fragile/clinical — exploratory) |

### Features kept OUT of O/C (to avoid importing confounds)

- `meanRms`, `peakAmplitude`, `activeFrameRatio` → **Extraversion** (loudness/energy/voiced-activity
  is the robust extraversion cue), not O/C. Putting them in O or C would import the trait
  literature's strongest *confound*.
- `spectralCentroidHz` already feeds extraversion/agreeableness — not double-counted into O/C
  (its openness/formant effect is direction-inconsistent and sex-specific [7]).

The current `packages/personality-signature/src/index.ts` wiring (openness =
pitchRange/musicality/vibrato; conscientiousness = controlledExpression / amplitudeStability /
pitchStability / residualInstability / shimmer) implements this mapping.

## 5. Limitations & honest framing

- **Perceived ≠ self-reported.** Most supporting results predict the personality listeners
  *attribute* to a voice, not the speaker's true trait — and self-report was essentially
  unrecognizable from acoustics in the one corpus that tested it (Mairesse 2007 [1]). A hum
  signature can at most mirror "how this voice tends to behave," never diagnose who someone is.
- **O and C are the *least* acoustic traits for self-report.** The best-powered self-report study
  (Lukac 2024 [5]) shows ~81–84% of the O/C signal is *linguistic content* — exactly the
  channel a wordless hum throws away. The two foregrounded traits are precisely the two an
  acoustic-only tool reads most weakly on *self-report*; we foreground them because they are the two
  OCEAN axes a hum can speak to *at all*, and because C is the strongest trait on *perceived*
  corpora. This is stated, not hidden.
- **Hums ≠ speech.** No lexical, disfluency, speech-rate, or articulation cues exist in a sustained
  vocalisation, and **no retrievable study maps humming/singing acoustics to Big Five**. Every
  mapping here is a *transfer* of a speech-prosody cue to a hum — an untested extrapolation. The
  strongest speech cues for C (speech rate, word precision) literally cannot be computed.
- **Effects are small.** Correlations r ≈ 0.2–0.4; binary accuracy 60–80% vs 50% chance; several key
  results are single-corpus, single-language (Korean/French/UK-English), small-n (n=12–47 for the
  clinical/perception studies), sex-specific, and uncorrected for multiple comparisons. None
  replicate cross-corpus for O/C directions.
- **Within-user, not between-user.** The defensible use is **longitudinal, within-person tendency**
  (this person's steady vocal habits relative to their own baseline and the hum protocol), where
  individual mic/voice confounds are held roughly constant — never a between-person verdict or
  ranking. Ranges in the product are protocol defaults, not population norms.
- **Tentative by construction.** Abstain until enough hums exist, cap confidence at "tentative,"
  carry no clinical label and no raw numbers in user copy, and frame as a *mirror of vocal habits,
  not a personality test.* This is honest given the ceiling above.

## 6. References

1. Mairesse, F., Walker, M. A., Mehl, M. R., & Moore, R. K. (2007). *Using Linguistic Cues for the Automatic Recognition of Personality in Conversation and Text.* Journal of Artificial Intelligence Research, 30, 457–500. https://users.soe.ucsc.edu/~maw/papers/personality_jair07.pdf
2. Smith, B. L., Brown, B. L., Strong, W. J., & Rencher, A. C. (1975), as cited in Mairesse et al. (2007) — speech rate ↔ perceived competence.
3. Schuller, B., et al. (2012). *The INTERSPEECH 2012 Speaker Trait Challenge.* Proc. Interspeech 2012, 254–257. https://www.fon.hum.uva.nl/rob/Publications/IS2012-Speaker-Trait-Challenge.pdf
4. Schuller, B., Steidl, S., Batliner, A., et al. (2015). *A Survey on Perceived Speaker Traits: Personality, Likability, Pathology, and the First Challenge.* Computer Speech & Language. https://mediatum.ub.tum.de/doc/1238147/112990.pdf
5. Lukac, M. (2024). *Speech-based personality prediction using deep learning with acoustic and linguistic embeddings.* Scientific Reports, 14, Article 30060. https://www.nature.com/articles/s41598-024-81047-0
6. Kim, M., Park, J., Jeong, M., & Song, J. (2025). *What Determines Personality Impressions of Synthetic and Natural Voices? The Effects of Voice Quality and Intonation.* Language and Speech. https://journals.sagepub.com/doi/10.1177/00238309251389567
7. Song, J., Kim, M., & Park, J. (2023). *Acoustic correlates of perceived personality from Korean utterances in a formal communicative setting.* PLoS ONE, 18(10), e0293222. https://pmc.ncbi.nlm.nih.gov/articles/PMC10617731/
8. Mohammadi, G., & Vinciarelli, A. (2012). *Automatic Personality Perception: Prediction of Trait Attribution Based on Prosodic Features.* IEEE Transactions on Affective Computing, 3(3), 273–284. https://infoscience.epfl.ch/record/192687
9. Mohammadi, G., Filippone, M., Origlia, A., & Vinciarelli, A. (2012). *From Speech to Personality: Mapping Voice Quality and Intonation into Personality Differences.* Proc. ACM Multimedia '12, Nara. https://www.dcs.gla.ac.uk/~vincia/papers/perso-MM-2012.pdf
10. Ray, G. B. (1986). *Vocally Cued Personality Prototypes.* Communication Monographs, 53(3), 266–276 — cited in Mohammadi et al. (2012).
11. Saeedi, S., Dabirmoghaddam, P., Soleimani, M., & Aghajanzadeh, M. (2023). *Relationship among five-factor personality traits and psychological distress with acoustic analysis.* Laryngoscope Investigative Otolaryngology, 8(4), 996–1006. https://pmc.ncbi.nlm.nih.gov/articles/PMC10446268/
12. Vinciarelli, A., & Mohammadi, G. (2014). *A Survey of Personality Computing.* IEEE Transactions on Affective Computing, 5(3), 273–291.
