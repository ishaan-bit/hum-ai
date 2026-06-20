# Model Card — Hum Capture → Affect Pipeline (v0)

> The gated, calibrated pipeline for turning a ~12 s free-flowing capture into an affect
> read **safely**. Built in `research/training` (PyTorch, Intel Arc XPU) + wired to the
> TS runtime. Every number below is measured under **speaker/source-grouped CV** on this
> run — no fabricated metrics. Far-domain PRIOR only; never hum truth, never clinical (ADR-0005).

## The problem (why this is not "an emotion classifier")

The product captures ~12 s expecting a hum, but the input can be **anything** — speech,
whistle, **sigh, breath**, throat-clear, background **noise**, or silence. Inferring emotion
from a sigh or noise would be an unsafe over-claim in a sensitive (mental-health-adjacent)
product. And a hum is **not speech**: it carries pitch/energy/timbre, not phonemes, so a
model that reads phonetic cues does not transfer. The pipeline is therefore **gated,
calibrated, and abstaining**, not a naive classifier:

```
12 s capture
  → ① ACCEPTANCE GATE   usable hum?  reject noise/silence/speech/sigh/whistle → "hum again"
  → ② DOMAIN / TYPE      (hum/sing vs speech vs burst) — calibrates trust
  → ③ AFFECT PRIOR       arousal/valence on the hum-projected signal; OOD-abstaining, capped
```

## ① Acceptance gate (STRICT) — the safety layer

A dependency-free logistic gate over 15 signal-quality features (voicing coverage, F0
stability, harmonicity/HNR, SNR, silence ratio, spectral flatness/centroid/rolloff, ZCR,
sustained-voiced-run). Trained on VocalSet singing + hum-ified clips (accept) vs vocal
bursts, raw speech, whistles, and **synthesized noise/silence** (reject), under
**source/speaker-grouped 5-fold CV**.

- **OOF balanced accuracy 97.6%**, hum precision 93.7%, recall 98.1%.
- Per-source ACCEPT rate (want high for hum, ~0 otherwise):

  | source | accept | | source | accept |
  |---|---|---|---|---|
  | VocalSet singing | **97.1%** | | noise (white/pink) | **0.0%** |
  | hum-ified voice | **99.1%** | | silence | **0.0%** |
  | raw speech | 1.7% | | sigh/sniff/sneeze/cough/throat | 0–6.6% |
  | — | — | | whistle | 14.9% · laughter 10.9% |

  → **noise and silence are rejected 100%** ("we don't process noise"); a rejected capture
  returns `action="ask_user_to_hum_again"` and **no affect is computed**.
- Reference impl: `signal_neural/runtime_gate.py` (`assess_capture`, `gated_read`) over the
  CV-validated weights in `capture_gate.json` (the 97.6% figure). The browser/runtime path is
  `capture-gate.ts` — a pure, browser-safe heuristic logistic over the SAME `AcousticFeatures`,
  **aligned to (not byte-identical with)** the validated gate; it is now **wired into the web SPA**
  so a rejected capture shows "hum again" before any affect is computed.

## ② Hum-ification (datasets → reusable hum signals)

Speech/song is projected onto what survives in a hum before training the affect prior:
F0 contour + energy envelope + voicing are tracked and **resynthesized** as a hum
(harmonics under a formant-suppressed "mmm" envelope; consonants/unvoiced dropped) or a
**whistle** (near-pure high tone). `signal_neural/humify.py`.

## ③ Affect prior — honest speech-vs-hum results

Speaker-grouped 5-fold CV on RAVDESS (acted **speech + song**; CREMA-D dropped as pure
speech). The headline is the **speech→hum gap**, which is the whole point:

| target | raw speech (benchmark) | **hum-ified (product-relevant)** | model |
|---|---|---|---|
| arousal | 87.4% (wav2vec2) / 84.2% (mel) | **84.2%** | mel_cnn2d |
| valence | 84.7% → ~85% | **81.1%** | mel ensemble |
| 6-way affect | ~65% | **64.7%** | mel ensemble |
| arousal (wav2vec2 on hum) | — | 74.8% | wav2vec2 |

**Key finding:** on hum-projected audio the **from-scratch mel-CNN (84.2% arousal) beats the
pretrained speech model wav2vec2 (74.8%)** — mel spectrograms transfer to hum, phonetic
embeddings do not.

**Deployment status (honest).** NONE of these hum models passed this run's promotion gate
(arousal 84.2% < the 85% threshold; valence 81.1%; 6-way 64.7% — all `promoted: false`). The mel
checkpoint (`checkpoints/model.hum.<target>.pt`, served by `infer.py`) is a **Python-CLI research
artifact**: it is a torch state-dict with **no browser-servable export** (`export_ts.py` converts
only feature-space linear/MLP heads, not mel-CNNs). The **deployed web runtime therefore runs the
classical JSON priors** — `model.arousal_binary.json` (the only one to clear the ~80% experimental
axis gate, ≈83%) plus the below-gate valence/6-class priors — each surfaced as an **OOD-abstaining,
far-domain-penalised** prior that never steers the affect head, confidence, or interventions
(ADR-0005 / `axis-prior.ts`). Porting the mel-CNN to the browser (mel filterbank + conv) is a
tracked follow-up; the 84.2% is a research result, not a shipped capability.

## Data reality (honest)

- **RAVDESS** (24 actors, **1,012 song + 1,056 speech**) — the song subset (solo emotional
  singing) is the most hum-like labeled audio that exists; it needs no download.
- **CREMA-D** (91 speakers) was pooled then **dropped** — strictly speech, wrong domain for hum.
- **Music V/A** (DEAM / PMEmo / MERP / Memo2496): not viable here — MERP/PMEmo distribute
  *features only* (copyright), DEAM/Memo2496 are 3–12 GB (disk), and all are **polyphonic**
  produced music — a large domain gap from a monophonic hum.
- **Hume AI A-VB** (59 k non-speech vocal-burst clips with V/A) is the ideal *non-speech*
  voice-affect data but is **EULA-gated**; Hume and Imentiv both anchor on **valence/arousal**,
  confirming V/A (not fine categories) as the right hum target.
- **There is no public hummed-melody-emotion dataset.** Every option is a proxy; the safety
  comes from the gate + OOD abstention + calibration, not from training accuracy.

## Hardware

Intel **Arc 140V** GPU enabled (`torch 2.8.0+xpu`); the mel cohort + heads train on XPU
(cnn1d ~0.3–0.5 s/epoch). wav2vec2 forward **hangs on XPU** (transformers/XPU limitation),
so its embeddings extract on CPU (cached). Both CPU and GPU are used.

## Limitations & next steps

- Acted far-domain audio; hum-projection is a synthetic proxy. Real validation needs **actual
  hum-emotion data** — bootstrap via the product, or license Hume A-VB.
- Whistle (15%) and laughter (11%) are the residual gate leaks (both voiced); tighten by
  raising the threshold or adding a pure-tone reject rule.
- ② domain/type detector is scaffolded (the gate already separates hum/speech/burst/noise);
  a dedicated multi-class router is the next increment.
