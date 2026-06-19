"""The TS-portable op-graph must reproduce the torch model exactly.

We train a tiny FeatureMLP, export it to the JSON op-graph, then re-execute that
op-graph with a numpy interpreter that mirrors `neural-feature-model.ts` and assert
the logits match torch's. This is the contract that lets a feature-space winner run
in the TypeScript runtime with no Python/ONNX/GPU dependency."""
import numpy as np
import torch

from research.training.signal_neural import export_ts, models


def _numpy_exec(payload, raw):
    # mirror of neural-feature-model.ts: standardize -> ops -> logits
    mean = np.array(payload["standardizer"]["mean"])
    std = np.array(payload["standardizer"]["std"])
    x = (raw - mean) / std
    for op in payload["ops"]:
        if op["op"] == "linear":
            x = np.array(op["W"]) @ x + np.array(op["b"])
        elif op["op"] == "batchnorm":
            m = np.array(op["mean"]); v = np.array(op["var"])
            w = np.array(op["weight"]); b = np.array(op["bias"])
            x = (x - m) / np.sqrt(v + op["eps"]) * w + b
        elif op["op"] == "relu":
            x = np.maximum(0, x)
        else:
            raise AssertionError(op["op"])
    return x


def test_feature_mlp_opgraph_matches_torch(tmp_path, monkeypatch):
    torch.manual_seed(0)
    in_dim, n_classes = 12, 2
    model = models.FeatureMLP(in_dim, n_classes, hidden=(16, 8))
    # give BatchNorm non-trivial running stats, then eval
    model.train()
    for _ in range(5):
        model(torch.randn(32, in_dim))
    model.eval()

    feat_mean = np.zeros(in_dim)
    feat_std = np.ones(in_dim)
    ops = export_ts.model_to_ops(model)
    payload = {"standardizer": {"mean": feat_mean.tolist(), "std": feat_std.tolist()}, "ops": ops}

    raw = np.random.RandomState(1).randn(in_dim)
    np_logits = _numpy_exec(payload, raw)
    with torch.no_grad():
        torch_logits = model(torch.tensor(raw, dtype=torch.float32).unsqueeze(0)).numpy()[0]
    assert np.allclose(np_logits, torch_logits, atol=1e-4), (np_logits, torch_logits)


def test_linear_probe_exports_single_linear():
    model = models.LinearProbe(8, 3).eval()
    ops = export_ts.model_to_ops(model)
    assert len(ops) == 1 and ops[0]["op"] == "linear"
    assert len(ops[0]["W"]) == 3 and len(ops[0]["W"][0]) == 8
