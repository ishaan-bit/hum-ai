"""Config/export loading + metric definitions (must match the TS cohort)."""
import json

import numpy as np

from research.training.signal_neural import data, metrics


def test_balanced_accuracy_immune_to_imbalance():
    # 90 of class A, 10 of class B; predict all A → raw acc 0.9 but balanced acc 0.5
    y_true = ["A"] * 90 + ["B"] * 10
    y_pred = ["A"] * 100
    assert abs(metrics.accuracy(y_true, y_pred) - 0.9) < 1e-9
    assert abs(metrics.balanced_accuracy(y_true, y_pred, ["A", "B"]) - 0.5) < 1e-9
    assert abs(metrics.full_metrics(y_true, y_pred, [0.9] * 100, ["A", "B"])["chance"]["balanced_chance"] - 0.5) < 1e-9


def test_ece_zero_when_perfectly_calibrated():
    y_true = ["A", "B", "A", "B"]
    y_pred = ["A", "B", "A", "B"]
    # all correct with confidence 1.0 → bin error 0
    assert metrics.expected_calibration_error(y_true, y_pred, [1.0, 1.0, 1.0, 1.0]) < 1e-9


def test_load_export_roundtrip(tmp_path):
    meta = {
        "featureNames": ["f0", "f1"],
        "targets": [
            {"id": "arousal_binary", "classes": ["low_arousal", "high_arousal"], "description": "x"},
        ],
        "gate": {"threshold": 0.8, "eceCap": 0.15, "maxPValue": 0.01},
        "classicalBaseline": {"arousal_binary": 0.831},
        "audioArchives": [],
    }
    rows = [
        {"signalId": "a", "sourceSampleId": "Actor_01/x.wav", "group": "actor_01",
         "fusionLabel": "calm_regulated", "targets": {"arousal_binary": "low_arousal"}, "features": [0.1, 0.2]},
        {"signalId": "b", "sourceSampleId": "Actor_02/y.wav", "group": "actor_02",
         "fusionLabel": "high_arousal_negative", "targets": {"arousal_binary": "high_arousal"}, "features": [0.3, 0.4]},
        {"signalId": "c", "sourceSampleId": "Actor_03/z.wav", "group": "actor_03",
         "fusionLabel": "neutral_close_to_usual", "targets": {"arousal_binary": None}, "features": [0.5, 0.6]},
    ]
    mp = tmp_path / "meta.json"
    rp = tmp_path / "rows.jsonl"
    mp.write_text(json.dumps(meta), encoding="utf-8")
    rp.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")

    ds = data.load_export(rows_path=rp, meta_path=mp)
    assert ds.features.shape == (3, 2)
    # the neutral row is EXCLUDED from arousal_binary via the mask
    assert ds.masks_by_target["arousal_binary"].tolist() == [True, True, False]
    assert list(ds.labels_by_target["arousal_binary"][ds.masks_by_target["arousal_binary"]]) == [
        "low_arousal", "high_arousal"
    ]
