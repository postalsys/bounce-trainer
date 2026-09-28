import unittest

import numpy as np

from training_utils import class_weights, format_report, per_label_report, stratified_split


class StratifiedSplitTest(unittest.TestCase):
    def test_every_class_with_two_or_more_samples_is_validated(self):
        y = np.array([0] * 100 + [1] * 10 + [2] * 2 + [3] * 1)
        train, val = stratified_split(y, val_fraction=0.1, seed=1)
        self.assertEqual(sorted(np.concatenate([train, val])), list(range(len(y))))
        self.assertEqual(len(set(train) & set(val)), 0)
        val_counts = np.bincount(y[val], minlength=4)
        self.assertEqual(list(val_counts), [10, 1, 1, 0])
        # a class never loses all its training samples
        self.assertTrue(all(np.bincount(y[train], minlength=4) >= 1))

    def test_seed_makes_split_reproducible(self):
        y = np.array([0, 1] * 50)
        a = stratified_split(y, seed=7)
        b = stratified_split(y, seed=7)
        np.testing.assert_array_equal(a[0], b[0])
        np.testing.assert_array_equal(a[1], b[1])


class ClassWeightsTest(unittest.TestCase):
    def test_balanced_and_sqrt(self):
        y = np.array([0] * 90 + [1] * 10)
        balanced = class_weights(y, 3, "balanced")
        self.assertAlmostEqual(balanced[0], 100 / (3 * 90))
        self.assertAlmostEqual(balanced[1], 100 / (3 * 10))
        self.assertEqual(balanced[2], 1.0)
        sqrt = class_weights(y, 3, "sqrt")
        self.assertAlmostEqual(sqrt[1], np.sqrt(balanced[1]))
        self.assertGreater(sqrt[1], sqrt[0])

    def test_none_and_invalid_mode(self):
        self.assertIsNone(class_weights([0, 1], 2, "none"))
        with self.assertRaises(ValueError):
            class_weights([0, 1], 2, "bogus")


class PerLabelReportTest(unittest.TestCase):
    def test_metrics(self):
        report = per_label_report([0, 0, 1, 1], [0, 1, 1, 1], {0: "a", 1: "b", 2: "c"})
        self.assertAlmostEqual(report["accuracy"], 0.75)
        self.assertEqual(report["labels"]["a"], {"precision": 1.0, "recall": 0.5, "f1": 2 / 3, "support": 2})
        self.assertAlmostEqual(report["labels"]["b"]["precision"], 2 / 3)
        self.assertEqual(report["labels"]["b"]["recall"], 1.0)
        self.assertEqual(report["labels"]["c"], {"precision": 0.0, "recall": 0.0, "f1": 0.0, "support": 0})
        self.assertIn("accuracy: 0.7500", format_report(report))

    def test_empty(self):
        self.assertEqual(per_label_report([], [], {})["accuracy"], 0.0)


if __name__ == "__main__":
    unittest.main()
