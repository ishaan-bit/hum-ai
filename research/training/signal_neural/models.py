"""Neural model cohort.

Two input modalities, one logits interface ([B, n_classes]):
  - feature-space (`input_kind="feat"`): models over the 58-d engineered vector —
    directly comparable to the classical LogReg AND exportable to a pure-TS forward
    pass (so a winner can run in the TS runtime with no Python/ONNX dependency);
  - audio-space (`input_kind="mel"|"mel_seq"|"hybrid"`): models over log-mel
    spectrograms, where neural representation learning can exceed engineered DSP.

Each module carries `.input_kind` so the trainer feeds it the right tensor.
Sizes are deliberately small (CPU-friendly; RAVDESS is ~2 k clips).
"""
from __future__ import annotations

import torch
import torch.nn as nn


# --------------------------------------------------------------------------- feat
class LinearProbe(nn.Module):
    """Logistic-regression-equivalent (single linear layer) — in-harness classical
    reference, so the cohort table always shows the linear floor on the SAME split."""
    input_kind = "feat"

    def __init__(self, in_dim: int, n_classes: int):
        super().__init__()
        self.fc = nn.Linear(in_dim, n_classes)

    def forward(self, x):
        return self.fc(x)


class FeatureMLP(nn.Module):
    """MLP over the engineered feature vector. Exportable to pure-TS (see export_ts)."""
    input_kind = "feat"

    def __init__(self, in_dim: int, n_classes: int, hidden=(128, 64), dropout=0.3):
        super().__init__()
        layers = []
        prev = in_dim
        self.hidden = list(hidden)
        for h in hidden:
            layers += [nn.Linear(prev, h), nn.BatchNorm1d(h), nn.ReLU(), nn.Dropout(dropout)]
            prev = h
        layers += [nn.Linear(prev, n_classes)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


# ---------------------------------------------------------------------------- mel
class MelCNN2D(nn.Module):
    """2-D CNN over the log-mel spectrogram [B, 1, n_mels, T]."""
    input_kind = "mel"

    def __init__(self, n_mels: int, n_classes: int, dropout=0.3):
        super().__init__()
        def block(ci, co):
            return nn.Sequential(
                nn.Conv2d(ci, co, 3, padding=1), nn.BatchNorm2d(co), nn.ReLU(),
                nn.Conv2d(co, co, 3, padding=1), nn.BatchNorm2d(co), nn.ReLU(),
                nn.MaxPool2d(2),
            )
        self.features = nn.Sequential(block(1, 16), block(16, 32), block(32, 64))
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(64, n_classes))

    def forward(self, x):              # x: [B, n_mels, T]
        x = x.unsqueeze(1)
        x = self.features(x)
        x = self.pool(x).flatten(1)
        return self.head(x)


class MelCNN1D(nn.Module):
    """1-D CNN along time; mel bands as channels [B, n_mels, T]."""
    input_kind = "mel"

    def __init__(self, n_mels: int, n_classes: int, dropout=0.3):
        super().__init__()
        def block(ci, co, k=5):
            return nn.Sequential(
                nn.Conv1d(ci, co, k, padding=k // 2), nn.BatchNorm1d(co), nn.ReLU(),
                nn.MaxPool1d(2),
            )
        self.features = nn.Sequential(block(n_mels, 64), block(64, 128), block(128, 128))
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(128, n_classes))

    def forward(self, x):              # x: [B, n_mels, T]
        x = self.features(x)
        x = self.pool(x).flatten(1)
        return self.head(x)


