"""Numpy multinomial logistic regression — a faithful port of `model.ts trainLogReg`.

Used for (a) the in-harness classical/linear reference on the SAME split, and
(b) the label-permutation significance test. It mirrors the TS protocol exactly:
zero-init weights, full-batch gradient descent, inverse-frequency class weights
normalized to mean 1, lr 0.5, l2 1e-3. This keeps the neural cohort's significance
test interpretation identical to the classical cohort's (the TARGET carries real,
learnable feature↔label signal), and fast enough for 150 permutations.
"""
from __future__ import annotations

import numpy as np


def _standardizer(X: np.ndarray):
    mean = X.mean(axis=0)
    sd = X.std(axis=0)
    sd = np.where(sd > 1e-6, sd, 1.0)
    return mean, sd


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / np.clip(e.sum(axis=1, keepdims=True), 1e-12, None)


class NumpyLogReg:
    def __init__(self, labels, mean, sd, W, b):
        self.labels = list(labels)
        self.mean, self.sd, self.W, self.b = mean, sd, W, b

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        Xs = (X - self.mean) / self.sd
        return _softmax(Xs @ self.W.T + self.b)


def train_logreg(
    X: np.ndarray,
    y: np.ndarray,
    labels,
    l2: float = 1e-3,
    iterations: int = 150,
    lr: float = 0.5,
    class_weighted: bool = True,
) -> NumpyLogReg:
    labels = list(labels)
    K = len(labels)
    N, D = X.shape
    li = {l: i for i, l in enumerate(labels)}
    yi = np.array([li[v] for v in y], dtype=int)
    mean, sd = _standardizer(X)
    Xs = (X - mean) / sd

    counts = np.bincount(yi, minlength=K).astype(np.float64)
    cw = np.ones(K)
    if class_weighted:
        with np.errstate(divide="ignore", invalid="ignore"):
            cw = np.where(counts > 0, N / (K * counts), 0.0)
        s = cw.sum()
        cw = cw * (K / s) if s > 0 else cw

    W = np.zeros((K, D))
    b = np.zeros(K)
    Y = np.zeros((N, K))
    Y[np.arange(N), yi] = 1.0
    sample_w = cw[yi]
    wtot = sample_w.sum()
    for _ in range(iterations):
        P = _softmax(Xs @ W.T + b)        # [N,K]
        err = (P - Y) * sample_w[:, None]  # weighted residual
        gW = err.T @ Xs / max(wtot, 1e-9)
        gB = err.sum(axis=0) / max(wtot, 1e-9)
        W -= lr * (gW + l2 * W)
        b -= lr * gB
    return NumpyLogReg(labels, mean, sd, W, b)
