"""Data loading for the neural cohort.

Single source of truth = the TS export (`npm run signal:export-neural`):
  - `labelled_rows.jsonl`  — one row per labelled RAVDESS sample: actor `group`,
    `fusionLabel`, per-target class, the 58-d engineered `features`, and the WAV
    `sourceSampleId` (entry path inside the RAVDESS zip).
  - `neural_export_meta.json` — feature names, target snapshots, gate config,
    classical baselines, audio archive paths.

Audio is read zip-direct (no extraction into the repo) and decoded with the stdlib
`wave` module (RAVDESS is 16-bit PCM). Waveforms are downsampled to 16 kHz, fixed
to a 3 s window, and turned into log-mel spectrograms via a hand-built mel
filterbank (no librosa/torchaudio dependency). Mels are cached to a git-ignored
`.npy` so repeated CV folds / epochs do not recompute them.

Grouped folds replicate `cohort-eval.ts groupFolds` EXACTLY (round-robin over
sorted actor ids), so the neural CV partition matches the classical one.
"""
from __future__ import annotations

import io
import json
import wave
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import paths

# ---- Audio / mel configuration (fixed so cache + checkpoints stay consistent) ----
TARGET_SR = 16000
CLIP_SECONDS = 3.0
CLIP_SAMPLES = int(TARGET_SR * CLIP_SECONDS)
N_FFT = 512
HOP = 160          # 10 ms
N_MELS = 64
FMIN = 0.0
FMAX = TARGET_SR / 2
MEL_CONFIG_TAG = f"sr{TARGET_SR}_d{CLIP_SECONDS}_n{N_FFT}_h{HOP}_m{N_MELS}"


@dataclass
class Dataset:
    meta: dict
    rows: list[dict]
    features: np.ndarray          # [N, F] engineered feature vectors
    labels_by_target: dict        # target_id -> np.ndarray[str] (aligned to a mask)
    masks_by_target: dict         # target_id -> np.ndarray[bool] (row included?)
    groups: np.ndarray            # [N] actor id per row
    feature_names: list[str]
    mels: np.ndarray | None = None  # [N, N_MELS, T] log-mel, filled by ensure_mels()


