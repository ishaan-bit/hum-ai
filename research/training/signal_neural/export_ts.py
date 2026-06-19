"""Export a feature-space neural model (LinearProbe / FeatureMLP) to a pure-JSON
op-graph that a tiny TypeScript forward pass can execute.

This is the gold integration path: a feature-space winner runs in the TS runtime
with NO Python, ONNX, or GPU dependency — same input contract as the classical
LogReg (the 58-d `toFeatureVector`). Only feature-space models are exportable this
way; audio (mel) winners are served via the Python CLI wrapper instead.

Op graph (executed in order on the raw 58-d feature vector):
  standardize → [linear → batchnorm → relu]* → linear → softmax(at read time)
BatchNorm1d is folded to its eval-time affine form; Dropout is identity at eval.
"""
from __future__ import annotations

import json

import numpy as np
import torch.nn as nn

from . import paths


def _linear_op(m: nn.Linear) -> dict:
    return {"op": "linear", "W": m.weight.detach().cpu().numpy().tolist(),
            "b": m.bias.detach().cpu().numpy().tolist()}


def _batchnorm_op(m: nn.BatchNorm1d) -> dict:
    return {
        "op": "batchnorm",
        "mean": m.running_mean.detach().cpu().numpy().tolist(),
        "var": m.running_var.detach().cpu().numpy().tolist(),
        "weight": m.weight.detach().cpu().numpy().tolist(),
        "bias": m.bias.detach().cpu().numpy().tolist(),
        "eps": float(m.eps),
    }


def model_to_ops(model: nn.Module) -> list[dict]:
    seq = model.net if hasattr(model, "net") else (model.fc if hasattr(model, "fc") else None)
    ops: list[dict] = []
    if isinstance(seq, nn.Linear):
        return [_linear_op(seq)]
    for layer in seq:
        if isinstance(layer, nn.Linear):
            ops.append(_linear_op(layer))
        elif isinstance(layer, nn.BatchNorm1d):
            ops.append(_batchnorm_op(layer))
        elif isinstance(layer, nn.ReLU):
            ops.append({"op": "relu"})
        elif isinstance(layer, nn.Dropout):
            continue  # identity at eval
        else:
            raise ValueError(f"unsupported layer for TS export: {type(layer).__name__}")
    return ops


def export_feature_model(
    model: nn.Module,
    feat_mean: np.ndarray,
    feat_std: np.ndarray,
    *,
    target_id: str,
    labels: list[str],
    feature_names: list[str],
    family: str,
    version: str,
    balanced_accuracy: float,
    ece: float,
    p_value: float,
    classical_baseline: float | None,
) -> str:
    """Write the TS-portable JSON to the git-ignored neural artifacts dir."""
    payload = {
        "version": version,
        "kind": "feature_mlp_opgraph",
        "target": target_id,
        "family": family,
        "labels": labels,
        "featureNames": feature_names,
        "standardizer": {"mean": feat_mean.tolist(), "std": feat_std.tolist()},
        "ops": model_to_ops(model.eval()),
        "evidence": {
            "balancedAccuracy": balanced_accuracy,
            "ece": ece,
            "pValue": p_value,
            "classicalBaseline": classical_baseline,
            "validation": "actor-grouped 5-fold CV (signal-lab neural harness)",
        },
        "governance": "Acted-speech far-domain PRIOR (penalty 0.45); never hum truth, never clinical (ADR-0005).",
    }
    out = paths.neural_artifacts_dir() / f"model.neural.{target_id}.json"
    paths.assert_gitignored(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return str(out)
