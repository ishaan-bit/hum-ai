"""Cohort orchestration, promotion, and artifact writing.

For each target: run the in-harness linear reference + the neural cohort under
identical actor-grouped CV, run the permutation significance test, pick the best
model, and apply the promotion gate (>=80% balanced acc, p<0.01, ECE<=0.15, AND
beats the classical baseline). Promote ONLY if the gate passes; otherwise keep
classical and say so. All machine artifacts are git-ignored under
`data/processed/signal-lab/neural/`; the human model card is the only tracked file.
"""
from __future__ import annotations

import json
import platform
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np
import torch

from . import data, device as devmod, evaluate, metrics, models, paths
from .evaluate import ModelSpec, grouped_cv, linear_reference_cv, permutation_pvalue
from .gate import promotion_gate


def _build_ensemble(oof_by_model: dict, members: list[str], ds, target_id: str, labels) -> dict | None:
    """Mean-probability ensemble over row-aligned out-of-fold predictions of `members`.
    Averaging diverse models cancels idiosyncratic per-model errors → typically +1–3pp
    over the best single member, with NO test leakage (still actor-grouped OOF)."""
    members = [m for m in members if m in oof_by_model]
    if len(members) < 2:
        return None
    rows_ref = oof_by_model[members[0]]["rows"]
    if any(oof_by_model[m]["rows"] != rows_ref for m in members[1:]):
        return None  # misaligned folds — refuse rather than average garbage
    import numpy as _np
    P = sum(oof_by_model[m]["proba"] for m in members) / len(members)
    y_true = [ds.labels_by_target[target_id][r] for r in rows_ref]
    pred = [labels[i] for i in P.argmax(axis=1)]
    em = metrics.full_metrics(y_true, pred, _np.max(P, axis=1).tolist(), labels)
    em["model"] = "ensemble_meanprob"
    em["family"] = "ensemble"
    em["members"] = members
    return em


# Common powerhouse knobs (AdamW + cosine warmup, label smoothing, grad clip, train-only
# SpecAugment + mixup). All are train-only / CV-internal — they cannot leak across the
# actor-grouped partition. Per-model epochs/bag/batch are tuned to the Arc 140V XPU, which
# runs 1-D/2-D convs very fast but is poor at RNNs and deep residual stacks — so the cohort
# leans on the cheap, historically-best cnn1d (heavy budget) and a wider 1-D sibling.
_AUG = dict(optimizer="adamw", scheduler="cosine", warmup_frac=0.06,
            label_smoothing=0.05, grad_clip=5.0, augment=True, mixup=0.2)


def feature_cohort() -> list[ModelSpec]:
    return [
        ModelSpec("linear_probe", "linear", lambda fd, nm, nc: models.LinearProbe(fd, nc),
                  "feat", epochs=60, lr=5e-3, batch_size=64, weight_decay=1e-4, patience=10),
        ModelSpec("feature_mlp", "mlp", lambda fd, nm, nc: models.FeatureMLP(fd, nc),
                  "feat", epochs=120, lr=2e-3, batch_size=64, weight_decay=5e-4, patience=16,
                  optimizer="adamw", scheduler="cosine", label_smoothing=0.05, grad_clip=5.0,
                  mixup=0.1, bag=3),
    ]


def audio_cohort() -> list[ModelSpec]:
    """Curated for the Arc 140V XPU: fast conv nets, heavy schedule + seed-bagging.
    cnn1d is ~0.3 s/epoch on this GPU AND was the strongest model historically, so it
    carries the cohort with a deep budget; cnn2d adds a 2-D view at a moderate budget."""
    return [
        ModelSpec("mel_cnn1d", "cnn1d", lambda fd, nm, nc: models.MelCNN1D(nm, nc),
                  "mel", epochs=150, lr=1.2e-3, batch_size=128, weight_decay=5e-4, patience=22, bag=5, **_AUG),
        ModelSpec("mel_cnn1d_wide", "cnn1d", lambda fd, nm, nc: models.MelCNN1DWide(nm, nc),
                  "mel", epochs=120, lr=1.0e-3, batch_size=128, weight_decay=5e-4, patience=18, bag=3, **_AUG),
        ModelSpec("mel_cnn2d", "cnn2d", lambda fd, nm, nc: models.MelCNN2D(nm, nc),
                  "mel", epochs=80, lr=1.0e-3, batch_size=64, weight_decay=5e-4, patience=14, bag=2, **_AUG),
    ]