def load_export(rows_path: Path | None = None, meta_path: Path | None = None) -> Dataset:
    rows_path = rows_path or paths.export_rows_path()
    meta_path = meta_path or paths.export_meta_path()
    if not rows_path.exists() or not meta_path.exists():
        raise FileNotFoundError(
            f"Neural export not found ({rows_path}). Run `npm run signal:export-neural` first."
        )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    rows = [json.loads(l) for l in rows_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    feature_names = list(meta["featureNames"])
    features = np.array([r["features"] for r in rows], dtype=np.float32)
    groups = np.array([r["group"] for r in rows], dtype=object)

    labels_by_target: dict = {}
    masks_by_target: dict = {}
    target_ids = [t["id"] for t in meta["targets"]]
    for tid in target_ids:
        mask = np.array([r["targets"].get(tid) is not None for r in rows], dtype=bool)
        labels = np.array([r["targets"].get(tid) or "" for r in rows], dtype=object)
        labels_by_target[tid] = labels
        masks_by_target[tid] = mask

    return Dataset(
        meta=meta,
        rows=rows,
        features=features,
        labels_by_target=labels_by_target,
        masks_by_target=masks_by_target,
        groups=groups,
        feature_names=feature_names,
    )


def grouped_folds(groups: np.ndarray, folds: int = 5) -> np.ndarray:
    """Round-robin over SORTED unique group ids — identical to TS `groupFolds`."""
    uniq = sorted(set(groups.tolist()))
    group_fold = {g: i % folds for i, g in enumerate(uniq)}
    return np.array([group_fold[g] for g in groups], dtype=int)


# --------------------------------------------------------------------------------
# Audio decode + mel spectrogram (dependency-free)
# --------------------------------------------------------------------------------
def _decode_wav_bytes(b: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(b), "rb") as w:
        sr = w.getframerate()
        nch = w.getnchannels()
        sw = w.getsampwidth()
        n = w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sw == 4:
        x = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported sample width {sw}")
    if nch > 1:
        x = x.reshape(-1, nch).mean(axis=1)
    return x, sr


def _resample_to_target(x: np.ndarray, sr: int) -> np.ndarray:
    if sr == TARGET_SR:
        return x
    # Decimation with a light box low-pass when downsampling by an integer factor
    # (RAVDESS is 48 kHz → factor 3); otherwise linear interpolation.
    if sr % TARGET_SR == 0:
        factor = sr // TARGET_SR
        trim = (len(x) // factor) * factor
        if trim == 0:
            return np.zeros(0, dtype=np.float32)
        return x[:trim].reshape(-1, factor).mean(axis=1).astype(np.float32)
    n_out = int(round(len(x) * TARGET_SR / sr))
    if n_out <= 1:
        return np.zeros(0, dtype=np.float32)
    xp = np.linspace(0, 1, num=len(x), endpoint=False)
    fp = x
    xq = np.linspace(0, 1, num=n_out, endpoint=False)
    return np.interp(xq, xp, fp).astype(np.float32)


def _fix_length(x: np.ndarray) -> np.ndarray:
    if len(x) >= CLIP_SAMPLES:
        start = (len(x) - CLIP_SAMPLES) // 2  # center crop
        return x[start : start + CLIP_SAMPLES]
    out = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    out[: len(x)] = x
    return out


def _mel_filterbank() -> np.ndarray:
    """Slaney-style triangular mel filterbank [N_MELS, N_FFT//2+1]."""
    def hz_to_mel(f):
        return 2595.0 * np.log10(1.0 + f / 700.0)

    def mel_to_hz(m):
        return 700.0 * (10.0 ** (m / 2595.0) - 1.0)

    n_bins = N_FFT // 2 + 1
    fft_freqs = np.linspace(0, TARGET_SR / 2, n_bins)
    mel_pts = np.linspace(hz_to_mel(FMIN), hz_to_mel(FMAX), N_MELS + 2)
    hz_pts = mel_to_hz(mel_pts)
    fb = np.zeros((N_MELS, n_bins), dtype=np.float32)
    for m in range(1, N_MELS + 1):
        f_left, f_center, f_right = hz_pts[m - 1], hz_pts[m], hz_pts[m + 1]
        for k, f in enumerate(fft_freqs):
            if f_left <= f <= f_center and f_center > f_left:
                fb[m - 1, k] = (f - f_left) / (f_center - f_left)
            elif f_center <= f <= f_right and f_right > f_center:
                fb[m - 1, k] = (f_right - f) / (f_right - f_center)
    return fb


_HANN = np.hanning(N_FFT).astype(np.float32)
_MELFB = _mel_filterbank()


def _log_mel(x: np.ndarray) -> np.ndarray:
    """Log-mel spectrogram [N_MELS, T], per-utterance standardized."""
    n_frames = 1 + (len(x) - N_FFT) // HOP if len(x) >= N_FFT else 1
    n_frames = max(1, n_frames)
    power = np.zeros((N_FFT // 2 + 1, n_frames), dtype=np.float32)
    for t in range(n_frames):
        start = t * HOP
        frame = x[start : start + N_FFT]
        if len(frame) < N_FFT:
            frame = np.pad(frame, (0, N_FFT - len(frame)))
        spec = np.fft.rfft(frame * _HANN)
        power[:, t] = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
    mel = _MELFB @ power                       # [N_MELS, T]
    logmel = np.log(mel + 1e-6)
    mu = logmel.mean()
    sd = logmel.std()
    return ((logmel - mu) / (sd + 1e-6)).astype(np.float32)


def _build_zip_index(archives: list[str]) -> dict[str, str]:
    """Map WAV entry name -> archive path across the RAVDESS zip(s)."""
    index: dict[str, str] = {}
    for arc in archives:
        if not Path(arc).exists():
            continue
        with zipfile.ZipFile(arc) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".wav"):
                    index[name] = arc
    return index


def ensure_mels(ds: Dataset, use_cache: bool = True, progress: bool = True) -> np.ndarray:
    """Compute (or load cached) log-mel spectrograms for every row, [N, N_MELS, T]."""
    if ds.mels is not None:
        return ds.mels
    cache = paths.cache_dir() / f"mels_{MEL_CONFIG_TAG}_n{len(ds.rows)}.npy"
    if use_cache and cache.exists():
        ds.mels = np.load(cache)
        if progress:
            print(f"  [mel] loaded cache {cache.name} shape={ds.mels.shape}")
        return ds.mels

    archives = list(ds.meta.get("audioArchives", []))
    index = _build_zip_index(archives)
    if not index:
        raise FileNotFoundError(
            f"No readable RAVDESS audio archives at {archives}. Mel models need the raw zips on disk."
        )

    open_zips: dict[str, zipfile.ZipFile] = {}
    mels = None
    try:
        for i, r in enumerate(ds.rows):
            name = r["sourceSampleId"]
            arc = index.get(name)
            if arc is None:
                raise FileNotFoundError(f"audio entry not found in zips: {name}")
            if arc not in open_zips:
                open_zips[arc] = zipfile.ZipFile(arc)
            b = open_zips[arc].read(name)
            x, sr = _decode_wav_bytes(b)
            x = _fix_length(_resample_to_target(x, sr))
            lm = _log_mel(x)
            if mels is None:
                mels = np.zeros((len(ds.rows), lm.shape[0], lm.shape[1]), dtype=np.float32)
            # guard against off-by-one frame counts
            t = min(lm.shape[1], mels.shape[2])
            mels[i, :, :t] = lm[:, :t]
            if progress and (i % 200 == 0 or i == len(ds.rows) - 1):
                print(f"  [mel] {i+1}/{len(ds.rows)}")
    finally:
        for z in open_zips.values():
            z.close()

    ds.mels = mels
    if use_cache:
        paths.assert_gitignored(cache)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.save(cache, mels)
        if progress:
            print(f"  [mel] cached → {cache}")
    return mels
