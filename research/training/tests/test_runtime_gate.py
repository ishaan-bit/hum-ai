"""Tests for the deployable capture gate (Stage ①).

Decision-logic tests run always (synthetic gate). End-to-end accept/reject tests run
only when the trained `capture_gate.json` artifact is present (it is git-ignored)."""
import numpy as np
import pytest

from research.training.signal_neural import acceptance, runtime_gate, paths


def _synth_hum(sr=16000, secs=3.0, f0=140.0):
    t = np.arange(int(sr * secs)) / sr
    sig = sum(np.exp(-0.6 * k) * np.sin(2 * np.pi * f0 * (k + 1) * t) for k in range(6))
    return (0.2 * sig).astype(np.float32)


def test_gate_proba_monotone_in_weights():
    # A trivial 1-feature gate: higher feature → higher P(hum).
    gate = {"standardizer": {"mean": [0.0], "std": [1.0]}, "weights": [[-1.0], [1.0]], "bias": [0.0, 0.0]}
    lo = runtime_gate._gate_proba(np.array([-2.0]), gate)
    hi = runtime_gate._gate_proba(np.array([2.0]), gate)
    assert 0.0 <= lo <= 1.0 and 0.0 <= hi <= 1.0
    assert hi > lo


def test_quality_features_shape():
    f = acceptance.quality_features(_synth_hum())
    assert f.shape == (len(acceptance.QUALITY_FEATURES),)
    assert np.isfinite(f).all()


@pytest.mark.skipif(
    not (paths.neural_artifacts_dir() / "capture_gate.json").exists(),
    reason="trained capture_gate.json artifact not present (git-ignored)",
)
def test_accepts_hum_rejects_noise_and_silence():
    rng = np.random.default_rng(0)
    hum = runtime_gate.assess_capture(_synth_hum())
    noise = runtime_gate.assess_capture((rng.standard_normal(16000 * 3) * 0.1).astype(np.float32))
    silence = runtime_gate.assess_capture((rng.standard_normal(16000 * 3) * 1e-3).astype(np.float32))
    assert hum.accepted is True
    assert noise.accepted is False and noise.action == "ask_user_to_hum_again"
    assert silence.accepted is False
