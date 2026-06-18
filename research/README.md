# research/

Python-only research and training scaffolds. **No models are trained in this
pass** and **no heavy ML dependencies are installed.** This directory documents
the plan and provides the structure so training can start without redesign.

| Dir | Purpose |
| --- | --- |
| `datasets/` | Acquisition + governance plan; every dataset must be registered in `@hum-ai/dataset-registry` before use. |
| `training/` | Expert fine-tuning and the LogReg fusion meta-learner training plan. |
| `evaluation/` | Calibration, abstention, and within-user (DVDSA-style) evaluation protocols. |
| `notebooks/` | Exploratory analysis (kept out of the app build). |
| `model-cards/` | One card per model/stub, documenting intended use, data, and limits. |

## Hard rules (mirror `@hum-ai/dataset-registry` governance, ADR-0005)
- Public datasets are **priors for cold-start only**. Native hum data and the
  personal baseline must progressively dominate.
- **Clinical-speech** data may be a `clinical_prior`, never hum truth (`hum_finetune`).
- **Music-emotion** data may support `recommendation`, never user-state diagnosis.
- **Vocal-burst / Hume-style** data are affective-expression bridges, not diagnosis.
- Only `native_hum` data may drive `hum_finetune` / `personalization` / `relapse_tracking`.

## Toolchain (when training begins)
Python ≥3.10, isolated `.venv`. Likely deps (NOT installed here): `torch`,
`transformers`, `librosa`, `scikit-learn`, `numpy`. Adding them is a separate,
explicitly-approved step.
