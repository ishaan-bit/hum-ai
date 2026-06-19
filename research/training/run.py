"""Signal-Lab neural harness CLI.

Examples (from repo root, after `npm run signal:export-neural`):
  python -m research.training.run smoke
  python -m research.training.run --target arousal_binary --cohort all
  python -m research.training.run --target all --cohort all --device auto
  python -m research.training.run device           # print detected acceleration

All machine artifacts are git-ignored under data/processed/signal-lab/neural/.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import torch

from research.training.signal_neural import data, device as devmod, export_ts, paths, train
from research.training.signal_neural.train import (
    audio_cohort, build_manifest, feature_cohort, fit_full_best, run_target,
    write_manifest, write_model_card, write_results,
)

TARGETS = ["arousal_binary", "valence_binary", "affect_fusion_label"]


def _select_cohort(name: str):
    if name == "feature":
        return feature_cohort()
    if name == "audio":
        return audio_cohort()
    return feature_cohort() + audio_cohort()


def _subsample(ds: data.Dataset, row_cap: int) -> data.Dataset:
    """Deterministic stride subsample for smoke runs (keeps actor coverage)."""
    n = len(ds.rows)
    if n <= row_cap:
        return ds
    step = n / row_cap
    keep = sorted({int(i * step) for i in range(row_cap)})
    ds.rows = [ds.rows[i] for i in keep]
    ds.features = ds.features[keep]
    ds.groups = ds.groups[keep]
    for tid in ds.labels_by_target:
        ds.labels_by_target[tid] = ds.labels_by_target[tid][keep]
        ds.masks_by_target[tid] = ds.masks_by_target[tid][keep]
    return ds


def _save_promoted(ds, result, cohort, device, device_name) -> str | None:
    """Persist a promoted model: TS op-graph (feature winner) or checkpoint (audio)."""
    target_id = result["target"]
    labels = result["labels"]
    best_name = result["best"]["model"]
    if best_name == "numpy_logreg":
        return None  # linear reference is the classical model; nothing neural to promote
    fitted = fit_full_best(ds, target_id, labels, best_name, cohort, device)
    if fitted is None:
        return None
    model, fmean, fstd, spec = fitted
    if spec.input_kind == "feat":
        path = export_ts.export_feature_model(
            model, fmean, fstd, target_id=target_id, labels=labels,
            feature_names=ds.feature_names, family=spec.family,
            version=f"signal-lab-neural-{target_id}/0.1.0",
            balanced_accuracy=result["best"]["balanced_accuracy"],
            ece=result["best"]["ece"], p_value=result["permutation"]["p_value"],
            classical_baseline=result["classical_baseline"],
        )
        return path
    # audio model → save a checkpoint (git-ignored) for the Python inference wrapper
    ckpt_dir = paths.checkpoints_dir()
    paths.assert_gitignored(ckpt_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt = ckpt_dir / f"model.neural.{target_id}.pt"
    torch.save({
        "state_dict": model.state_dict(),
        "spec": spec.name, "family": spec.family, "input_kind": spec.input_kind,
        "labels": labels, "feat_mean": fmean.tolist(), "feat_std": fstd.tolist(),
        "target": target_id,
    }, ckpt)
    return str(ckpt)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Signal-Lab neural training harness")
    ap.add_argument("mode", nargs="?", default="run", choices=["run", "smoke", "device"])
    ap.add_argument("--target", default="all", help="arousal_binary|valence_binary|affect_fusion_label|all")
    ap.add_argument("--cohort", default="all", choices=["feature", "audio", "all"])
    ap.add_argument("--device", default="auto", choices=["auto", "xpu", "cuda", "cpu"])
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--permutations", type=int, default=150)
    ap.add_argument("--row-cap", type=int, default=0, help="subsample rows (0 = all)")
    ap.add_argument("--epochs", type=int, default=0, help="override max epochs (0 = per-spec default)")
    args = ap.parse_args(argv)

    if args.mode == "device":
        print(devmod.describe(args.device))
        print(devmod.available_backends())
        return 0

    device, device_name = devmod.select_device(args.device)
    backend = devmod.available_backends()
    print(f"[device] {devmod.describe(args.device)}")

    if args.mode == "smoke":
        args.row_cap = args.row_cap or 240
        args.permutations = min(args.permutations, 24)
        args.target = "arousal_binary" if args.target == "all" else args.target
        args.cohort = args.cohort if args.cohort != "all" else "all"
        epochs_override = args.epochs or 6
    else:
        epochs_override = args.epochs or 0

    ds = data.load_export()
    print(f"[data] {len(ds.rows)} rows, {len(set(ds.groups.tolist()))} actor groups, "
          f"{ds.features.shape[1]} features; targets={[t['id'] for t in ds.meta['targets']]}")
    if args.row_cap:
        ds = _subsample(ds, args.row_cap)
        print(f"[data] subsampled to {len(ds.rows)} rows ({len(set(ds.groups.tolist()))} groups)")

    cohort = _select_cohort(args.cohort)
    if epochs_override:
        for s in cohort:
            s.epochs = epochs_override

    targets = TARGETS if args.target == "all" else [t.strip() for t in args.target.split(",")]
    # Incremental merge: keep prior targets' results so running a target at a time
    # still produces ONE complete manifest/card across all targets.
    prior_results: list[dict] = []
    prior_artifacts: dict[str, str | None] = {}
    rp = paths.neural_artifacts_dir() / "neural_results.json"
    mp = paths.neural_artifacts_dir() / "neural_model_manifest.json"
    if args.mode != "smoke" and args.row_cap == 0 and rp.exists():
        try:
            prior_results = [r for r in json.loads(rp.read_text(encoding="utf-8")).get("results", [])
                             if r["target"] not in targets]
        except Exception:
            prior_results = []
    if mp.exists():
        try:
            for t in json.loads(mp.read_text(encoding="utf-8")).get("targets", []):
                if t["id"] not in targets:
                    prior_artifacts[t["id"]] = t.get("artifact")
        except Exception:
            pass

    all_results = list(prior_results)
    promoted_artifacts: dict[str, str | None] = dict(prior_artifacts)
    for tid in targets:
        result = run_target(ds, tid, cohort, device, device_name,
                            folds=args.folds, permutations=args.permutations, log=print)
        all_results.append(result)
        if result["promoted"]:
            try:
                promoted_artifacts[tid] = _save_promoted(ds, result, cohort, device, device_name)
                print(f"[promote] {tid}: artifact → {promoted_artifacts[tid]}")
            except Exception as e:  # never let artifact export crash the run
                print(f"[promote] {tid}: artifact export failed: {e}")
                promoted_artifacts[tid] = None

    res = write_results(all_results, backend, device_name)
    manifest = build_manifest(all_results, device_name, backend, promoted_artifacts)
    mpath = write_manifest(manifest)
    card = write_model_card(all_results, manifest, device_name)
    print(f"\n[artifacts] results → {res['path']}")
    print(f"[artifacts] manifest → {mpath}")
    print(f"[artifacts] model card (tracked) → {card}")

    print("\n=== SUMMARY ===")
    for r in all_results:
        cb = r["classical_baseline"]
        print(f"  {r['target']:20s} best={r['best']['model']:16s} "
              f"balAcc={r['best']['balanced_accuracy']*100:5.1f}% "
              f"(classical {None if cb is None else f'{cb*100:.1f}%'}) "
              f"ECE={r['best']['ece']:.3f} p={r['permutation']['p_value']:.3f} "
              f"→ {'PROMOTED' if r['promoted'] else 'kept classical'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
