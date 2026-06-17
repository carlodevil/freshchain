"""Main pipeline orchestrator for the FreshChain ML Pipeline.

Provides the CLI entry point and the `run_pipeline` function that orchestrates
the full pipeline: Config → DataGenerator → FeatureEngine → Models → Evaluator
→ Explainer. Handles graceful degradation when individual models fail.

Requirements: 14.1, 14.2, 14.5, 16.8
"""

import argparse
import logging
import time
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.data_generator.generator import DataGenerator, DataManifest
from freshchain_ml_pipeline.evaluation.evaluator import Evaluator
from freshchain_ml_pipeline.explainer.explainer import Explainer
from freshchain_ml_pipeline.feature_engine.engine import FeatureEngine
from freshchain_ml_pipeline.models import BaseModel
from freshchain_ml_pipeline.models.anomaly_detector import AnomalyDetector
from freshchain_ml_pipeline.models.demand_forecaster import DemandForecaster
from freshchain_ml_pipeline.models.replenishment_model import ReplenishmentModel
from freshchain_ml_pipeline.models.shelf_life_estimator import ShelfLifeEstimator
from freshchain_ml_pipeline.models.spoilage_classifier import SpoilageClassifier
from freshchain_ml_pipeline.models.transfer_priority import TransferPriority
from freshchain_ml_pipeline.schema.prediction_output import PredictionOutput
from freshchain_ml_pipeline.utils import set_global_seed, setup_logging

logger = logging.getLogger("freshchain_ml_pipeline")


