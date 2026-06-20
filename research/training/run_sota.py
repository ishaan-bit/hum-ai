"""SOTA pooled-affect runner — pretrained-backbone embeddings + head, grouped CV.

Pools RAVDESS + CREMA-D into one actor-grouped dataset, extracts FROZEN self-supervised
speech embeddings (wav2vec2 / WavLM / HuBERT — pretrained on ~960 h+ of unlabelled
speech), and trains a feature-space head under the SAME actor-grouped 5-fold CV +
label-permutation significance + promotion gate as the rest of the harness (reuses
`run_target`, so metrics / ensemble / gate are byte-identical and the comparison is honest).

  python -m research.training.run_sota --device xpu --threshold 0.85
  python -m research.training.run_sota --model microsoft/wavlm-base-plus --no-cremad

All machine artifacts are git-ignored under data/processed/signal-lab/neural/.
"""
from __future__ import annotations

import argparse
import json
import platform
import sys

import numpy as np

from research.training.signal_neural import corpora, device as devmod, embed, models, paths
from research.training.signal_neural.data import Dataset
from research.training.signal_neural.evaluate import ModelSpec
from research.training.signal_neural.train import _now_iso, run_target

AFFECT_CLASSES = ["calm_regulated", "positive_activation", "high_arousal_negative",
                  "low_mood", "tense_anxious", "neutral_close_to_usual"]
TARGET_DEFS = [
    {"id": "affect_fusion_label", "classes": AFFECT_CLASSES, "description": "6-way fusion affect (pooled)"},
    {"id": "arousal_binary", "classes": ["low_arousal", "high_arousal"], "description": "binary arousal (pooled)"},
    {"id": "valence_binary", "classes": ["negative_valence", "positive_valence"], "description": "binary valence (pooled)"},
]


def build_dataset(items, emb, threshold) -> Dataset:
    groups = np.array([it.group for it in items], dtype=object)
    labels_by_target, masks_by_target = {}, {}
    for td in TARGET_DEFS:
        tid = td["id"]
        labels_by_target[tid] = np.array([it.targets.get(tid) or "" for it in items], dtype=object)
        masks_by_target[tid] = np.array([it.targets.get(tid) is not None for it in items], dtype=bool)
    meta = {
        "targets": TARGET_DEFS,
        "gate": {"threshold": threshold, "eceCap": 0.15, "maxPValue": 0.01},
        "classicalBaseline": {},     # new pooled dataset → in-harness linear ref is the floor
    }
    return Dataset(meta=meta, rows=[it.uid for it in items], features=emb.astype(np.float32),
                   labels_by_target=labels_by_target, masks_by_target=masks_by_target, groups=groups,
                   feature_names=[f"emb{i}" for i in range(emb.shape[1])], mels=None)


def sota_cohort() -> list[ModelSpec]:
    """Heads over the frozen embedding. Seed-bagged + mean-prob ensembled; the embedding
    already carries the pretrained signal so a strong MLP head is enough."""
    base = dict(optimizer="adamw", scheduler="cosine", label_smoothing=0.05, grad_clip=5.0,
                batch_size=128, weight_decay=1e-3, ensemble=True)
    return [
        ModelSpec("emb_linear", "linear", lambda fd, nm, nc: models.LinearProbe(fd, nc),
                  "feat", epochs=90, lr=2e-3, patience=14, bag=3, **base),
        ModelSpec("emb_mlp", "mlp", lambda fd, nm, nc: models.FeatureMLP(fd, nc, hidden=(512, 256), dropout=0.4),
                  "feat", epochs=130, lr=1e-3, patience=18, bag=5, mixup=0.2, **base),
        ModelSpec("emb_mlp_deep", "mlp", lambda fd, nm, nc: models.FeatureMLP(fd, nc, hidden=(768, 384, 192), dropout=0.45),
                  "feat", epochs=130, lr=1e-3, patience=18, bag=5, mixup=0.2, **base),
    ]


def main(argv: list[str]) -> int:
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="SOTA pooled-affect runner (pretrained embeddings)")
    ap.add_argument("--device", default="auto", choices=["auto", "xpu", "cuda", "cpu"])
    ap.add_argument("--model", default=embed.DEFAULT_MODEL, help="HF backbone id (wav2vec2/WavLM/HuBERT)")
    ap.add_argument("--layer-pool", default="last4", choices=["last", "last4"])
    ap.add_argument("--domain", default="raw", choices=["raw", "hum", "whistle"],
                    help="raw=speech benchmark; hum/whistle=project to the hum domain before extraction")
    ap.add_argument("--target", default="all")
    ap.add_argument("--no-cremad", action="store_true", help="RAVDESS only (ablation)")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--permutations", type=int, default=200)  # ≥100 so the gate can reach p<0.01
    ap.add_argument("--threshold", type=float, default=0.85)
    ap.add_argument("--emb-device", default="", help="device for embedding extraction (default: same as --device)")
    args = ap.parse_args(argv)

    device, device_name = devmod.select_device(args.device)
    print(f"[device] {devmod.describe(args.device)}")

    items = corpora.pooled_items(include_cremad=not args.no_cremad)
    summ = corpora.summarize(items)
    print(f"[data] pooled {summ['n']} clips, {summ['n_groups']} speaker groups, by_corpus={summ['by_corpus']}")
    for tid in ("arousal_binary", "valence_binary", "affect_fusion_label"):
        print(f"[data]   {tid}: n={summ[tid]['n']} classes={summ[tid]['classes']}")

    emb_device = device
    if args.emb_device:
        emb_device, _ = devmod.select_device(args.emb_device)
    emb = embed.extract_embeddings(items, emb_device, model_name=args.model, layer_pool=args.layer_pool,
                                   domain=args.domain)
    print(f"[emb] embedding matrix {emb.shape} via {args.model} ({args.layer_pool}, domain={args.domain})")

    ds = build_dataset(items, emb, args.threshold)
    targets = ["arousal_binary", "valence_binary", "affect_fusion_label"] if args.target == "all" \
        else [t.strip() for t in args.target.split(",")]

    all_results = []
    for tid in targets:
        all_results.append(run_target(ds, tid, sota_cohort(), device, device_name,
                                      folds=args.folds, permutations=args.permutations, log=print,
                                      threshold=args.threshold))

    out_dir = paths.neural_artifacts_dir()
    paths.assert_gitignored(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": "signal-lab-sota-results/0.1.0",
        "generatedAt": _now_iso(),
        "host": {"platform": platform.platform()},
        "device": device_name,
        "backbone": args.model,
        "layerPool": args.layer_pool,
        "domain": args.domain,
        "pooledData": summ,
        "gateThreshold": args.threshold,
        "results": all_results,
    }
    p = out_dir / (f"sota_results_{args.domain}.json" if args.domain != "raw" else "sota_results.json")
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\n[artifacts] sota results → {p}")

    print("\n=== SOTA SUMMARY ===")
    for r in all_results:
        print(f"  {r['target']:20s} best={r['best']['model']:16s} "
              f"balAcc={r['best']['balanced_accuracy']*100:5.1f}% "
              f"ECE={r['best']['ece']:.3f} p={r['permutation']['p_value']:.3f} "
              f"→ {'PASS' if r['gate']['passed'] else 'FAIL'} (gate {args.threshold*100:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
