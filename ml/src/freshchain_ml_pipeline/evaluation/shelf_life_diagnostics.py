"""Shelf-Life Prediction Distribution Diagnostics.

Provides diagnostic functions for analyzing shelf-life prediction distributions,
detecting data generation issues, and identifying model calibration problems.

Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
"""

import logging
from typing import Any, Dict, List, Tuple

import numpy as np

logger = logging.getLogger("freshchain_ml_pipeline")

# Risk level thresholds (days_remaining)
# <= 1 → CRITICAL, <= 3 → HIGH, <= 5 → MEDIUM, > 5 → LOW
RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]


def days_to_risk_level(days_remaining: float) -> str:
    """Map remaining shelf life to risk level.

    Parameters
    ----------
    days_remaining : float
        Predicted or actual remaining shelf life in days.

    Returns
    -------
    str
        One of "CRITICAL", "HIGH", "MEDIUM", "LOW".
    """
    if days_remaining <= 1.0:
        return "CRITICAL"
    elif days_remaining <= 3.0:
        return "HIGH"
    elif days_remaining <= 5.0:
        return "MEDIUM"
    else:
        return "LOW"


def compute_risk_distribution(values: np.ndarray) -> Dict[str, float]:
    """Compute the percentage distribution of risk levels.

    Parameters
    ----------
    values : np.ndarray
        Array of days_remaining values (predictions or targets).

    Returns
    -------
    dict
        Dictionary mapping risk level names to their percentage (0-100).
        Keys: "CRITICAL", "HIGH", "MEDIUM", "LOW".

    Raises
    ------
    ValueError
        If values is empty.
    """
    if len(values) == 0:
        raise ValueError("Cannot compute risk distribution for empty array")

    total = len(values)
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}

    for v in values:
        level = days_to_risk_level(float(v))
        counts[level] += 1

    distribution = {level: (count / total) * 100.0 for level, count in counts.items()}
    return distribution


def log_risk_distribution(
    predictions: np.ndarray, label: str = "Predictions"
) -> Dict[str, float]:
    """Compute and log the risk level distribution as percentages.

    Requirement 3.1: WHEN the Shelf_Life_Estimator produces predictions,
    THE Pipeline SHALL log the distribution of risk levels (CRITICAL, HIGH,
    MEDIUM, LOW) as percentages.

    Parameters
    ----------
    predictions : np.ndarray
        Array of days_remaining prediction values.
    label : str, optional
        Label for the log output (default "Predictions").

    Returns
    -------
    dict
        Dictionary mapping risk level names to their percentage (0-100).
    """
    distribution = compute_risk_distribution(predictions)

    logger.info("Shelf-Life %s - Risk Level Distribution:", label)
    for level in RISK_LEVELS:
        logger.info("  %s: %.1f%%", level, distribution[level])

    return distribution


def check_data_generation_issue(targets: np.ndarray) -> bool:
    """Check if target data has a data generation issue.

    Requirement 3.3: WHEN the shelf-life target data contains more than 50%
    of values with days_remaining <= 1.0, THE Pipeline SHALL flag this as a
    data generation issue in the evaluation report.

    Parameters
    ----------
    targets : np.ndarray
        Array of target days_remaining values.

    Returns
    -------
    bool
        True if > 50% of target values are <= 1.0 (data generation issue).
    """
    if len(targets) == 0:
        return False

    critical_count = int(np.sum(targets <= 1.0))
    critical_pct = critical_count / len(targets)

    return bool(critical_pct > 0.50)


def check_model_calibration_issue(
    targets: np.ndarray, predictions: np.ndarray
) -> bool:
    """Check if predictions are skewed toward CRITICAL despite balanced targets.

    Requirement 3.4: WHEN the shelf-life target data has a balanced distribution
    but predictions are skewed toward CRITICAL, THE Pipeline SHALL flag this as
    a model calibration issue in the evaluation report.

    A balanced target distribution means <= 50% of targets are <= 1.0.
    Skewed predictions means > 60% of predictions are CRITICAL.

    Parameters
    ----------
    targets : np.ndarray
        Array of target days_remaining values.
    predictions : np.ndarray
        Array of predicted days_remaining values.

    Returns
    -------
    bool
        True if targets are balanced but predictions are skewed (> 60% CRITICAL).
    """
    if len(targets) == 0 or len(predictions) == 0:
        return False

    # Check if targets are balanced (not a data generation issue)
    has_data_issue = check_data_generation_issue(targets)
    if has_data_issue:
        return False

    # Check if predictions are skewed toward CRITICAL (> 60%)
    pred_distribution = compute_risk_distribution(predictions)
    return pred_distribution["CRITICAL"] > 60.0