def run_pipeline(config: PipelineConfig) -> dict:
    """Orchestrate the full FreshChain ML pipeline.

    Executes the pipeline stages in order:
    1. Validate configuration
    2. Set global random seed for reproducibility
    3. Generate synthetic data
    4. Build features for each model
    5. Train and predict with each model (graceful degradation on failure)
    6. Evaluate model predictions
    7. Explain predictions
    8. Validate all PredictionOutput instances against schema

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling all pipeline parameters.

    Returns
    -------
    dict
        Dictionary containing:
        - "config": the PipelineConfig used
        - "manifest": the DataManifest from data generation
        - "predictions": dict mapping model names to lists of PredictionOutput
        - "evaluation_report": evaluation summary report
        - "explanations": dict mapping model names to narrative strings
        - "errors": dict mapping model names to error messages for failed models
        - "elapsed_seconds": total pipeline execution time
    """
    pipeline_start = time.time()

    # --- Step 1: Validate configuration ---
    logger.info("Pipeline starting — validating configuration")
    config.validate()
    logger.info(
        "Configuration valid: %d stores, %d SKUs/store, %d days, seed=%d",
        config.num_stores,
        config.num_skus_per_store,
        config.num_days,
        config.random_seed,
    )

    # --- Step 2: Set global random seed ---
    logger.info("Setting global random seed to %d", config.random_seed)
    set_global_seed(config.random_seed)

    # --- Step 3: Generate synthetic data ---
    logger.info("Starting data generation")
    data_gen_start = time.time()
    data_generator = DataGenerator(config)
    manifest = data_generator.generate_all()
    data_gen_end = time.time()
    logger.info(
        "Data generation complete in %.2fs. Rows: sensor=%d, sales=%d",
        data_gen_end - data_gen_start,
        manifest.metadata.get("sensor_readings_rows", 0),
        manifest.metadata.get("sales_observations_rows", 0),
    )

    # --- Step 4: Build features ---
    logger.info("Starting feature engineering")
    feature_start = time.time()
    feature_engine = FeatureEngine(config)

    spoilage_features = feature_engine.build_spoilage_features(manifest)
    wastage_features = feature_engine.build_wastage_features(manifest)
    demand_features = feature_engine.build_demand_features(manifest)
    anomaly_features = feature_engine.build_anomaly_features(manifest)
    shelf_life_features = feature_engine.build_shelf_life_features(manifest)

    feature_end = time.time()
    logger.info(
        "Feature engineering complete in %.2fs. "
        "Rows: spoilage=%d, wastage=%d, demand=%d, anomaly=%d, shelf_life=%d",
        feature_end - feature_start,
        len(spoilage_features),
        len(wastage_features),
        len(demand_features),
        len(anomaly_features),
        len(shelf_life_features),
    )

    # --- Step 5: Train models and generate predictions ---
    logger.info("Starting model training and prediction")
    model_start = time.time()

    # Define model configurations: (name, model_class, features_df, target_col, time_col, is_unsupervised)
    model_configs = _build_model_configs(
        config,
        spoilage_features,
        wastage_features,
        demand_features,
        anomaly_features,
        shelf_life_features,
    )

    predictions: Dict[str, List[PredictionOutput]] = {}
    raw_predictions: Dict[str, pd.DataFrame] = {}
    trained_models: Dict[str, BaseModel] = {}
    errors: Dict[str, str] = {}

    for model_name, model_info in model_configs.items():
        try:
            logger.info("Training model: %s", model_name)
            model_train_start = time.time()

            model_instance = model_info["model"]
            features_df = model_info["features"]
            target_col = model_info["target"]
            time_col = model_info["time_col"]
            is_unsupervised = model_info.get("unsupervised", False)

            if len(features_df) == 0:
                raise ValueError(f"No feature data available for {model_name}")

            # Prepare X and y
            feature_cols = [
                c for c in features_df.columns
                if c != target_col and c != time_col
            ]

            # Get or derive target
            if target_col and target_col in features_df.columns:
                y = features_df[target_col]
            else:
                # Derive target from features
                y = _derive_target_for_model(model_name, features_df)

            if is_unsupervised:
                # Anomaly detector: train on all features, no target needed
                # Exclude ground truth label if present
                unsupervised_exclude = [time_col] if time_col else []
                if "is_anomaly" in features_df.columns:
                    unsupervised_exclude.append("is_anomaly")
                unsupervised_feature_cols = [
                    c for c in feature_cols if c not in unsupervised_exclude
                ]
                X_train = _encode_categorical_columns(
                    features_df[unsupervised_feature_cols],
                    exclude_cols=unsupervised_exclude,
                )
                # Drop time column if still present
                if time_col and time_col in X_train.columns:
                    X_train = X_train.drop(columns=[time_col])

                # Pass ground truth labels if available (for supervised training)
                y_anomaly = None
                if "is_anomaly" in features_df.columns:
                    y_anomaly = features_df["is_anomaly"]
                model_instance.train(X_train, y_anomaly)
                raw_preds = model_instance.predict(X_train)
            else:
                # Supervised models: use time-aware split
                if time_col and time_col in features_df.columns:
                    X_train, X_test, y_train, y_test = BaseModel.time_aware_split(
                        features_df[feature_cols + [time_col]],
                        y,
                        time_col,
                        config.test_split_pct,
                    )
                    # Drop time column and encode categoricals for training
                    X_train_features = _encode_categorical_columns(
                        X_train.drop(columns=[time_col], errors="ignore")
                    )
                    X_test_features = _encode_categorical_columns(
                        X_test.drop(columns=[time_col], errors="ignore")
                    )
                else:
                    # Fallback: simple split by index
                    split_idx = int(len(features_df) * (1 - config.test_split_pct))
                    X_train_features = _encode_categorical_columns(
                        features_df[feature_cols].iloc[:split_idx]
                    )
                    X_test_features = _encode_categorical_columns(
                        features_df[feature_cols].iloc[split_idx:]
                    )
                    y_train = y.iloc[:split_idx]
                    y_test = y.iloc[split_idx:]

                model_instance.train(X_train_features, y_train)
                raw_preds = model_instance.predict(X_test_features)

            # Convert to PredictionOutput
            pred_outputs = model_instance.to_prediction_output(raw_preds)

            # Validate all PredictionOutput instances
            validated_outputs = _validate_prediction_outputs(pred_outputs, model_name)

            predictions[model_name] = validated_outputs
            raw_predictions[model_name] = raw_preds
            trained_models[model_name] = model_instance

            model_train_end = time.time()
            logger.info(
                "Model %s complete in %.2fs: %d predictions generated",
                model_name,
                model_train_end - model_train_start,
                len(validated_outputs),
            )

        except Exception as e:
            logger.error(
                "Model %s failed: %s. Continuing with remaining models.",
                model_name,
                str(e),
            )
            errors[model_name] = str(e)

    model_end = time.time()
    logger.info(
        "Model training complete in %.2fs. Successful: %d, Failed: %d",
        model_end - model_start,
        len(predictions),
        len(errors),
    )

    # --- Step 5b: Post-processing — replenishment, routePriority, businessImpact ---
    logger.info("Starting post-processing: routePriority, businessImpact")
    _compute_replenishment(predictions, wastage_features)
    _compute_route_priority(predictions)
    _compute_business_impact(predictions, wastage_features)
    logger.info("Post-processing complete")

    # --- Step 6: Evaluate models ---
    logger.info("Starting model evaluation")
    eval_start = time.time()
    evaluator = Evaluator(config)

    all_metrics: Dict[str, Dict[str, Any]] = {}
    for model_name in predictions:
        try:
            raw_preds = raw_predictions[model_name]
            model_info = model_configs[model_name]
            features_df = model_info["features"]
            target_col = model_info["target"]
            time_col = model_info["time_col"]
            is_unsupervised = model_info.get("unsupervised", False)

            if is_unsupervised:
                # Anomaly detector: evaluate against injected anomalies if available
                if "is_anomaly" in features_df.columns and "anomaly_flag" in raw_preds.columns:
                    y_true = features_df["is_anomaly"].values
                    y_pred = (raw_preds["anomaly_flag"] == "anomaly").astype(int).values
                    anomaly_metrics = evaluator.evaluate_anomaly_detector(
                        y_true, y_pred
                    )
                    # Compute F1 on anomaly class for threshold validation (Req 4.5)
                    from sklearn.metrics import f1_score
                    anomaly_metrics["f1_anomaly"] = float(
                        f1_score(y_true, y_pred, pos_label=1, zero_division=0.0)
                    )
                    all_metrics[model_name] = anomaly_metrics
                else:
                    all_metrics[model_name] = {"note": "No ground truth available"}
            else:
                # Supervised: evaluate on test set
                if target_col and target_col in features_df.columns:
                    y_full = features_df[target_col]
                    feature_cols = [
                        c for c in features_df.columns
                        if c != target_col and c != time_col
                    ]

                    if time_col and time_col in features_df.columns:
                        _, _, _, y_test = BaseModel.time_aware_split(
                            features_df[feature_cols + [time_col]],
                            y_full,
                            time_col,
                            config.test_split_pct,
                        )
                    else:
                        split_idx = int(len(features_df) * (1 - config.test_split_pct))
                        y_test = y_full.iloc[split_idx:]

                    # Get prediction values from raw_preds
                    if "prediction" in raw_preds.columns:
                        y_pred = raw_preds["prediction"].values
                    elif "predicted_value" in raw_preds.columns:
                        y_pred = raw_preds["predicted_value"].values
                    else:
                        y_pred = raw_preds.iloc[:, 0].values

                    # Align lengths
                    min_len = min(len(y_test), len(y_pred))
                    y_test_aligned = y_test.values[:min_len]
                    y_pred_aligned = y_pred[:min_len]

                    if model_name == "spoilage_classifier":
                        # Use specialized spoilage evaluation with per-class recall
                        # and Macro F1 logging (Requirements 2.4, 2.5, 2.6)
                        all_metrics[model_name] = evaluator.evaluate_spoilage_classifier(
                            y_test_aligned, y_pred_aligned
                        )
                    else:
                        metrics = evaluator.evaluate_regressor(
                            y_test_aligned, y_pred_aligned
                        )
                        # Compute normalized metrics for threshold comparison
                        y_std = float(np.std(y_test_aligned))
                        y_mean = float(np.mean(y_test_aligned))
                        if y_std > 0:
                            metrics["rmse_pct_std"] = metrics["rmse"] / y_std
                        else:
                            metrics["rmse_pct_std"] = 0.0
                        if y_mean > 0:
                            metrics["mae_pct_mean"] = metrics["mae"] / y_mean
                        else:
                            metrics["mae_pct_mean"] = 0.0

                        # Compute MAPE for demand forecaster (Requirement 4.2)
                        if model_name == "demand_forecaster":
                            non_zero_mask = y_test_aligned != 0
                            if non_zero_mask.any():
                                mape = float(np.mean(
                                    np.abs(
                                        (y_test_aligned[non_zero_mask] - y_pred_aligned[non_zero_mask])
                                        / y_test_aligned[non_zero_mask]
                                    )
                                ))
                            else:
                                mape = 0.0
                            metrics["mape"] = mape

                        all_metrics[model_name] = metrics
                else:
                    all_metrics[model_name] = {"note": "No target column available"}

        except Exception as e:
            logger.warning("Evaluation failed for %s: %s", model_name, str(e))
            all_metrics[model_name] = {"error": str(e)}

    # Add failed models to metrics
    for model_name, error_msg in errors.items():
        all_metrics[model_name] = {"error": error_msg}

    evaluation_report = evaluator.generate_summary_report(all_metrics)

    # --- Step 6b: Model acceptance validation (Requirement 4.1, 4.7, 4.8) ---
    logger.info("Running model acceptance validation")
    validation_report = evaluator.validate_all_models(all_metrics)
    evaluation_report["validation_report"] = validation_report
    logger.info(
        "Model acceptance validation complete. Overall status: %s",
        validation_report.get("overall_status", "UNKNOWN"),
    )

    # --- Step 6c: Shelf-life distribution diagnostics (Requirement 3.1, 3.5) ---
    if "shelf_life_estimator" in raw_predictions:
        try:
            from freshchain_ml_pipeline.evaluation.shelf_life_diagnostics import (
                run_shelf_life_diagnostics,
            )
            shelf_life_model_info = model_configs["shelf_life_estimator"]
            sl_features = shelf_life_model_info["features"]
            sl_target_col = shelf_life_model_info["target"]
            sl_raw_preds = raw_predictions["shelf_life_estimator"]

            # Get target values
            if sl_target_col and sl_target_col in sl_features.columns:
                sl_targets = sl_features[sl_target_col].values
            else:
                sl_targets = np.array([])

            # Get prediction values
            if "predicted_value" in sl_raw_preds.columns:
                sl_pred_values = sl_raw_preds["predicted_value"].values
            elif "remaining_days" in sl_raw_preds.columns:
                sl_pred_values = sl_raw_preds["remaining_days"].values
            else:
                sl_pred_values = sl_raw_preds.iloc[:, 0].values

            diagnostics = run_shelf_life_diagnostics(sl_targets, sl_pred_values)
            evaluation_report["shelf_life_diagnostics"] = diagnostics
            logger.info("Shelf-life diagnostics complete")
        except Exception as e:
            logger.warning("Shelf-life diagnostics failed: %s", str(e))
            evaluation_report["shelf_life_diagnostics"] = {"error": str(e)}

    eval_end = time.time()
    logger.info("Model evaluation complete in %.2fs", eval_end - eval_start)

    # --- Step 7: Explain predictions ---
    logger.info("Starting prediction explanation")
    explain_start = time.time()
    explainer = Explainer(config)

    explanations: Dict[str, str] = {}
    for model_name, model_instance in trained_models.items():
        try:
            model_info = model_configs[model_name]
            features_df = model_info["features"]
            target_col = model_info["target"]
            time_col = model_info["time_col"]
            is_unsupervised = model_info.get("unsupervised", False)

            # Use the same feature columns that were used during training
            # (exclude target, time, and identifier columns that were dropped)
            feature_cols = [
                c for c in features_df.columns
                if c != target_col and c != time_col
            ]

            if is_unsupervised:
                # Anomaly detector excludes identifier columns and ground truth
                unsupervised_exclude = []
                if time_col:
                    unsupervised_exclude.append(time_col)
                if "is_anomaly" in features_df.columns:
                    unsupervised_exclude.append("is_anomaly")
                feature_cols = [
                    c for c in feature_cols if c not in unsupervised_exclude
                ]

            X_explain = _encode_categorical_columns(
                features_df[feature_cols],
            )

            # Drop time column if still present
            if time_col and time_col in X_explain.columns:
                X_explain = X_explain.drop(columns=[time_col])

            # Get the actual model object for importance computation
            raw_model = model_instance.model if hasattr(model_instance, "model") else model_instance

            # Ensure X_explain columns match what the model was trained on
            if hasattr(raw_model, "n_features_in_"):
                n_model_features = raw_model.n_features_in_
                if len(X_explain.columns) != n_model_features:
                    # The model was trained on a subset — use only the columns
                    # that match. For tree models, feature_names_in_ tells us which.
                    if hasattr(raw_model, "feature_names_in_"):
                        trained_cols = list(raw_model.feature_names_in_)
                        X_explain = X_explain[[c for c in trained_cols if c in X_explain.columns]]
                    else:
                        # Take the last n_model_features columns (identifiers are typically first)
                        X_explain = X_explain.iloc[:, -n_model_features:]

            if len(X_explain) > 0 and len(X_explain.columns) > 0:
                importance_df = explainer.compute_feature_importance(
                    raw_model,
                    X_explain,
                    method="builtin",
                )
                metrics = all_metrics.get(model_name, {})
                narrative = explainer.generate_narrative(
                    model_name, importance_df, metrics
                )
                explanations[model_name] = narrative
        except Exception as e:
            logger.warning("Explanation failed for %s: %s", model_name, str(e))
            explanations[model_name] = f"Explanation unavailable: {str(e)}"

    explain_end = time.time()
    logger.info("Prediction explanation complete in %.2fs", explain_end - explain_start)

    # --- Final summary ---
    pipeline_end = time.time()
    elapsed = pipeline_end - pipeline_start
    logger.info(
        "Pipeline complete in %.2fs. Models trained: %d/%d",
        elapsed,
        len(predictions),
        len(model_configs),
    )

    return {
        "config": config,
        "manifest": manifest,
        "predictions": predictions,
        "evaluation_report": evaluation_report,
        "explanations": explanations,
        "errors": errors,
        "elapsed_seconds": elapsed,
    }


