"""Unified Prediction Output schema for SAP AI Core integration.

Defines the PredictionOutput Pydantic model that all FreshChain ML models
must conform to when producing predictions. Includes sentinel values for
fields that a given model cannot populate, and constants for valid
prediction types.

Requirements: 16.1, 16.2, 16.8, 16.9, 16.10
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# --- Constants ---

# Sentinel values for fields that cannot be populated by a given model
SENTINEL_NUMERIC: float = -1.0
SENTINEL_STRING: str = "N/A"

# Valid prediction types mapped from each model
PREDICTION_TYPE_SPOILAGE: str = "SPOILAGE_RISK"
PREDICTION_TYPE_WASTAGE: str = "WASTAGE_FORECAST"
PREDICTION_TYPE_DEMAND: str = "DEMAND_FORECAST"
PREDICTION_TYPE_ANOMALY: str = "SENSOR_ANOMALY"
PREDICTION_TYPE_SHELF_LIFE: str = "SHELF_LIFE"
PREDICTION_TYPE_REPLENISHMENT: str = "REPLENISHMENT"

VALID_PREDICTION_TYPES: set[str] = {
    PREDICTION_TYPE_SPOILAGE,
    PREDICTION_TYPE_WASTAGE,
    PREDICTION_TYPE_DEMAND,
    PREDICTION_TYPE_ANOMALY,
    PREDICTION_TYPE_SHELF_LIFE,
    PREDICTION_TYPE_REPLENISHMENT,
}

# Valid risk levels
VALID_RISK_LEVELS: tuple[str, ...] = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


class PredictionOutput(BaseModel):
    """Unified model output schema for SAP AI Core.

    All FreshChain ML models produce predictions conforming to this schema.
    Fields that a model cannot populate are set to sentinel values:
      - Numeric fields: -1.0
      - String fields: "N/A"
    When sentinel values are used, recommendedAction should contain an
    explanation of why the field could not be populated.

    Attributes:
        predictionType: FreshChain prediction category (e.g. "SPOILAGE_RISK").
        riskLevel: Risk classification - one of LOW, MEDIUM, HIGH, CRITICAL.
        score: Risk score from 0.0 to 1.0.
        confidence: Model confidence from 0.0 to 1.0.
        anomalyType: Business reason code or "N/A" if not applicable.
        remainingShelfLifeDays: Predicted remaining shelf life or -1.0 sentinel.
        demandUnitsForecast: Near-term demand estimate or -1.0 sentinel.
        replenishmentUnits: Recommended replenishment quantity or -1.0 sentinel.
        routePriority: Optional transfer priority.
        recommendedAction: Optional human-readable operational recommendation.
        businessImpact: Optional expected waste and lost-sales impact.
    """

    # Required fields
    predictionType: str
    riskLevel: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    anomalyType: str
    remainingShelfLifeDays: float
    demandUnitsForecast: float
    replenishmentUnits: float

    # Optional (recommended) fields
    routePriority: Optional[int] = None
    recommendedAction: Optional[str] = None
    businessImpact: Optional[str] = None

    @field_validator("riskLevel")
    @classmethod
    def validate_risk_level(cls, v: str) -> str:
        """Validate that riskLevel is one of the allowed values.

        Args:
            v: The riskLevel value to validate.

        Returns:
            The validated riskLevel string.

        Raises:
            ValueError: If riskLevel is not LOW, MEDIUM, HIGH, or CRITICAL.
        """
        if v not in VALID_RISK_LEVELS:
            raise ValueError(
                f"Invalid riskLevel: '{v}'. Must be one of {VALID_RISK_LEVELS}"
            )
        return v
