"""Grouped-CV training/eval engine for the neural cohort.

Protocol (mirrors `cohort-eval.ts`, with neural training inside each fold):
  - actor-grouped K-fold (round-robin over sorted actor ids — identical partition
    to the classical cohort), so no speaker leaks across folds;
  - within each train fold, an INNER grouped hold-out (some train actors) drives
    early stopping — the test fold is never seen during training or model select;
  - inverse-frequency class weighting in the loss to counter imbalance;
  - features standardized on TRAIN stats only (fit per fold);
  - out-of-fold predictions pooled, then balanced-accuracy / macro-F1 / ECE /
    confusion computed once (same as TS).

Significance uses the fast numpy-LogReg null reference over the SAME folds — the
standard permutation interpretation (does the target carry learnable signal?),
tractable for 150 permutations. Documented as such; not a per-neural-model test.
"""
from __future__ import annotations

import gc
import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
import torch
import torch.nn as nn

from . import augment, metrics
from .data import Dataset, grouped_folds
from .linref import train_logreg


def _lr_at(ep: int, total: int, base_lr: float, warmup_frac: float, min_lr_frac: float) -> float:
    """Linear warmup → cosine decay to `min_lr_frac*base_lr` over `total` epochs."""
    warmup = max(1, int(round(total * warmup_frac)))
    if ep < warmup:
        return base_lr * (ep + 1) / warmup
    prog = (ep - warmup) / max(1, total - warmup)
    cos = 0.5 * (1.0 + math.cos(math.pi * min(1.0, prog)))
    return base_lr * (min_lr_frac + (1.0 - min_lr_frac) * cos)


def _augment_batch(xb, kind: str):
    """Apply SpecAugment in the canonical [B, n_mels, T] layout, returning the same
    layout/type as the input. `feat` is left untouched (no spectrogram to mask)."""
    if kind == "mel":
        return augment.spec_augment(xb)
    if kind == "mel_seq":                       # [B, T, n_mels] → augment → back
        return augment.spec_augment(xb.transpose(1, 2)).transpose(1, 2)
    if kind == "hybrid":
        mel, feat = xb
        return augment.spec_augment(mel), feat
    return xb


@dataclass
class ModelSpec:
    name: str
    family: str
    build: Callable[[int, int, int], nn.Module]  # (feat_dim, n_mels, n_classes) -> module
    input_kind: str
    epochs: int = 40
    lr: float = 1e-3
    batch_size: int = 64
    weight_decay: float = 1e-4
    patience: int = 8
    # ---- powerhouse knobs (default OFF → identical behaviour for untouched specs) ----
    optimizer: str = "adam"           # "adam" | "adamw"
    scheduler: str = "none"           # "none" | "cosine" (linear warmup → cosine decay)
    warmup_frac: float = 0.05
    label_smoothing: float = 0.0
    grad_clip: float = 0.0            # max grad norm (0 = off)
    augment: bool = False             # SpecAugment on mel/mel_seq/hybrid train batches
    mixup: float = 0.0                # mixup alpha (0 = off); soft-target loss
    bag: int = 1                      # seed-bagged sub-models per fold (probs averaged)
    min_lr_frac: float = 0.02         # cosine floor as a fraction of base lr
    ensemble: bool = False            # include this spec's OOF probs in the mean-prob ensemble


def _seed(s: int = 1234):
    torch.manual_seed(s)            # also seeds all accelerator RNGs (xpu/cuda) via the generator
    np.random.seed(s)
    if getattr(torch, "xpu", None) is not None and torch.xpu.is_available():
        torch.xpu.manual_seed_all(s)


