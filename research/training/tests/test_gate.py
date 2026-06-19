"""Promotion-gate honesty: a model is promoted ONLY with complete, sufficient
evidence. Mirrors the TS gate tests + the extra 'beat classical' rule."""
from research.training.signal_neural.gate import promotion_gate


def test_passes_only_when_all_criteria_met():
    g = promotion_gate(0.86, 0.10, 0.005, classical_baseline=0.831)
    assert g.passed
    assert g.beats_classical


def test_fails_below_threshold():
    g = promotion_gate(0.78, 0.05, 0.001, classical_baseline=0.70)
    assert not g.passed
    assert any("balanced accuracy" in r for r in g.reasons)


def test_fails_without_permutation_test():
    g = promotion_gate(0.90, 0.05, None, classical_baseline=0.70)
    assert not g.passed
    assert any("permutation" in r for r in g.reasons)


def test_fails_when_pvalue_too_high():
    g = promotion_gate(0.90, 0.05, 0.04, classical_baseline=0.70)
    assert not g.passed
    assert any("p=" in r for r in g.reasons)


def test_fails_when_ece_too_high():
    g = promotion_gate(0.90, 0.30, 0.001, classical_baseline=0.70)
    assert not g.passed
    assert any("ECE" in r for r in g.reasons)


def test_fails_when_not_beating_classical():
    # clears 80%/p/ECE but only ties the classical baseline → keep classical
    g = promotion_gate(0.832, 0.05, 0.001, classical_baseline=0.831)
    assert not g.passed
    assert not g.beats_classical
    assert any("classical" in r for r in g.reasons)


def test_no_classical_baseline_means_no_beat_requirement():
    g = promotion_gate(0.86, 0.10, 0.005, classical_baseline=None)
    assert g.passed


def test_cannot_claim_90_without_the_number():
    # A 90% claim must be backed by an observed 0.90 — the gate echoes the real value.
    g = promotion_gate(0.81, 0.05, 0.001, classical_baseline=0.70)
    assert g.passed
    assert abs(g.observed - 0.81) < 1e-9
    assert "81.0%" in g.reasons[0]