def heavy_audio_cohort() -> list[ModelSpec]:
    """Slow models (RNN / deep residual) kept available for CPU or a patient run; NOT in
    the default cohort because they are 20–35 s/epoch on this iGPU. Used via --cohort heavy."""
    common = dict(epochs=60, lr=1.0e-3, batch_size=64, weight_decay=5e-4, patience=14, bag=2, **_AUG)
    return [
        ModelSpec("mel_bigru", "rnn", lambda fd, nm, nc: models.MelBiGRU(nm, nc), "mel_seq", **common),
        ModelSpec("mel_crnn", "crnn", lambda fd, nm, nc: models.MelCRNN(nm, nc), "mel", **common),
        ModelSpec("mel_rescnn", "rescnn", lambda fd, nm, nc: models.MelResCNN(nm, nc), "mel", **common),
        ModelSpec("hybrid_mel_feat", "hybrid", lambda fd, nm, nc: models.HybridMelFeat(nm, fd, nc), "hybrid", **common),
    ]


def _needs_audio(cohort: list[ModelSpec]) -> bool:
    return any(s.input_kind in ("mel", "mel_seq", "hybrid") for s in cohort)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_target(
    ds: data.Dataset,
    target_id: str,
    cohort: list[ModelSpec],
    device,
    device_name: str,
    folds: int = 5,
    permutations: int = 150,
    log=print,
    threshold: float | None = None,
) -> dict:
    target_meta = next(t for t in ds.meta["targets"] if t["id"] == target_id)
    labels = list(target_meta["classes"])
    mask = ds.masks_by_target[target_id]
    n = int(mask.sum())
    groups = ds.groups[mask]
    log(f"\n=== target {target_id} — {n} samples, {len(set(groups.tolist()))} actor groups, classes={labels} ===")

    if _needs_audio(cohort):
        data.ensure_mels(ds)

    rows = []
    # Classical/linear reference on the SAME folds (the floor to beat).
    linref = linear_reference_cv(ds, target_id, labels, folds=folds)
    rows.append(linref)
    log(f"  [ref] numpy_logreg balAcc={linref['balanced_accuracy']*100:.1f}% ECE={linref['ece']:.3f}")

    oof_by_model: dict = {}
    ens_eligible: list[str] = []
    for spec in cohort:
        log(f"  [train] {spec.name} ({spec.family}) epochs<= {spec.epochs}…")
        m = grouped_cv(spec, ds, target_id, labels, device, folds=folds, log=log)
        oof = m.pop("_oof", None)  # transient — never serialized
        if oof is not None and oof["proba"].shape[0] > 0:
            oof_by_model[m["model"]] = oof
            if getattr(spec, "ensemble", False) or spec.input_kind in ("mel", "mel_seq", "hybrid"):
                ens_eligible.append(m["model"])
        rows.append(m)
        log(f"  [done] {spec.name} balAcc={m['balanced_accuracy']*100:.1f}% "
            f"acc={m['accuracy']*100:.1f}% macroF1={m['macro_f1']:.3f} ECE={m['ece']:.3f}")

    # Mean-probability ensemble across the audio models (the honest +1–3pp lever).
    ens = _build_ensemble(oof_by_model, ens_eligible, ds, target_id, labels)
    if ens is not None:
        rows.append(ens)
        log(f"  [done] {ens['model']} (members={'+'.join(ens['members'])}) "
            f"balAcc={ens['balanced_accuracy']*100:.1f}% macroF1={ens['macro_f1']:.3f} ECE={ens['ece']:.3f}")

    rows.sort(key=lambda r: (r["balanced_accuracy"], r["macro_f1"], -r["ece"]), reverse=True)
    best = rows[0]

    log(f"  [perm] permutation significance ({permutations} perms, linear null-ref)…")
    perm = permutation_pvalue(ds, target_id, labels, folds=folds, permutations=permutations)
    log(f"  [perm] observed={perm['observed']*100:.1f}% null={perm['null_mean']*100:.1f}% p={perm['p_value']:.3f}")

    classical_baseline = ds.meta.get("classicalBaseline", {}).get(target_id)
    gate_threshold = ds.meta["gate"]["threshold"] if threshold is None else threshold
    gate = promotion_gate(
        best["balanced_accuracy"], best["ece"], perm["p_value"],
        classical_baseline=classical_baseline,
        threshold=gate_threshold,
        ece_cap=ds.meta["gate"]["eceCap"],
        max_p_value=ds.meta["gate"]["maxPValue"],
    )
    log(f"  [gate] best={best['model']} balAcc={best['balanced_accuracy']*100:.1f}% "
        f"vs classical {None if classical_baseline is None else f'{classical_baseline*100:.1f}%'} "
        f"→ {'PASS' if gate.passed else 'FAIL'} ({'; '.join(gate.reasons)})")

    return {
        "target": target_id,
        "target_description": target_meta.get("description", ""),
        "labels": labels,
        "n": n,
        "group_count": len(set(groups.tolist())),
        "device": device_name,
        "cohort": rows,
        "best": best,
        "permutation": perm,
        "classical_baseline": classical_baseline,
        "gate": gate.to_dict(),
        "promoted": gate.passed,
    }


