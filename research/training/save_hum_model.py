"""Fit + save the deployable HUM affect prior (winning mel model on hum-ified RAVDESS).

Refits the cohort winner on ALL hum-projected labelled rows and writes a git-ignored
checkpoint that `infer.py` / `runtime_gate.gated_read` can serve. Far-domain hum-projected
PRIOR only (ADR-0005)."""
from __future__ import annotations

import sys

import numpy as np
import torch

from research.training.signal_neural import corpora, device as devmod, paths
from research.training.signal_neural.train import audio_cohort, fit_full_best
from research.training.run_mel import build_dataset, extract_pooled_mels


def main(argv):
    target = argv[0] if argv else "arousal_binary"
    best = argv[1] if len(argv) > 1 else "mel_cnn2d"
    device, dev = devmod.select_device("xpu")
    items = corpora.pooled_items(include_cremad=False)          # RAVDESS (speech+song)
    mels = extract_pooled_mels(items, "hum")
    ds = build_dataset(items, mels, 0.85)
    labels = next(t["classes"] for t in ds.meta["targets"] if t["id"] == target)
    print(f"[fit] {best} on hum-ified {target} ({int(ds.masks_by_target[target].sum())} rows) …")
    fitted = fit_full_best(ds, target, labels, best, audio_cohort(), device)
    if fitted is None:
        print("[fit] no spec matched — abort"); return 1
    model, fmean, fstd, spec = fitted
    ckpt_dir = paths.checkpoints_dir(); paths.assert_gitignored(ckpt_dir); ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt = ckpt_dir / f"model.hum.{target}.pt"
    torch.save({
        "state_dict": model.state_dict(), "spec": spec.name, "family": spec.family,
        "input_kind": spec.input_kind, "labels": labels,
        "feat_mean": fmean.tolist(), "feat_std": fstd.tolist(),
        "target": target, "domain": "hum",
        "note": "Hum-projected far-domain affect PRIOR (ADR-0005); coarse axis; not hum truth, not clinical.",
    }, ckpt)
    print(f"[fit] saved -> {ckpt}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