def _inner_split(groups: np.ndarray, rng: np.random.Generator, val_frac=0.2):
    """Hold out ~val_frac of TRAIN actors as an inner validation set (grouped)."""
    uniq = sorted(set(groups.tolist()))
    if len(uniq) < 3:
        # too few groups to hold out — fall back to a random row split
        n = len(groups)
        perm = rng.permutation(n)
        cut = max(1, int(n * (1 - val_frac)))
        tr = np.zeros(n, dtype=bool); tr[perm[:cut]] = True
        return tr, ~tr
    n_val = max(1, int(round(len(uniq) * val_frac)))
    val_groups = set(rng.choice(uniq, size=n_val, replace=False).tolist())
    val_mask = np.array([g in val_groups for g in groups])
    return ~val_mask, val_mask


def _class_weights(y: np.ndarray, labels, device) -> torch.Tensor:
    K = len(labels)
    li = {l: i for i, l in enumerate(labels)}
    counts = np.bincount([li[v] for v in y], minlength=K).astype(np.float64)
    N = len(y)
    w = np.where(counts > 0, N / (K * counts), 0.0)
    s = w.sum()
    w = w * (K / s) if s > 0 else np.ones(K)
    return torch.tensor(w, dtype=torch.float32, device=device)


def _tensor_for(kind, idx, ds: Dataset, feat_mean, feat_std, device):
    if kind == "feat":
        X = (ds.features[idx] - feat_mean) / feat_std
        return torch.tensor(X, dtype=torch.float32, device=device)
    if kind == "mel":
        return torch.tensor(ds.mels[idx], dtype=torch.float32, device=device)
    if kind == "mel_seq":
        return torch.tensor(ds.mels[idx].transpose(0, 2, 1), dtype=torch.float32, device=device)
    if kind == "hybrid":
        X = (ds.features[idx] - feat_mean) / feat_std
        return (
            torch.tensor(ds.mels[idx], dtype=torch.float32, device=device),
            torch.tensor(X, dtype=torch.float32, device=device),
        )
    raise ValueError(kind)


def _forward(model, batch):
    if isinstance(batch, tuple):
        return model(batch[0], batch[1])
    return model(batch)


def _predict_proba(model, kind, idx, ds, feat_mean, feat_std, device, labels, batch_size=128):
    model.eval()
    out = []
    with torch.no_grad():
        for s in range(0, len(idx), batch_size):
            chunk = idx[s : s + batch_size]
            xb = _tensor_for(kind, chunk, ds, feat_mean, feat_std, device)
            logits = _forward(model, xb)
            out.append(torch.softmax(logits, dim=1).cpu().numpy())
    return np.concatenate(out, axis=0) if out else np.zeros((0, len(labels)))


