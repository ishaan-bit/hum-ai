# @hum-ai/signal-lab

Offline **pretraining / evaluation / inference foundation** for Hum AI. It turns the
prepared public datasets under the git-ignored `data/` tree into a baseline
affect-**prior** model and lets a new hum run through the learned pipeline — without
duplicating any existing extractor, fusion, or intervention logic, and without
introducing heavy ML dependencies.

> Governance first (ADR-0005): public datasets are **priors only**, never hum truth.
> Only `native_hum` data may drive `hum_finetune` / `personalization` /
> `relapse_tracking`, and no native hum corpus exists yet. Everything this package
> produces is a far-/near-domain prior, down-weighted by `DOMAIN_GAP_PENALTY`, and
> is **not clinical** and **not clinically validated**.

## Flow

```
data/manifests + data/raw (zip-direct)        ← honest availability reconciliation
        → computeFeatures (@hum-ai/audio-features)   ← the REAL extractor, reused
        → label harmonization (RAVDESS emotion → FUSION_LABELS, traceable)
        → baseline LogReg (affect prior, AcousticFeatures → FUSION_LABELS)
        → evaluation: actor-grouped CV + permutation significance + ECE + tiers
        → LearnedAffectPriorExpert (drop-in AffectExpert)
        → inferFromHum: quality-gate → domain-classifier → fusion(+caps) → intervention
        → evidence report (state candidates, confidence/uncertainty, support, warnings)
```

## CLI (also wired as root `signal:*` npm scripts)

| Command | What it does |
| --- | --- |
| `npm run signal:availability` | Reconcile dataset manifests + on-disk reality; honest status per dataset. |
| `npm run signal:extract` | Zip-direct feature extraction → git-ignored feature tables (all usable datasets, bounded). |
| `npm run signal:train` | Extract RAVDESS + train the baseline + evaluate (calibration + significance). |
| `npm run signal:infer` | Run a synthetic new hum through the learned (or fallback) pipeline. |
| `npm run signal:all` | Train then infer. |

## Artifacts (git-ignored — `data/processed/signal-lab/`, reproducible)

`dataset_availability.json`, `DATASET_AVAILABILITY.md`, `feature_schema.json`,
`label_mapping.json`, `features.<dataset>.jsonl`, `feature_extraction_summary.json`,
`model.json`, `evaluation_report.json`, `EVALUATION_REPORT.md`, `MODEL_CARD.md`,
`MODEL_READINESS_REPORT.md`, `inference_demo.*.json`.

Raw audio, feature tables, and model weights are **never** tracked
(`assertGitIgnoredArtifactPath` + `.gitignore` + the `forbidden-files` QA gate).

## Programmatic inference

```ts
import { inferFromHum, deserializeModel } from "@hum-ai/signal-lab";
import { readFileSync } from "node:fs";

const model = deserializeModel(readFileSync("data/processed/signal-lab/model.json", "utf8"));
const report = await inferFromHum({ audio, model });          // or { features }
// report.inferredState / report.confidence / report.support / report.intervention / report.warnings
```

With no `model`, `inferFromHum` runs in honest **fallback** mode (heuristic stub
experts) and flags `fallbackUsed: true`.

## What it deliberately does NOT do

- No heavy ML deps (torch/transformers/librosa). Those stay in the Python
  `research/` scaffold and require explicit approval (research/training/README.md).
- No diagnosis, no clinical claims, no MELD/clinical accuracy presented as Hum's.
- No `hum_finetune` / `personalization` / `relapse_tracking` from public data.
