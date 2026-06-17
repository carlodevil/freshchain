"""Metric computation helpers for the FreshChain evaluation framework.

Provides functions to compute classification, regression, and anomaly detection
metrics using scikit-learn under the hood.

Requirements: 12.1, 12.2, 12.3
"""

from typing import Dict, Any

import numpy as np
from sklearn.metrics import (
    precision_recall_fscore_support,
    mean_absolute_error,
    mean_squared_error,
)


def compute_classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    labels: list | None = None,
) -> Dict[str, Any]:
    """Compute precision, recall, and F1-score per class for classification.

    Parameters
    ----------
    y_true : array-like
        Ground truth labels.
    y_pred : array-like
        Predicted labels.
    labels : list or None, optional
        List of class labels to include. If None, derived from the data.

    Returns
    -------
    dict
        Dictionary with keys:
        - 'per_class': dict mapping each class label to its precision, recall, F1
        - 'weighted_f1': weighted average F1-score across all classes
        - 'macro_f1': macro average F1-score across all classes

    Raises
    ------
    ValueError
        If y_true and y_pred have different lengths or are empty.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    if len(y_true) == 0 or len(y_pred) == 0:
        raise ValueError("y_true and y_pred must not be empty.")
    if len(y_true) != len(y_pred):
        raise ValueError(
            f"y_true and y_pred must have the same length, "
            f"got {len(y_true)} and {len(y_pred)}."
        )

    if labels is None:
        labels = sorted(set(y_true) | set(y_pred))

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0.0
    )

    per_class = {}
    for i, label in enumerate(labels):
        per_class[label] = {
            "precision": float(precision[i]),
            "recall": float(recall[i]),
            "f1": float(f1[i]),
            "support": int(support[i]),
        }

    # Compute weighted and macro F1
    _, _, weighted_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, average="weighted", zero_division=0.0
    )
    _, _, macro_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, average="macro", zero_division=0.0
    )

    return {
        "per_class": per_class,
        "weighted_f1": float(weighted_f1),
        "macro_f1": float(macro_f1),
    }


def compute_regression_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
) -> Dict[str, float]:
    """Compute MAE and RMSE for regression predictions.

    Parameters
    ----------
    y_true : array-like
        Ground truth values.
    y_pred : array-like
        Predicted values.

    Returns
    -------
    dict
        Dictionary with keys 'mae' and 'rmse'.

    Raises
    ------
    ValueError
        If y_true and y_pred have different lengths or are empty.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    if len(y_true) == 0 or len(y_pred) == 0:
        raise ValueError("y_true and y_pred must not be empty.")
    if len(y_true) != len(y_pred):
        raise ValueError(
            f"y_true and y_pred must have the same length, "
            f"got {len(y_true)} and {len(y_pred)}."
        )

    mae = mean_absolute_error(y_true, y_pred)
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))

    return {
        "mae": float(mae),
        "rmse": rmse,
    }


def compute_anomaly_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    positive_label: Any = 1,
) -> Dict[str, float]:
    """Compute detection rate and false positive rate for anomaly detection.

    Parameters
    ----------
    y_true : array-like
        Ground truth labels (1 = anomaly, 0 = normal by default).
    y_pred : array-like
        Predicted labels (1 = anomaly, 0 = normal by default).
    positive_label : any, optional
        The label representing an anomaly (default 1).

    Returns
    -------
    dict
        Dictionary with keys:
        - 'detection_rate': fraction of true anomalies correctly detected (recall)
        - 'false_positive_rate': fraction of normal readings incorrectly flagged

    Raises
    ------
    ValueError
        If y_true and y_pred have different lengths or are empty.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    if len(y_true) == 0 or len(y_pred) == 0:
        raise ValueError("y_true and y_pred must not be empty.")
    if len(y_true) != len(y_pred):
        raise ValueError(
            f"y_true and y_pred must have the same length, "
            f"got {len(y_true)} and {len(y_pred)}."
        )

    # True anomalies and true normals
    true_anomaly_mask = y_true == positive_label
    true_normal_mask = ~true_anomaly_mask

    # Detection rate = TP / (TP + FN) = recall for anomaly class
    total_anomalies = true_anomaly_mask.sum()
    if total_anomalies == 0:
        detection_rate = 0.0
    else:
        detected = ((y_pred == positive_label) & true_anomaly_mask).sum()
        detection_rate = float(detected / total_anomalies)

    # False positive rate = FP / (FP + TN) = FP / total normals
    total_normals = true_normal_mask.sum()
    if total_normals == 0:
        false_positive_rate = 0.0
    else:
        false_positives = ((y_pred == positive_label) & true_normal_mask).sum()
        false_positive_rate = float(false_positives / total_normals)

    return {
        "detection_rate": detection_rate,
        "false_positive_rate": false_positive_rate,
    }
