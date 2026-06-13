"""Explainer module for computing feature importance and generating business narratives.

Provides the Explainer class that computes feature importance rankings using
SHAP values (with built-in feature importance as fallback), generates
natural-language summaries, identifies primary environmental factors for
spoilage predictions, and flags high-wastage predictions.

Requirements: 13.1, 13.2, 13.3, 13.4
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig

logger = logging.getLogger("freshchain_ml_pipeline")

# Environmental features relevant to spoilage
ENVIRONMENTAL_FEATURES = [
    "temperatureC",
    "temperature",
    "temp",
    "humidityPct",
    "humidity",
    "co2Ppm",
    "co2",
    "rolling_mean_temp",
    "rolling_mean_humidity",
    "cumulative_temp_exposure",
    "high_humidity_flag",
]


class Explainer:
    """Computes feature importance and generates business-interpretable narratives.

    Supports SHAP-based and built-in feature importance methods, with
    automatic fallback when SHAP is unavailable or fails.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration for output paths and settings.
    """

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def compute_feature_importance(
        self,
        model,
        X: pd.DataFrame,
        method: str = "builtin",
    ) -> pd.DataFrame:
        """Compute feature importance rankings for a trained model.

        Attempts SHAP-based importance first (if method="shap"), falling back
        to built-in feature_importances_ attribute. For models without
        feature_importances_ (e.g., IsolationForest), uses permutation
        importance or returns equal weights.

        Parameters
        ----------
        model : object
            A trained model with either feature_importances_ attribute or
            a predict/decision_function method.
        X : pd.DataFrame
            Feature matrix used for computing importance.
        method : str, optional
            Method to use: "shap" for SHAP values, "builtin" for built-in
            feature importance (default "builtin").

        Returns
        -------
        pd.DataFrame
            DataFrame with columns: feature_name, importance_score.
            Sorted by importance_score descending. Scores are non-negative.
        """
        feature_names = list(X.columns)

        if method == "shap":
            importance = self._try_shap(model, X, feature_names)
            if importance is not None:
                return importance

        # Fallback to built-in feature importance
        importance = self._try_builtin(model, feature_names)
        if importance is not None:
            return importance

        # Final fallback: permutation importance or equal weights
        importance = self._try_permutation_importance(model, X, feature_names)
        if importance is not None:
            return importance

        # Last resort: equal weights
        logger.warning(
            "No feature importance method available; returning equal weights"
        )
        n_features = len(feature_names)
        equal_score = 1.0 / n_features if n_features > 0 else 0.0
        df = pd.DataFrame(
            {
                "feature_name": feature_names,
                "importance_score": [equal_score] * n_features,
            }
        )
        return df.sort_values("importance_score", ascending=False).reset_index(
            drop=True
        )

    def generate_narrative(
        self,
        model_name: str,
        importance_df: pd.DataFrame,
        metrics: Optional[dict] = None,
    ) -> str:
        """Generate a natural-language summary referencing top 3 features.

        Produces a business-readable narrative describing the key drivers
        of the model's predictions and its performance metrics.

        Parameters
        ----------
        model_name : str
            Human-readable name of the model (e.g., "Spoilage Classifier").
        importance_df : pd.DataFrame
            Feature importance DataFrame from compute_feature_importance().
        metrics : dict, optional
            Dictionary of performance metrics (e.g., {"f1": 0.82, "accuracy": 0.90}).

        Returns
        -------
        str
            Natural-language narrative referencing the top 3 features.
        """
        # Get top 3 features
        top_features = importance_df.head(3)
        top_names = top_features["feature_name"].tolist()

        # Build narrative
        narrative_parts = []
        narrative_parts.append(
            f"The {model_name} model's predictions are primarily driven by "
            f"the following top 3 features: {top_names[0]}"
        )

        if len(top_names) > 1:
            narrative_parts[0] += f", {top_names[1]}"
        if len(top_names) > 2:
            narrative_parts[0] += f", and {top_names[2]}"
        narrative_parts[0] += "."

        # Add importance scores
        for _, row in top_features.iterrows():
            narrative_parts.append(
                f"  - {row['feature_name']}: importance score "
                f"{row['importance_score']:.4f}"
            )

        # Add metrics if provided
        if metrics:
            metrics_str = ", ".join(
                f"{k}={v:.4f}" if isinstance(v, float) else f"{k}={v}"
                for k, v in metrics.items()
            )
            narrative_parts.append(
                f"Model performance metrics: {metrics_str}."
            )

        return "\n".join(narrative_parts)

    def identify_primary_environmental_factor(
        self, importance_df: pd.DataFrame
    ) -> str:
        """Identify the primary environmental factor for spoilage predictions.

        Searches the feature importance rankings for environmental features
        (temperature, humidity, CO2) and returns the highest-ranked one.

        Parameters
        ----------
        importance_df : pd.DataFrame
            Feature importance DataFrame from compute_feature_importance().

        Returns
        -------
        str
            Name of the primary environmental factor, or "unknown" if none found.
        """
        for _, row in importance_df.iterrows():
            feature_lower = row["feature_name"].lower()
            for env_feature in ENVIRONMENTAL_FEATURES:
                if env_feature.lower() in feature_lower:
                    return row["feature_name"]
        return "unknown"

    def flag_high_wastage_predictions(
        self,
        predictions: pd.Series,
        importance_df: pd.DataFrame,
        percentile_threshold: float = 90.0,
    ) -> pd.DataFrame:
        """Flag predictions exceeding the 90th percentile as high-wastage.

        For each flagged prediction, provides a contributing-factor summary
        based on the top features from the importance rankings.

        Parameters
        ----------
        predictions : pd.Series
            Series of wastage prediction values.
        importance_df : pd.DataFrame
            Feature importance DataFrame for the wastage model.
        percentile_threshold : float, optional
            Percentile above which predictions are flagged (default 90.0).

        Returns
        -------
        pd.DataFrame
            DataFrame with columns: prediction_index, predicted_value,
            is_high_wastage, contributing_factors.
        """
        if len(predictions) == 0:
            return pd.DataFrame(
                columns=[
                    "prediction_index",
                    "predicted_value",
                    "is_high_wastage",
                    "contributing_factors",
                ]
            )

        threshold_value = np.percentile(predictions.values, percentile_threshold)
        top_factors = importance_df.head(3)["feature_name"].tolist()
        factor_summary = ", ".join(top_factors)

        results = []
        for idx, value in enumerate(predictions):
            is_high = bool(value > threshold_value)
            results.append(
                {
                    "prediction_index": idx,
                    "predicted_value": float(value),
                    "is_high_wastage": is_high,
                    "contributing_factors": factor_summary if is_high else "",
                }
            )

        return pd.DataFrame(results)

    def _try_shap(
        self, model, X: pd.DataFrame, feature_names: list
    ) -> Optional[pd.DataFrame]:
        """Attempt to compute SHAP-based feature importance.

        Parameters
        ----------
        model : object
            Trained model.
        X : pd.DataFrame
            Feature matrix.
        feature_names : list
            List of feature names.

        Returns
        -------
        pd.DataFrame or None
            Feature importance DataFrame, or None if SHAP fails.
        """
        try:
            import shap

            # Use a sample for efficiency
            sample_size = min(100, len(X))
            X_sample = X.iloc[:sample_size]

            # Try TreeExplainer first (for tree-based models)
            try:
                explainer = shap.TreeExplainer(model)
                shap_values = explainer.shap_values(X_sample)
            except Exception:
                # Fallback to KernelExplainer
                try:
                    explainer = shap.KernelExplainer(
                        model.predict, X_sample.iloc[:10]
                    )
                    shap_values = explainer.shap_values(X_sample)
                except Exception:
                    return None

            # Handle multi-output SHAP values
            if isinstance(shap_values, list):
                # For binary classification, take the positive class
                shap_values = shap_values[-1]

            # Compute mean absolute SHAP values per feature
            mean_abs_shap = np.abs(shap_values).mean(axis=0)

            df = pd.DataFrame(
                {
                    "feature_name": feature_names,
                    "importance_score": mean_abs_shap,
                }
            )
            # Ensure non-negative
            df["importance_score"] = df["importance_score"].clip(lower=0.0)
            df = df.sort_values("importance_score", ascending=False).reset_index(
                drop=True
            )
            logger.info("SHAP feature importance computed successfully")
            return df

        except ImportError:
            logger.warning("SHAP not available; falling back to built-in importance")
            return None
        except Exception as e:
            logger.warning(
                "SHAP computation failed: %s; falling back to built-in importance",
                str(e),
            )
            return None

    def _try_builtin(
        self, model, feature_names: list
    ) -> Optional[pd.DataFrame]:
        """Attempt to use built-in feature_importances_ attribute.

        Parameters
        ----------
        model : object
            Trained model.
        feature_names : list
            List of feature names.

        Returns
        -------
        pd.DataFrame or None
            Feature importance DataFrame, or None if not available.
        """
        # Check for feature_importances_ (tree-based models)
        importances = None
        if hasattr(model, "feature_importances_"):
            importances = model.feature_importances_
        elif hasattr(model, "model") and hasattr(model.model, "feature_importances_"):
            importances = model.model.feature_importances_

        if importances is not None:
            # Ensure length matches
            if len(importances) == len(feature_names):
                df = pd.DataFrame(
                    {
                        "feature_name": feature_names,
                        "importance_score": np.abs(importances),
                    }
                )
                df = df.sort_values(
                    "importance_score", ascending=False
                ).reset_index(drop=True)
                logger.info("Built-in feature importance computed successfully")
                return df
            else:
                logger.warning(
                    "feature_importances_ length (%d) does not match "
                    "feature count (%d)",
                    len(importances),
                    len(feature_names),
                )

        return None

    def _try_permutation_importance(
        self, model, X: pd.DataFrame, feature_names: list
    ) -> Optional[pd.DataFrame]:
        """Attempt permutation importance as a fallback.

        Parameters
        ----------
        model : object
            Trained model with a predict or decision_function method.
        X : pd.DataFrame
            Feature matrix.
        feature_names : list
            List of feature names.

        Returns
        -------
        pd.DataFrame or None
            Feature importance DataFrame, or None if not possible.
        """
        try:
            from sklearn.inspection import permutation_importance

            # Need a scoring function - use a simple variance-based approach
            sample_size = min(100, len(X))
            X_sample = X.iloc[:sample_size]

            # Check if model has predict or decision_function
            if hasattr(model, "predict"):
                result = permutation_importance(
                    model,
                    X_sample,
                    model.predict(X_sample),
                    n_repeats=5,
                    random_state=self.config.random_seed,
                )
                importances = np.abs(result.importances_mean)
                df = pd.DataFrame(
                    {
                        "feature_name": feature_names,
                        "importance_score": importances,
                    }
                )
                df = df.sort_values(
                    "importance_score", ascending=False
                ).reset_index(drop=True)
                logger.info("Permutation importance computed successfully")
                return df
        except Exception as e:
            logger.warning("Permutation importance failed: %s", str(e))

        return None
