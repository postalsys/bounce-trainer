"""
Dataset helpers for train_model.py that need only numpy, so they can be
unit tested without TensorFlow.
"""

import numpy as np


def stratified_split(y, val_fraction=0.1, seed=None):
    """Split sample indices into train and validation sets per class.

    Every class keeps roughly `val_fraction` of its samples for validation,
    and any class with at least two samples gets at least one validation
    sample, so rare labels are always measured. Returns two shuffled index
    arrays (train, val).
    """
    y = np.asarray(y)
    rng = np.random.default_rng(seed)
    train_idx, val_idx = [], []
    for cls in np.unique(y):
        idx = rng.permutation(np.flatnonzero(y == cls))
        n_val = int(round(len(idx) * val_fraction))
        if len(idx) >= 2:
            n_val = min(max(n_val, 1), len(idx) - 1)
        else:
            n_val = 0
        val_idx.append(idx[:n_val])
        train_idx.append(idx[n_val:])
    return (
        rng.permutation(np.concatenate(train_idx)),
        rng.permutation(np.concatenate(val_idx)),
    )


def class_weights(y, num_classes, mode="sqrt"):
    """Per-class loss weights keyed by class id.

    "balanced" is n / (k * n_c). "sqrt" is its square root, which still
    lifts rare labels but keeps the majority label (greylisting, ~59% of
    the baseline) from being drowned out. "none" returns None. Classes with
    no samples get weight 1.0.
    """
    if mode == "none":
        return None
    if mode not in ("sqrt", "balanced"):
        raise ValueError(f"unknown class weight mode: {mode}")
    counts = np.bincount(np.asarray(y), minlength=num_classes)
    total = counts.sum()
    weights = {}
    for cls, count in enumerate(counts):
        if count == 0:
            weights[cls] = 1.0
            continue
        w = total / (num_classes * count)
        weights[cls] = float(np.sqrt(w) if mode == "sqrt" else w)
    return weights


def per_label_report(y_true, y_pred, id_to_label):
    """Precision, recall, F1 and support per label, plus overall accuracy."""
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    report = {}
    for cls, label in id_to_label.items():
        tp = int(np.sum((y_pred == cls) & (y_true == cls)))
        predicted = int(np.sum(y_pred == cls))
        support = int(np.sum(y_true == cls))
        precision = tp / predicted if predicted else 0.0
        recall = tp / support if support else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall
            else 0.0
        )
        report[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
        }
    accuracy = float(np.mean(y_true == y_pred)) if len(y_true) else 0.0
    return {"accuracy": accuracy, "labels": report}


def format_report(report):
    """Render a per_label_report() result as a text table."""
    lines = [f"  {'label':<20} {'prec':>6} {'recall':>6} {'f1':>6} {'n':>6}"]
    for label, m in report["labels"].items():
        lines.append(
            f"  {label:<20} {m['precision']:>6.3f} {m['recall']:>6.3f}"
            f" {m['f1']:>6.3f} {m['support']:>6}"
        )
    lines.append(f"  accuracy: {report['accuracy']:.4f}")
    return "\n".join(lines)