def _build_model_configs(
    config: PipelineConfig,
    spoilage_features: pd.DataFrame,
    wastage_features: pd.DataFrame,
    demand_features: pd.DataFrame,
    anomaly_features: pd.DataFrame,
    shelf_life_features: pd.DataFrame,
) -> Dict[str, Dict[str, Any]]:
    """Build model configuration dictionary mapping model names to their setup.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration.
    spoilage_features : pd.DataFrame
        Features for spoilage classification.
    wastage_features : pd.DataFrame
        Features for wastage/replenishment prediction.
    demand_features : pd.DataFrame
        Features for demand forecasting.
    anomaly_features : pd.DataFrame
        Features for anomaly detection.
    shelf_life_features : pd.DataFrame
        Features for shelf-life estimation.

    Returns
    -------
    dict
        Dictionary mapping model names to configuration dicts with keys:
        model, features, target, time_col, unsupervised.
    """
    # Identify target and time columns for each feature set
    spoilage_target = _find_target_column(
        spoilage_features, ["spoilage_label", "label", "target", "is_spoiled"]
    )
    demand_target = _find_target_column(
        demand_features, ["unitsSold", "units_sold", "target", "demand"]
    )
    shelf_life_target = _find_target_column(
        shelf_life_features, ["days_remaining", "remaining_shelf_life", "target", "shelf_life"]
    )

    spoilage_time = _find_time_column(spoilage_features)
    demand_time = _find_time_column(demand_features)
    shelf_life_time = _find_time_column(shelf_life_features)
    wastage_time = _find_time_column(wastage_features)

    # Build replenishment features from demand + wastage features
    # The replenishment model uses demand features with a derived target
    replenishment_features = _build_replenishment_features(demand_features, wastage_features)
    replenishment_time = _find_time_column(replenishment_features)
    replenishment_target = "replenishment_target"

    return {
        "spoilage_classifier": {
            "model": SpoilageClassifier(config),
            "features": spoilage_features,
            "target": spoilage_target,
            "time_col": spoilage_time,
            "unsupervised": False,
        },
        "demand_forecaster": {
            "model": DemandForecaster(config),
            "features": demand_features,
            "target": demand_target,
            "time_col": demand_time,
            "unsupervised": False,
        },
        "anomaly_detector": {
            "model": AnomalyDetector(config),
            "features": anomaly_features,
            "target": None,
            "time_col": None,
            "unsupervised": True,
        },
        "shelf_life_estimator": {
            "model": ShelfLifeEstimator(config),
            "features": shelf_life_features,
            "target": shelf_life_target,
            "time_col": shelf_life_time,
            "unsupervised": False,
        },
        "replenishment_model": {
            "model": ReplenishmentModel(config),
            "features": replenishment_features,
            "target": replenishment_target,
            "time_col": replenishment_time,
            "unsupervised": False,
        },
    }


