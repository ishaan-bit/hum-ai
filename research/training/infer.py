"""Python inference wrapper for a promoted NEURAL model (new-hum inference).

This is the runtime path for a promoted AUDIO (mel) model — the kind that cannot run
in the pure-TS op-graph executor. It loads the git-ignored checkpoint and predicts a
coarse axis (e.g. arousal) for a single WAV. Feature-space winners do NOT need this:
they run natively in the TS runtime via `model.neural.<target>.json`.

Honesty (ADR-0005): the output is a far-domain acted-speech PRIOR (penalty 0.45),
a coarse axis, NOT hum truth, NOT clinical. It is auxiliary evidence only.

Usage:
  python -m research.training.infer --checkpoint data/processed/signal-lab/neural/checkpoints/model.neural.arousal_binary.pt --wav path/to/clip.wav
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import torch

from research.training.signal_neural import data, device as devmod, models, paths


def _build_from_spec(spec_name: str, feat_dim: int, n_mels: int, n_classes: int):
    factory = {
        "mel_cnn2d": lambda: models.MelCNN2D(n_mels, n_classes),
        "mel_cnn1d": lambda: models.MelCNN1D(n_mels, n_classes),
        "mel_bigru": lambda: models.MelBiGRU(n_mels, n_classes),
        "mel_crnn": lambda: models.MelCRNN(n_mels, n_classes),
        "hybrid_mel_feat": lambda: models.HybridMelFeat(n_mels, feat_dim, n_classes),
        "feature_mlp": lambda: models.FeatureMLP(feat_dim, n_classes),
        "linear_probe": lambda: models.LinearProbe(feat_dim, n_classes),
    }[spec_name]
    return factory()


def predict_wav(checkpoint: str, wav_path: str, device_name: str = "auto") -> dict:
    device, dev = devmod.select_device(device_name)
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    labels = ckpt["labels"]
    input_kind = ckpt["input_kind"]
    feat_mean = np.array(ckpt["feat_mean"], dtype=np.float32)
    feat_std = np.array(ckpt["feat_std"], dtype=np.float32)

    with open(wav_path, "rb") as f:
        x, sr = data._decode_wav_bytes(f.read())
    x = data._fix_length(data._resample_to_target(x, sr))
    mel = data._log_mel(x)[None, :, :]  # [1, n_mels, T]
    n_mels = mel.shape[1]

    # NOTE: feature-space checkpoints would need the engineered feature vector, which
    # is produced by the TS extractor; audio models only need the waveform/mel.
    model = _build_from_spec(ckpt["spec"], feat_dim=len(feat_mean), n_mels=n_mels, n_classes=len(labels))
    model.load_state_dict(ckpt["state_dict"])
    model.to(device).eval()

    with torch.no_grad():
        if input_kind == "mel":
            logits = model(torch.tensor(mel, dtype=torch.float32, device=device))
        elif input_kind == "mel_seq":
            logits = model(torch.tensor(mel.transpose(0, 2, 1), dtype=torch.float32, device=device))
        else:
            raise SystemExit(
                f"input_kind '{input_kind}' needs engineered features — use the TS op-graph "
                f"(model.neural.{ckpt['target']}.json) for feature-space models."
            )
        proba = torch.softmax(logits, dim=1).cpu().numpy()[0]
    top = int(proba.argmax())
    return {
        "target": ckpt["target"],
        "model": ckpt["spec"],
        "device": dev,
        "topLabel": labels[top],
        "probability": float(proba[top]),
        "distribution": {labels[i]: float(proba[i]) for i in range(len(labels))},
        "note": "Far-domain acted-speech PRIOR (penalty 0.45); auxiliary only; not hum truth, not clinical (ADR-0005).",
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Neural prior inference for a single WAV")
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--wav", required=True)
    ap.add_argument("--device", default="auto", choices=["auto", "xpu", "cuda", "cpu"])
    args = ap.parse_args(argv)
    print(json.dumps(predict_wav(args.checkpoint, args.wav, args.device), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