def _train_fold(spec: ModelSpec, ds, tr_idx, labels, feat_dim, n_mels, device, log=lambda *_: None, seed: int = 20240617):
    _seed(seed)                                  # deterministic init/dropout per (fold, bag-member)
    rng = np.random.default_rng(seed)
    y_tr_all = ds._target_labels[tr_idx]
    g_tr = ds.groups[tr_idx]
    inner_tr, inner_val = _inner_split(g_tr, rng)
    sub_tr = tr_idx[inner_tr]
    sub_val = tr_idx[inner_val]

    feat_mean = ds.features[sub_tr].mean(axis=0)
    feat_std = ds.features[sub_tr].std(axis=0)
    feat_std = np.where(feat_std > 1e-6, feat_std, 1.0)

    li = {l: i for i, l in enumerate(labels)}
    y_tr = np.array([li[v] for v in ds._target_labels[sub_tr]], dtype=int)
    y_val = np.array([li[v] for v in ds._target_labels[sub_val]], dtype=int)

    model = spec.build(feat_dim, n_mels, len(labels)).to(device)
    cw = _class_weights(ds._target_labels[sub_tr], labels, device)
    loss_fn = nn.CrossEntropyLoss(weight=cw, label_smoothing=spec.label_smoothing)
    if spec.optimizer == "adamw":
        opt = torch.optim.AdamW(model.parameters(), lr=spec.lr, weight_decay=spec.weight_decay)
    else:
        opt = torch.optim.Adam(model.parameters(), lr=spec.lr, weight_decay=spec.weight_decay)

    best_val = -1.0
    best_state = None
    bad = 0
    y_val_str = ds._target_labels[sub_val]
    n = len(sub_tr)
    for ep in range(spec.epochs):
        if spec.scheduler == "cosine":
            lr_ep = _lr_at(ep, spec.epochs, spec.lr, spec.warmup_frac, spec.min_lr_frac)
            for pg in opt.param_groups:
                pg["lr"] = lr_ep
        model.train()
        perm = rng.permutation(n)
        for s in range(0, n, spec.batch_size):
            bidx = sub_tr[perm[s : s + spec.batch_size]]
            if len(bidx) < 2:
                continue  # BatchNorm needs >1 row
            xb = _tensor_for(spec.input_kind, bidx, ds, feat_mean, feat_std, device)
            yb = torch.tensor([li[v] for v in ds._target_labels[bidx]], dtype=torch.long, device=device)
            if spec.augment:
                xb = _augment_batch(xb, spec.input_kind)
            opt.zero_grad()
            if spec.mixup > 0:
                mperm, lam = augment.mixup_params(len(bidx), spec.mixup, device)
                xb = augment.mixup_inputs(xb, mperm, lam)
                logits = _forward(model, xb)
                loss = lam * loss_fn(logits, yb) + (1.0 - lam) * loss_fn(logits, yb[mperm])
            else:
                logits = _forward(model, xb)
                loss = loss_fn(logits, yb)
            loss.backward()
            if spec.grad_clip > 0:
                nn.utils.clip_grad_norm_(model.parameters(), spec.grad_clip)
            opt.step()
        # early stopping on inner-val balanced accuracy
        proba = _predict_proba(model, spec.input_kind, sub_val, ds, feat_mean, feat_std, device, labels)
        pred = [labels[i] for i in proba.argmax(axis=1)]
        val_ba = metrics.balanced_accuracy(list(y_val_str), pred, labels)
        if val_ba > best_val + 1e-4:
            best_val = val_ba
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
        else:
            bad += 1
            if bad >= spec.patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    return model, feat_mean, feat_std, best_val


def grouped_cv(spec: ModelSpec, ds: Dataset, target_id: str, labels, device, folds=5, log=lambda *_: None) -> dict:
    mask = ds.masks_by_target[target_id]
    idx_all = np.where(mask)[0]
    ds._target_labels = ds.labels_by_target[target_id]  # alias for fold helpers
    groups = ds.groups[idx_all]
    fold_of = grouped_folds(groups, folds)
    feat_dim = ds.features.shape[1]
    n_mels = ds.mels.shape[1] if ds.mels is not None else 0

    bag = max(1, spec.bag)
    y_true, y_pred, p_top = [], [], []
    oof_rows: list[int] = []
    oof_proba: list[np.ndarray] = []
    for f in range(folds):
        te_local = np.where(fold_of == f)[0]
        tr_local = np.where(fold_of != f)[0]
        te_idx = idx_all[te_local]
        tr_idx = idx_all[tr_local]
        if len(te_idx) == 0 or len(tr_idx) == 0:
            continue
        # Seed-bagging: train `bag` independent sub-models (distinct seeds → distinct
        # init/dropout/augmentation/inner-split) and average their test probabilities.
        proba_sum = None
        val_bas = []
        for b in range(bag):
            model, fmean, fstd, val_ba = _train_fold(
                spec, ds, tr_idx, labels, feat_dim, n_mels, device, log, seed=1000 + f * 101 + b * 9973)
            pb = _predict_proba(model, spec.input_kind, te_idx, ds, fmean, fstd, device, labels)
            proba_sum = pb if proba_sum is None else proba_sum + pb
            val_bas.append(val_ba)
            del model
            gc.collect()
        proba = proba_sum / bag
        pred_i = proba.argmax(axis=1)
        for j, row in enumerate(te_idx):
            y_true.append(ds.labels_by_target[target_id][row])
            y_pred.append(labels[pred_i[j]])
            p_top.append(float(proba[j].max()))
        oof_rows.extend(int(r) for r in te_idx)
        oof_proba.append(proba)
        log(f"    fold {f}: test={len(te_idx)} bag={bag} innerVal_balAcc={np.mean(val_bas):.3f}")

    m = metrics.full_metrics(y_true, y_pred, p_top, labels)
    m["model"] = spec.name
    m["family"] = spec.family
    m["folds"] = folds
    m["group_count"] = len(set(groups.tolist()))
    # Out-of-fold probabilities (row-aligned across all specs for this target) so the
    # caller can build a mean-probability ensemble. Transient — stripped before write.
    m["_oof"] = {"rows": oof_rows, "proba": np.concatenate(oof_proba, axis=0) if oof_proba else np.zeros((0, len(labels))), "labels": list(labels)}
    return m


