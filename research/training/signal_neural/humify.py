"""Hum-ification: turn an acted-SPEECH clip into a HUM-like (or whistle-like) signal.

Why this exists — the corpora we can train on (RAVDESS, CREMA-D) are *speech*; the
product input is a *hum* (closed-mouth voiced tone), a hummed tune with/without
lyrics, or a *whistle* (near-pure tone). These are fundamentally different signals:
speech carries emotion partly through articulation (consonants, formants, vowel
transitions) which a hum DOES NOT HAVE. A model that learns phonetic cues will not
transfer to hum (ADR-0005: RAVDESS is far-domain, penalty 0.45 — a PRIOR, never hum
truth).

So before extracting features for the *hum-applicable* track, we project each speech
clip onto what survives in a hum: its **pitch (F0) contour**, **energy dynamics**,
**voicing**, and **coarse timbre** — and resynthesize that as a hum/whistle, discarding
the phonetic/formant content. The emotion signal the model then sees is the part that
actually exists when a user hums. This is dependency-free (numpy only).

Modes:
  - "hum":     harmonics at F0 under a fixed low-pass "mmm" envelope (formants removed).
  - "whistle": near-pure tone at F0 (+ a faint 2nd harmonic).
Both follow the original F0 contour + RMS energy envelope; unvoiced/silent frames go
quiet (a hum has no consonant bursts).
"""
from __future__ import annotations

import numpy as np

SR = 16000
_FRAME = 400        # 25 ms analysis frame
_HOP = 160          # 10 ms
_FMIN, _FMAX = 70.0, 400.0     # plausible hum/voice F0 band


def _frame_signal(x: np.ndarray, frame: int, hop: int) -> np.ndarray:
    if len(x) < frame:
        x = np.pad(x, (0, frame - len(x)))
    n = 1 + (len(x) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def track_f0_energy(x: np.ndarray, sr: int = SR):
    """Per-frame (F0_hz, voiced_flag, rms) via autocorrelation. Returns frame-rate arrays."""
    frames = _frame_signal(x, _FRAME, _HOP).astype(np.float64)
    win = np.hanning(_FRAME)
    fr = frames * win
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    lag_min = max(1, int(sr / _FMAX))
    lag_max = min(_FRAME - 1, int(sr / _FMIN))
    f0 = np.zeros(len(frames))
    voiced = np.zeros(len(frames), dtype=bool)
    for i in range(len(frames)):
        f = fr[i]
        ac = np.correlate(f, f, mode="full")[_FRAME - 1:]
        ac0 = ac[0] if ac[0] > 1e-9 else 1e-9
        seg = ac[lag_min:lag_max] / ac0
        if len(seg) == 0:
            continue
        k = int(np.argmax(seg))
        peak = seg[k]
        lag = lag_min + k
        # voiced if autocorr peak is strong and energy above the noise floor
        if peak > 0.35 and rms[i] > 0.02 * (rms.max() + 1e-9):
            f0[i] = sr / lag
            voiced[i] = True
    # median-smooth F0 over voiced frames to kill octave jumps / spurious values
    f0 = _median_smooth(f0, k=5)
    return f0, voiced, rms


def _median_smooth(a: np.ndarray, k: int = 5) -> np.ndarray:
    if len(a) < k:
        return a
    pad = k // 2
    ap = np.pad(a, (pad, pad), mode="edge")
    return np.array([np.median(ap[i:i + k]) for i in range(len(a))])


def _upsample(frame_vals: np.ndarray, n_samples: int) -> np.ndarray:
    """Linear-interpolate a frame-rate curve to sample rate."""
    if len(frame_vals) == 0:
        return np.zeros(n_samples)
    fx = np.linspace(0, 1, len(frame_vals))
    sx = np.linspace(0, 1, n_samples)
    return np.interp(sx, fx, frame_vals)


def humify_waveform(x: np.ndarray, sr: int = SR, mode: str = "hum", n_harmonics: int = 6) -> np.ndarray:
    """Speech waveform → hum/whistle-like waveform preserving F0 contour + energy."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) < _FRAME:
        return x.astype(np.float32)
    f0, voiced, rms = track_f0_energy(x, sr)
    # hold F0 through short unvoiced gaps so the hum line stays continuous (a hummer
    # glides rather than cutting out on every consonant)
    f0_filled = f0.copy()
    last = 0.0
    for i in range(len(f0_filled)):
        if voiced[i] and f0_filled[i] > 0:
            last = f0_filled[i]
        elif last > 0:
            f0_filled[i] = last
    n = len(x)
    f0_s = _upsample(f0_filled, n)
    env_s = _upsample(rms, n)
    voiced_s = _upsample(voiced.astype(float), n)        # soft voicing gate
    env_s = env_s * np.clip(voiced_s * 1.5, 0, 1)        # quiet on unvoiced (no consonants)

    # instantaneous phase from the (interpolated) F0 contour
    if mode == "whistle":
        # a real whistle preserves the melody but in a high register (~0.7–2 kHz) as a
        # near-pure tone — transpose the F0 contour up so it's an honest whistle, not a
        # low hum fundamental. (This is what makes it distinguishable from a hum.)
        f0_s = np.clip(f0_s, 0, _FMAX)
        voiced_f0 = f0_s[f0_s > 0]
        med = float(np.median(voiced_f0)) if voiced_f0.size else 150.0
        factor = float(np.clip(1000.0 / max(med, 1e-6), 4.0, 12.0))
        f0_s = np.clip(f0_s * factor, 0, 3000.0)
    else:
        f0_s = np.clip(f0_s, 0, _FMAX)
    phase = 2 * np.pi * np.cumsum(f0_s) / sr

    if mode == "whistle":
        sig = np.sin(phase) + 0.06 * np.sin(2 * phase)   # near-pure high tone
    else:  # hum: harmonics under a low-pass "mmm" envelope (no formants/consonants)
        sig = np.zeros(n)
        for k in range(1, n_harmonics + 1):
            amp = np.exp(-0.6 * (k - 1))                 # smooth low-pass timbre
            sig += amp * np.sin(k * phase)
    sig = sig * env_s
    # normalize to match original RMS scale (keep relative dynamics)
    cur = np.sqrt((sig ** 2).mean() + 1e-12)
    tgt = np.sqrt((x ** 2).mean() + 1e-12)
    sig = sig * (tgt / cur)
    return sig.astype(np.float32)
