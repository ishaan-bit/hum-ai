"""Acceleration detection — Intel XPU → CUDA → CPU, auto, never required.

The harness NEVER hard-requires a GPU: tests and full runs work on CPU. When the
Intel Arc XPU runtime is present (the `torch ... whl/xpu` build + drivers), it is
detected and used automatically; otherwise we fall back cleanly to CPU and say so.
"""
from __future__ import annotations

import torch


def available_backends() -> dict:
    """A snapshot of what acceleration this torch build can actually reach."""
    xpu = bool(getattr(torch, "xpu", None)) and torch.xpu.is_available()
    cuda = torch.cuda.is_available()
    return {
        "torch_version": torch.__version__,
        "xpu_available": xpu,
        "cuda_available": cuda,
        "cpu_threads": torch.get_num_threads(),
    }


def select_device(prefer: str = "auto") -> tuple[torch.device, str]:
    """Resolve (device, name). `prefer` ∈ {auto, xpu, cuda, cpu}.

    A requested accelerator that is unavailable falls back to CPU with the name
    still reflecting the REAL device used, so reports never overclaim hardware.
    """
    prefer = (prefer or "auto").lower()
    if prefer == "cpu":
        return torch.device("cpu"), "cpu"
    has_xpu = bool(getattr(torch, "xpu", None)) and torch.xpu.is_available()
    has_cuda = torch.cuda.is_available()
    if prefer == "xpu":
        return (torch.device("xpu"), "xpu") if has_xpu else (torch.device("cpu"), "cpu")
    if prefer == "cuda":
        return (torch.device("cuda"), "cuda") if has_cuda else (torch.device("cpu"), "cpu")
    # auto
    if has_xpu:
        return torch.device("xpu"), "xpu"
    if has_cuda:
        return torch.device("cuda"), "cuda"
    return torch.device("cpu"), "cpu"


def describe(prefer: str = "auto") -> str:
    dev, name = select_device(prefer)
    b = available_backends()
    note = "" if name != "cpu" else " (no XPU/CUDA runtime in this torch build — CPU fallback)"
    return f"device={name}{note}; torch={b['torch_version']}; cpu_threads={b['cpu_threads']}"