def _compute_replenishment(
    predictions: Dict[str, List[PredictionOutput]],
    wastage_features: pd.DataFrame,
    safety_buffer_pct: float = 0.20,
) -> None:
    """Compute replenishmentUnits for each demand forecast prediction.

    Formula: replenishmentUnits = max(0, demandUnitsForecast - current_available_stock + safety_buffer)
    Where:
    - current_available_stock is estimated from wastage_features sell_through_rate
      (low sell-through implies high stock)
    - safety_buffer = 20% of demand forecast

    Parameters
    ----------
    predictions : dict
        Model name → list of PredictionOutput (modified in place).
    wastage_features : pd.DataFrame
        Wastage features containing sell_through_rate for stock estimation.
    safety_buffer_pct : float
        Safety buffer as fraction of demand forecast (default 0.20).
    """
    # Estimate average daily available stock from wastage features
    if "sell_through_rate" in wastage_features.columns:
        avg_sell_through = wastage_features["sell_through_rate"].mean()
        # If sell_through is low (e.g. 0.3), stock is relatively high
        # Estimate available stock as inverse relationship
        avg_sell_through = max(0.01, min(1.0, avg_sell_through))
        # Use a baseline stock estimate: if sell_through is 0.5, stock ~ demand
        current_available_stock = 10.0 * (1.0 - avg_sell_through)
    else:
        current_available_stock = 5.0  # Default fallback

    demand_preds = predictions.get("demand_forecaster", [])
    for pred in demand_preds:
        demand = pred.demandUnitsForecast
        if demand > 0:
            safety_buffer = demand * safety_buffer_pct
            replenishment = max(0.0, demand - current_available_stock + safety_buffer)
            pred.replenishmentUnits = replenishment
        else:
            pred.replenishmentUnits = 0.0


