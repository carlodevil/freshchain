"""Evaluation module for computing performance metrics and validating model outputs."""

from freshchain_ml_pipeline.evaluation.metrics import (
    compute_classification_metrics,
    compute_regression_metrics,
    compute_anomaly_metrics,
)
from freshchain_ml_pipeline.evaluation.evaluator import Evaluator
from freshchain_ml_pipeline.evaluation.shelf_life_diagnostics import (
    compute_risk_distribution,
    log_risk_distribution,
    check_data_generation_issue,
    check_model_calibration_issue,
    check_distribution_balance,
    run_shelf_life_diagnostics,
)

__all__ = [
    "compute_classification_metrics",
    "compute_regression_metrics",
    "compute_anomaly_metrics",
    "Evaluator",
    "compute_risk_distribution",
    "log_risk_distribution",
    "check_data_generation_issue",
    "check_model_calibration_issue",
    "check_distribution_balance",
    "run_shelf_life_diagnostics",
]
