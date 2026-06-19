"""Path conventions — mirror `@hum-ai/signal-lab/src/paths.ts`.

Generated artifacts (checkpoints, tensors, manifests, machine results) live under
the git-ignored `data/processed/signal-lab/neural/`. The human-readable model CARD
is the only tracked output, written under `research/model-cards/` (existing repo
convention). `HUM_DATA_DIR` overrides the data root exactly like the TS side.
"""
from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    # research/training/signal_neural/paths.py → repo is parents[3].
    return Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    env = os.environ.get("HUM_DATA_DIR", "").strip()
    if env:
        return Path(env).resolve()
    return repo_root() / "data"


def neural_artifacts_dir() -> Path:
    return data_dir() / "processed" / "signal-lab" / "neural"


def cache_dir() -> Path:
    return neural_artifacts_dir() / "cache"


def checkpoints_dir() -> Path:
    return neural_artifacts_dir() / "checkpoints"


def model_cards_dir() -> Path:
    return repo_root() / "research" / "model-cards"


def export_rows_path() -> Path:
    return neural_artifacts_dir() / "labelled_rows.jsonl"


def export_meta_path() -> Path:
    return neural_artifacts_dir() / "neural_export_meta.json"


def assert_gitignored(p: Path) -> None:
    """Refuse to write a generated artifact onto a tracked path (data/ is ignored)."""
    p = Path(p).resolve()
    dd = data_dir().resolve()
    inside_repo = repo_root().resolve() in p.parents or p == repo_root().resolve()
    if not inside_repo:
        return  # outside the repo entirely (e.g. HUM_DATA_DIR) — safe
    if dd in p.parents or p == dd:
        return  # under the git-ignored data/ tree — safe
    raise ValueError(
        f"Refusing to write a generated artifact to a tracked path: {p}. "
        f"Artifacts must live under {dd} (git-ignored) or outside the repo."
    )
