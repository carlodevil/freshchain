"""Transfer Priority ranking system for the FreshChain ML Pipeline.

Computes routePriority (integer 1-10, where 1 = highest priority) based on
combined signals from all other models:
- Spoilage risk score (higher → HIGHER priority, needs urgent transfer before unsalvageable)
- Shelf-life remaining (lower → higher priority, needs to move fast)
- Demand forecast (higher → higher priority, store needs stock)
- Anomaly detection (if sensor fault → higher priority for investigation)
- Replenishment need (higher → higher priority)

This is a rule-based scoring system, not a trained ML model.

Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
"""

import logging
from typing import List, Optional

import numpy as np

from freshchain_ml_pipeline.schema.prediction_output import PredictionOutput

logger = logging.getLogger("freshchain_ml_pipeline")


class TransferPriority:
    """Rule-based transfer priority scoring system.

    Computes a priority score for each item based on combined signals
    from spoilage, shelf-life, demand, anomaly, and replenishment models.
    Priority is an integer from 1 (highest) to 10 (lowest).

    Scoring logic (Requirement 6.5):
    - Items closer to spoilage or expiry receive higher priority (lower number)
    - Items with high demand at the destination receive higher priority
    - Anomaly-flagged items receive higher priority for investigation
    - High spoilage risk INCREASES priority (lower number) — these items
      need urgent transfer to discount outlets or food banks BEFORE they
      become unsalvageable (Requirement 6.3, 6.4)

    Priority ranges (Requirements 6.1, 6.2):
    - Shelf life ≤ 1 day → priority 1 or 2 (highest urgency)
    - Shelf life ≤ 3 days → priority 1 to 4 (high urgency)
    - Output always integer in range 1-10 (Requirement 6.6)

    Tie-breaking (Requirement 6.7):
    - When two items have equal shelf-life urgency, higher spoilage risk
      gets higher priority (lower number).

    This is NOT a trained ML model — it uses deterministic rules to
    combine signals from other models into a single priority ranking.
    """

    def compute_priority(
        self,
        spoilage_preds: Optional[List[PredictionOutput]] = None,
        shelf_life_preds: Optional[List[PredictionOutput]] = None,
        demand_preds: Optional[List[PredictionOutput]] = None,
        anomaly_preds: Optional[List[PredictionOutput]] = None,
        replenishment_preds: Optional[List[PredictionOutput]] = None,
    ) -> list[int]:
        """Compute transfer priority scores based on combined model signals.

        Revised priority scoring logic (Requirements 6.1-6.7):
        - Start with base score of 5
        - shelf_life <= 1 day: +4 (urgent transfer needed) → priority 1-2
        - shelf_life <= 3 days: +2 → priority 1-4
        - demand_forecast > mean: +1
        - anomaly detected: +1 (needs investigation/equipment transfer)
        - spoilage risk HIGH/CRITICAL: +3 (INCREASES priority for urgent transfer)
        - replenishment_units > 0: +1
        - Clip final score to 1-10 range, invert so 1 = highest priority

        Parameters
        ----------
        spoilage_preds : list of PredictionOutput or None
            Predictions from the spoilage classifier.
        shelf_life_preds : list of PredictionOutput or None
            Predictions from the shelf-life estimator.
        demand_preds : list of PredictionOutput or None
            Predictions from the demand forecaster.
        anomaly_preds : list of PredictionOutput or None
            Predictions from the anomaly detector.
        replenishment_preds : list of PredictionOutput or None
            Predictions from the replenishment model.

        Returns
        -------
        list of int
            Priority scores (1-10, where 1 = highest priority).
            Length equals the maximum prediction list length.
        """
        # Determine the number of items to score
        lengths = []
        if spoilage_preds:
            lengths.append(len(spoilage_preds))
        if shelf_life_preds:
            lengths.append(len(shelf_life_preds))
        if demand_preds:
            lengths.append(len(demand_preds))
        if anomaly_preds:
            lengths.append(len(anomaly_preds))
        if replenishment_preds:
            lengths.append(len(replenishment_preds))

        if not lengths:
            return []

        n_items = max(lengths)

        # Compute mean demand for relative comparison
        mean_demand = 0.0
        if demand_preds:
            demands = [p.demandUnitsForecast for p in demand_preds if p.demandUnitsForecast > 0]
            if demands:
                mean_demand = np.mean(demands)

        priorities = []
        for i in range(n_items):
            score = 5  # Base score

            # Shelf-life signal (Requirements 6.1, 6.2)
            if shelf_life_preds and i < len(shelf_life_preds):
                days = shelf_life_preds[i].remainingShelfLifeDays
                if 0 <= days <= 1:
                    score += 4  # Urgent transfer needed → priority 1-2
                elif 0 <= days <= 3:
                    score += 2  # High urgency → priority 1-4

            # Demand signal (Requirement 6.5)
            if demand_preds and i < len(demand_preds):
                demand = demand_preds[i].demandUnitsForecast
                if demand > mean_demand and mean_demand > 0:
                    score += 1

            # Anomaly signal (Requirement 6.5)
            if anomaly_preds and i < len(anomaly_preds):
                if anomaly_preds[i].anomalyType != "N/A":
                    score += 2  # Sensor fault needs investigation/equipment transfer
                if anomaly_preds[i].riskLevel in ("HIGH", "CRITICAL"):
                    score += 2  # Critical/high sensor reading increases priority

            # Spoilage signal — HIGH/CRITICAL risk INCREASES priority
            # (Requirements 6.3, 6.4: high-risk items need urgent transfer
            # to discount outlets or food banks before they become unsalvageable)
            if spoilage_preds and i < len(spoilage_preds):
                if spoilage_preds[i].riskLevel in ("HIGH", "CRITICAL"):
                    score += 3  # Increases priority (lower number after inversion)

            # Replenishment signal
            if replenishment_preds and i < len(replenishment_preds):
                if replenishment_preds[i].replenishmentUnits > 0:
                    score += 1

            # Clip to 1-10 range and invert (higher raw score = lower priority number = higher priority)
            clipped_score = int(np.clip(score, 1, 10))
            # Invert: raw 10 → priority 1, raw 1 → priority 10
            priority = 11 - clipped_score

            # Ensure output is always integer in range 1-10 (Requirement 6.6)
            priority = int(np.clip(priority, 1, 10))
            priorities.append(priority)

        logger.info(
            "Transfer priority computed for %d items. "
            "Priority distribution: min=%d, max=%d, mean=%.1f",
            len(priorities),
            min(priorities) if priorities else 0,
            max(priorities) if priorities else 0,
            np.mean(priorities) if priorities else 0,
        )

        return priorities
