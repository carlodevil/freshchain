"""Explainer module for translating model predictions into business-interpretable narratives.

Provides feature importance computation, natural-language narrative generation,
high-wastage flagging, and visualisation utilities.
"""

from freshchain_ml_pipeline.explainer.explainer import Explainer
from freshchain_ml_pipeline.explainer.visualisation import (
    generate_importance_chart,
    generate_pdp_chart,
)

__all__ = ["Explainer", "generate_importance_chart", "generate_pdp_chart"]