def fit_full_best(ds: data.Dataset, target_id: str, labels, best_name: str, cohort: list[ModelSpec], device):
    """Refit the winning spec on ALL labelled rows (inner val for early stop) for the
    deployable artifact. Returns (model, feat_mean, feat_std, spec)."""
    spec = next((s for s in cohort if s.name == best_name), None)
    if spec is None:
        return None
    if _needs_audio([spec]):
        data.ensure_mels(ds)
    ds._target_labels = ds.labels_by_target[target_id]
    idx_all = np.where(ds.masks_by_target[target_id])[0]
    feat_dim = ds.features.shape[1]
    n_mels = ds.mels.shape[1] if ds.mels is not None else 0
    model, fmean, fstd, _ = evaluate._train_fold(spec, ds, idx_all, labels, feat_dim, n_mels, device)
    return model, fmean, fstd, spec


def write_results(all_results: list[dict], backend: dict, device_name: str) -> dict:
    out_dir = paths.neural_artifacts_dir()
    paths.assert_gitignored(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": "signal-lab-neural-results/0.1.0",
        "generatedAt": _now_iso(),
        "host": {"platform": platform.platform(), "python": platform.python_version()},
        "backend": backend,
        "device": device_name,
        "results": all_results,
    }
    p = out_dir / "neural_results.json"
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"path": str(p), "payload": payload}


