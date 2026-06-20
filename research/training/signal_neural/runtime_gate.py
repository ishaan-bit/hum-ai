"""Runtime capture gate + gated read — the DEPLOYABLE Stage ① of the hum flow.

Loads the trained strict capture gate (`capture_gate.json`) and decides, for a single
captured waveform, whether it is a usable HUM. If not → the caller asks the user to hum
again; affect is NEVER computed on a rejected capture (no over-claiming on noise / sigh /
breath / speech / silence). This mirrors `acceptance.quality_features` exactly so the
deployed decision matches the validated 97.6%-balanced-accuracy gate.

`gated_read` chains the gate with the affect prior (the Python-served mel model) so the
whole "①accept → ②/③ affect" path is one call. Honest by construction: a rejected capture
returns a retry prompt and no affect; an accepted one returns affect carrying the
far-domain caveat (ADR-0005).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict

import numpy as np

from . import acceptance, data, paths


@dataclass
class CaptureDecision:
    accepted: bool
    p_hum: float
    threshold: float
    reason: str
    action: str            # "" when accepted | "ask_user_to_hum_again" when rejected

    def to_dict(self) -> dict:
        return asdict(self)


def _load_gate(path=None) -> dict:
    p = path or (paths.neural_artifacts_dir() / "capture_gate.json")
    return json.loads(open(p, encoding="utf-8").read())


def _gate_proba(x_feats: np.ndarray, gate: dict) -> float:
    mean = np.array(gate["standardizer"]["mean"], dtype=np.float64)
    sd = np.array(gate["standardizer"]["std"], dtype=np.float64)
    W = np.array(gate["weights"], dtype=np.float64)        # [2, D]
    b = np.array(gate["bias"], dtype=np.float64)           # [2]
    xs = (x_feats - mean) / sd
    z = xs @ W.T + b
    z = z - z.max()
    e = np.exp(z)
    p = e / e.sum()
    return float(p[1])                                     # P(hum)


def assess_capture(wav: np.ndarray | str, gate=None) -> CaptureDecision:
    """Decide whether `wav` (16 kHz float array OR path to a WAV) is a usable hum."""
    gate = gate or _load_gate()
    if isinstance(wav, str):
        with open(wav, "rb") as f:
            x, sr = data._decode_wav_bytes(f.read())
        wav = data._resample_to_target(x, sr)
    feats = acceptance.quality_features(np.asarray(wav, dtype=np.float64)).astype(np.float64)
    p = _gate_proba(feats, gate)
    thr = float(gate.get("threshold", 0.5))
    if p >= thr:
        return CaptureDecision(True, p, thr, f"clear sustained hum (P(hum)={p:.2f} ≥ {thr})", "")
    return CaptureDecision(
        False, p, thr,
        f"not a clear hum (P(hum)={p:.2f} < {thr}) — likely noise/silence/speech/sigh/whistle",
        "ask_user_to_hum_again",
    )


def gated_read(wav: np.ndarray | str, affect_checkpoint: str | None = None, device: str = "auto") -> dict:
    """Full gated single-capture read: ① gate, then ②/③ affect ONLY if accepted."""
    decision = assess_capture(wav)
    out: dict = {"captureGate": decision.to_dict()}
    if not decision.accepted:
        out["affect"] = None
        out["message"] = "Didn't catch a clear hum — please hum again."
        return out
    if affect_checkpoint:
        from .. import infer  # lazy
        if isinstance(wav, str):
            out["affect"] = infer.predict_wav(affect_checkpoint, wav, device)
        else:
            out["affect"] = {"note": "affect prediction needs a WAV path for the mel pipeline"}
    else:
        out["affect"] = {"note": "no affect checkpoint provided; gate-only read"}
    out["affect_caveat"] = (
        "Far-domain hum-projected PRIOR (ADR-0005): arousal/valence are coarse axes, never hum "
        "truth, never clinical; surfaced with OOD abstention + far-domain penalty."
    )
    return out