def _compute_route_priority(predictions: Dict[str, List[PredictionOutput]]) -> None:
    """Compute routePriority ranking for all predictions using TransferPriority system.

    Uses the rule-based TransferPriority system to compute priority scores
    based on combined signals from all models. Then assigns routePriority
    to all predictions.

    Parameters
    ----------
    predictions : dict
        Model name → list of PredictionOutput (modified in place).
    """
    transfer_priority = TransferPriority()

    spoilage_preds = predictions.get("spoilage_classifier", [])
    shelf_life_preds = predictions.get("shelf_life_estimator", [])
    demand_preds = predictions.get("demand_forecaster", [])
    anomaly_preds = predictions.get("anomaly_detector", [])
    replenishment_preds = predictions.get("replenishment_model", [])

    priorities = transfer_priority.compute_priority(
        spoilage_preds=spoilage_preds or None,
        shelf_life_preds=shelf_life_preds or None,
        demand_preds=demand_preds or None,
        anomaly_preds=anomaly_preds or None,
        replenishment_preds=replenishment_preds or None,
    )

    # Assign priorities to the longest prediction list first, then to all
    # For simplicity, assign based on index across all prediction lists
    all_preds_flat = []
    for model_name, pred_list in predictions.items():
        for pred in pred_list:
            all_preds_flat.append(pred)

    # Assign priorities: use the computed priorities for the first N items,
    # then assign remaining items a default mid-priority
    for i, pred in enumerate(all_preds_flat):
        if i < len(priorities):
            pred.routePriority = priorities[i % len(priorities)]
        else:
            pred.routePriority = 5  # Default mid-priority


def _compute_business_impact(
    predictions: Dict[str, List[PredictionOutput]],
    wastage_features: pd.DataFrame,
) -> None:
    """Compute businessImpact string for each prediction.

    Format: "Est. waste: X units (ZAR Y). Lost sales risk: Z units if not replenished."
    Uses average price from sales data and predicted wastage/demand to estimate
    monetary impact.

    Parameters
    ----------
    predictions : dict
        Model name → list of PredictionOutput (modified in place).
    wastage_features : pd.DataFrame
        Wastage features containing price information for monetary estimates.
    """
    # Get average price from wastage features if available
    avg_price = 25.0  # Default R25 per unit
    if "averagePrice" in wastage_features.columns:
        price_mean = wastage_features["averagePrice"].mean()
        if price_mean > 0:
            avg_price = price_mean

    # Estimate wastage from replenishment predictions
    replenishment_preds = predictions.get("replenishment_model", [])
    demand_preds = predictions.get("demand_forecaster", [])

    for model_name, pred_list in predictions.items():
        for i, pred in enumerate(pred_list):
            # Compute waste estimate and lost sales risk
            waste_units = 0.0
            lost_sales_units = 0.0

            # Spoilage CRITICAL/HIGH → waste risk
            if pred.predictionType == "SPOILAGE_RISK" and pred.riskLevel in ("CRITICAL", "HIGH"):
                waste_units = pred.score * 10  # Estimate based on score
                waste_cost = waste_units * avg_price
                pred.businessImpact = (
                    f"Est. waste: {waste_units:.0f} units (ZAR {waste_cost:.0f}). "
                    f"Lost sales risk: {waste_units:.0f} units if not replenished."
                )
            # Shelf life <= 3 days
            elif pred.predictionType == "SHELF_LIFE" and 0 <= pred.remainingShelfLifeDays <= 3:
                days = pred.remainingShelfLifeDays
                waste_units = max(1.0, 10.0 * (1 - days / 3.0))
                waste_cost = waste_units * avg_price
                lost_sales_units = waste_units
                pred.businessImpact = (
                    f"Est. waste: {waste_units:.0f} units (ZAR {waste_cost:.0f}). "
                    f"Lost sales risk: {lost_sales_units:.0f} units if not replenished."
                )
            # Demand forecast
            elif pred.predictionType == "DEMAND_FORECAST":
                demand = pred.demandUnitsForecast
                lost_sales_units = max(0, demand - pred.replenishmentUnits) if pred.replenishmentUnits >= 0 else demand
                revenue_at_risk = lost_sales_units * avg_price
                pred.businessImpact = (
                    f"Est. waste: 0 units (ZAR 0). "
                    f"Lost sales risk: {lost_sales_units:.0f} units if not replenished."
                )
            # Replenishment
            elif pred.predictionType == "REPLENISHMENT":
                units_needed = pred.replenishmentUnits
                lost_sales_cost = units_needed * avg_price
                pred.businessImpact = (
                    f"Est. waste: 0 units (ZAR 0). "
                    f"Lost sales risk: {units_needed:.0f} units if not replenished."
                )
            # Anomaly detected
            elif pred.predictionType == "SENSOR_ANOMALY" and pred.anomalyType != "N/A":
                batch_value = 50.0 * avg_price
                pred.businessImpact = (
                    f"Est. waste: 50 units (ZAR {batch_value:.0f}). "
                    f"Lost sales risk: 50 units if not replenished."
                )
            # Default
            else:
                pred.businessImpact = (
                    "Est. waste: 0 units (ZAR 0). "
                    "Lost sales risk: 0 units if not replenished."
                )


