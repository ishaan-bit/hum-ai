"""Frozen pretrained-backbone embeddings for the SOTA pooled-affect experiment.

Loads a self-supervised speech model (wav2vec2 / WavLM / HuBERT) ONCE, runs every
clip through it on the accelerator, and pools the transformer hidden states to a
fixed-length embedding (mean ⊕ std over time, averaged across a span of upper layers
— the SUPERB recipe for paralinguistic tasks). The backbone is FROZEN (no grad): this
is the fast, memory-light SOTA path that fits the 8 GB Arc iGPU, and the expensive
forward pass is cached to a git-ignored .npy so it runs exactly once per (model, set).

Self-supervised pretraining IS the point here — wav2vec2/WavLM are pretrained on
~960 h+ of unlabelled speech, which is the transfer signal a 2 k–9 k-clip corpus
cannot learn from scratch.
"""
from __future__ import annotations

import hashlib
import time

import numpy as np
import torch

from . import corpora, paths

DEFAULT_MODEL = "facebook/wav2vec2-base"
MAX_SECONDS = 8.0          # truncate very long clips so memory/time stay bounded
TARGET_SR = 16000


def _cache_path(model_name: str, layer_pool: str, domain: str = "raw"):
    safe = model_name.replace("/", "_")
    dom = "" if domain == "raw" else f"_{domain}"
    return paths.cache_dir() / f"emb_{safe}_{layer_pool}{dom}.npz"


def _load_store(cache) -> dict:
    if not cache.exists():
        return {}
    z = np.load(cache, allow_pickle=True)
    return dict(zip(z["uids"].tolist(), z["emb"]))


def _save_store(cache, store: dict):
    paths.assert_gitignored(cache)
    cache.parent.mkdir(parents=True, exist_ok=True)
    uids = list(store.keys())
    np.savez(cache, uids=np.array(uids, dtype=object), emb=np.stack([store[u] for u in uids], axis=0))


def _pool_hidden(hs: torch.Tensor) -> torch.Tensor:
    """hs: [T, H] valid frames → mean ⊕ std over time → [2H]."""
    return torch.cat([hs.mean(dim=0), hs.std(dim=0)], dim=0)


def _resolve_local(model_name: str) -> str:
    """Prefer a curl-downloaded local copy under research/training/models/<name> (the
    hf_hub/Xet downloader is unreliable on some networks; curl into a local dir works)."""
    local = paths.repo_root() / "research" / "training" / "models" / model_name.split("/")[-1]
    return str(local) if (local / "config.json").exists() else model_name


def extract_embeddings(
    items: list[corpora.Item],
    device,
    model_name: str = DEFAULT_MODEL,
    layer_pool: str = "last4",          # "last" | "last4" (mean of last 4 layers)
    use_cache: bool = True,
    domain: str = "raw",                # "raw" | "hum" | "whistle" (hum-domain projection)
    log=print,
) -> np.ndarray:
    """Return [N, 2H] frozen-backbone embeddings for `items`. Cached PER CLIP (uid) in a
    single .npz, so adding a corpus only extracts the new clips — never re-extracts."""
    cache = _cache_path(model_name, layer_pool, domain)
    store = _load_store(cache) if use_cache else {}
    missing = [it for it in items if it.uid not in store]
    log(f"  [emb] {len(items)} clips; cached={len(items)-len(missing)} missing={len(missing)} ({model_name})")

    if missing:
        from transformers import AutoFeatureExtractor, AutoModel  # lazy (heavy import)
        src = _resolve_local(model_name)
        log(f"  [emb] loading backbone from {src} on {device.type} …")
        fe = AutoFeatureExtractor.from_pretrained(src)
        model = AutoModel.from_pretrained(src, output_hidden_states=True).to(device).eval()
        for p in model.parameters():
            p.requires_grad_(False)
        max_len = int(MAX_SECONDS * TARGET_SR)
        t0 = time.time()
        with torch.no_grad():
            for i, it in enumerate(missing):
                wav = corpora.load_waveform(it, domain=domain)
                if len(wav) > max_len:
                    s = (len(wav) - max_len) // 2
                    wav = wav[s:s + max_len]
                if len(wav) < TARGET_SR // 2:
                    wav = np.pad(wav, (0, TARGET_SR // 2 - len(wav)))
                iv = fe(wav, sampling_rate=TARGET_SR, return_tensors="pt")
                out = model(iv.input_values.to(device))
                hs = (torch.stack(out.hidden_states[-4:], 0).mean(0)[0] if layer_pool == "last4"
                      else out.last_hidden_state[0])
                store[it.uid] = _pool_hidden(hs).float().cpu().numpy()
                if i % 250 == 0 or i == len(missing) - 1:
                    rate = (i + 1) / max(1e-6, time.time() - t0)
                    log(f"  [emb] {i+1}/{len(missing)}  ({rate:.1f} clip/s, ~{(len(missing)-i-1)/max(rate,1e-6)/60:.0f} min left)")
                    if use_cache and i and i % 1000 == 0:
                        _save_store(cache, store)   # checkpoint long runs
        if use_cache:
            _save_store(cache, store)
            log(f"  [emb] cached → {cache.name} ({len(store)} clips)")
        del model
        if device.type == "xpu":
            torch.xpu.empty_cache()
    return np.stack([store[it.uid] for it in items], axis=0).astype(np.float32)