def build_manifest(all_results: list[dict], device_name: str, backend: dict, promoted_artifacts: dict,
                   threshold: float = 0.80) -> dict:
    promoted = [r for r in all_results if r["promoted"]]
    top = max(promoted, key=lambda r: r["best"]["balanced_accuracy"]) if promoted else None
    FEATURE_FAMILIES = {"linear", "mlp"}
    top_is_feature = top is not None and top["best"].get("family") in FEATURE_FAMILIES
    return {
        "version": "signal-lab-neural-manifest/0.1.0",
        "generatedAt": _now_iso(),
        "kind": "neural",
        "device": device_name,
        "backend": backend,
        "gate": {
            "metric": "balanced_accuracy",
            "status": "EXPERIMENTAL",
            "threshold": threshold,
            "eceCap": 0.15,
            "maxPValue": 0.01,
            "extraRule": "neural balanced accuracy must exceed the classical baseline by >0.5pp to promote",
            "validation": "actor-grouped 5-fold CV + numpy-logreg permutation null-reference + top-class ECE",
        },
        "targets": [
            {
                "id": r["target"],
                "bestModel": r["best"]["model"],
                "family": r["best"].get("family"),
                "balancedAccuracy": r["best"]["balanced_accuracy"],
                "macroF1": r["best"]["macro_f1"],
                "ece": r["best"]["ece"],
                "pValue": r["permutation"]["p_value"],
                "classicalBaseline": r["classical_baseline"],
                "passedGate": r["promoted"],
                "artifact": promoted_artifacts.get(r["target"]),
            }
            for r in all_results
        ],
        "promoted": None if top is None else {
            "targetId": top["target"],
            "model": top["best"]["model"],
            "family": top["best"].get("family"),
            "balancedAccuracy": top["best"]["balanced_accuracy"],
            "classicalBaseline": top["classical_baseline"],
            "artifact": promoted_artifacts.get(top["target"]),
            "note": (
                "EXPERIMENTAL far-domain acted-speech PRIOR that cleared the gate AND beat the classical "
                "baseline. Coarse axis; penalty 0.45; NOT hum truth, NOT clinical (ADR-0005). Surfaced as "
                "an auxiliary gate-passed prior; does not by itself steer interventions."
            ),
        },
        "inferenceImpact": (
            "No neural target beat the classical baseline under the gate; the TS runtime keeps its classical "
            "fallback." if top is None else (
                f"Neural '{top['best']['model']}' promoted for '{top['target']}' as a feature-space model: exported to "
                f"a pure-JSON op-graph the TS runtime executes natively (no Python/ONNX/GPU); classical fallback "
                f"preserved if the artifact is absent." if top_is_feature else
                f"Neural '{top['best']['model']}' promoted for '{top['target']}' as an AUDIO (mel) model: it CANNOT run "
                f"in the pure-TS op-graph and is served by the Python inference CLI (research/training/infer.py). The "
                f"TS runtime keeps its classical model / heuristic fallback (no feature-space op-graph was produced for "
                f"this target). The promotion is an EXPERIMENTAL far-domain prior; it does not by itself steer interventions."
            )
        ),
        "servedBy": None if top is None else ("ts_opgraph" if top_is_feature else "python_cli"),
        "governance": (
            "RAVDESS acted speech, far domain (penalty 0.45). PRIOR only; never hum truth; never clinical (ADR-0005)."
        ),
    }


