"""Pooled mel-CNN cohort runner — the GPU-native, hum-transferable affect track.

Runs the from-scratch mel cohort (cnn1d / cnn1d_wide / cnn2d + ensemble) on the POOLED
RAVDESS+CREMA-D data on the Intel Arc XPU (1-D/2-D convs are fast on this iGPU; this is
how we keep the GPU busy while wav2vec2 embeddings extract on CPU). Mel spectrograms
capture pitch / energy / timbre rather than phonemes, so this track degrades less when
projected toward the hum domain (--domain hum) than the speech-pretrained embeddings.

  python -m research.training.run_mel --device xpu --threshold 0.85           # speech-mel
  python -m research.training.run_mel --device xpu --domain hum --threshold 0.85   # hum-mel

Mels (+ a mel-derived feature floor for the linear reference) are cached git-ignored.
Reuses run_target so CV / ensemble / permutation / gate are identical to the rest.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np

from research.training.signal_neural import corpora, data as datamod, device as devmod, paths
from research.training.signal_neural.data import Dataset
from research.training.signal_neural.train import _now_iso, audio_cohort, run_target
from research.training.run_sota import TARGET_DEFS


def _mels_cache(domain: str, n: int):
    return paths.cache_dir() / f"pooled_mels_{datamod.MEL_CONFIG_TAG}_{domain}_n{n}.npy"


def extract_pooled_mels(items, domain: str, log=print) -> np.ndarray:
    cache = _mels_cache(domain, len(items))
    if cache.exists():
        mels = np.load(cache)
        log(f"  [mel] loaded cache {cache.name} {mels.shape}")
        return mels
    mels = None
    t0 = time.time()
    for i, it in enumerate(items):
        x = datamod._fix_length(corpora.load_waveform(it, domain=domain))
        lm = datamod._log_mel(x)
        if mels is None:
            mels = np.zeros((len(items), lm.shape[0], lm.shape[1]), dtype=np.float32)
        t = min(lm.shape[1], mels.shape[2])
        mels[i, :, :t] = lm[:, :t]
        if i % 500 == 0 or i == len(items) - 1:
            rate = (i + 1) / max(1e-6, time.time() - t0)
            log(f"  [mel] {i+1}/{len(items)} ({rate:.0f}/s, ~{(len(items)-i-1)/max(rate,1e-6)/60:.0f} min left)")
    paths.assert_gitignored(cache); cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, mels)
    log(f"  [mel] cached → {cache.name} {mels.shape}")
    return mels


def build_dataset(items, mels, threshold) -> Dataset:
    # mel-derived feature floor for the linear reference (per-band mean+std over time).
    feats = np.concatenate([mels.mean(axis=2), mels.std(axis=2)], axis=1).astype(np.float32)
    groups = np.array([it.group for it in items], dtype=object)
    labels_by_target, masks_by_target = {}, {}
    for td in TARGET_DEFS:
        tid = td["id"]
        labels_by_target[tid] = np.array([it.targets.get(tid) or "" for it in items], dtype=object)
        masks_by_target[tid] = np.array([it.targets.get(tid) is not None for it in items], dtype=bool)
    meta = {"targets": TARGET_DEFS, "gate": {"threshold": threshold, "eceCap": 0.15, "maxPValue": 0.01},
            "classicalBaseline": {}}
    return Dataset(meta=meta, rows=[it.uid for it in items], features=feats,
                   labels_by_target=labels_by_target, masks_by_target=masks_by_target, groups=groups,
                   feature_names=[f"melstat{i}" for i in range(feats.shape[1])], mels=mels)


def main(argv):
    for _s in (sys.stdout, sys.stderr):
        try: _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    ap = argparse.ArgumentParser(description="Pooled mel-CNN affect cohort (GPU-native)")
    ap.add_argument("--device", default="xpu", choices=["auto", "xpu", "cuda", "cpu"])
    ap.add_argument("--domain", default="raw", choices=["raw", "hum", "whistle"])
    ap.add_argument("--target", default="all")
    ap.add_argument("--no-cremad", action="store_true")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--permutations", type=int, default=200)
    ap.add_argument("--threshold", type=float, default=0.85)
    args = ap.parse_args(argv)

    device, device_name = devmod.select_device(args.device)
    print(f"[device] {devmod.describe(args.device)}")
    items = corpora.pooled_items(include_cremad=not args.no_cremad)
    summ = corpora.summarize(items)
    print(f"[data] pooled {summ['n']} clips, {summ['n_groups']} speakers, by_corpus={summ['by_corpus']} domain={args.domain}")

    mels = extract_pooled_mels(items, args.domain)
    ds = build_dataset(items, mels, args.threshold)
    targets = ["arousal_binary", "valence_binary", "affect_fusion_label"] if args.target == "all" \
        else [t.strip() for t in args.target.split(",")]

    results = []
    for tid in targets:
        results.append(run_target(ds, tid, audio_cohort(), device, device_name,
                                  folds=args.folds, permutations=args.permutations, log=print,
                                  threshold=args.threshold))
    out = paths.neural_artifacts_dir() / f"mel_pooled_results_{args.domain}.json"
    paths.assert_gitignored(out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"version": "signal-lab-mel-pooled/0.1.0", "generatedAt": _now_iso(),
                               "device": device_name, "domain": args.domain, "pooledData": summ,
                               "gateThreshold": args.threshold, "results": results}, indent=2), encoding="utf-8")
    print(f"\n[artifacts] mel pooled → {out}")
    print("\n=== MEL POOLED SUMMARY ===")
    for r in results:
        print(f"  {r['target']:20s} best={r['best']['model']:16s} balAcc={r['best']['balanced_accuracy']*100:5.1f}% "
              f"ECE={r['best']['ece']:.3f} p={r['permutation']['p_value']:.3f} "
              f"→ {'PASS' if r['gate']['passed'] else 'FAIL'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