def permutation_pvalue(ds: Dataset, target_id: str, labels, folds=5, permutations=150, seed=9973) -> dict:
    """Label-permutation significance on balanced accuracy using the numpy-LogReg
    null reference over the SAME grouped folds (mirrors experiment.ts)."""
    mask = ds.masks_by_target[target_id]
    idx_all = np.where(mask)[0]
    X = ds.features[idx_all]
    y = ds.labels_by_target[target_id][idx_all]
    groups = ds.groups[idx_all]
    fold_of = grouped_folds(groups, folds)

    def cv_balacc(y_use):
        yt, yp = [], []
        for f in range(folds):
            te = fold_of == f
            tr = ~te
            present = [l for l in labels if l in set(y_use[tr].tolist())]
            if len(present) < 2 or te.sum() == 0:
                continue
            clf = train_logreg(X[tr], y_use[tr], present)
            proba = clf.predict_proba(X[te])
            pred = [present[i] for i in proba.argmax(axis=1)]
            yt.extend(y_use[te].tolist())
            yp.extend(pred)
        return metrics.balanced_accuracy(yt, yp, labels)

    observed = cv_balacc(y)
    rng = np.random.default_rng(seed)
    nulls = []
    ge = 0
    for _ in range(permutations):
        ys = y.copy()
        rng.shuffle(ys)
        a = cv_balacc(ys)
        nulls.append(a)
        if a >= observed:
            ge += 1
    nulls = np.array(nulls)
    return {
        "metric": "balanced_accuracy",
        "permutations": permutations,
        "observed": float(observed),
        "null_mean": float(nulls.mean()) if len(nulls) else 0.0,
        "null_std": float(nulls.std(ddof=1)) if len(nulls) > 1 else 0.0,
        "p_value": (ge + 1) / (permutations + 1),
        "reference_model": "numpy-logreg(150it) linear null-reference",
    }


def linear_reference_cv(ds: Dataset, target_id: str, labels, folds=5) -> dict:
    """In-harness classical (numpy LogReg) on the SAME folds — the linear floor."""
    mask = ds.masks_by_target[target_id]
    idx_all = np.where(mask)[0]
    X = ds.features[idx_all]
    y = ds.labels_by_target[target_id][idx_all]
    groups = ds.groups[idx_all]
    fold_of = grouped_folds(groups, folds)
    yt, yp, pt = [], [], []
    for f in range(folds):
        te = fold_of == f
        tr = ~te
        present = [l for l in labels if l in set(y[tr].tolist())]
        if len(present) < 2 or te.sum() == 0:
            continue
        clf = train_logreg(X[tr], y[tr], present)
        proba = clf.predict_proba(X[te])
        idxp = proba.argmax(axis=1)
        yt.extend(y[te].tolist())
        yp.extend([present[i] for i in idxp])
        pt.extend(proba.max(axis=1).tolist())
    m = metrics.full_metrics(yt, yp, pt, labels)
    m["model"] = "numpy_logreg"
    m["family"] = "linear(reference)"
    return m