class MelCNN1DWide(nn.Module):
    """Wider, deeper 1-D CNN along time (mel bands as channels) with concat avg+max
    global pooling. A capacity-bumped sibling of `MelCNN1D` for cohort diversity — still
    pure 1-D convs, which the Intel Arc XPU runs extremely fast (≈sub-second/epoch)."""
    input_kind = "mel"

    def __init__(self, n_mels: int, n_classes: int, channels=(96, 192, 256, 256), dropout=0.3, k=7):
        super().__init__()
        def block(ci, co):
            return nn.Sequential(
                nn.Conv1d(ci, co, k, padding=k // 2, bias=False), nn.BatchNorm1d(co), nn.ReLU(inplace=True),
                nn.Conv1d(co, co, 3, padding=1, bias=False), nn.BatchNorm1d(co), nn.ReLU(inplace=True),
                nn.MaxPool1d(2),
            )
        chs = [n_mels] + list(channels)
        self.features = nn.Sequential(*[block(chs[i], chs[i + 1]) for i in range(len(channels))])
        self.avg = nn.AdaptiveAvgPool1d(1)
        self.max = nn.AdaptiveMaxPool1d(1)
        self.head = nn.Sequential(
            nn.Dropout(dropout), nn.Linear(2 * channels[-1], channels[-1]), nn.BatchNorm1d(channels[-1]),
            nn.ReLU(inplace=True), nn.Dropout(dropout), nn.Linear(channels[-1], n_classes),
        )

    def forward(self, x):              # x: [B, n_mels, T]
        x = self.features(x)
        a = self.avg(x).flatten(1)
        m = self.max(x).flatten(1)
        return self.head(torch.cat([a, m], dim=1))


class MelBiGRU(nn.Module):
    """Bi-directional GRU over mel frames [B, T, n_mels] with attention pooling."""
    input_kind = "mel_seq"

    def __init__(self, n_mels: int, n_classes: int, hidden=64, dropout=0.3):
        super().__init__()
        self.gru = nn.GRU(n_mels, hidden, batch_first=True, bidirectional=True)
        self.attn = nn.Linear(2 * hidden, 1)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(2 * hidden, n_classes))

    def forward(self, x):              # x: [B, T, n_mels]
        h, _ = self.gru(x)             # [B, T, 2H]
        w = torch.softmax(self.attn(h).squeeze(-1), dim=1).unsqueeze(-1)  # [B,T,1]
        ctx = (h * w).sum(dim=1)       # attention-weighted temporal pooling
        return self.head(ctx)


class MelCRNN(nn.Module):
    """CNN frontend → BiGRU over time → attention pooling (CNN+RNN hybrid)."""
    input_kind = "mel"

    def __init__(self, n_mels: int, n_classes: int, hidden=64, dropout=0.3):
        super().__init__()
        def block(ci, co):
            return nn.Sequential(
                nn.Conv2d(ci, co, 3, padding=1), nn.BatchNorm2d(co), nn.ReLU(),
                nn.MaxPool2d((2, 2)),
            )
        self.cnn = nn.Sequential(block(1, 16), block(16, 32))
        self.freq_pool = nn.AdaptiveAvgPool2d((1, None))  # collapse freq, keep time
        self.gru = nn.GRU(32, hidden, batch_first=True, bidirectional=True)
        self.attn = nn.Linear(2 * hidden, 1)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(2 * hidden, n_classes))

    def forward(self, x):              # x: [B, n_mels, T]
        x = x.unsqueeze(1)
        x = self.cnn(x)                # [B, C, F', T']
        x = self.freq_pool(x).squeeze(2)   # [B, C, T']
        x = x.transpose(1, 2)          # [B, T', C]
        h, _ = self.gru(x)
        w = torch.softmax(self.attn(h).squeeze(-1), dim=1).unsqueeze(-1)
        ctx = (h * w).sum(dim=1)
        return self.head(ctx)


