"""Train + evaluate the STRICT capture-acceptance gate (Stage ① of the hum flow).

Builds a labeled accept(hum) / reject(everything else) set from the corpora on disk
plus synthetic noise/silence, extracts dependency-free signal-quality features, and
evaluates a speaker/corpus-GROUPED logistic gate (no speaker leaks across folds). Reports
per-source accept rates so we can SEE that it rejects noise/silence/speech/sigh/whistle
and accepts hums. The chosen strict threshold + feature weights are saved (git-ignored).

  python -m research.training.run_gate                 # default sample sizes
  python -m research.training.run_gate --per 400
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np

from research.training.signal_neural import acceptance, corpora, paths
from research.training.signal_neural.data import _decode_wav_bytes, _resample_to_target
from research.training.signal_neural.linref import train_logreg
from research.training.signal_neural.metrics import balanced_accuracy

RAW = paths.repo_root() / "data" / "raw"


def _zip_wavs(zip_path: Path, pred, cap: int, rng) -> list[tuple[str, bytes]]:
    if not zip_path.exists():
        return []
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".wav") and "__MACOSX" not in n and pred(n)]
        rng.shuffle(names)
        return [(n, z.read(n)) for n in names[:cap]]


def _decode(b: bytes) -> np.ndarray:
    x, sr = _decode_wav_bytes(b)
    return _resample_to_target(x, sr)


def collect(per: int, rng) -> list[dict]:
    """Return samples: {wav, label(1=hum/accept,0=reject), group, source}."""
    S: list[dict] = []

    # ---- POSITIVES (accept = clear sustained voiced hum) ----
    # VocalSet sustained singing — the most hum-like real audio. group = singer.
    for name, b in _zip_wavs(RAW / "vocalset" / "VocalSet11.zip", lambda n: True, per, rng):
        singer = name.split("/")[1] if "/" in name else "vs"
        S.append({"wav": _decode(b), "label": 1, "group": f"vocalset:{singer}", "source": "vocalset_sing"})
    # Hum-ified speech — hums by construction. group = ravdess actor (distinct from raw).
    rav = corpora.load_ravdess_items(); rng.shuffle(rav)
    for it in rav[:per]:
        S.append({"wav": corpora.load_waveform(it, domain="hum"), "label": 1,
                  "group": f"humified:{it.group}", "source": "humified_speech"})

    # ---- NEGATIVES (reject) ----
    # Vocal bursts: sigh / breath / cough / throat-clear / sneeze / sniff / laughter.
    for name, b in _zip_wavs(RAW / "vocalsound" / "vocalsound_16k.zip", lambda n: True, per, rng):
        spk = Path(name).stem.split("_")[0]
        typ = Path(name).stem.split("_")[-1]
        S.append({"wav": _decode(b), "label": 0, "group": f"vocalsound:{spk}", "source": f"burst_{typ}"})
    # Raw speech (strict: reject — it's articulation-heavy, not a hum).
    for it in rav[per:2 * per]:
        S.append({"wav": corpora.load_waveform(it, domain="raw"), "label": 0,
                  "group": f"speech:{it.group}", "source": "raw_speech"})
    # Whistle (strict: reject — near-pure tone, not a voiced hum).
    for it in rav[2 * per:2 * per + per // 2]:
        S.append({"wav": corpora.load_waveform(it, domain="whistle"), "label": 0,
                  "group": f"whistle:{it.group}", "source": "whistle"})
    # Synthetic noise / silence — we must NEVER process these.
    for j in range(per // 2):
        for kind in ("white", "pink", "silence", "hum_plus_noise"):
            S.append({"wav": acceptance.make_noise(kind, rng=rng), "label": 0,
                      "group": f"synth:{kind}:{j%8}", "source": f"noise_{kind}"})
    return S


def grouped_folds(groups, folds=5):
    uniq = sorted(set(groups))
    gf = {g: i % folds for i, g in enumerate(uniq)}
    return np.array([gf[g] for g in groups])


def main(argv):
    for _s in (sys.stdout, sys.stderr):
        try: _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=350, help="samples per major source")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--threshold", type=float, default=0.5, help="strict accept threshold on P(hum)")
    args = ap.parse_args(argv)
    rng = np.random.default_rng(20240617)

    print(f"[gate] collecting samples (per={args.per}) …")
    S = collect(args.per, rng)
    X = np.stack([acceptance.quality_features(s["wav"]) for s in S]).astype(np.float64)
    y = np.array([s["label"] for s in S])
    groups = [s["group"] for s in S]
    sources = np.array([s["source"] for s in S])
    print(f"[gate] {len(S)} samples | accept(hum)={int(y.sum())} reject={int((y==0).sum())} | "
          f"{len(set(groups))} groups | {X.shape[1]} features")

    # Grouped CV: out-of-fold P(hum) for every sample (no speaker leakage).
    fold = grouped_folds(groups, args.folds)
    proba = np.zeros(len(S))
    labels = [0, 1]
    for f in range(args.folds):
        te, tr = fold == f, fold != f
        if te.sum() == 0 or len(set(y[tr].tolist())) < 2:
            continue
        clf = train_logreg(X[tr], y[tr], labels)
        proba[te] = clf.predict_proba(X[te])[:, 1]
    pred = (proba >= args.threshold).astype(int)
    bal = balanced_accuracy(y.tolist(), pred.tolist(), labels)
    acc = float((pred == y).mean())
    # hum precision/recall (accepting a non-hum is the dangerous error)
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    prec = tp / max(1, tp + fp); rec = tp / max(1, tp + fn)
    print(f"\n[gate] OOF balanced_acc={bal*100:.1f}% acc={acc*100:.1f}% | "
          f"hum precision={prec*100:.1f}% recall={rec*100:.1f}% (thr={args.threshold})")
    print(f"[gate] leakage risk = accepting a NON-hum: {fp}/{int((y==0).sum())} "
          f"({fp/max(1,(y==0).sum())*100:.1f}% of rejects slipped through)")

    print("\n[gate] per-source ACCEPT rate (want HIGH for hum, ~0 for the rest):")
    for src in sorted(set(sources.tolist())):
        m = sources == src
        print(f"   {src:22s} n={int(m.sum()):4d}  accept={pred[m].mean()*100:5.1f}%  meanP(hum)={proba[m].mean():.2f}")

    # Fit final gate on all data; save weights + threshold (git-ignored).
    clf = train_logreg(X, y, labels)
    out = paths.neural_artifacts_dir() / "capture_gate.json"
    paths.assert_gitignored(out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "version": "signal-lab-capture-gate/0.1.0",
        "policy": "strict", "threshold": args.threshold,
        "features": acceptance.QUALITY_FEATURES,
        "standardizer": {"mean": clf.mean.tolist(), "std": clf.sd.tolist()},
        "weights": clf.W.tolist(), "bias": clf.b.tolist(), "labels": ["reject", "hum"],
        "oof": {"balanced_accuracy": bal, "hum_precision": prec, "hum_recall": rec},
        "governance": "Stage-① usable-hum gate. If P(hum)<threshold → ask user to hum again; affect is NEVER run on rejected captures.",
    }, indent=2), encoding="utf-8")
    print(f"\n[artifacts] capture gate → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
