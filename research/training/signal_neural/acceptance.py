"""Capture acceptance gate — STAGE ① of the hum flow.

The product captures ~12 s of free-flowing audio expecting a hum, but it can be
ANYTHING: speech, whistle, sigh, breath, throat-clear, background noise, silence. This
gate decides, BEFORE any affect inference, whether the capture is a usable, clear,
sustained voiced HUM. If not → the app asks the user to hum again. We never run affect
on noise/silence/garbage (that would be an unsafe over-claim in a sensitive product).

STRICT policy: accept ≈ a sustained, voiced, harmonic hum/tone (VocalSet-like). Reject
speech (consonant/articulation-heavy), vocal bursts (sigh/breath/cough), whistles
(near-pure high tone), noise, and silence.

All features are dependency-free (numpy) so the gate can run anywhere the 16 kHz mono
waveform is available; they mirror the kinds of cues in @hum-ai/audio-features
(voicing coverage, harmonicity, SNR, silence ratio, spectral flatness).
"""
from __future__ import annotations

import numpy as np

from .humify import _frame_signal, track_f0_energy

SR = 16000
_FRAME = 400
_HOP = 160

QUALITY_FEATURES = [
    "voiced_ratio", "f0_cov", "f0_med", "harmonicity", "rms_mean", "rms_dr",
    "silence_ratio", "snr_proxy", "spec_flatness", "zcr", "zcr_std",
    "spec_centroid", "spec_rolloff", "voiced_run_frac", "hf_ratio",
]


def _spectral_stats(frames: np.ndarray, sr: int):
    win = np.hanning(frames.shape[1])
    mag = np.abs(np.fft.rfft(frames * win, axis=1)) + 1e-9      # [F, K]
    freqs = np.fft.rfftfreq(frames.shape[1], 1 / sr)
    power = mag ** 2
    psum = power.sum(axis=1) + 1e-9
    # spectral flatness (Wiener entropy): geo-mean / arith-mean; noise→1, tone→0
    logp = np.log(power)
    flat = np.exp(logp.mean(axis=1)) / (power.mean(axis=1) + 1e-12)
    centroid = (freqs[None, :] * power).sum(axis=1) / psum
    cum = np.cumsum(power, axis=1)
    rolloff_idx = (cum >= 0.85 * cum[:, -1:]).argmax(axis=1)
    rolloff = freqs[rolloff_idx]
    hf = power[:, freqs > 3000].sum(axis=1) / psum             # consonant/whistle energy
    return flat, centroid, rolloff, hf


def quality_features(x: np.ndarray, sr: int = SR) -> np.ndarray:
    """Compact signal-quality / hum-likeness vector for the acceptance gate."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) < _FRAME:
        x = np.pad(x, (0, _FRAME - len(x)))
    f0, voiced, rms = track_f0_energy(x, sr)
    frames = _frame_signal(x, _FRAME, _HOP).astype(np.float64)

    voiced_ratio = float(voiced.mean()) if len(voiced) else 0.0
    f0v = f0[voiced & (f0 > 0)]
    f0_med = float(np.median(f0v)) if len(f0v) else 0.0
    f0_cov = float(np.std(f0v) / (np.mean(f0v) + 1e-9)) if len(f0v) > 1 else 1.0  # tone→low

    # harmonicity (HNR proxy): autocorr peak strength over voiced frames
    harmo = []
    win = np.hanning(_FRAME)
    lag_min, lag_max = max(1, int(sr / 400)), min(_FRAME - 1, int(sr / 70))
    for i in np.where(voiced)[0][:200]:
        f = frames[i] * win
        ac = np.correlate(f, f, mode="full")[_FRAME - 1:]
        ac0 = ac[0] if ac[0] > 1e-9 else 1e-9
        seg = ac[lag_min:lag_max] / ac0
        if len(seg):
            harmo.append(float(seg.max()))
    harmonicity = float(np.mean(harmo)) if harmo else 0.0

    rms_mean = float(rms.mean())
    rms_dr = float(np.percentile(rms, 95) - np.percentile(rms, 5))
    noise_floor = float(np.percentile(rms, 10)) + 1e-9
    silence_ratio = float((rms < 2 * noise_floor).mean())
    snr_proxy = float(np.percentile(rms, 90) / noise_floor)

    zc = np.mean(np.abs(np.diff(np.sign(frames), axis=1)) > 0, axis=1)   # per-frame ZCR
    zcr, zcr_std = float(zc.mean()), float(zc.std())
    flat, centroid, rolloff, hf = _spectral_stats(frames, sr)
    # longest sustained voiced run / total frames
    run, best = 0, 0
    for vflag in voiced:
        run = run + 1 if vflag else 0
        best = max(best, run)
    voiced_run_frac = best / max(1, len(voiced))

    return np.array([
        voiced_ratio, f0_cov, f0_med / 400.0, harmonicity, rms_mean, rms_dr,
        silence_ratio, np.tanh(snr_proxy / 10), float(flat.mean()), zcr, zcr_std,
        float(centroid.mean()) / (sr / 2), float(rolloff.mean()) / (sr / 2),
        voiced_run_frac, float(hf.mean()),
    ], dtype=np.float32)


# --------------------------------------------------------------- synthetic negatives
def make_noise(kind: str, n: int = SR * 4, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng()
    if kind == "silence":
        return (rng.standard_normal(n) * 1e-3).astype(np.float32)          # near-silent floor
    if kind == "white":
        return (rng.standard_normal(n) * 0.1).astype(np.float32)
    if kind == "pink":
        w = rng.standard_normal(n)
        f = np.fft.rfft(w)
        f /= np.maximum(np.arange(len(f)), 1) ** 0.5
        x = np.fft.irfft(f, n)
        return (0.1 * x / (np.abs(x).max() + 1e-9)).astype(np.float32)
    if kind == "hum_plus_noise":     # quiet voiced + heavy noise (borderline → reject)
        t = np.arange(n) / SR
        tone = 0.05 * np.sin(2 * np.pi * 140 * t)
        return (tone + 0.12 * rng.standard_normal(n)).astype(np.float32)
    return (rng.standard_normal(n) * 0.05).astype(np.float32)