def _encode_categorical_columns(df: pd.DataFrame, exclude_cols: List[str] | None = None) -> pd.DataFrame:
    """Encode string/object and datetime columns as numeric for model training.

    Converts object-type columns to pandas Categorical codes and drops
    datetime columns (they should be removed before calling this).
    Columns listed in exclude_cols are left unchanged.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame potentially containing object/datetime columns.
    exclude_cols : list of str or None
        Columns to exclude from encoding (e.g., target, time columns).

    Returns
    -------
    pd.DataFrame
        DataFrame with object columns converted to integer codes and
        datetime columns dropped.
    """
    if exclude_cols is None:
        exclude_cols = []

    result = df.copy()
    cols_to_drop = []
    for col in result.columns:
        if col in exclude_cols:
            continue
        if result[col].dtype == object:
            result[col] = result[col].astype("category").cat.codes
        elif hasattr(result[col].dtype, "kind") and result[col].dtype.kind in ("M", "m"):
            # Drop datetime/timedelta columns
            cols_to_drop.append(col)

    if cols_to_drop:
        result = result.drop(columns=cols_to_drop)

    return result


def _prepare_features_with_target(
    features_df: pd.DataFrame,
    target_col: str | None,
    time_col: str | None,
) -> tuple[pd.DataFrame, pd.Series | None]:
    """Prepare feature DataFrame by separating features from target and encoding.

    If no target column exists in the DataFrame, creates a synthetic target
    based on available numeric columns.

    Parameters
    ----------
    features_df : pd.DataFrame
        Raw feature DataFrame from the FeatureEngine.
    target_col : str or None
        Name of the target column if present.
    time_col : str or None
        Name of the time column if present.

    Returns
    -------
    tuple of (pd.DataFrame, pd.Series or None)
        Encoded feature DataFrame (without target/time) and target Series.
    """
    exclude = []
    if target_col and target_col in features_df.columns:
        exclude.append(target_col)
    if time_col and time_col in features_df.columns:
        exclude.append(time_col)

    # Extract target
    y = None
    if target_col and target_col in features_df.columns:
        y = features_df[target_col].copy()

    # Get feature columns (exclude target and time)
    feature_cols = [c for c in features_df.columns if c not in exclude]
    X = features_df[feature_cols].copy()

    # Encode categoricals and drop datetimes
    X = _encode_categorical_columns(X)

    return X, y


def _derive_spoilage_target(features_df: pd.DataFrame) -> pd.Series:
    """Derive a binary spoilage target from feature values.

    Uses cumulative temperature exposure and high humidity flag to create
    a synthetic spoilage label for training.

    Parameters
    ----------
    features_df : pd.DataFrame
        Spoilage feature DataFrame.

    Returns
    -------
    pd.Series
        Binary target (0=Good, 1=Bad).
    """
    import numpy as np

    target = pd.Series(0, index=features_df.index, dtype=int)

    if "cumulative_temp_exposure" in features_df.columns:
        median_exposure = features_df["cumulative_temp_exposure"].median()
        target = target | (features_df["cumulative_temp_exposure"] > median_exposure).astype(int)

    if "high_humidity_flag" in features_df.columns:
        target = target | features_df["high_humidity_flag"].astype(int)

    return target


def _derive_wastage_target(features_df: pd.DataFrame) -> pd.Series:
    """Derive a wastage target from feature values.

    Uses sell-through rate and stock age to create a synthetic wastage value.

    Parameters
    ----------
    features_df : pd.DataFrame
        Wastage feature DataFrame.

    Returns
    -------
    pd.Series
        Non-negative wastage target.
    """
    import numpy as np

    target = pd.Series(0.0, index=features_df.index, dtype=float)

    if "stock_age_days" in features_df.columns and "sell_through_rate" in features_df.columns:
        # Higher stock age and lower sell-through → more wastage
        target = (
            features_df["stock_age_days"] * (1 - features_df["sell_through_rate"].clip(0, 1))
        ).clip(lower=0)
    elif "stock_age_days" in features_df.columns:
        target = features_df["stock_age_days"].clip(lower=0).astype(float)

    return target