class _SE(nn.Module):
    """Squeeze-and-excitation channel gate (Hu et al. 2018) — cheap, helps small CNNs
    focus on the informative mel channels."""
    def __init__(self, c: int, r: int = 8):
        super().__init__()
        h = max(4, c // r)
        self.fc = nn.Sequential(nn.Linear(c, h), nn.ReLU(), nn.Linear(h, c), nn.Sigmoid())

    def forward(self, x):              # x: [B, C, F, T]
        s = x.mean(dim=(2, 3))         # global avg pool → [B, C]
        s = self.fc(s).unsqueeze(-1).unsqueeze(-1)
        return x * s


class _ResBlock(nn.Module):
    """Pre-activation residual block (Conv-BN-ReLU ×2 + SE) with a projection shortcut
    and optional spatial downsample."""
    def __init__(self, ci: int, co: int, stride: int = 1, dropout: float = 0.1):
        super().__init__()
        self.conv1 = nn.Conv2d(ci, co, 3, stride=stride, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(co)
        self.conv2 = nn.Conv2d(co, co, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(co)
        self.se = _SE(co)
        self.drop = nn.Dropout2d(dropout)
        self.short = (nn.Sequential(nn.Conv2d(ci, co, 1, stride=stride, bias=False), nn.BatchNorm2d(co))
                      if (stride != 1 or ci != co) else nn.Identity())
        self.act = nn.ReLU(inplace=True)

    def forward(self, x):
        r = self.short(x)
        y = self.act(self.bn1(self.conv1(x)))
        y = self.drop(self.bn2(self.conv2(y)))
        y = self.se(y)
        return self.act(y + r)


class MelResCNN(nn.Module):
    """Residual SE-CNN over the log-mel spectrogram with concat avg+max global pooling.
    Deeper than `MelCNN2D` but still small; augmentation keeps it from overfitting the
    ~2 k-clip corpus. The strongest feature extractor in the audio cohort."""
    input_kind = "mel"

    def __init__(self, n_mels: int, n_classes: int, width: int = 32, dropout: float = 0.3):
        super().__init__()
        w = width
        self.stem = nn.Sequential(nn.Conv2d(1, w, 3, padding=1, bias=False), nn.BatchNorm2d(w), nn.ReLU(inplace=True))
        self.stage1 = nn.Sequential(_ResBlock(w, w), _ResBlock(w, w))
        self.stage2 = nn.Sequential(_ResBlock(w, 2 * w, stride=2), _ResBlock(2 * w, 2 * w))
        self.stage3 = nn.Sequential(_ResBlock(2 * w, 4 * w, stride=2), _ResBlock(4 * w, 4 * w))
        self.avg = nn.AdaptiveAvgPool2d((1, 1))
        self.max = nn.AdaptiveMaxPool2d((1, 1))
        self.head = nn.Sequential(
            nn.Linear(8 * w, 4 * w), nn.BatchNorm1d(4 * w), nn.ReLU(inplace=True), nn.Dropout(dropout),
            nn.Linear(4 * w, n_classes),
        )

    def forward(self, x):              # x: [B, n_mels, T]
        x = x.unsqueeze(1)
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        a = self.avg(x).flatten(1)
        m = self.max(x).flatten(1)
        return self.head(torch.cat([a, m], dim=1))


class HybridMelFeat(nn.Module):
    """Mel-CNN embedding concatenated with the engineered feature vector → MLP head."""
    input_kind = "hybrid"

    def __init__(self, n_mels: int, feat_dim: int, n_classes: int, dropout=0.3):
        super().__init__()
        def block(ci, co):
            return nn.Sequential(
                nn.Conv2d(ci, co, 3, padding=1), nn.BatchNorm2d(co), nn.ReLU(),
                nn.MaxPool2d(2),
            )
        self.cnn = nn.Sequential(block(1, 16), block(16, 32), block(32, 64))
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.feat_bn = nn.BatchNorm1d(feat_dim)
        self.head = nn.Sequential(
            nn.Linear(64 + feat_dim, 96), nn.BatchNorm1d(96), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(96, n_classes),
        )

    def forward(self, mel, feat):      # mel: [B, n_mels, T], feat: [B, F]
        e = self.pool(self.cnn(mel.unsqueeze(1))).flatten(1)
        f = self.feat_bn(feat)
        return self.head(torch.cat([e, f], dim=1))
