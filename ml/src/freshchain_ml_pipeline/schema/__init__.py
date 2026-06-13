"""Schema module for Pydantic models defining the unified PredictionOutput format."""

from freshchain_ml_pipeline.schema.prediction_output import (
    PREDICTION_TYPE_ANOMALY,
    PREDICTION_TYPE_DEMAND,
    PREDICTION_TYPE_SHELF_LIFE,
    PREDICTION_TYPE_SPOILAGE,
    PREDICTION_TYPE_WASTAGE,
    SENTINEL_NUMERIC,
    SENTINEL_STRING,
    VALID_PREDICTION_TYPES,
    VALID_RISK_LEVELS,
    PredictionOutput,
)

__all__ = [
    "PredictionOutput",
    "SENTINEL_NUMERIC",
    "SENTINEL_STRING",
    "PREDICTION_TYPE_SPOILAGE",
    "PREDICTION_TYPE_WASTAGE",
    "PREDICTION_TYPE_DEMAND",
    "PREDICTION_TYPE_ANOMALY",
    "PREDICTION_TYPE_SHELF_LIFE",
    "VALID_PREDICTION_TYPES",
    "VALID_RISK_LEVELS",
]
