# Signal-Lab Neural Training Harness

An **offline, app-runtime-isolated** PyTorch cohort for the HumAI affect priors. It
trains/evaluates neural models on the **exact** labels, actor groups, target
derivations, and engineered features exported by `@hum-ai/signal-lab`, under the
**same** leakage-safe grouped-CV promotion gate as the classical cohort. It promotes
a neural model **only** if it clears the gate **and** beats the classical baseline;
otherwise the TypeScript runtime keeps its classical fallback.

This harness adds **no** dependency to the TypeScript/app runtime. Production never
needs Python or a GPU.

## Install

```bash
# CPU baseline (always works):
python -m pip install -r research/training/requirements.txt --index-url https://download.pytorch.org/whl/cpu
python -m pip install pytest    # for the harness tests
```

### Intel Arc / XPU acceleration (optional, auto-detected)

The CPU wheel above has **no** XPU runtime. To use the Intel GPU, install the XPU
build instead (needs current Intel GPU drivers; oneAPI is bundled in the wheel):

```bash
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/xpu
```

Then run any command with `--device xpu` (or leave `--device auto`). The harness
detects `torch.xpu.is_available()` at runtime and falls back to CPU automatically if
XPU is unavailable — nothing else changes.

## Run

```bash
# 1. Export the labelled training set from TypeScript (single source of truth):
npm run signal:export-neural

# 2. Detect acceleration:
python -m research.training.run device

# 3. Smoke test (small subset, few epochs — validates the pipeline end-to-end):
python -m research.training.run smoke --cohort all

# 4. Full cohort for a target (beat the classical baseline, try for 90%):
python -m research.training.run --target arousal_binary --cohort all
python -m research.training.run --target all --cohort all   # all targets

# 5. Tests (no GPU required):
python -m pytest research/training/tests -q
```

## What it does

1. **Data** (`signal_neural/data.py`): reads `labelled_rows.jsonl` +
   `neural_export_meta.json`; loads RAVDESS audio zip-direct (stdlib `wave`, no
   librosa/torchaudio), resamples to 16 kHz, makes log-mel spectrograms via a
   hand-built mel filterbank, and caches them to a git-ignored `.npy`. Grouped folds
   replicate `cohort-eval.ts groupFolds` exactly.
2. **Model cohort** (`signal_neural/models.py`):
   - feature-space: `LinearProbe` (classical reference), `FeatureMLP`;
   - audio-space: `MelCNN2D`, `MelCNN1D`, `MelBiGRU` (attention pooling),
     `MelCRNN` (CNN+GRU+attention), `HybridMelFeat` (mel-CNN embedding ⊕ engineered
     features).
3. **Evaluate** (`signal_neural/evaluate.py`): actor-grouped K-fold with an inner
   grouped hold-out for early stopping, inverse-frequency class weighting, balanced
   accuracy / macro-F1 / ECE / confusion (mirrors `cohort-eval.ts`), and a
   label-permutation significance test using a fast numpy-LogReg null reference.
4. **Gate** (`signal_neural/gate.py`): balanced acc ≥ 0.80 ∧ p < 0.01 ∧ ECE ≤ 0.15
   ∧ beats the classical baseline — never rounds up, never waives a criterion.
5. **Promotion**: a promoted **feature-space** model is exported to a pure-JSON
   op-graph (`model.neural.<target>.json`) that the TS runtime executes natively
   (`neural-feature-model.ts`); a promoted **audio** model is saved as a git-ignored
   `.pt` checkpoint for the Python inference wrapper, with TS classical fallback
   preserved. A human model card is written to `research/model-cards/` (tracked).

## Governance (ADR-0005)

RAVDESS is acted speech, **far** domain (penalty 0.45) — a **prior** only, never hum
truth, never clinical. The coarse arousal/valence axes only change the *question*,
not the governance. A promoted prior is surfaced as **auxiliary** evidence and does
**not** by itself steer the affect head or interventions.

## Artifacts (all git-ignored under `data/processed/signal-lab/neural/`)

- `labelled_rows.jsonl`, `neural_export_meta.json` — the TS export
- `cache/mels_*.npy` — cached spectrograms
- `neural_results.json` — full per-target cohort metrics
- `neural_model_manifest.json` — machine manifest (gate outcomes, promotion)
- `checkpoints/model.neural.<target>.pt` — promoted audio checkpoints
- `model.neural.<target>.json` — promoted feature-space op-graph (TS-loadable)

Only the **model card** under `research/model-cards/` is tracked. Weights, tensors,
spectrograms, feature matrices, and raw audio are **never** committed.
