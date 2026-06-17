"""Model training module for spoilage, wastage, demand, anomaly, and shelf-life models.

Provides the BaseModel abstract class that all FreshChain ML models extend,
and a shared time-aware train/test split utility that ensures no temporal
data leakage across all model evaluations.

Requirements: 7.6, 8.6, 9.6, 11.6, 12.4
"""

from abc import ABC, abstractmethod
from typing import Tuple

import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.schema.prediction_output import PredictionOutput


class BaseModel(ABC):
    """Abstract base class for all FreshChain ML models.

    Defines the common interface that all models must implement:
    train, predict, and to_prediction_output. Also provides a shared
    time-aware train/test split utility.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling model training parameters.
    """

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    @abstractmethod
    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train the model on the provided features and target.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for training.
        y : pd.Series
            Target variable for training.
        """
        ...

    @abstractmethod
    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Generate predictions for the provided features.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for prediction.

        Returns
        -------
        pd.DataFrame
            DataFrame containing model predictions.
        """
        ...

    @abstractmethod
    def to_prediction_output(
        self, raw_predictions: pd.DataFrame
    ) -> list[PredictionOutput]:
        """Convert raw model predictions to unified PredictionOutput schema.

        Parameters
        ----------
        raw_predictions : pd.DataFrame
            Raw predictions from the predict() method.

        Returns
        -------
        list[PredictionOutput]
            List of PredictionOutput instances conforming to the schema.
        """
        ...

    @staticmethod
    def time_aware_split(
        X: pd.DataFrame,
        y: pd.Series,
        time_column: str,
        test_pct: float = 0.20,
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
        """Split data into train/test sets based on temporal ordering.

        Ensures that the test set contains the final `test_pct` fraction
        of the time range, guaranteeing no future data leakage into the
        training set.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix containing a time column.
        y : pd.Series
            Target variable aligned with X.
        time_column : str
            Name of the column in X containing timestamps or dates.
        test_pct : float, optional
            Fraction of the time range to reserve for testing (default 0.20).

        Returns
        -------
        tuple of (X_train, X_test, y_train, y_test)
            Temporally split DataFrames and Series.

        Raises
        ------
        ValueError
            If time_column is not found in X or if test_pct is not in (0, 1).
        """
        if time_column not in X.columns:
            raise ValueError(
                f"time_column '{time_column}' not found in DataFrame columns: "
                f"{list(X.columns)}"
            )
        if not (0.0 < test_pct < 1.0):
            raise ValueError(
                f"test_pct must be between 0 and 1 (exclusive), got {test_pct}"
            )

        # Convert time column to datetime for proper ordering
        time_values = pd.to_datetime(X[time_column])

        # Compute the split point based on the time range
        min_time = time_values.min()
        max_time = time_values.max()
        time_range = max_time - min_time
        split_time = min_time + time_range * (1.0 - test_pct)

        # Split based on the temporal cutoff
        train_mask = time_values <= split_time
        test_mask = time_values > split_time

        X_train = X.loc[train_mask].reset_index(drop=True)
        X_test = X.loc[test_mask].reset_index(drop=True)
        y_train = y.loc[train_mask].reset_index(drop=True)
        y_test = y.loc[test_mask].reset_index(drop=True)

        return X_train, X_test, y_train, y_test
