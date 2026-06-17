"""Unified evaluation framework for the FreshChain ML Pipeline.

Provides the Evaluator class that computes metrics for classifiers, regressors,
and anomaly detectors, enforces time-aware splits, supports temporal
cross-validation, and generates summary reports comparing models against
performance thresholds.

Requirements: 12.4, 12.5, 12.6, 2.4, 2.5, 2.6
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.evaluation.metrics import (
    compute_classification_metrics,
    compute_regression_metrics,
    compute_anomaly_metrics,
)

logger = logging.getLogger("freshchain_ml_pipeline")


# Default performance thresholds from the requirements document.
# Each model has acceptance criteria that must be met for deployment.
# Models with multiple metrics use a "metrics" list; all must pass.
#
# Requirements: 4.2, 4.3, 4.4, 4.5, 4.6
DEFAULT_THRESHOLDS = {
    "demand_forecaster": {
        "metric": "mae_pct_mean",
        "threshold": 0.65,
        "direction": "lte",  # MAE as fraction of mean < 65%
    },
    "spoilage_classifier": {
        "metrics": [
            {
                "metric": "class_1_recall",
                "threshold": 0.75,
                "direction": "gte",  # Class 1 recall >= 0.75
            },
            {
                "metric": "macro_f1",
                "threshold": 0.75,
                "direction": "gte",  # Macro F1 >= 0.75
            },
        ],
    },
    "shelf_life_estimator": {
        "metric": "mae",
        "threshold": 2.0,
        "direction": "lte",  # MAE < 2.0 days
    },
    "anomaly_detector": {
        "metric": "f1_anomaly",
        "threshold": 0.70,
        "direction": "gte",  # F1 on anomaly class >= 0.70
    },
    "replenishment_model": {
        "metric": "mae",
        "threshold": 5.0,
        "direction": "lte",  # MAE < 5.0 units
    },
}


class Evaluator:
    """Unified evaluation framework for all FreshChain ML models.

    Computes metrics, enforces time-aware splits, supports temporal
    cross-validation, and generates summary reports.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling evaluation parameters.
    thresholds : dict or None, optional
        Performance thresholds per model. If None, uses DEFAULT_THRESHOLDS.
    """

    def __init__(
        self,
        config: PipelineConfig,
        thresholds: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        self.config = config
        self.thresholds = thresholds if thresholds is not None else DEFAULT_THRESHOLDS

    def evaluate_classifier(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        labels: list | None = None,
    ) -> Dict[str, Any]:
        """Evaluate a classification model.

        Parameters
        ----------
        y_true : array-like
            Ground truth labels.
        y_pred : array-like
            Predicted labels.
        labels : list or None, optional
            Class labels to include.

        Returns
        -------
        dict
            Classification metrics including per-class precision/recall/F1
            and weighted/macro F1 scores.
        """
        return compute_classification_metrics(y_true, y_pred, labels=labels)

    def evaluate_spoilage_classifier(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        labels: list | None = None,
        recall_threshold: float = 0.75,
        macro_f1_threshold: float = 0.75,
    ) -> Dict[str, Any]:
        """Evaluate the spoilage classifier with per-class recall and Macro F1 logging.

        Logs per-class recall and Macro F1 to the evaluation report. Raises
        validation errors (logged warnings) if Class 1 recall < recall_threshold
        or Macro F1 < macro_f1_threshold.

        Parameters
        ----------
        y_true : array-like
            Ground truth labels (0=Good, 1=Bad).
        y_pred : array-like
            Predicted labels (0=Good, 1=Bad).
        labels : list or None, optional
            Class labels to include. Defaults to [0, 1].
        recall_threshold : float, optional
            Minimum acceptable recall for Class 1 (default 0.75).
        macro_f1_threshold : float, optional
            Minimum acceptable Macro F1 (default 0.75).

        Returns
        -------
        dict
            Classification metrics including per-class recall, Macro F1,
            and validation_errors list.
        """
        if labels is None:
            labels = [0, 1]

        metrics = compute_classification_metrics(y_true, y_pred, labels=labels)

        # Log per-class recall and Macro F1
        validation_errors = []

        class_1_recall = metrics["per_class"].get(1, {}).get("recall", 0.0)
        macro_f1 = metrics["macro_f1"]

        logger.info("Spoilage Classifier - Per-class recall:")
        for label, class_metrics in metrics["per_class"].items():
            logger.info(
                "  Class %s: recall=%.4f, precision=%.4f, f1=%.4f",
                label,
                class_metrics["recall"],
                class_metrics["precision"],
                class_metrics["f1"],
            )
        logger.info("Spoilage Classifier - Macro F1: %.4f", macro_f1)
        logger.info("Spoilage Classifier - Class 1 recall: %.4f", class_1_recall)

        # Validate recall threshold for Class 1
        if class_1_recall < recall_threshold:
            error_msg = (
                f"VALIDATION ERROR: Spoilage Classifier Class 1 recall "
                f"({class_1_recall:.4f}) is below threshold ({recall_threshold})"
            )
            logger.warning(error_msg)
            validation_errors.append(error_msg)

        # Validate Macro F1 threshold
        if macro_f1 < macro_f1_threshold:
            error_msg = (
                f"VALIDATION ERROR: Spoilage Classifier Macro F1 "
                f"({macro_f1:.4f}) is below threshold ({macro_f1_threshold})"
            )
            logger.warning(error_msg)
            validation_errors.append(error_msg)

        metrics["class_1_recall"] = class_1_recall
        metrics["validation_errors"] = validation_errors

        return metrics

    def evaluate_regressor(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
    ) -> Dict[str, float]:
        """Evaluate a regression model.

        Parameters
        ----------
        y_true : array-like
            Ground truth values.
        y_pred : array-like
            Predicted values.

        Returns
        -------
        dict
            Regression metrics including MAE and RMSE.
        """
        return compute_regression_metrics(y_true, y_pred)

    def evaluate_anomaly_detector(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        positive_label: Any = 1,
    ) -> Dict[str, float]:
        """Evaluate an anomaly detection model.

        Parameters
        ----------
        y_true : array-like
            Ground truth labels (anomaly/normal).
        y_pred : array-like
            Predicted labels (anomaly/normal).
        positive_label : any, optional
            Label representing anomaly (default 1).

        Returns
        -------
        dict
            Anomaly metrics including detection_rate and false_positive_rate.
        """
        return compute_anomaly_metrics(y_true, y_pred, positive_label=positive_label)

    def temporal_cross_validate(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        time_column: str,
        model_train_fn,
        model_predict_fn,
        metric_fn,
        n_folds: int | None = None,
        window_type: str = "expanding",
    ) -> List[Dict[str, Any]]:
        """Perform temporal cross-validation with expanding or sliding windows.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix with a time column.
        y : pd.Series
            Target variable.
        time_column : str
            Name of the time column in X.
        model_train_fn : callable
            Function that trains a model: model_train_fn(X_train, y_train).
        model_predict_fn : callable
            Function that predicts: model_predict_fn(X_test) -> predictions.
        metric_fn : callable
            Function that computes metrics: metric_fn(y_true, y_pred) -> dict.
        n_folds : int or None, optional
            Number of temporal folds. Defaults to config.cv_folds (min 3).
        window_type : str, optional
            'expanding' (default) or 'sliding'.

        Returns
        -------
        list of dict
            Metrics for each fold.

        Raises
        ------
        ValueError
            If n_folds < 3 or time_column not in X.
        """
        if n_folds is None:
            n_folds = max(3, self.config.cv_folds)
        if n_folds < 3:
            raise ValueError(f"n_folds must be >= 3, got {n_folds}")
        if time_column not in X.columns:
            raise ValueError(
                f"time_column '{time_column}' not found in DataFrame columns."
            )

        # Sort by time
        time_values = pd.to_datetime(X[time_column])
        sorted_indices = time_values.argsort()
        X_sorted = X.iloc[sorted_indices].reset_index(drop=True)
        y_sorted = y.iloc[sorted_indices].reset_index(drop=True)
        time_sorted = time_values.iloc[sorted_indices].reset_index(drop=True)

        n_samples = len(X_sorted)
        # Each fold uses an increasing portion for training and the next chunk for testing
        # We need n_folds test segments, so we divide the data into n_folds + 1 parts
        # The first part is always in training, subsequent parts are test segments
        fold_size = n_samples // (n_folds + 1)

        if fold_size < 1:
            raise ValueError(
                f"Not enough data for {n_folds} folds. "
                f"Need at least {n_folds + 1} samples, got {n_samples}."
            )

        fold_results = []
        for fold_idx in range(n_folds):
            if window_type == "expanding":
                # Expanding window: train on all data up to the fold boundary
                train_end = fold_size * (fold_idx + 1)
                test_start = train_end
                test_end = min(train_end + fold_size, n_samples)
            elif window_type == "sliding":
                # Sliding window: train on a fixed-size window before the test set
                train_start = fold_idx * fold_size
                train_end = fold_size * (fold_idx + 1)
                test_start = train_end
                test_end = min(train_end + fold_size, n_samples)
                X_sorted_fold = X_sorted.iloc[train_start:train_end]
                y_sorted_fold = y_sorted.iloc[train_start:train_end]
            else:
                raise ValueError(
                    f"window_type must be 'expanding' or 'sliding', got '{window_type}'"
                )

            if test_start >= n_samples:
                break

            if window_type == "expanding":
                X_train = X_sorted.iloc[:train_end]
                y_train = y_sorted.iloc[:train_end]
            else:
                X_train = X_sorted_fold
                y_train = y_sorted_fold

            X_test = X_sorted.iloc[test_start:test_end]
            y_test = y_sorted.iloc[test_start:test_end]

            if len(X_test) == 0:
                break

            # Train and predict
            model_train_fn(X_train, y_train)
            predictions = model_predict_fn(X_test)

            # Compute metrics
            metrics = metric_fn(y_test, predictions)
            metrics["fold"] = fold_idx + 1
            metrics["train_size"] = len(X_train)
            metrics["test_size"] = len(X_test)
            fold_results.append(metrics)

        return fold_results

    def generate_summary_report(
        self,
        all_metrics: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """Generate a summary report comparing all models against thresholds.

        Parameters
        ----------
        all_metrics : dict
            Dictionary mapping model names to their computed metrics.
            Expected keys match threshold keys (e.g., 'spoilage_classifier').
            Each value is a dict of metric values.

        Returns
        -------
        dict
            Dictionary with model names as keys and values containing:
            - 'status': 'PASSED' or 'FAILED'
            - 'metrics': the computed metrics
            - 'threshold_details': what was checked and the result

        Notes
        -----
        Models not present in the thresholds dict are reported with status
        'NO_THRESHOLD'. Models that raised errors during evaluation should
        be passed with a special key 'error' in their metrics dict, and
        will be marked as 'FAILED'.

        Threshold configs can use either a single metric format:
            {"metric": "mae", "threshold": 2.0, "direction": "lte"}
        or a multi-metric format (all must pass):
            {"metrics": [{"metric": "class_1_recall", "threshold": 0.75, "direction": "gte"}, ...]}
        """
        report = {}

        for model_name, metrics in all_metrics.items():
            # Handle models that errored during evaluation
            if "error" in metrics:
                report[model_name] = {
                    "status": "FAILED",
                    "metrics": metrics,
                    "threshold_details": {
                        "reason": f"Model evaluation error: {metrics['error']}"
                    },
                }
                continue

            # Check if we have thresholds for this model
            if model_name not in self.thresholds:
                report[model_name] = {
                    "status": "NO_THRESHOLD",
                    "metrics": metrics,
                    "threshold_details": {"reason": "No threshold defined"},
                }
                continue

            threshold_config = self.thresholds[model_name]

            # Handle multi-metric threshold format (e.g., spoilage_classifier)
            if "metrics" in threshold_config:
                report[model_name] = self._evaluate_multi_metric(
                    model_name, metrics, threshold_config["metrics"]
                )
                continue

            metric_key = threshold_config["metric"]
            threshold_value = threshold_config["threshold"]
            direction = threshold_config["direction"]

            # Get the metric value from the metrics dict
            metric_value = metrics.get(metric_key)
            if metric_value is None:
                report[model_name] = {
                    "status": "FAILED",
                    "metrics": metrics,
                    "threshold_details": {
                        "reason": f"Metric '{metric_key}' not found in results"
                    },
                }
                continue

            # Check primary threshold
            passed = self._check_threshold(metric_value, threshold_value, direction)

            # Check secondary threshold if present (e.g., anomaly detector FPR)
            secondary_passed = True
            secondary_details = None
            if "secondary_metric" in threshold_config:
                sec_metric_key = threshold_config["secondary_metric"]
                sec_threshold = threshold_config["secondary_threshold"]
                sec_direction = threshold_config["secondary_direction"]
                sec_value = metrics.get(sec_metric_key)

                if sec_value is not None:
                    secondary_passed = self._check_threshold(
                        sec_value, sec_threshold, sec_direction
                    )
                    secondary_details = {
                        "metric": sec_metric_key,
                        "value": sec_value,
                        "threshold": sec_threshold,
                        "direction": sec_direction,
                        "passed": secondary_passed,
                    }
                else:
                    secondary_passed = False
                    secondary_details = {
                        "metric": sec_metric_key,
                        "reason": "Metric not found",
                        "passed": False,
                    }

            overall_passed = passed and secondary_passed

            threshold_details = {
                "primary_metric": metric_key,
                "primary_value": metric_value,
                "primary_threshold": threshold_value,
                "primary_direction": direction,
                "primary_passed": passed,
            }
            if secondary_details:
                threshold_details["secondary"] = secondary_details

            report[model_name] = {
                "status": "PASSED" if overall_passed else "FAILED",
                "metrics": metrics,
                "threshold_details": threshold_details,
            }

        return report

    def _evaluate_multi_metric(
        self,
        model_name: str,
        metrics: Dict[str, Any],
        metric_thresholds: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Evaluate a model against multiple metric thresholds (all must pass).

        Parameters
        ----------
        model_name : str
            Name of the model being evaluated.
        metrics : dict
            Computed metrics for the model.
        metric_thresholds : list of dict
            List of threshold configs, each with 'metric', 'threshold', 'direction'.

        Returns
        -------
        dict
            Report entry with status, metrics, and threshold_details.
        """
        all_passed = True
        checks = []

        for threshold_entry in metric_thresholds:
            metric_key = threshold_entry["metric"]
            threshold_value = threshold_entry["threshold"]
            direction = threshold_entry["direction"]

            metric_value = metrics.get(metric_key)
            if metric_value is None:
                checks.append({
                    "metric": metric_key,
                    "value": None,
                    "threshold": threshold_value,
                    "direction": direction,
                    "passed": False,
                    "reason": f"Metric '{metric_key}' not found in results",
                })
                all_passed = False
            else:
                passed = self._check_threshold(metric_value, threshold_value, direction)
                checks.append({
                    "metric": metric_key,
                    "value": metric_value,
                    "threshold": threshold_value,
                    "direction": direction,
                    "passed": passed,
                })
                if not passed:
                    all_passed = False

        return {
            "status": "PASSED" if all_passed else "FAILED",
            "metrics": metrics,
            "threshold_details": {"checks": checks},
        }

    def validate_all_models(
        self,
        all_metrics: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """Validate all models against acceptance thresholds post-training.

        Produces a validation report listing each model's name, metric name,
        threshold, achieved value, and pass/fail status. Logs a WARNING for
        any model that fails validation but does NOT raise an exception,
        allowing the pipeline to continue execution.

        Parameters
        ----------
        all_metrics : dict
            Dictionary mapping model names to their computed metrics.

        Returns
        -------
        dict
            Validation report with the same structure as generate_summary_report,
            plus a top-level 'overall_status' key ('PASSED' or 'FAILED').

        Requirements: 4.1, 4.7, 4.8
        """
        report = self.generate_summary_report(all_metrics)

        # Log warnings for failed models (Requirement 4.8)
        overall_passed = True
        for model_name, result in report.items():
            if result["status"] == "FAILED":
                overall_passed = False
                details = result["threshold_details"]

                # Build a descriptive warning message
                if "checks" in details:
                    # Multi-metric format
                    for check in details["checks"]:
                        if not check["passed"]:
                            if check.get("value") is not None:
                                logger.warning(
                                    "MODEL VALIDATION FAILED: %s - %s = %.4f "
                                    "(threshold: %s %.4f)",
                                    model_name,
                                    check["metric"],
                                    check["value"],
                                    check["direction"],
                                    check["threshold"],
                                )
                            else:
                                logger.warning(
                                    "MODEL VALIDATION FAILED: %s - %s: %s",
                                    model_name,
                                    check["metric"],
                                    check.get("reason", "metric not found"),
                                )
                elif "reason" in details:
                    logger.warning(
                        "MODEL VALIDATION FAILED: %s - %s",
                        model_name,
                        details["reason"],
                    )
                else:
                    metric_name = details.get("primary_metric", "unknown")
                    metric_value = details.get("primary_value", "N/A")
                    threshold = details.get("primary_threshold", "N/A")
                    direction = details.get("primary_direction", "N/A")
                    logger.warning(
                        "MODEL VALIDATION FAILED: %s - %s = %s "
                        "(threshold: %s %s)",
                        model_name,
                        metric_name,
                        metric_value,
                        direction,
                        threshold,
                    )
            elif result["status"] == "PASSED":
                logger.info("MODEL VALIDATION PASSED: %s", model_name)

        report["overall_status"] = "PASSED" if overall_passed else "FAILED"
        return report

    @staticmethod
    def _check_threshold(value: float, threshold: float, direction: str) -> bool:
        """Check if a metric value meets the threshold in the given direction.

        Parameters
        ----------
        value : float
            The metric value to check.
        threshold : float
            The threshold to compare against.
        direction : str
            One of 'gte' (>=), 'lte' (<=), 'gt' (>), 'lt' (<).

        Returns
        -------
        bool
            True if the threshold is met.
        """
        if direction == "gte":
            return value >= threshold
        elif direction == "lte":
            return value <= threshold
        elif direction == "gt":
            return value > threshold
        elif direction == "lt":
            return value < threshold
        else:
            raise ValueError(f"Unknown direction: {direction}")