def _derive_demand_target(features_df: pd.DataFrame) -> pd.Series:
    """Derive a demand target from feature values.

    Uses sales lag features as a proxy for demand.

    Parameters
    ----------
    features_df : pd.DataFrame
        Demand feature DataFrame.

    Returns
    -------
    pd.Series
        Non-negative demand target.
    """
    if "sales_lag_1" in features_df.columns:
        return features_df["sales_lag_1"].clip(lower=0).astype(float)
    elif "sales_lag_7" in features_df.columns:
        return features_df["sales_lag_7"].clip(lower=0).astype(float)
    else:
        return pd.Series(1.0, index=features_df.index, dtype=float)


def _derive_shelf_life_target(features_df: pd.DataFrame) -> pd.Series:
    """Derive a shelf-life target from feature values.

    Uses days_since_production and cumulative exposure to estimate remaining life.

    Parameters
    ----------
    features_df : pd.DataFrame
        Shelf-life feature DataFrame.

    Returns
    -------
    pd.Series
        Non-negative days remaining target.
    """
    import numpy as np

    if "days_since_production" in features_df.columns:
        # Assume base shelf life of ~10 days, subtract days since production
        base_life = 10.0
        remaining = base_life - features_df["days_since_production"]
        if "cumulative_temp_exposure" in features_df.columns:
            # Reduce by exposure (normalized)
            max_exposure = features_df["cumulative_temp_exposure"].max()
            if max_exposure > 0:
                remaining = remaining - (features_df["cumulative_temp_exposure"] / max_exposure) * 2
        return remaining.clip(lower=0).astype(float)
    else:
        return pd.Series(5.0, index=features_df.index, dtype=float)


def _derive_target_for_model(model_name: str, features_df: pd.DataFrame) -> pd.Series:
    """Derive a target variable for a model when not present in features.

    Parameters
    ----------
    model_name : str
        Name of the model needing a target.
    features_df : pd.DataFrame
        Feature DataFrame to derive target from.

    Returns
    -------
    pd.Series
        Derived target variable.
    """
    if model_name == "spoilage_classifier":
        return _derive_spoilage_target(features_df)
    elif model_name == "demand_forecaster":
        return _derive_demand_target(features_df)
    elif model_name == "shelf_life_estimator":
        return _derive_shelf_life_target(features_df)
    elif model_name == "replenishment_model":
        return _derive_replenishment_target(features_df)
    else:
        # Default: return zeros
        return pd.Series(0.0, index=features_df.index, dtype=float)


def _build_replenishment_features(
    demand_features: pd.DataFrame,
    wastage_features: pd.DataFrame,
) -> pd.DataFrame:
    """Build features for the replenishment model from demand and wastage features.

    Combines demand features (sales lags, price) with stock-related signals
    from wastage features. Also derives the replenishment target.

    Parameters
    ----------
    demand_features : pd.DataFrame
        Features from the demand feature builder.
    wastage_features : pd.DataFrame
        Features from the wastage feature builder.

    Returns
    -------
    pd.DataFrame
        Combined feature DataFrame with replenishment_target column.
    """
    # Start with demand features (they have sales lags and price)
    replenishment_df = demand_features.copy()

    # Add stock-related features from wastage if available
    if "sell_through_rate" in wastage_features.columns:
        # Align by common keys if possible
        if "storeCode" in wastage_features.columns and "storeCode" in replenishment_df.columns:
            # Compute mean sell_through_rate per store/sku
            stock_info = wastage_features.groupby(
                ["storeCode", "sku"], as_index=False
            ).agg(
                mean_sell_through=("sell_through_rate", "mean"),
            )
            replenishment_df = replenishment_df.merge(
                stock_info, on=["storeCode", "sku"], how="left"
            )
            replenishment_df["mean_sell_through"] = replenishment_df["mean_sell_through"].fillna(0.5)
        else:
            replenishment_df["mean_sell_through"] = wastage_features["sell_through_rate"].mean()

    # Derive the replenishment target:
    # Formula: max(0, sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5)
    #
    # Rationale (Requirement 5.5):
    # - sales_lag_7 * 1.2: 20% demand buffer above trailing 7-day sales average
    # - current_stock_estimate: prevents over-ordering when stock exists
    # - demand_std * 1.5: 1.5-sigma safety stock margin for demand variability
    # - max(0, ...): ensures non-negative target (no negative orders)
    sales_lag_7 = replenishment_df.get("sales_lag_7", pd.Series(10.0, index=replenishment_df.index))
    sales_lag_1 = replenishment_df.get("sales_lag_1", pd.Series(10.0, index=replenishment_df.index))

    # Estimate current stock from sell-through rate
    if "mean_sell_through" in replenishment_df.columns:
        current_stock_estimate = sales_lag_7 * (1 - replenishment_df["mean_sell_through"].clip(0.01, 1.0))
    else:
        current_stock_estimate = sales_lag_7 * 0.5

    # Estimate demand variability (std) from lag differences
    demand_std = (sales_lag_7 - sales_lag_1).abs().clip(lower=1.0)

    # Target: max(0, sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5)
    replenishment_target = (sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5).clip(lower=0)
    replenishment_df["replenishment_target"] = replenishment_target

    return replenishment_df


