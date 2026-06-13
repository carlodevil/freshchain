"""Replenishment Model for the FreshChain ML Pipeline.

Predicts optimal replenishment units per store/SKU based on:
- Demand forecast (from demand forecaster features)
- Current stock levels (from inventory data)
- Shelf-life risk (remaining days)
- Safety stock buffer

Formula: replenishment = max(0, forecast_demand * lead_time_days - current_stock + safety_stock)
Where safety_stock = forecast_demand * safety_factor (based on demand variability)

This is a rule-based + regression hybrid model.
"""

import logging

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.models import BaseModel
from freshchain_ml_pipeline.schema.prediction_output import (
    PREDICTION_TYPE_REPLENISHMENT,
    SENTINEL_NUMERIC,
    SENTINEL_STRING,
    PredictionOutput,
)

logger = logging.getLogger("freshchain_ml_pipeline")


class ReplenishmentModel(BaseModel):
    """XGBoost regressor for optimal replenishment quantity prediction.

    Predicts the number of units to replenish per store/SKU based on
    demand features (sales lags, average price) and shelf-life features.
    The target is derived as:
        max(0, sales_lag_7 * 1.2 - current_stock_estimate + demand_std * 1.5)

    Outputs are clipped at zero and rounded to non-negative integers.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling model training parameters.
    """

    def __init__(self, config: PipelineConfig) -> None:
        super().__init__(config)
        self.model = XGBRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=config.random_seed,
        )
        self._is_trained = False

    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train the replenishment model.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix with demand and shelf-life features.
        y : pd.Series
            Target variable (replenishment units).
        """
        logger.info("Training ReplenishmentModel on %d samples", len(X))

        # Drop time column if present before fitting
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        self.model.fit(X_features, y)
        self._is_trained = True

        logger.info("ReplenishmentModel training complete")

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Generate non-negative replenishment quantity predictions.

        All outputs are guaranteed to be non-negative integers.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for prediction.

        Returns
        -------
        pd.DataFrame
            DataFrame with column: replenishment_units (non-negative integers).

        Requirements: 5.2
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before calling predict()")

        # Drop time column if present
        feature_cols = [c for c in X.columns if c != "timestamp"]
        X_features = X[feature_cols]

        raw_predictions = self.model.predict(X_features)
        # Clip at zero and round to integers (Requirement 5.2)
        clipped_predictions = np.clip(raw_predictions, 0, None)
        int_predictions = np.round(clipped_predictions).astype(int)

        # Validate: all outputs must be non-negative integers
        assert (int_predictions >= 0).all(), (
            "ReplenishmentModel produced negative predictions after clipping"
        )

        return pd.DataFrame({"replenishment_units": int_predictions.astype(float)})

    def to_prediction_output(
        self, raw_predictions: pd.DataFrame
    ) -> list[PredictionOutput]:
        """Convert raw predictions to PredictionOutput schema.

        Parameters
        ----------
        raw_predictions : pd.DataFrame
            Output from predict() with column: replenishment_units.

        Returns
        -------
        list[PredictionOutput]
            List of PredictionOutput instances with predictionType="REPLENISHMENT".
        """
        outputs = []
        for _, row in raw_predictions.iterrows():
            units = float(row["replenishment_units"])
            # Use a stable absolute scale so a single prediction is not always 1.0.
            score = min(1.0, units / 40.0)
            risk_level = self._units_to_risk_level(units)

            output = PredictionOutput(
                predictionType=PREDICTION_TYPE_REPLENISHMENT,
                riskLevel=risk_level,
                score=score,
                confidence=0.7,
                anomalyType=SENTINEL_STRING,
                remainingShelfLifeDays=SENTINEL_NUMERIC,
                demandUnitsForecast=SENTINEL_NUMERIC,
                replenishmentUnits=units,
                recommendedAction=(
                    f"Replenishment needed: {units:.0f} units. "
                    f"{'Urgent restock required.' if units > 20 else 'Standard replenishment.' if units > 0 else 'Stock levels adequate.'}"
                ),
            )
            outputs.append(output)

        return outputs

    @staticmethod
    def _units_to_risk_level(units: float) -> str:
        """Map replenishment units to risk level.

        Parameters
        ----------
        units : float
            Predicted replenishment units needed.

        Returns
        -------
        str
            One of "CRITICAL", "HIGH", "MEDIUM", "LOW".
        """
        if units > 30:
            return "CRITICAL"
        elif units > 20:
            return "HIGH"
        elif units > 10:
            return "MEDIUM"
        else:
            return "LOW"
