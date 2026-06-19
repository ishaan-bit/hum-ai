"""Evaluation metrics — byte-for-byte mirror of `cohort-eval.ts`.

Same definitions as the classical TS cohort so a "neural vs classical" comparison
is apples-to-apples:
  - balanced accuracy = mean per-class recall over PRESENT classes (chance = 1/K,
    immune to class imbalance — a skewed prior cannot inflate it),
  - macro-F1 over present classes,
  - ECE = 10-bin top-probability expected calibration error,
  - confusion matrix + per-class precision/recall/F1.
"""
from __future__ import annotations

from typing import Sequence

import numpy as np


def present_labels(y_true: Sequence[str], labels: Sequence[str]) -> list[str]:
    s = set(y_true)
    return [l for l in labels if l in s]


def balanced_accuracy(y_true: Sequence[str], y_pred: Sequence[str], labels: Sequence[str]) -> float:
    total = 0.0
    used = 0
    for l in labels:
        tp = 0
        support = 0
        for t, p in zip(y_true, y_pred):
            if t == l:
                support += 1
                if p == l:
                    tp += 1
        if support > 0:
            total += tp / support
            used += 1
    return total / used if used > 0 else 0.0


def accuracy(y_true: Sequence[str], y_pred: Sequence[str]) -> float:
    if not y_true:
        return 0.0
    return sum(1 for t, p in zip(y_true, y_pred) if t == p) / len(y_true)


def per_class(y_true: Sequence[str], y_pred: Sequence[str], labels: Sequence[str]) -> list[dict]:
    out = []
    for label in labels:
        tp = fp = fn = support = 0
        for t, p in zip(y_true, y_pred):
            tt = t == label
            pp = p == label
            if tt:
                support += 1
            if tt and pp:
                tp += 1
            elif (not tt) and pp:
                fp += 1
            elif tt and (not pp):
                fn += 1
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
        out.append({"label": label, "support": support, "precision": precision, "recall": recall, "f1": f1})
    return out


def macro_f1(y_true: Sequence[str], y_pred: Sequence[str], labels: Sequence[str]) -> float:
    pc = per_class(y_true, y_pred, labels)
    return sum(c["f1"] for c in pc) / len(pc) if pc else 0.0


def confusion(y_true: Sequence[str], y_pred: Sequence[str], labels: Sequence[str]) -> dict:
    idx = {l: i for i, l in enumerate(labels)}
    m = [[0 for _ in labels] for _ in labels]
    for t, p in zip(y_true, y_pred):
        if t in idx and p in idx:
            m[idx[t]][idx[p]] += 1
    return {"labels": list(labels), "matrix": m}


def expected_calibration_error(y_true: Sequence[str], y_pred: Sequence[str], p_top: Sequence[float], bins: int = 10) -> float:
    bin_acc = [0.0] * bins
    bin_conf = [0.0] * bins
    bin_n = [0] * bins
    for t, p, pt in zip(y_true, y_pred, p_top):
        b = min(bins - 1, max(0, int(pt * bins)))
        bin_n[b] += 1
        bin_conf[b] += pt
        if t == p:
            bin_acc[b] += 1
    n = len(p_top) or 1
    ece = 0.0
    for b in range(bins):
        if bin_n[b] == 0:
            continue
        ece += (bin_n[b] / n) * abs(bin_acc[b] / bin_n[b] - bin_conf[b] / bin_n[b])
    return ece


def majority_class_accuracy(y_true: Sequence[str]) -> float:
    if not y_true:
        return 0.0
    vals, counts = np.unique(np.array(y_true), return_counts=True)
    return float(counts.max() / len(y_true))


def full_metrics(y_true: Sequence[str], y_pred: Sequence[str], p_top: Sequence[float], labels: Sequence[str]) -> dict:
    present = present_labels(y_true, labels)
    pc = per_class(y_true, y_pred, present)
    return {
        "n": len(y_true),
        "num_classes": len(present),
        "accuracy": accuracy(y_true, y_pred),
        "balanced_accuracy": balanced_accuracy(y_true, y_pred, present),
        "macro_f1": (sum(c["f1"] for c in pc) / len(pc)) if pc else 0.0,
        "ece": expected_calibration_error(y_true, y_pred, p_top),
        "per_class": pc,
        "confusion": confusion(y_true, y_pred, present),
        "chance": {
            "majority_class_accuracy": majority_class_accuracy(y_true),
            "balanced_chance": 1.0 / max(1, len(present)),
        },
    }