def _derive_replenishment_target(features_df: pd.DataFrame) -> pd.Series:
    """Derive a replenishment target from feature values.

    Formula: max(0, sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5)

    Rationale for each term:
    - sales_lag_7 * 1.2: The 1.2 multiplier provides a 20% demand buffer above
      the 7-day trailing sales average to account for demand growth.
    - current_stock_estimate: Subtracted to prevent over-ordering when stock
      already exists. Estimated from sell-through rate.
    - demand_std * 1.5: Provides a 1.5-sigma safety stock margin proportional
      to demand variability, ensuring buffer for uncertain demand.
    - max(0, ...): Ensures the target is never negative (no negative orders).

    The output is clipped to non-negative values and should be rounded to
    integers when used as model predictions.

    Parameters
    ----------
    features_df : pd.DataFrame
        Replenishment feature DataFrame.

    Returns
    -------
    pd.Series
        Non-negative replenishment target (float, to be rounded to int by model).

    Requirements: 5.1, 5.2, 5.5
    """
    sales_lag_7 = features_df.get("sales_lag_7", pd.Series(10.0, index=features_df.index))
    sales_lag_1 = features_df.get("sales_lag_1", pd.Series(10.0, index=features_df.index))

    # Input validation: clip negative values to zero (Requirement 5.3)
    sales_lag_7 = sales_lag_7.clip(lower=0)
    sales_lag_1 = sales_lag_1.clip(lower=0)

    # Estimate current stock from sell-through rate
    if "mean_sell_through" in features_df.columns:
        current_stock = sales_lag_7 * (1 - features_df["mean_sell_through"].clip(0.01, 1.0))
    else:
        current_stock = sales_lag_7 * 0.5

    # Clip current_stock to non-negative (Requirement 5.3)
    current_stock = current_stock.clip(lower=0)

    # Demand variability (standard deviation proxy from lag differences)
    # When demand_std > sales_lag_7, the safety buffer is proportional to
    # demand variability, ensuring adequate stock for uncertain demand (Req 5.4)
    demand_std = (sales_lag_7 - sales_lag_1).abs().clip(lower=1.0)

    # Formula: max(0, sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5)
    # The clip(lower=0) ensures non-negative output (Requirement 5.2)
    target = (sales_lag_7 * 1.2 - current_stock + demand_std * 1.5).clip(lower=0)
    return target


def _find_target_column(df: pd.DataFrame, candidates: List[str]) -> str | None:
    """Find the target column from a list of candidate names.

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame to search for target column.
    candidates : list of str
        Candidate column names in priority order.

    Returns
    -------
    str or None
        The first matching column name, or None if no match found.
    """
    for col in candidates:
        if col in df.columns:
            return col
    return None


def _find_time_column(df: pd.DataFrame) -> str | None:
    """Find the time/date column in a DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame to search for time column.

    Returns
    -------
    str or None
        The time column name, or None if not found.
    """
    time_candidates = [
        "timestamp", "measuredAt", "businessDate", "date", "time",
        "placedAt", "datetime",
    ]
    for col in time_candidates:
        if col in df.columns:
            return col
    return None


def _validate_prediction_outputs(
    outputs: List[PredictionOutput], model_name: str
) -> List[PredictionOutput]:
    """Validate all PredictionOutput instances against the schema.

    Re-validates each output through Pydantic to ensure schema compliance.
    Logs warnings for any invalid outputs and excludes them from results.

    Parameters
    ----------
    outputs : list of PredictionOutput
        Raw prediction outputs from a model.
    model_name : str
        Name of the model that produced the outputs (for logging).

    Returns
    -------
    list of PredictionOutput
        Validated prediction outputs (invalid ones excluded).
    """
    validated = []
    invalid_count = 0

    for output in outputs:
        try:
            # Re-validate through Pydantic model_validate
            validated_output = PredictionOutput.model_validate(output.model_dump())
            validated.append(validated_output)
        except Exception as e:
            invalid_count += 1
            if invalid_count <= 3:
                logger.warning(
                    "Invalid PredictionOutput from %s: %s", model_name, str(e)
                )

    if invalid_count > 0:
        logger.warning(
            "Model %s produced %d invalid PredictionOutput instances (excluded)",
            model_name,
            invalid_count,
        )

    return validated


def main() -> None:
    """CLI entry point for the FreshChain ML Pipeline.

    Parses command-line arguments for config path and parameter overrides,
    then runs the full pipeline.
    """
    parser = argparse.ArgumentParser(
        description="FreshChain ML Pipeline — end-to-end ML system for retail food supply chain optimisation"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to YAML configuration file",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Override global random seed",
    )
    parser.add_argument(
        "--stores",
        type=int,
        default=None,
        help="Override number of stores",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="Override number of simulation days",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Override output directory path",
    )

    args = parser.parse_args()

    # Setup logging
    setup_logging()

    # Load config
    if args.config:
        config = PipelineConfig.load_from_yaml(args.config)
    else:
        config = PipelineConfig()

    # Apply CLI overrides
    if args.seed is not None:
        config.random_seed = args.seed
    if args.stores is not None:
        config.num_stores = args.stores
    if args.days is not None:
        config.num_days = args.days
    if args.output_dir is not None:
        config.output_dir = args.output_dir

    # Run pipeline
    results = run_pipeline(config)

    # Print summary
    print(f"\nPipeline completed in {results['elapsed_seconds']:.2f}s")
    print(f"Models trained: {len(results['predictions'])}")
    if results["errors"]:
        print(f"Models failed: {len(results['errors'])}")
        for name, err in results["errors"].items():
            print(f"  - {name}: {err}")


if __name__ == "__main__":
    main()
