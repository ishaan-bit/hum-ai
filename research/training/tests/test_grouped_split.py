"""Grouped-split integrity: no actor/group leaks across folds, and the partition
matches the TS `groupFolds` round-robin exactly."""
import numpy as np

from research.training.signal_neural.data import grouped_folds


def test_groups_are_disjoint_across_folds():
    groups = np.array([f"actor_{i%24:02d}" for i in range(2068)], dtype=object)
    fold_of = grouped_folds(groups, folds=5)
    # every group must map to exactly ONE fold
    by_group = {}
    for g, f in zip(groups, fold_of):
        by_group.setdefault(g, set()).add(f)
    assert all(len(s) == 1 for s in by_group.values())


def test_round_robin_matches_ts():
    groups = np.array(["actor_03", "actor_01", "actor_02", "actor_01"], dtype=object)
    fold_of = grouped_folds(groups, folds=2)
    # sorted unique: [actor_01, actor_02, actor_03] -> folds 0,1,0
    expected = {"actor_01": 0, "actor_02": 1, "actor_03": 0}
    for g, f in zip(groups, fold_of):
        assert f == expected[g]


def test_all_folds_used_when_enough_groups():
    groups = np.array([f"a{i}" for i in range(10)], dtype=object)
    fold_of = grouped_folds(groups, folds=5)
    assert set(fold_of.tolist()) == {0, 1, 2, 3, 4}