def check_distribution_balance(predictions: np.ndarray) -> Tuple[bool, str]:
    """Check that no single risk level exceeds 60% of predictions.

    Requirement 3.2: THE Shelf_Life_Estimator SHALL produce a distribution
    where no single risk level exceeds 60% of all predictions on the test set.

    Parameters
    ----------
    predictions : np.ndarray
        Array of predicted days_remaining values.

    Returns
    -------
    tuple of (bool, str)
        (passed, message) where passed is True if no level exceeds 60%,
        and message describes the result.
    """
    if len(predictions) == 0:
        return True, "No predictions to check"

    distribution = compute_risk_distribution(predictions)

    for level in RISK_LEVELS:
        if distribution[level] > 60.0:
            return False, (
                f"DISTRIBUTION IMBALANCE: {level} accounts for "
                f"{distribution[level]:.1f}% of predictions (exceeds 60% threshold)"
            )

    return True, "Distribution balanced: no single risk level exceeds 60%"


def run_shelf_life_diagnostics(
    targets: np.ndarray, predictions: np.ndarray
) -> Dict[str, Any]:
    """Run full shelf-life distribution diagnostics.

    Combines all diagnostic checks into a single report:
    - Risk level distribution logging (Req 3.1)
    - Distribution balance check (Req 3.2)
    - Data generation issue detection (Req 3.3)
    - Model calibration issue detection (Req 3.4)
    - Before/after distribution comparison (Req 3.5)

    Parameters
    ----------
    targets : np.ndarray
        Array of target days_remaining values.
    predictions : np.ndarray
        Array of predicted days_remaining values.

    Returns
    -------
    dict
        Diagnostic report containing:
        - target_distribution: risk level percentages for targets
        - prediction_distribution: risk level percentages for predictions
        - data_generation_issue: bool
        - model_calibration_issue: bool
        - distribution_balanced: bool
        - distribution_balance_message: str
        - flags: list of issue strings
    """
    flags: List[str] = []

    # Log target distribution (Req 3.5 - before training comparison)
    target_distribution = log_risk_distribution(
        targets, label="Target (days_remaining)"
    )

    # Log prediction distribution (Req 3.1)
    prediction_distribution = log_risk_distribution(
        predictions, label="Predictions"
    )

    # Check data generation issue (Req 3.3)
    data_gen_issue = check_data_generation_issue(targets)
    if data_gen_issue:
        flag_msg = (
            "DATA GENERATION ISSUE: More than 50% of target days_remaining "
            "values are <= 1.0. The training data may not represent realistic "
            "shelf-life distributions."
        )
        flags.append(flag_msg)
        logger.warning(flag_msg)

    # Check model calibration issue (Req 3.4)
    calibration_issue = check_model_calibration_issue(targets, predictions)
    if calibration_issue:
        flag_msg = (
            "MODEL CALIBRATION ISSUE: Target distribution is balanced but "
            "predictions are skewed toward CRITICAL (> 60%). The model may "
            "need recalibration or additional training data diversity."
        )
        flags.append(flag_msg)
        logger.warning(flag_msg)

    # Check distribution balance (Req 3.2)
    balanced, balance_msg = check_distribution_balance(predictions)
    if not balanced:
        flags.append(balance_msg)
        logger.warning(balance_msg)

    # Log side-by-side comparison (Req 3.5)
    logger.info("Shelf-Life Distribution Comparison (Target vs Prediction):")
    logger.info("  %-10s | %-12s | %-12s", "Risk Level", "Target %", "Prediction %")
    logger.info("  %s", "-" * 40)
    for level in RISK_LEVELS:
        logger.info(
            "  %-10s | %10.1f%% | %10.1f%%",
            level,
            target_distribution[level],
            prediction_distribution[level],
        )

    return {
        "target_distribution": target_distribution,
        "prediction_distribution": prediction_distribution,
        "data_generation_issue": data_gen_issue,
        "model_calibration_issue": calibration_issue,
        "distribution_balanced": balanced,
        "distribution_balance_message": balance_msg,
        "flags": flags,
    }
