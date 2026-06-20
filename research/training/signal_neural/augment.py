"""Train-only audio augmentation for the mel cohort.

Applied ONLY to TRAINING batches inside a fold (never to inner-val or test), so it
cannot leak across the grouped-CV partition. Augmentation is the single biggest
lever for a small, far-domain corpus (RAVDESS ~2 k clips): it regularizes the model
and synthesizes label-preserving variation without inventing new labels.

Two families, both standard for speech-emotion recognition:
  - SpecAugment (Park et al. 2019): random time + frequency masking on the log-mel,
    plus light gain jitter, additive Gaussian noise, and a small temporal roll.
  - mixup (Zhang et al. 2018): convex combination of two samples + their labels —
    returns soft targets the loss mixes (handled by the trainer).

All ops take a batch already on the training device and return a batch on the same
device. Mel layout is the canonical `[B, n_mels, T]`; `mel_seq` (`[B, T, n_mels]`)
and `hybrid` (`(mel, feat)`) layouts are handled by the trainer before/after.
"""
from __future__ import annotations

import numpy as np
import torch


def _band_keep_mask(B: int, L: int, max_w: int, n_masks: int, do, rng, device) -> torch.Tensor:
    """Vectorized [B, L] keep-mask: per sample, zero out `n_masks` random bands of width
    ≤ max_w (only where `do` is True). No per-sample Python loop — built from broadcast
    comparisons so the whole batch is masked in a handful of tensor ops."""
    keep = torch.ones(B, L, device=device)
    ar = torch.arange(L, device=device).view(1, L)
    do_col = do.view(B, 1)
    for _ in range(n_masks):
        w = torch.as_tensor(rng.integers(0, max_w + 1, size=B), device=device).view(B, 1)
        s = torch.as_tensor(rng.integers(0, max(1, L), size=B), device=device).view(B, 1)
        band = (ar >= s) & (ar < s + w) & do_col
        keep = keep.masked_fill(band, 0.0)
    return keep


def spec_augment(
    mel: torch.Tensor,
    *,
    n_time_masks: int = 2,
    n_freq_masks: int = 2,
    time_mask_frac: float = 0.12,
    freq_mask_frac: float = 0.18,
    noise_std: float = 0.10,
    gain_db: float = 4.0,
    max_roll_frac: float = 0.10,
    p: float = 0.8,
) -> torch.Tensor:
    """SpecAugment on a `[B, n_mels, T]` log-mel batch (per-utterance standardized, so
    masking to 0 ≈ masking to the mean). FULLY VECTORIZED — no per-sample Python loop,
    which is essential on XPU where each tiny kernel launch carries high latency (a naive
    per-sample loop dwarfs the model compute for a fast conv net). Random params are drawn
    on CPU (numpy) and cross to the device as small `[B]` tensors."""
    if mel.dim() != 3:
        raise ValueError(f"spec_augment expects [B, n_mels, T], got {tuple(mel.shape)}")
    B, M, T = mel.shape
    dev = mel.device
    tw = max(1, int(round(T * time_mask_frac)))
    fw = max(1, int(round(M * freq_mask_frac)))
    roll_max = max(0, int(round(T * max_roll_frac)))

    rng = np.random.default_rng()
    do = torch.as_tensor(rng.random(B) < p, device=dev)        # [B] bool — which samples augment
    do3 = do.view(B, 1, 1)
    out = mel

    if gain_db > 0:
        g = torch.as_tensor((10.0 ** (rng.uniform(-gain_db, gain_db, size=B) / 20.0)).astype(np.float32),
                            device=dev).view(B, 1, 1)
        out = torch.where(do3, out * g, out)
    if noise_std > 0:
        out = torch.where(do3, out + torch.randn_like(out) * noise_std, out)

    # Per-sample temporal roll via gather (onset jitter) — vectorized, no loop.
    if roll_max > 0:
        shifts = torch.as_tensor(rng.integers(-roll_max, roll_max + 1, size=B), device=dev)
        shifts = torch.where(do, shifts, torch.zeros_like(shifts))
        idx = (torch.arange(T, device=dev).view(1, T) - shifts.view(B, 1)) % T   # [B, T]
        out = torch.gather(out, 2, idx.view(B, 1, T).expand(B, M, T))

    # Time + frequency band masks (vectorized keep-masks).
    tkeep = _band_keep_mask(B, T, tw, n_time_masks, do, rng, dev)               # [B, T]
    fkeep = _band_keep_mask(B, M, fw, n_freq_masks, do, rng, dev)               # [B, M]
    out = out * tkeep.view(B, 1, T) * fkeep.view(B, M, 1)
    return out


def mixup_params(batch_size: int, alpha: float, device) -> tuple[torch.Tensor, float]:
    """Draw a mixup permutation + lambda. Returns (perm_index, lam). The trainer mixes
    inputs as `lam*x + (1-lam)*x[perm]` and the loss as `lam*CE(·,y) + (1-lam)*CE(·,y[perm])`."""
    if alpha <= 0:
        return torch.arange(batch_size, device=device), 1.0
    lam = float(np.random.beta(alpha, alpha))
    lam = max(lam, 1.0 - lam)  # keep the dominant label dominant (stabilizes early stop)
    perm = torch.randperm(batch_size, device=device)
    return perm, lam


def mixup_inputs(x, perm: torch.Tensor, lam: float):
    """Convex-combine inputs along the batch axis. Handles a tensor or a (mel, feat)
    tuple (hybrid) — same perm + lam applied to every component."""
    if isinstance(x, tuple):
        return tuple(lam * t + (1.0 - lam) * t[perm] for t in x)
    return lam * x + (1.0 - lam) * x[perm]
