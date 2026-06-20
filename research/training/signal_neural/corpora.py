"""Multi-corpus loader for the SOTA pooled-affect experiment.

Pools the labelled speech-emotion corpora that are actually on disk into ONE
actor-grouped dataset, with the EXACT same target derivation as the TS export, so
results stay directly comparable to the classical/neural cohorts and honest under
ADR-0005:

  - RAVDESS  (24 actors, acted speech+song) — reuse the TS export rows (labels +
    actor groups already computed) so RAVDESS labelling is byte-identical.
  - CREMA-D  (91 actors, crowd-validated)    — parse `AudioWAV/<actor>_<sent>_<EMO>_<lvl>.wav`.

emotion → fusion label → (arousal_binary, valence_binary) follows the repo's
`label_mapping.json`: disgust + surprise have no distinct fusion label and are
EXCLUDED from every target (exactly as RAVDESS does), so the pool is consistent.
Speaker groups are namespaced per corpus (`ravdess:actor_1`, `cremad:1001`) so the
actor-grouped CV never lets a speaker leak across folds even across corpora.
"""
from __future__ import annotations

import io
import wave
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import data as ravdess_data, paths

TARGET_SR = 16000

# Canonical maps (mirror label_mapping.json / FUSION_LABEL_AFFECT).
EMOTION_TO_FUSION = {
    "neutral": "neutral_close_to_usual",
    "calm": "calm_regulated",
    "happy": "positive_activation",
    "sad": "low_mood",
    "angry": "high_arousal_negative",
    "fearful": "tense_anxious",
    "disgust": None,        # excluded — no distinct fusion label (ADR-0005 mapping)
    "surprised": None,      # excluded — ambiguous valence
}
FUSION_TO_BINARY = {
    "neutral_close_to_usual": (None, None),          # neutral deadband — excluded from binary
    "calm_regulated": ("low_arousal", "positive_valence"),
    "positive_activation": ("high_arousal", "positive_valence"),
    "low_mood": ("low_arousal", "negative_valence"),
    "high_arousal_negative": ("high_arousal", "negative_valence"),
    "tense_anxious": ("high_arousal", "negative_valence"),
}
CREMAD_CODE = {"ANG": "angry", "DIS": "disgust", "FEA": "fearful",
               "HAP": "happy", "NEU": "neutral", "SAD": "sad"}


def targets_for_emotion(emotion: str) -> dict:
    """emotion → {affect_fusion_label, arousal_binary, valence_binary} (None = excluded)."""
    fusion = EMOTION_TO_FUSION.get(emotion)
    arousal, valence = FUSION_TO_BINARY.get(fusion, (None, None)) if fusion else (None, None)
    return {"affect_fusion_label": fusion, "arousal_binary": arousal, "valence_binary": valence}


@dataclass
class Item:
    uid: str
    corpus: str                 # "ravdess" | "cremad"
    group: str                  # namespaced speaker id (globally unique)
    audio: tuple                # ("zip", archive_path, entry) | ("file", path)
    targets: dict               # {target_id: class|None}


def load_ravdess_items() -> list[Item]:
    """Reuse the TS export rows (identical labels + groups) and resolve each clip to its
    RAVDESS zip entry, so RAVDESS audio is read the same way as the existing harness."""
    ds = ravdess_data.load_export()
    archives = [a for a in ds.meta.get("audioArchives", []) if Path(a).exists()]
    index = ravdess_data._build_zip_index(archives)  # entry -> archive
    items: list[Item] = []
    for r in ds.rows:
        entry = r["sourceSampleId"]
        arc = index.get(entry)
        if arc is None:
            continue
        items.append(Item(
            uid=f"ravdess:{r.get('signalId') or entry}",
            corpus="ravdess",
            group=f"ravdess:{r['group']}",
            audio=("zip", arc, entry),
            targets=dict(r["targets"]),
        ))
    return items


def load_cremad_items(root: Path | None = None) -> list[Item]:
    """Parse CREMA-D AudioWAV filenames → emotion → targets. Speaker group = actor id."""
    root = root or (paths.repo_root() / "data" / "raw" / "crema_d" / "AudioWAV")
    if not root.exists():
        return []
    items: list[Item] = []
    for wav in sorted(root.glob("*.wav")):
        if wav.stat().st_size < 1024:       # unhydrated LFS pointer — skip
            continue
        parts = wav.stem.split("_")          # <actor>_<sentence>_<EMO>_<level>
        if len(parts) < 3:
            continue
        actor, emo_code = parts[0], parts[2]
        emotion = CREMAD_CODE.get(emo_code.upper())
        if emotion is None:
            continue
        items.append(Item(
            uid=f"cremad:{wav.stem}",
            corpus="cremad",
            group=f"cremad:{actor}",
            audio=("file", str(wav)),
            targets=targets_for_emotion(emotion),
        ))
    return items


# --------------------------------------------------------------------------- audio
def load_waveform(item: Item, domain: str = "raw") -> np.ndarray:
    """Return a mono float32 16 kHz waveform for `item` (zip entry or file).

    `domain` controls hum-domain projection (see humify.py):
      - "raw":     the original speech (speech-benchmark track).
      - "hum":     resynthesized hum (F0 contour + energy, formants/consonants removed).
      - "whistle": near-pure tone following F0 (the furthest-from-speech hum variant).
    """
    kind = item.audio[0]
    if kind == "zip":
        _, arc, entry = item.audio
        with zipfile.ZipFile(arc) as zf:
            b = zf.read(entry)
    else:
        _, path = item.audio
        with open(path, "rb") as f:
            b = f.read()
    x, sr = ravdess_data._decode_wav_bytes(b)
    x = ravdess_data._resample_to_target(x, sr)
    if domain and domain != "raw":
        from . import humify
        x = humify.humify_waveform(x, sr=ravdess_data.TARGET_SR, mode=domain)
    return x


def pooled_items(include_cremad: bool = True) -> list[Item]:
    items = load_ravdess_items()
    if include_cremad:
        items += load_cremad_items()
    return items


def summarize(items: list[Item]) -> dict:
    from collections import Counter
    out = {"n": len(items), "by_corpus": dict(Counter(i.corpus for i in items)),
           "n_groups": len({i.group for i in items})}
    for tid in ("affect_fusion_label", "arousal_binary", "valence_binary"):
        c = Counter(i.targets.get(tid) for i in items if i.targets.get(tid) is not None)
        out[tid] = {"n": sum(c.values()), "classes": dict(c)}
    return out
