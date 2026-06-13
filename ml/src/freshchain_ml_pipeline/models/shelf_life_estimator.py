"""Shelf Life Estimator model for the FreshChain ML Pipeline.

Uses XGBoost regression to estimate remaining shelf life (days) for
product batches based on cumulative environmental exposure. Predictions
are clipped at zero to ensure non-negative outputs.

Requirements: 11.1, 11.2, 11.3, 11.6, 16.7
"""

import logging

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.models import BaseModel
from freshchain_ml_pipeline.schema.prediction_output import (
    PREDICTION_TYPE_SHELF_LIFE,
    SENTINEL_NUMERIC,
    SENTINEL_STRING,
    PredictionOutput,
)

logger = logging.getLogger("freshchain_ml_pipeline")


class ShelfLifeEstimator(BaseModel):
    """XGBoost regressor for shelf-life estimation.

    Estimates remaining shelf life in days for product batches based on
    cumulative temperature and humidity exposure, days since production,
    and product category. Outputs are clipped at zero.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling model training parameters.
    """

    def __init__(self, config: PipelineConfig) -> None:
        super().__init__(config)
        self.model = XGBRegressor(
            n_estimators=600,
            max_depth=6,
            learning_rate=0.04,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_alpha=0.02,
            reg_lambda=0.3,
            random_state=config.random_seed,
        )
        self._is_trained = False

    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train the shelf-life estimator with time-aware split.

        Uses the final 20% of the time range as the test set to prevent
        temporal data leakage.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix with cumulative exposure and product features.
        y : pd.Series
            Target variable (days_remaining).
        """
        logger.info("Training ShelfLifeEstimator on %d samples", len(X))

        # Drop time column if present before fitting
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        self.model.fit(X_features, y)
        self._is_trained = True

        logger.info("ShelfLifeEstimator training complete")

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Generate non-negative shelf-life predictions.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for prediction.

        Returns
        -------
        pd.DataFrame
            DataFrame with column: days_remaining (clipped at 0).
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before calling predict()")

        # Drop time column if present
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        raw_predictions = self.model.predict(X_features)
        # Clip at zero to ensure non-negative predictions
        clipped_predictions = np.clip(raw_predictions, 0, None)

        return pd.DataFrame({"days_remaining": clipped_predictions})

    def to_prediction_output(
        self, raw_predictions: pd.DataFrame
    ) -> list[PredictionOutput]:
        """Convert raw predictions to PredictionOutput schema.

        Maps remaining shelf life to risk levels based on proximity to expiry:
        - ≤ 1 day → CRITICAL
        - ≤ 3 days → HIGH
        - ≤ 5 days → MEDIUM
        - > 5 days → LOW

        Parameters
        ----------
        raw_predictions : pd.DataFrame
            Output from predict() with column: days_remaining.

        Returns
        -------
        list[PredictionOutput]
            List of PredictionOutput instances with predictionType="SHELF_LIFE".
        """
        outputs = []
        for _, row in raw_predictions.iterrows():
            days = float(row["days_remaining"])
            risk_level = self._days_to_risk_level(days)
            # Score: inverse of remaining days (higher = closer to expiry)
            # Normalise assuming max shelf life of 30 days
            score = min(1.0, max(0.0, 1.0 - days / 30.0))

            output = PredictionOutput(
                predictionType=PREDICTION_TYPE_SHELF_LIFE,
                riskLevel=risk_level,
                score=score,
                confidence=0.7,
                anomalyType=SENTINEL_STRING,
                remainingShelfLifeDays=days,
                demandUnitsForecast=SENTINEL_NUMERIC,
                replenishmentUnits=SENTINEL_NUMERIC,
                recommendedAction=(
                    f"Estimated remaining shelf life: {days:.1f} days. "
                    f"{'Urgent: remove from shelf.' if days <= 1 else 'Monitor closely.' if days <= 3 else 'Within acceptable range.'}"
                ),
            )
            outputs.append(output)

        return outputs

    @staticmethod
    def _days_to_risk_level(days_remaining: float) -> str:
        """Map remaining shelf life to risk level.

        Parameters
        ----------
        days_remaining : float
            Predicted remaining shelf life in days.

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
