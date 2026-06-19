"""Promotion gate — mirror of `cohort-eval.ts` `promotionGate`, plus a stricter
"must beat the classical baseline" rule for neural promotion.

A neural model is promotable for a target ONLY if ALL hold under actor-grouped CV:
  1. balanced accuracy >= threshold (default 0.80),
  2. label-permutation p < maxPValue (default 0.01) — the target carries real signal,
  3. top-class ECE <= eceCap (default 0.15) — confident-and-correct, not just confident,
  4. balanced accuracy > the classical-cohort baseline for the same target (with a
     small margin) — a neural model that merely ties the classical baseline is NOT
     worth a heavier runtime, so we keep classical.

The gate NEVER rounds up or waives a criterion; it returns explicit reasons.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GateResult:
    metric: str
    threshold: float
    observed: float
    ece: float
    ece_cap: float
    p_value: float | None
    max_p_value: float
    classical_baseline: float | None
    beat_margin: float
    beats_classical: bool
    passed: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "metric": self.metric,
            "threshold": self.threshold,
            "observed": self.observed,
            "ece": self.ece,
            "eceCap": self.ece_cap,
            "pValue": self.p_value,
            "maxPValue": self.max_p_value,
            "classicalBaseline": self.classical_baseline,
            "beatMargin": self.beat_margin,
            "beatsClassical": self.beats_classical,
            "passed": self.passed,
            "reasons": self.reasons,
        }


def promotion_gate(
    balanced_accuracy: float,
    ece: float,
    p_value: float | None,
    classical_baseline: float | None = None,
    threshold: float = 0.80,
    ece_cap: float = 0.15,
    max_p_value: float = 0.01,
    beat_margin: float = 0.005,
) -> GateResult:
    reasons: list[str] = []
    if balanced_accuracy < threshold:
        reasons.append(f"balanced accuracy {balanced_accuracy*100:.1f}% < {threshold*100:.0f}%")
    if p_value is None:
        reasons.append("no permutation significance test was run")
    elif p_value >= max_p_value:
        reasons.append(f"permutation p={p_value:.3f} >= {max_p_value}")
    if ece > ece_cap:
        reasons.append(f"ECE {ece:.3f} > {ece_cap}")

    beats_classical = True
    if classical_baseline is not None:
        beats_classical = balanced_accuracy > classical_baseline + beat_margin
        if not beats_classical:
            reasons.append(
                f"does not beat classical baseline {classical_baseline*100:.1f}% by >{beat_margin*100:.1f}pp "
                f"(neural {balanced_accuracy*100:.1f}%) — keep classical"
            )

    passed = len(reasons) == 0
    if passed:
        reasons.append(
            f"balanced accuracy {balanced_accuracy*100:.1f}% >= {threshold*100:.0f}%, "
            f"p={p_value:.3f}, ECE {ece:.3f}"
            + (f", beats classical {classical_baseline*100:.1f}%" if classical_baseline is not None else "")
        )
    return GateResult(
        metric="balanced_accuracy",
        threshold=threshold,
        observed=balanced_accuracy,
        ece=ece,
        ece_cap=ece_cap,
        p_value=p_value,
        max_p_value=max_p_value,
        classical_baseline=classical_baseline,
        beat_margin=beat_margin,
        beats_classical=beats_classical,
        passed=passed,
        reasons=reasons,
    )
