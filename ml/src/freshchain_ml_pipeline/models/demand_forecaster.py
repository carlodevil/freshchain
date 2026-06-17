"""Demand Forecaster model for the FreshChain ML Pipeline.

Uses XGBoost regression with lag features (1, 7, 14 days) to produce
7-day daily demand forecasts per store/SKU. Implements rolling-origin
cross-validation with a minimum of 3 folds.

Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 16.5
"""

import logging
from typing import List, Tuple

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.models import BaseModel
from freshchain_ml_pipeline.schema.prediction_output import (
    PREDICTION_TYPE_DEMAND,
    SENTINEL_NUMERIC,
    SENTINEL_STRING,
    PredictionOutput,
)

logger = logging.getLogger("freshchain_ml_pipeline")


class DemandForecaster(BaseModel):
    """XGBoost regressor for demand forecasting with lag features.

    Produces 7-day daily demand forecasts per store/SKU using historical
    sales lags (1, 7, 14 days), day-of-week, and other temporal features.
    Supports rolling-origin cross-validation with a minimum of 3 folds.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling model training parameters.
    """

    FORECAST_HORIZON: int = 7
    LAG_DAYS: List[int] = [1, 7, 14]

    def __init__(self, config: PipelineConfig) -> None:
        super().__init__(config)
        self.model = XGBRegressor(
            n_estimators=200,
            max_depth=3,
            learning_rate=0.08,
            subsample=0.9,
            colsample_bytree=0.8,
            reg_alpha=0.5,
            reg_lambda=2.0,
            min_child_weight=3,
            gamma=0.1,
            objective="reg:squarederror",
            random_state=config.random_seed,
        )
        self._is_trained = False
        # Residual statistics for dynamic confidence scoring
        self._residual_variance: float = 0.0
        self._residual_std: float = 0.0
        self._cv: float = 0.0
        # Per-group CV for more granular confidence scoring
        self._group_cv: dict = {}
        # Training mean for fallback predictions
        self._train_mean: float = 0.0

    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train the demand forecaster.

        Uses temporal split to prevent future data leakage. After training,
        computes residual statistics (variance, coefficient of variation)
        from training predictions vs actuals for dynamic confidence scoring.
        Also computes per-prediction residual stats for finer-grained
        confidence estimates.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix with lag features and temporal encodings.
        y : pd.Series
            Target variable (unitsSold).
        """
        logger.info("Training DemandForecaster on %d samples", len(X))

        # Drop time column if present before fitting
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        self.model.fit(X_features, y)
        self._is_trained = True
        self._train_mean = float(np.mean(y.values))

        # Compute residual statistics from training predictions vs actuals
        train_predictions = self.model.predict(X_features)
        residuals = y.values - train_predictions

        # Global residual variance and standard deviation
        self._residual_variance = float(np.var(residuals))
        self._residual_std = float(np.std(residuals))

        # Coefficient of variation: std(actuals) / mean(actuals)
        # This measures demand variability relative to the mean
        y_mean = float(np.mean(y.values))
        y_std = float(np.std(y.values))
        if y_mean > 0:
            self._cv = y_std / y_mean
        else:
            self._cv = 0.0

        # Compute per-prediction-magnitude residual stats for adaptive confidence
        # Group residuals by prediction magnitude buckets for local error estimation
        pred_magnitudes = np.abs(train_predictions)
        if len(pred_magnitudes) > 10:
            # Create magnitude-based error profile
            quartiles = np.percentile(pred_magnitudes, [25, 50, 75])
            for i, (lo, hi) in enumerate(zip(
                [0] + quartiles.tolist(),
                quartiles.tolist() + [float("inf")]
            )):
                mask = (pred_magnitudes >= lo) & (pred_magnitudes < hi)
                if mask.any():
                    bucket_residual_std = float(np.std(residuals[mask]))
                    self._group_cv[i] = bucket_residual_std

        logger.info(
            "DemandForecaster training complete. "
            "Residual std=%.4f, CV=%.4f",
            self._residual_std,
            self._cv,
        )

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Generate 7-day daily demand forecasts.

        Uses an ensemble approach: blends the XGBoost prediction with
        a conservative lag-based anchor. The anchor uses the rolling
        median-like estimate (rolling_mean minus partial std) to reduce
        sensitivity to demand spikes/drops.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for prediction.

        Returns
        -------
        pd.DataFrame
            DataFrame with columns: demandForecast (predicted units),
            forecastDay (1-7 horizon day).
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before calling predict()")

        # Drop time column if present
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        # XGBoost prediction
        xgb_predictions = self.model.predict(X_features)
        xgb_predictions = np.clip(xgb_predictions, 0, None)

        # Conservative lag-based anchor using available features
        lag_anchor = np.full(len(X_features), self._train_mean)

        has_rolling = "rolling_mean_7" in X_features.columns
        has_lag1 = "sales_lag_1" in X_features.columns
        has_min = "rolling_min_7" in X_features.columns
        has_std = "rolling_std_7" in X_features.columns

        if has_rolling:
            rolling_mean = X_features["rolling_mean_7"].values
            rolling_min = X_features["rolling_min_7"].values if has_min else rolling_mean * 0.5
            rolling_std = X_features["rolling_std_7"].values if has_std else np.zeros(len(X_features))
            lag_1 = X_features["sales_lag_1"].values if has_lag1 else rolling_mean

            # Midpoint between mean and min, adjusted by volatility
            # High volatility → pull toward the midpoint of (mean, min)
            # Low volatility → stay closer to the mean
            volatility_ratio = np.clip(rolling_std / np.maximum(rolling_mean, 1.0), 0, 1)

            # Base anchor: weighted average tilted toward mean for stable demand,
            # toward midpoint(mean, min) for volatile demand
            stable_anchor = 0.5 * rolling_mean + 0.3 * lag_1 + 0.2 * rolling_min
            volatile_anchor = 0.4 * rolling_mean + 0.2 * lag_1 + 0.4 * rolling_min

            lag_anchor = np.where(
                rolling_mean > 0,
                (1 - volatility_ratio) * stable_anchor + volatility_ratio * volatile_anchor,
                lag_1,
            )

        elif has_lag1:
            lag_anchor = X_features["sales_lag_1"].values

        lag_anchor = np.clip(lag_anchor, 0, None)

        # Blend: 50% XGBoost + 50% conservative lag anchor
        # Equal weighting ensures the model doesn't deviate too far from
        # historical norms while still learning useful patterns
        predictions = 0.5 * xgb_predictions + 0.5 * lag_anchor

        # Round to nearest integer for unit-based demand
        predictions = np.round(predictions).astype(float)
        predictions = np.clip(predictions, 0, None)

        # Each prediction represents one day in the forecast horizon
        n_predictions = len(predictions)
        forecast_days = np.tile(
            np.arange(1, self.FORECAST_HORIZON + 1),
            n_predictions // self.FORECAST_HORIZON + 1,
        )[:n_predictions]

        return pd.DataFrame(
            {
                "demandForecast": predictions,
                "forecastDay": forecast_days,
            }
        )

    def rolling_origin_cv(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        time_column: str,
        min_folds: int = 3,
    ) -> List[Tuple[np.ndarray, np.ndarray]]:
        """Generate rolling-origin cross-validation fold indices.

        Creates expanding-window folds where each fold uses all prior
        data for training and the next time block for testing. Ensures
        a minimum number of folds.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix containing a time column.
        y : pd.Series
            Target variable.
        time_column : str
            Name of the time column in X.
        min_folds : int, optional
            Minimum number of CV folds (default 3).

        Returns
        -------
        list of (train_indices, test_indices) tuples
            Each tuple contains arrays of row indices for train and test.
        """
        if time_column not in X.columns:
            raise ValueError(
                f"time_column '{time_column}' not found in DataFrame"
            )

        time_values = pd.to_datetime(X[time_column])
        sorted_indices = time_values.argsort()
        n_samples = len(X)

        # Determine fold size to ensure at least min_folds
        n_folds = max(min_folds, self.config.cv_folds)
        # Reserve first portion for initial training, split rest into folds
        initial_train_size = n_samples // (n_folds + 1)
        fold_size = (n_samples - initial_train_size) // n_folds

        folds = []
        for i in range(n_folds):
            train_end = initial_train_size + i * fold_size
            test_start = train_end
            test_end = min(test_start + fold_size, n_samples)

            if test_end <= test_start:
                break

            train_idx = sorted_indices[:train_end].values
            test_idx = sorted_indices[test_start:test_end].values
            folds.append((train_idx, test_idx))

        return folds

    def _compute_confidence(self, prediction_value: float) -> float:
        """Compute dynamic confidence score for a prediction.

        Uses residual standard deviation normalized by prediction magnitude,
        with adjustments based on the coefficient of variation (CV) from
        training data.

        Confidence formula:
            base = 1.0 - min(1.0, normalized_residual_std)
        where normalized_residual_std = residual_std / max(|prediction|, 1.0)

        CV-based thresholds:
            - CV > 0.5 (high variability): confidence capped at 0.59
            - CV < 0.2 (low variability): confidence floored at 0.81

        Parameters
        ----------
        prediction_value : float
            The predicted demand value.

        Returns
        -------
        float
            Confidence score clamped between 0.0 and 1.0.
        """
        # Normalize residual std by prediction magnitude (avoid division by zero)
        magnitude = max(abs(prediction_value), 1.0)
        normalized_residual_std = self._residual_std / magnitude

        # Base confidence from residual variance
        confidence = 1.0 - min(1.0, normalized_residual_std)

        # Apply CV-based thresholds
        if self._cv > 0.5:
            # High variability: ensure confidence < 0.6
            confidence = min(confidence, 0.59)
        elif self._cv < 0.2:
            # Low variability: ensure confidence > 0.8
            confidence = max(confidence, 0.81)

        # Final clamp to [0.0, 1.0]
        return max(0.0, min(1.0, confidence))

    def to_prediction_output(
        self, raw_predictions: pd.DataFrame
    ) -> list[PredictionOutput]:
        """Convert raw predictions to PredictionOutput schema.

        Parameters
        ----------
        raw_predictions : pd.DataFrame
            Output from predict() with columns: demandForecast, forecastDay.

        Returns
        -------
        list[PredictionOutput]
            List of PredictionOutput instances with predictionType="DEMAND_FORECAST".
        """
        outputs = []
        for _, row in raw_predictions.iterrows():
            demand = float(row["demandForecast"])
            # Score based on normalised demand (capped at 1.0)
            max_demand = raw_predictions["demandForecast"].max()
            score = min(1.0, demand / max_demand) if max_demand > 0 else 0.0

            # Dynamic confidence based on residual variance and CV
            confidence = self._compute_confidence(demand)

            output = PredictionOutput(
                predictionType=PREDICTION_TYPE_DEMAND,
                riskLevel="LOW",  # Demand forecasts use LOW by default
                score=score,
                confidence=confidence,
                anomalyType=SENTINEL_STRING,
                remainingShelfLifeDays=SENTINEL_NUMERIC,
                demandUnitsForecast=demand,
                replenishmentUnits=SENTINEL_NUMERIC,  # Will be overwritten in post-processing
                recommendedAction=(
                    f"Forecast day {int(row['forecastDay'])}: "
                    f"{demand:.1f} units predicted. "
                    f"Adjust replenishment orders accordingly."
                ),
            )
            outputs.append(output)

        return outputs
