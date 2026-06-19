"""GPU optionality + CPU fallback: the harness must run on CPU and never hard-require
an accelerator. Requesting an unavailable backend must fall back to CPU cleanly."""
import torch

from research.training.signal_neural import device as devmod


def test_cpu_always_available():
    dev, name = devmod.select_device("cpu")
    assert name == "cpu"
    assert dev.type == "cpu"


def test_unavailable_accelerator_falls_back_to_cpu():
    # On the CI/CPU wheel neither XPU nor CUDA is present → must fall back to CPU,
    # and the reported name must reflect the REAL device (never overclaim hardware).
    b = devmod.available_backends()
    dev, name = devmod.select_device("xpu")
    if not b["xpu_available"]:
        assert name == "cpu"
    dev, name = devmod.select_device("cuda")
    if not b["cuda_available"]:
        assert name == "cpu"


def test_auto_picks_a_real_device():
    dev, name = devmod.select_device("auto")
    assert name in ("xpu", "cuda", "cpu")
    # a tiny tensor must actually allocate on the chosen device
    t = torch.zeros(2, device=dev)
    assert t.sum().item() == 0.0


def test_backends_snapshot_shape():
    b = devmod.available_backends()
    assert set(b) >= {"torch_version", "xpu_available", "cuda_available", "cpu_threads"}
