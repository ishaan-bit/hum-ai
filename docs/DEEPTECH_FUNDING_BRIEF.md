# Hum AI — Deeptech Diligence Brief

*Investigational within-user emotional-state read and early-warning signals from a short daily hum.*
*Status: research-stage. Not a medical device. Not FDA-cleared. Not clinically validated. No diagnostic claims.*
*Prepared for technical diligence — every strong claim is tagged by maturity (BUILT / INVESTIGATIONAL / ASPIRATIONAL) and cited to a repo path or external source.*

> Generated 2026-06-24 by a multi-agent research workflow (41 findings, 21 adversarially-verified external claims) and grounded in the repo. The within-user risk-marker engine in section 3.6 was implemented in the same session (packages/relapse-engine/src/risk-markers.ts, 12 unit tests; consumer surfacing + copy-safety + render proofs in apps/web). External performance numbers cited below are competitors and prior literature, never Hum AI's own.

---

## 1. Thesis

A 12-second, content-free **hum** is a deliberately impoverished signal — and that is the point. By stripping away words, it removes the language, vocabulary, accent, and code-switching confounds that dominate the speech-biomarker literature, and it removes the word-content privacy surface entirely. On top of that fixed, comparable-across-sessions signal, Hum AI builds a **transparent, on-device, within-user** read of emotional state (valence/arousal on Russell's affective circumplex) and three **consent-gated, non-diagnostic early-warning markers** (depressive-affect, anxiety-tension, relapse-drift) measured against *the user's own baseline*, never a population cutoff.

The strategic wedge is shaped by three external facts that diligence should weigh heavily:

1. **No voice-based mental-health screener has ever obtained FDA authorization.** The category leader, Kintsugi, pursued an FDA De Novo for roughly four years, burned ~$30M, never cleared, shut down in early 2026, and open-sourced its models ([Behavioral Health Business, 2026-02-11](https://bhbusiness.com/2026/02/11/mental-health-voice-biomarker-kintsugi-closes-makes-all-technology-and-research-public/); [Kintsugi open-source blog](https://www.kintsugihealth.com/blog/open-source)).
2. **Every incumbent analyses speech** — content-bearing or "content-independent," but always *spoken* — and processing is predominantly cloud/server-side, producing population-trained, single-shot scores rather than individualized longitudinal baselines.
3. **Humming as a screening biomarker is essentially absent from the peer-reviewed literature.** This is genuine white space — and, honestly, an absence of validation that a skeptical funder must price.

Hum AI's positioning is therefore the *combination* of four properties no single incumbent occupies at once — humming-based / non-linguistic, on-device, per-user longitudinally personalized, and a wellness "mood-mirror" (non-diagnostic) framing — while a separate, structurally firewalled, IRB-pre-registered screening instrument matures behind the consumer product. The novelty is the **stack**, not any one feature.

What is built today is an honest signal-processing and personalization spine plus a complete validation/governance apparatus. What is investigational is the clinical screening head (zero validated performance numbers; pivotal study not yet run). What is aspirational is any validated clinical claim. This brief keeps those three buckets rigorously separate.

---

## 2. The science

### 2.1 Affective circumplex as the read substrate

The dimensional read and all three risk markers are grounded in **Russell's circumplex model of affect**, which places states on a valence × arousal plane: low-valence + low/flat-arousal is the canonical "down/flat/withdrawn" region; negative-valence + high-arousal is the "tense / keyed-up" region. This is explicitly the framing in code (`packages/relapse-engine/src/risk-markers.ts`, header comment lines ~14–21), where "low" always means *low for you*, computed against a personal robust baseline, never a population norm.

### 2.2 What the voice-biomarker literature actually supports

**The replicable signal in depression is timing/prosody, not voice-quality perturbation.** The most consistent associations are reduced speaking/articulation rate, more and longer pauses, reduced loudness, and reduced F0 variability (monotone) — all tracking psychomotor retardation, and all improving with treatment response. Mundt's foundational IVR study (n=35, 6-week treatment) found total pause time r=.29, pause-length variability r=.38, speaking rate r=−.23 vs. HAMD, and treatment responders showed faster speech and fewer pauses ([Mundt et al., PMC3022333](https://pmc.ncbi.nlm.nih.gov/articles/PMC3022333/); [Mundt 2012, Biol Psychiatry, PMID 22541039](https://www.sciencedirect.com/science/article/abs/pii/S0006322312002636)). Source/perturbation features (jitter, shimmer, HNR, MFCCs) carry weaker signal and are exactly the features most sensitive to microphone/codec/SNR artifacts. The canonical taxonomy is [Cummins, Scherer et al., *Speech Communication* 71:10–49 (2015)](https://www.semanticscholar.org/paper/A-review-of-depression-and-suicide-risk-assessment-Cummins-Scherer/7d9f6beb6ed00358124c7784d42e94feaae2339b).

**The strongest single methodological line is MIT Lincoln Laboratory's articulatory-coordination work** (Williamson & Quatieri): eigenvalue spectra of multi-scale cross-channel correlation matrices over formant tracks and delta-MFCCs, modeling depression as reduced motor coordination. Their winning **test-set** scores were RMSE 8.50 / MAE 6.52 (AVEC 2013) and RMSE 8.12 / MAE 6.31 (AVEC 2014), beating the respective challenge baselines (10.75/8.66 in 2013; 9.89/7.89 in 2014); on the AVEC 2013 *development* set with speaker adaptation the combined model reached RMSE 7.42 / MAE 5.75 ([Williamson et al., AVEC 2014 PDF](http://web.mit.edu/dmehta/www/docs/WilliamsonAVEC2014%20Vocal%20and%20facial%20biomarkers%20of%20depression%20based%20on%20motor%20incoordination%20and%20timing.pdf); [MIT News, 2014](https://news.mit.edu/2014/lincoln-laboratory-team-takes-honors-audiovisual-emotion-challenge-workshop-1211)). Notably, the same framework was later extended to TBI, Parkinson's, and COVID — itself a caution about **disorder specificity**.

### 2.3 The replication crisis — stated plainly

Headline performance looks strong (AUC ~0.71–0.93; accuracy 78–96.5%) but is not yet clinically generalizable. The 2025 systematic review (Briganti & Lechien, *J. Voice*; [PubMed 40410060](https://pubmed.ncbi.nlm.nih.gov/40410060/); 12 studies, 16,872 participants) judged **6 of 12 studies at high risk of bias**, primarily patient-selection bias and lack of external validation, concluding that "methodological heterogeneity and generalizability concerns must be addressed before widespread clinical adoption." Realistic population performance sits at the low end: the largest such study (Mazur et al., Kintsugi; [Ann. Fam. Med. 2025, PMC11772039](https://pmc.ncbi.nlm.nih.gov/articles/PMC11772039/); n=14,898) detected moderate-to-severe depression (PHQ-9≥10) at sensitivity 71.3% / specificity 73.5% — and that very study is one of the six flagged as high-bias.

Two independent 2025/26 studies converge on the benchmark problem. A systematic review (Danylenko & Unold, *Applied Sciences* 16(1):422, 2026, [doi:10.3390/app16010422](https://doi.org/10.3390/app16010422)) screened 536 papers → 66 quality-assessed → **only 5 met minimal reproducibility standards**, identifying subject (speaker) leakage as the dominant flaw; with leakage removed, models "performed worse than a simple mean predictor." Separately, Patapati et al. (ICMI '25 Companion, [doi:10.1145/3747327.3763034](https://dl.acm.org/doi/full/10.1145/3747327.3763034)) show models trained on PHQ-8 retain nearly all accuracy when transferred to synthetic GAD-7 labels — i.e., they capture **generic distress, not depression-specific features**. Cross-corpus/cross-lingual transfer collapses *toward* chance (a DAIC-WOZ→MODMA model fell to ~48.7%; [Sun et al., J. Affective Disorders 2025](https://www.sciencedirect.com/science/article/abs/pii/S0165032725011814), cited for the failure baseline), and gender is a documented confound that inflates benchmarks ([Bailey & Plumbley, arXiv:2010.15120](https://arxiv.org/abs/2010.15120)).

### 2.4 The honest status of humming

There are **no validated depression/anxiety screening models built on humming or sustained tones**. The nearest analog, the sustained vowel, generally *underperforms* free speech for depression because it strips out the timing/prosody/coordination features that carry the strongest signal ([sustained vs. continuous phonation, PMC5345563](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5345563/)). Humming appears in a *different* literature — as an intervention (Bhramari pranayama / humming-bee breath raising HRV and vagal tone; [PMC10182780](https://pmc.ncbi.nlm.nih.gov/articles/PMC10182780/)) — not as a diagnostic signal.

**Implication for Hum AI, stated without hedging:** a hum-based read *cannot inherit* the (already shaky) running-speech screening AUCs. The defensible scientific posture is the field's best-supported use case — **longitudinal, within-person tracking of change** (Mundt-style) — presented as a soft, non-diagnostic signal, with any cross-sectional screening claim deferred entirely to the pre-registered study. Cross-cultural evidence that non-linguistic vocalizations carry emotion ([PMC3728469](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3728469/)) and that acoustic/prosodic features are "independent of linguistic content" in principle ([PMC12293195](https://pmc.ncbi.nlm.nih.gov/articles/PMC12293195/)) makes language-independence for humming a **well-grounded hypothesis, not a validated result.**

---

## 3. The system

The full read-path spine is **BUILT** and runs end-to-end client-side: capture-gate → quality-gate → domain-classifier → expert ensemble → reliability-weighted fusion → dual-baseline personalization → within-user relapse/trend → intervention → safety-language screen (`packages/orchestrator/src/orchestrator.ts`).

### 3.1 Deterministic DSP feature extractor — BUILT
Dependency-free `HumDspExtractor` / `computeFeatures`: RMS framing, adaptive noise-floor/SNR proxy, autocorrelation F0 with parabolic interpolation, radix-2 FFT spectral features, voicing/expression proxies — serialized as a 58-column model vector (32 numeric + 2 boolean + 12 nullable with `__present` masks). *Evidence: `packages/audio-features/src`; `packages/signal-lab/src/feature-schema.ts`; `docs/ARCHITECTURE.md` §3.1.*

### 3.2 Transparent valence/arousal backbone — BUILT
`acousticAffectAxes` maps 13 on-domain DSP features to V-A with **fixed weights**, bounded [−1,1] — a deterministic floor that always yields a read from the first hum. Trained priors only *nudge* it, capped at 0.75 (in-domain native) / 0.5 (far-domain) and fading with OOD distance via `exp(−1.5·ood)`. *Evidence: `packages/orchestrator/src/axis-read.ts` (`resolveAxis`); `docs/ARCHITECTURE.md` §3.2–3.3.*

### 3.3 Multi-expert affect architecture + fusion — BUILT (experts heuristic; see §4 honesty note)
Six deterministic SER experts (`HumAcousticExpert`, `HumEmbeddingExpert`, `SingingPhonationExpert`, `VocalBurstExpressionExpert`, `SpeechEmotionExpert`, `SpeechClinicalExpert`) emit multi-label affect tilts behind a common `AffectExpert` contract, combined by a **reliability-weighted late-fusion meta-learner** (`FusionEngine.fuse`). The trained `LogisticRegressionMetaLearner` is a drop-in for the deterministic `StubWeightedMetaLearner`; **untrained it throws by design**, with the stub as honest fallback, and is promoted only when it beats the stub on held-out hums. *Evidence: `packages/expert-ser/src`; `packages/fusion-engine/src/meta-learner.ts` (lines 32–99); `packages/native-corpus/src/fusion-train.ts`.*
> **Honesty note (INVESTIGATIONAL):** the six experts are heuristic stubs with a hard 0.35 confidence cap, *not* trained models. Real SER/embedding models (WavLM/HuBERT/Wav2Vec2) are Phase-2 work behind the same contract. The dimensional V-A read leads from the backbone; the meta-learner only re-weights experts for the *secondary* affect-state read once the user's own confirmed hums fit it.

### 3.4 Within-user personalization — BUILT
Dual robust baseline (rolling short-term + anchored long-term; median/MAD/IQR), z-delta re-referencing, salience blended with HiTL per-user feature importance (|Pearson r| of features vs. reported axis), and an EMA personal axis-calibration offset learned from reported-minus-predicted residuals (bounded ±0.6). *Evidence: `packages/personalization-engine/src` (`dual-baseline.ts`, `salience.ts`, `axis-calibration.ts`); `docs/ARCHITECTURE.md` §3.4.*

### 3.5 Dual-baseline relapse engine + robust trend — BUILT
DVDSA-inspired paired comparison (vs. previous stable / high-risk / 7d / 30d references) emitting `recovery | stable | worsening | relapse_drift | uncertain`, plus Theil-Sen slope, Mann-Kendall S/τ significance, and CUSUM drift-onset. Confidence **hard-capped at 88%**; defaults to `uncertain` without references. *Evidence: `packages/relapse-engine/src` (`relapse.ts`, `trend.ts`, `longitudinal.ts`).*

### 3.6 The new within-user risk-marker engine — BUILT (architecture), INVESTIGATIONAL (thresholds)
`deriveRiskMarkers` (`packages/relapse-engine/src/risk-markers.ts`) emits three **non-diagnostic, consent-gated** markers, each defined relative to the user's own history:

- **depressive-affect** — sustained low-valence + flat/low-arousal *below the user's own baseline*;
- **anxiety-tension** — sustained high-arousal + negative-valence ("keyed-up for you");
- **relapse-drift** — sustained divergence from baseline.

The engine is built on robust within-user statistics: a personal **median ± MAD** band (`robustBand`, MAD→σ via the 1.4826 factor with a spread floor), a **sustained-ness** requirement over a recent window, and a **sequential CUSUM** change-detector (`cusumDrift`) that flags the *onset* of a sustained shift for early detection. It is structurally `isDiagnostic: false`, **abstains without a personal baseline** (returns `insufficient` until `baselineReady`), maps to coarse user-safe levels (`watch` / `elevated`), and its output register must pass `@hum-ai/safety-language`. Grounding and behavior are documented inline (header lines ~7–47).
> **Honesty note (INVESTIGATIONAL):** all marker thresholds (stable band, high-risk band, drift windows, CUSUM slack/threshold) are *principled but uncalibrated defaults* pending real-outcome calibration (`DIAGNOSTIC_ROADMAP` Tier B4). The engine is correct architecture awaiting calibration data, not a validated detector.

### 3.7 HiTL + population loops, OCEAN signature, deployed SPA — BUILT
- **HiTL native-hum loop (ADR-0011):** on-device `NativeCorpus` of {derived features, benign V-A self-report}; browser-runnable `trainLogReg` promoted to steer the read only when it beats the backbone in-domain. *Evidence: `packages/native-corpus/src/train.ts`; `docs/adr/0011-...md`.*
- **Cross-user population loop (ADR-0012):** `poolContributions` groups consented pseudonymous contributions by contributor for group-by-contributor CV; `trainPopulationArtifact` reuses the within-user promotion gate plus a ≥8-distinct-contributor diversity guard. *Evidence: `packages/population-corpus/src/pool.ts`, `train.ts`.* (Offline-capable; live cross-user write gated OFF; no pooled data yet.)
- **Exploratory Big Five (OCEAN) signature** foregrounding the two most acoustically-legible traits (Openness, Conscientiousness); Myers-Briggs removed. *Evidence: `packages/personality-signature/src/index.ts`.*
- **Deployed local-first Vite SPA** running the full spine client-side, persisting derived-only data to the user's owner-scoped Firestore. *Evidence: `apps/web`, `vercel.json`, `firebase.json`, `firestore.rules`; production at hum-ai-beige.vercel.app.*

---

## 4. Validation & rigor

The evaluation/promotion machinery is fully built and is, candidly, the most diligence-ready asset in the repo. It is calibration-first and ungameable in the ways the literature most often fails.

| Method | What it enforces | Evidence path |
|---|---|---|
| **Participant-grouped k-fold CV** | one participant's hums never split across train/test; single-class folds skipped honestly, not imputed to chance (the study analog of RAVDESS actor-grouping) | `packages/signal-lab/src/evaluate-binary.ts` (oofScores); `shared-types/src/metrics.ts` (`groupFolds`) |
| **ROC AUC via Mann-Whitney U** | tie-aware ranks; NaN-honest (single-class surfaced, never defaulted to 0.5); participant-grouped percentile bootstrap 95% CI resampling whole participants | `evaluate-binary.ts` (`rocAuc` + `groupedBootstrapAucCI`) |
| **Calibration (ECE)** | 10-bin reliability diagram + binary ECE; a discriminating-but-miscalibrated model fails the gate | `shared-types/src/metrics.ts`; `docs/validation/ANALYSIS_PLAN.md` §6 |
| **Label-permutation null** | empirical AUC p = (count[null≥obs]+1)/(valid nulls+1), over valid draws only | `evaluate-binary.ts`; `cohort-eval.ts` |
| **Youden operating point** | sens/spec/PPV/NPV/F1 at the OOF-maximized threshold, with default-0.5 metrics alongside | `evaluate-binary.ts` (`bestYoudenThreshold`) |
| **Reproducibility** | all randomness seeded (`makeRng`); analysis dry-run on synthetic labelled data end-to-end before any real data | `docs/validation/ANALYSIS_PLAN.md` §12; `shared-types/src/numeric.ts` |

**Pre-registered promotion gates (placeholders pending biostatistics lock; never round up):**
- **Clinical screening gate** (`DEFAULT_SCREENING_GATE`): ALL of ≥200 rows, ≥100 participants, AUC≥0.80, AUC-95%CI-lower≥0.70, permutation p<0.01, ECE≤0.10, sensitivity≥0.80, specificity≥0.70. *`packages/screening-model/src/screening.ts`.*
- **On-device native-axis gate** (small-n discipline): ≥24 examples, ≥8/pole, balanced-acc ≥0.60 floor, +0.03 margin over backbone, permutation p<0.05, ECE≤0.20, plus a calibration-trend guard (never promote a model whose recent read accuracy is slipping). *`packages/native-corpus/src/train.ts`.*
- **Offline cohort gate**: balanced accuracy ≥0.80 (chance=1/k, majority-class-proof) AND permutation p<0.01 AND top-class ECE≤0.15, plus selective-prediction (abstention) curves. *`packages/signal-lab/src/cohort-eval.ts`.*

**Pre-registered study design (BUILT documentation; not yet run):** cross-sectional co-primary endpoints (PHQ-9≥10, GAD-7≥10) with Holm-Bonferroni multiplicity control; secondary calibration/abstention/within-user-longitudinal endpoints; blinded screening probability; SAP frozen before unblinding; QUADAS-2 risk-of-bias mapping flags patient-selection HIGH, mitigated by grouped CV + required external replication. *Evidence: `docs/validation/` (`PRE_REGISTRATION.md`, `IRB_PROTOCOL.md`, `ANALYSIS_PLAN.md`, `POWER_ANALYSIS.md`, `QUADAS-2`, `DATA_DICTIONARY.md`, `DIAGNOSTIC_ROADMAP.md`, `NATIVE_HUM_DATA_SPEC.md`).*

**Test suite:** 603 of 608 tests pass under Node's built-in `node:test` runner (no third-party framework). The 5 failures are confined to uncommitted working-tree edits (`axis-read.ts`, personalization `update.ts`, relapse-engine WIP) — not the committed/deployed Stable Build v6.

### What is explicitly NOT yet validated
- **The clinical screening head has produced zero validated performance numbers.** No native-hum corpus labeled with clinical reference instruments yet exists; the pre-registered cross-sectional pilot has **not been run**.
- **The within-user risk markers are uncalibrated** (§3.6).
- **The SER experts are heuristic, not trained** (§3.3); a mel-CNN hum model reaching ~84.2% arousal exists only as a Python-CLI research checkpoint, below its own 85% gate and not browser-servable.
- **Far-domain RAVDESS priors are honestly gated:** arousal_binary cleared an experimental 80% balanced-accuracy gate at ~83% but is kept as an auxiliary prior that does **not** steer the read; 6-class (~47.9%) and valence (~69.4%) are below-gate and unwired (`apps/web/public/models/model_manifest.json`).
- **The population loop has no pooled data** (diversity guard withholds steering below 8 contributors).
- **ADR-0012 has no committed markdown file** in `docs/adr/` yet — implemented and documented in architecture/memory, but the formal ADR record is unwritten.

---

## 5. Regulatory posture

**The load-bearing external fact:** as of mid-2026, **no voice-based mental-health screening tool has FDA authorization.** Kintsugi pursued a De Novo for ~4 years across multiple pre-submissions and shut down without clearance ([BHB 2026-02-11](https://bhbusiness.com/2026/02/11/mental-health-voice-biomarker-kintsugi-closes-makes-all-technology-and-research-public/)). FDA-authorized digital mental-health SaMD are overwhelmingly *treatment* devices (prescription digital therapeutics under "Computerized Behavioral Therapy Device for Psychiatric Disorders" — reSET, Somryst, EndeavorRx, Rejoyn, MamaLift Plus, DaylightRx; [Cureus/PMC12090883](https://pmc.ncbi.nlm.nih.gov/articles/PMC12090883/)), not voice screeners.

**The regulatory line.** A voice app that *screens for, detects, or monitors* depression/anxiety is **Software as a Medical Device** under FDA's adoption of the IMDRF definition — the trigger is the **intended-use claim, not the technology** ([FDA SaMD](https://www.fda.gov/medical-devices/digital-health-center-excellence/software-medical-device-samd); [IMDRF N12](https://www.imdrf.org/)). A first-in-class screener with no predicate would go through **De Novo** (not 510(k)); Breakthrough Device Designation accelerates but is **not** a marketing authorization ([21 U.S.C. 360e-3](https://www.law.cornell.edu/uscode/text/21/360e-3)). FDA's revised **General Wellness** guidance (reissued Jan 6, 2026; [PDF](https://www.fda.gov/media/90652/download)) grants enforcement discretion only for low-risk products limited to general-health/lifestyle uses (it enumerates "relaxation or stress management," "mental acuity," "self-esteem," "sleep management") — and a per-user output that screens/infers/monitors a condition falls **outside** that discretion. In the EU, such a screener is MDSW under **MDR Rule 11 (Class IIa+)** requiring a Notified Body, and is therefore **automatically a high-risk AI system** under EU AI Act Art. 6(1) per [MDCG 2025-6 / AIB 2025-1](https://health.ec.europa.eu/) (product-embedded high-risk obligations now proposed for 2 Aug 2028 under the May-2026 Digital Omnibus agreement, not yet in force).

**Hum AI's posture today (BUILT, machine-enforced):**
- **6-tier claims ladder.** Tier-4 clinical screening documented **UNREACHABLE** in the current build; Tier-5 (diagnosis / medical device / FDA-cleared / "prevents relapse") **categorically blocked in code**. *`docs/claims/CLAIMS_LADDER.md`.*
- **Machine-enforced safety language.** `FORBIDDEN_PHRASES` blocklist (diagnosis, "you have depression," clinically validated, medical device, FDA-cleared, premature "screens for…," any cited sensitivity/specificity number) with `assertSafeUserFacingText` throwing `UnsafeLanguageError` at the render boundary. *`packages/safety-language/src/phrases.ts`.*
- **Single off-by-default switch.** `validatedRegulatoryMode` (default **false**) is the only thing that could unlock Tier 4–5 copy; setting it without prospective validation + external replication + clearance + governance sign-off is *defined as a safety violation*.
- **Two-head + consent separation (ADR-0006).** The clinical-risk head is withheld unless explicitly consented, hard-capped at 88%; `assertNoClinicalLeak` blocks clinical-risk ids/labels from reaching the recommendation engine or copy; internal labels map one-way to lossy, safe-direction user copy.
- **Structural screening firewall.** `evaluateScreening` computes a blinded probability that is **never surfaced**; a QA gate (`no-screening-in-read-path`) firewalls it from `apps/web`/orchestrator/safety-language at the import-graph level. *`packages/qa-gates/src/screening-isolation.ts`.*
- **Structural on-device privacy.** Raw audio never leaves the device; only derived features/qualitative summaries sync, only with consent; `assertNoRawAudioFields` blocks raw-audio tokens at any depth; consent scopes default off except `local_processing`. *`packages/shared-types/src/privacy.ts`.*
- **Deterministic crisis protocol.** PHQ-9 item-9 endorsement (≥1) synchronously triggers a non-dismissable crisis surface with region-aware resources (988 default) **before any model runs**; never abstains, never depends on confidence, audit-logged. *`packages/affect-model-contracts/src/crisis.ts`.*
- **Five QA governance gates pass** (`npm run qa`): no-clinical-leak, no-camera-deps, no-raw-confidence-copy, forbidden-files, no-screening-in-read-path.

**What we can say today:** within-person mood-awareness, self-reflection, relaxation/stress-management framing. **What we cannot say:** that Hum screens for, detects, diagnoses, or monitors any condition; any accuracy number; any reference to depression/anxiety/PTSD/suicidality as a product output. Any disease-level work is confined to IRB-approved, pre-registered research.

---

## 6. The moat

The defensible thesis is a **compounding, consented, derived-only native-hum corpus** plus the engineering apparatus that converts each corpus increment into a credibly-validated model increment. Investors correctly note that generic "we have recordings" data moats are eroding; Hum's is specifically structured to be exclusive, regulated, and workflow-locked.

1. **First real `native_hum` truth.** A registered dataset entry (`native_hum_self_report_corpus`): on-device {derived features, benign V-A self-report}, raw audio never stored, the **only lawful source of hum truth** (ADR-0005). Public datasets (RAVDESS etc.) are cold-start priors only, penalized and abstaining out-of-domain. *`packages/dataset-registry/src/entries.ts`; `docs/validation/NATIVE_HUM_DATA_SPEC.md`.*
2. **HiTL loop compounds per-user, on-device.** Each confirmed/adjusted read mints one row of native-hum truth that (a) instantly re-centres the read via personal calibration and (b) feeds a browser-runnable retrain promoted only when it beats the transparent backbone — escaping the far-domain ceiling with no far-domain penalty, bootstrapping a proprietary corpus without waiting on an external study. *`packages/native-corpus/src/train.ts`.*
3. **Cross-user population loop (ADR-0012)** as the path from per-user to a shared population prior, gated by group-by-contributor CV + the ≥8-contributor diversity guard + the same honest promotion gate.
4. **The hum itself is structural.** A fixed, language-independent, comparable-across-sessions signal that strips content/privacy confounds — the bridge from public priors to native data.
5. **Two-tier governed data architecture** separates the benign on-device native-hum corpus from the PHI clinical-screening corpus (PHQ-9/GAD-7, IRB-gated, pseudonymised, separate channel; pooling is a separate IRB-gated backend step, never client-side) — letting the moat grow without regulatory contamination.
6. **The validation/promotion machinery is itself a reusable asset** (grouped CV, AUC+CI, ECE, permutation p, Youden, pre-registered gates) — the engineering moat that makes the data moat monetizable as a regulated instrument later.
7. **Local-first deployment** lowers consent friction and broadens the recruitable corpus while keeping raw audio on-device.

---

## 7. Competitive landscape

No voice-biomarker company has obtained FDA clearance. Incumbents split into (a) clinical-trial speech analytics for neuro/cognition and (b) mental-health acoustic screening — **all analyse spoken speech, predominantly cloud-side, single-shot.**

| Company | Modality | Status / regulatory | Funding (disclosed) | Validation |
|---|---|---|---|---|
| **Kintsugi** *(defunct)* | ~20s free speech, acoustic | **Shut down early 2026** after ~4 yrs De Novo, ~$30M, **never cleared**; open-sourced models | ~$28–30M | Pivotal vs SCID-5 ([NCT06809907](https://clinicaltrials.gov/study/NCT06809907)); cross-sectional 71.3%/73.5% vs PHQ-9 ([PMC11772039](https://pmc.ncbi.nlm.nih.gov/articles/PMC11772039/)) |
| **Ellipsis Health** | <60s speech, **acoustic+NLP** (content-bearing) | Not FDA-cleared; pivoted to "Sage" AI care-manager | ~$75–76M ($26M 2021 + $45M 2025, Salesforce/Khosla/CVS) | AUC≥0.80 on unseen speakers ([arXiv:2412.19072](https://arxiv.org/abs/2412.19072)); Highmark/JHU n=2,086 ([PMC12223686](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12223686)) |
| **Sonde Health** | ~30s speech, acoustic; **on-device (Snapdragon)** | Wellness/non-diagnostic; no FDA clearance | ~$35.25M ($16M A 2019 + $19.25M B 2022) | Sonde-authored prospective cohort n=104 ([PMC10948552](https://pmc.ncbi.nlm.nih.gov/articles/PMC10948552/)) |
| **Canary Speech** | seconds of speech, API-first acoustic | No FDA clearance; 9 patents; used in research/trials | ~$22.3M (incl. $13M A, Jun 2024) | UAR ~0.60 anxiety / 0.63 depression ([Canary, FICC 2024](https://canaryspeech.com/)) |
| **Winterlight → Cambridge Cognition** | free speech+language (lang-dependent), **cognition/dementia** | M&A exit Jan 2023, ~£7.0M (~$8.6M) | 500+ features; AD detection low-80s–~91%; used in Roche/AC Immune TAURIEL |
| **Aural Analytics → Linus Health** | content-bearing clinical speech, **neuro** | Acquired Mar 2024; "Speech Vitals-ALS" FDA Breakthrough *Designation* | n/a | Powers ALS-trial speech endpoints |
| **Vocalis Health** *(defunct)* | respiratory/cardiac + COVID voice screener | Deadpooled/closed | ~$9M (one round) | COVID pilot AUC 0.72 ([PMC8120447](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8120447/)) |

**How Hum differs.** Each property below is individually occupied by *someone*; **no incumbent occupies all four at once** — that stack is the white space:
- **Non-linguistic / language-independent** — humming carries pitch, prosody, melodic movement, voicing, energy *without words*; every incumbent records speech (even "acoustic-only" players need spoken words), removing the content-bearing privacy surface entirely.
- **On-device** — raw audio off servers (only Sonde's Qualcomm work is a partial precedent).
- **Longitudinal personalization** — per-user adaptive baseline vs. population single-shot cutoffs; tracks deviation from the individual's own norm, the field's best-supported use case and a hedge against the demographic-bias trap.
- **Wellness "mood-mirror" framing** — Kintsugi's collapse shows the diagnostic-De-Novo route is category-killing; a non-diagnostic posture (à la Sonde) is the lower-burden wedge while validation matures.

*Honest qualifiers:* language-independence for humming is a hypothesis, not a validated result; the personalization SNR/bias advantage is design rationale, not proven superiority.

---

## 8. Milestones & the ask

Framed against the investor reality that capital is AI-gated and concentrated, that an FDA-evidence-vs-payer-evidence "valley of death" sank Kintsugi, Pear, Akili, and Woebot's consumer app, and that specialist diagnostics VCs underwrite **milestone-based de-risking** (analytical validity → clinical validity → clinical utility) over revenue projections (Rock Health 2024–25; Bessemer *State of Health AI 2026*; Innolitics).

**Phase 0 — Investigational foundation (largely BUILT).** Deployed local-first SPA; transparent on-device read + within-user markers; complete validation/promotion machinery; full IRB pre-registration package; structural safety/privacy firewalls. *De-risked: analytical apparatus and governance exist before any clinical claim.*

**Phase 1 — Native-hum corpus + within-user validity (the funded ask).** Grow the consented derived-only native-hum corpus via the HiTL loop; calibrate the risk-marker thresholds against real within-user outcomes (`DIAGNOSTIC_ROADMAP` Tier B4); replace heuristic SER stubs with trained hum-native experts and fit/calibrate the meta-learner; stand up the population backend toward the rigorous 0.80 / p<0.01 / ECE bar as n grows. *Milestone: a genuinely model-led (not merely refined) hum read clearing the on-device gate; longitudinal/relapse cohort (C2: ~50–150 participants, daily hums ≥3 months with clinician-anchored events) enrolled.*

**Phase 2 — Pre-registered cross-sectional screening pilot (ASPIRATIONAL).** Run the pre-registered PHQ-9/GAD-7 co-primary study against the frozen SAP; pursue external independent replication; only then approach a De Novo with original pivotal evidence on the *actual shipped model and platform* (the npj critique's bar). *Tier-4 remains UNREACHABLE — and Tier-5 categorically blocked — until co-primary endpoints, replication, and governance sign-off all hold.*

**The ask underwrites validation, not scale:** each tranche maps to a concrete uncertainty eliminated — corpus milestone → marker calibration → trained-expert promotion → pilot enrollment — keeping spend ahead of, not chasing, the regulatory clock.

---

## 9. Honest risks

1. **The science is hard and the field is in a replication crisis.** Within-corpus AUCs of 0.8–0.9+ collapse *toward* chance cross-corpus, cross-device, cross-language, and cross-sex; subject leakage and gender confounds inflate benchmarks; the signal is **transdiagnostic distress, not depression-specific** (§2.3). Hum cannot inherit published screening AUCs.
2. **Humming is unvalidated as a screening biomarker** (§2.4). It is genuine white space *and* an absence of validation — a skeptical funder will note that the literature gap cuts both ways.
3. **Regulatory risk is the category killer.** No voice screener has ever cleared FDA; a diagnostic claim demands a slow, ~$5M+, multi-year De Novo with prospective gold-standard evidence and (likely) external replication. The mitigation is structural: a non-diagnostic wellness posture, machine-enforced (§5), with screening firewalled and off by default.
4. **Investigational-vs-validated gap.** The screening head has produced **zero validated numbers**; risk-marker thresholds are uncalibrated; SER experts are heuristic; the population loop has no data. The product reads honestly today *because* these are gated off — but the clinical thesis is unproven.
5. **Dataset bias & cold start.** The native-hum corpus does not yet exist at scale; cold-start relies on penalized, abstaining far-domain priors. Demographic diversity (the ≥8-contributor guard is a floor, not a guarantee) and voice-as-biometric privacy/consent obligations (BIPA/GDPR special-category) are live underwriting concerns.
6. **Commercial durability.** Even FDA-cleared peers failed commercially (Pear, Akili, Woebot); reimbursement for a novel voice biomarker has no dedicated Medicare benefit category. The defensible near-term path is voice/hum as a within-person wellness signal, with the regulated instrument as optionality, not the base case.
7. **WIP integrity.** 5 of 608 tests currently fail on uncommitted working-tree edits; ADR-0012 lacks a committed markdown record. These are housekeeping, not architecture, but are disclosed for completeness.

*— End of brief. All maturity tags and citations are load-bearing; none of the reference accuracies above (e.g., AVEC RMSE/MAE, Kintsugi 71.3%/73.5%, Canary UAR) are Hum AI's own performance — Hum AI has produced no validated clinical performance numbers to date.*