def write_model_card(all_results: list[dict], manifest: dict, device_name: str) -> str:
    """Write the human-readable, TRACKED model card (research/model-cards/).

    The only tracked output of the harness. Honest by construction: every number is
    measured this run; promotion claims carry their caveats (ADR-0004 card rule)."""
    def pct(x):
        return "—" if x is None else f"{x*100:.1f}%"

    promoted = manifest.get("promoted")
    L = []
    L.append("# Model Card — signal-lab NEURAL affect priors (v0)\n")
    L.append("> Generated by `research/training` (PyTorch). Machine artifacts + weights are git-ignored under "
             "`data/processed/signal-lab/neural/`; only this card is tracked. No fabricated numbers — every value "
             "is measured under actor-grouped 5-fold CV on this run.\n")
    L.append("## Overview\n")
    L.append(f"- **Device used:** {device_name} (auto-detected; Intel XPU → CUDA → CPU; CPU never required).")
    L.append(f"- **Datasets:** RAVDESS speech+song (acted_speech_emotion, far domain, penalty 0.45) — the ONLY "
             "locally affect-labelled corpus. VocalSet/VocalSound are domain/OOD only and carry no affect labels.")
    L.append("- **Status:** EXPERIMENTAL prior. NEVER hum truth, NEVER clinical, does NOT by itself steer "
             "interventions (ADR-0005).")
    L.append("\n## Promotion gate\n")
    g = manifest["gate"]
    L.append(f"- Metric **{g['metric']}** ≥ **{g['threshold']*100:.0f}%**, permutation p < {g['maxPValue']}, "
             f"ECE ≤ {g['eceCap']}, under {g['validation']}.")
    L.append(f"- Extra promotion rule: {g['extraRule']}.")
    L.append("\n## Results (this run)\n")
    L.append("| target | best model | family | balanced acc | classical baseline | macro-F1 | ECE | perm p | promoted? |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in all_results:
        b = r["best"]
        L.append(f"| `{r['target']}` | {b['model']} | {b.get('family','')} | **{pct(b['balanced_accuracy'])}** | "
                 f"{pct(r['classical_baseline'])} | {b['macro_f1']:.3f} | {b['ece']:.3f} | "
                 f"{r['permutation']['p_value']:.3f} | {'✅ yes' if r['promoted'] else '❌ no'} |")
    L.append("\n### Full cohort per target\n")
    for r in all_results:
        L.append(f"\n**`{r['target']}`** ({r['n']} samples, {r['group_count']} actor groups):\n")
        L.append("| model | family | balanced acc | accuracy | macro-F1 | ECE |")
        L.append("|---|---|---|---|---|---|")
        for m in r["cohort"]:
            L.append(f"| {m['model']} | {m.get('family','')} | {pct(m['balanced_accuracy'])} | "
                     f"{pct(m['accuracy'])} | {m['macro_f1']:.3f} | {m['ece']:.3f} |")
    L.append("\n## Promotion outcome\n")
    if promoted:
        L.append(f"- **PROMOTED:** `{promoted['model']}` for `{promoted['targetId']}` at "
                 f"{pct(promoted['balancedAccuracy'])} (beat classical {pct(promoted['classicalBaseline'])}).")
        L.append(f"- {promoted['note']}")
        L.append(f"- {manifest['inferenceImpact']}")
    else:
        L.append("- **No neural model was promoted.** No target cleared the gate AND beat the classical baseline; "
                 "the TypeScript runtime keeps its classical model / heuristic fallback.")
        L.append(f"- {manifest['inferenceImpact']}")
    L.append("\n## Significance & validation\n")
    L.append("- Actor-grouped 5-fold CV: no speaker appears in both train and test of a fold (replicates the "
             "classical cohort's `groupFolds` partition exactly).")
    L.append("- Significance: label-permutation on balanced accuracy using a numpy-LogReg linear null reference "
             "over the same folds (mirrors `experiment.ts`) — it establishes the TARGET carries real, learnable "
             "feature↔label signal; it is not a per-neural-model bootstrap.")
    L.append("- Class imbalance handled by inverse-frequency class weighting in the loss; balanced accuracy "
             "(chance = 1/K) is the headline so a skewed prior cannot inflate it.")
    L.append("\n## Limitations & risks\n")
    L.append("- Acted (performed) far-domain speech; arousal/valence are coarse axes, not the 6-way affect head.")
    L.append("- No native-hum corpus exists; NOTHING here is validated on a real user's hum. Remains a prior.")
    L.append("- Feature-space winners run in the TS runtime via a pure-JSON op-graph (no Python/ONNX/GPU); audio "
             "(mel) winners are served only by the Python CLI wrapper, with TS classical fallback preserved.")
    out = paths.model_cards_dir() / "signal-lab-neural-affect-prior-v0.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    return str(out)


def write_manifest(manifest: dict) -> str:
    out = paths.neural_artifacts_dir() / "neural_model_manifest.json"
    paths.assert_gitignored(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return str(out)
