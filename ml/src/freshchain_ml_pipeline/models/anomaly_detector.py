"""Anomaly Detector model for the FreshChain ML Pipeline.

Uses a two-stage approach:
1. Rule-based detection for obvious anomalies (spikes, stuck values)
2. Gradient-boosted tree classifier trained on labelled normal/anomaly data

Since we have synthetic ground truth labels (is_anomaly from the anomaly
injector), we train a gradient-boosted classifier. This gives much
better detection than unsupervised methods because the model learns the
actual decision boundary between normal and anomalous readings, and
scales much better than SVM for larger datasets.

Requirements: 10.1, 10.2, 10.3, 10.6, 16.6
"""

import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.models import BaseModel
from freshchain_ml_pipeline.schema.prediction_output import (
    PREDICTION_TYPE_ANOMALY,
    SENTINEL_NUMERIC,
    SENTINEL_STRING,
    PredictionOutput,
)

logger = logging.getLogger("freshchain_ml_pipeline")

# --- Rule-based thresholds ---
_SPIKE_THRESHOLD_TEMP_ROC = 5.5
_SPIKE_THRESHOLD_HUMIDITY_ROC = 16.0
_SPIKE_THRESHOLD_CO2_ROC = 110.0
_ZSCORE_THRESHOLD = 3.2


class AnomalyDetector(BaseModel):
    """Two-stage anomaly detector: rule-based + gradient-boosted classifier.

    Stage 1 (rules): Catches obvious anomalies via threshold checks on
    rate-of-change and z-score features. Thresholds are tuned tighter
    than the original to improve recall on subtle anomalies.

    Stage 2 (GBM): A gradient-boosted classifier trained on labelled
    data (normal=0, anomaly=1) with balanced sample weights to handle
    the imbalanced classes. Provides calibrated probability estimates
    and scales linearly with dataset size.

    Final prediction: OR of both stages (anomaly if either flags it).

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling model training parameters.
    """

    def __init__(self, config: PipelineConfig) -> None:
        super().__init__(config)
        self.model = GradientBoostingClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=10,
            max_features=0.8,
            random_state=config.random_seed,
        )
        self.scaler = StandardScaler()
        self._is_trained = False
        self._feature_cols = None
        self._has_labels = False
        self._optimal_threshold = 0.5

    def train(self, X: pd.DataFrame, y: pd.Series = None) -> None:
        """Train the anomaly detector.

        If y (ground truth labels) is provided, trains a gradient-boosted
        classifier on the labelled data with sample weights to handle
        class imbalance. If y is None, falls back to rule-based only.

        After training, calibrates a decision threshold to optimize F1
        on the training data.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix with sensor features and derived metrics.
        y : pd.Series, optional
            Ground truth labels (0=normal, 1=anomaly).
        """
        logger.info("Training AnomalyDetector on %d samples", len(X))

        # Drop time/datetime columns if present
        feature_cols = [
            c for c in X.columns
            if c not in ("timestamp", "measuredAt") and not pd.api.types.is_datetime64_any_dtype(X[c])
        ]
        self._feature_cols = feature_cols
        X_features = X[feature_cols].values.astype(np.float64)
        X_features = np.nan_to_num(X_features, nan=0.0, posinf=0.0, neginf=0.0)

        # Scale features
        self.scaler.fit(X_features)
        X_scaled = self.scaler.transform(X_features)

        if y is not None and len(y) == len(X_features):
            y_arr = np.asarray(y).flatten().astype(int)

            # Check we have both classes
            unique_classes = np.unique(y_arr)
            if len(unique_classes) >= 2:
                # Compute sample weights for class imbalance
                n_pos = (y_arr == 1).sum()
                n_neg = (y_arr == 0).sum()
                weight_pos = n_neg / max(n_pos, 1)
                sample_weights = np.where(y_arr == 1, weight_pos, 1.0)

                logger.info(
                    "Training GBM classifier on %d samples (pos=%d, neg=%d, weight_pos=%.2f)",
                    len(y_arr),
                    n_pos,
                    n_neg,
                    weight_pos,
                )
                self.model.fit(X_scaled, y_arr, sample_weight=sample_weights)
                self._has_labels = True

                # Calibrate decision threshold to maximize F1
                self._calibrate_threshold(X_scaled, y_arr)
            else:
                logger.warning(
                    "Only one class present in labels; falling back to rule-based only"
                )
                self._has_labels = False
        else:
            logger.info("No labels provided; using rule-based detection only")
            self._has_labels = False

        self._is_trained = True
        logger.info("AnomalyDetector training complete (GBM=%s)", self._has_labels)

    def _calibrate_threshold(self, X_scaled: np.ndarray, y_true: np.ndarray) -> None:
        """Find the optimal probability threshold that maximizes F1 score.

        Searches across a fine grid of thresholds and picks the one
        that maximizes F1 on the anomaly class (pos_label=1).

        Parameters
        ----------
        X_scaled : np.ndarray
            Scaled feature matrix used during training.
        y_true : np.ndarray
            Ground truth labels.
        """
        from sklearn.metrics import f1_score

        proba = self.model.predict_proba(X_scaled)[:, 1]
        best_f1 = 0.0
        best_threshold = 0.5

        for threshold in np.arange(0.1, 0.95, 0.02):
            y_pred = (proba >= threshold).astype(int)
            f1 = f1_score(y_true, y_pred, pos_label=1, zero_division=0.0)
            if f1 > best_f1:
                best_f1 = f1
                best_threshold = threshold

        self._optimal_threshold = best_threshold
        logger.info(
            "Calibrated anomaly threshold=%.2f (training F1=%.4f)",
            best_threshold,
            best_f1,
        )

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Generate anomaly predictions combining rules and gradient-boosted classifier.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix for prediction.

        Returns
        -------
        pd.DataFrame
            DataFrame with columns:
            - anomaly_flag: "anomaly" or "normal"
            - anomaly_score: numeric score in [0, 1], higher = more anomalous
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before calling predict()")

        # Use the same feature columns that were used during training
        feature_cols = self._feature_cols if self._feature_cols else [
            c for c in X.columns
            if c not in ("timestamp", "measuredAt") and not pd.api.types.is_datetime64_any_dtype(X[c])
        ]
        # Only use columns that exist in X
        feature_cols = [c for c in feature_cols if c in X.columns]
        X_features = X[feature_cols].copy()
        n_samples = len(X_features)

        # --- Stage 1: Rule-based detection ---
        rule_flags = self._apply_rules(X_features)
        rule_scores = self._compute_rule_scores(X_features)

        # --- Stage 2: Gradient-boosted classifier ---
        if self._has_labels:
            X_arr = X_features.values.astype(np.float64)
            X_arr = np.nan_to_num(X_arr, nan=0.0, posinf=0.0, neginf=0.0)
            X_scaled = self.scaler.transform(X_arr)

            # Use calibrated threshold for classification
            gbm_proba = self.model.predict_proba(X_scaled)[:, 1]
            gbm_flags = gbm_proba >= self._optimal_threshold
        else:
            gbm_flags = np.zeros(n_samples, dtype=bool)
            gbm_proba = np.zeros(n_samples)

        # --- Combine: Strategy depends on whether we have a trained model ---
        if self._has_labels:
            # When GBM is available, it subsumes the rule-based detection since it
            # was trained on the same features (z-scores, rate-of-change) that rules check.
            # Using the GBM alone provides much better precision with minimal recall loss.
            combined_flags = gbm_flags
        else:
            # Without a trained model, rely entirely on rules
            combined_flags = rule_flags

        # --- Final score: weighted combination of rule score and GBM probability ---
        # GBM probability is more calibrated, so give it higher weight
        final_scores = np.where(
            self._has_labels,
            np.maximum(rule_scores, gbm_proba * 0.9 + rule_scores * 0.1),
            rule_scores,
        )

        anomaly_flags = np.where(combined_flags, "anomaly", "normal")

        return pd.DataFrame(
            {
                "anomaly_flag": anomaly_flags,
                "anomaly_score": np.clip(final_scores, 0.0, 1.0),
            }
        )

    def _apply_rules(self, X: pd.DataFrame) -> np.ndarray:
        """Apply rule-based anomaly detection."""
        n = len(X)
        flags = np.zeros(n, dtype=bool)

        if "temp_rate_of_change" in X.columns:
            flags |= (X["temp_rate_of_change"].abs() > _SPIKE_THRESHOLD_TEMP_ROC).values
        if "humidity_rate_of_change" in X.columns:
            flags |= (X["humidity_rate_of_change"].abs() > _SPIKE_THRESHOLD_HUMIDITY_ROC).values
        if "co2_rate_of_change" in X.columns:
            flags |= (X["co2_rate_of_change"].abs() > _SPIKE_THRESHOLD_CO2_ROC).values
        if "temp_zscore" in X.columns:
            flags |= (X["temp_zscore"].abs() > _ZSCORE_THRESHOLD).values
        if "humidity_zscore" in X.columns:
            flags |= (X["humidity_zscore"].abs() > _ZSCORE_THRESHOLD).values
        if "co2_zscore" in X.columns:
            flags |= (X["co2_zscore"].abs() > _ZSCORE_THRESHOLD).values

        return flags

    def _compute_rule_scores(self, X: pd.DataFrame) -> np.ndarray:
        """Compute continuous anomaly score from rule-based features.

        Uses a sigmoid-like normalization for smoother score distribution
        and better calibration with the GBM probability scores.
        """
        n = len(X)
        scores = np.zeros(n)

        if "temp_rate_of_change" in X.columns:
            # Normalize: score approaches 1.0 as ROC approaches/exceeds threshold
            normalized = X["temp_rate_of_change"].abs().values / _SPIKE_THRESHOLD_TEMP_ROC
            scores = np.maximum(scores, np.clip(normalized, 0, 1))
        if "humidity_rate_of_change" in X.columns:
            normalized = X["humidity_rate_of_change"].abs().values / _SPIKE_THRESHOLD_HUMIDITY_ROC
            scores = np.maximum(scores, np.clip(normalized, 0, 1))
        if "co2_rate_of_change" in X.columns:
            normalized = X["co2_rate_of_change"].abs().values / _SPIKE_THRESHOLD_CO2_ROC
            scores = np.maximum(scores, np.clip(normalized, 0, 1))
        if "temp_zscore" in X.columns:
            normalized = X["temp_zscore"].abs().values / _ZSCORE_THRESHOLD
            scores = np.maximum(scores, np.clip(normalized, 0, 1))
        if "humidity_zscore" in X.columns:
            normalized = X["humidity_zscore"].abs().values / _ZSCORE_THRESHOLD
            scores = np.maximum(scores, np.clip(normalized, 0, 1))
        if "co2_zscore" in X.columns:
            normalized = X["co2_zscore"].abs().values / _ZSCORE_THRESHOLD
            scores = np.maximum(scores, np.clip(normalized, 0, 1))

        return scores

    def to_prediction_output(
        self, raw_predictions: pd.DataFrame
    ) -> list[PredictionOutput]:
        """Convert raw predictions to PredictionOutput schema."""
        outputs = []
        for _, row in raw_predictions.iterrows():
            score = float(row["anomaly_score"])
            flag = str(row["anomaly_flag"])
            risk_level = self._score_to_risk_level(score)

            # Anomaly type is SENSOR_FAULT if explicitly flagged OR if risk
            # level is HIGH/CRITICAL (ensures consistency between riskLevel
            # and anomalyType — a CRITICAL reading should never show "N/A")
            if flag == "anomaly" or risk_level in ("HIGH", "CRITICAL"):
                anomaly_type = "SENSOR_FAULT"
                status_desc = "anomaly"
            else:
                anomaly_type = SENTINEL_STRING
                status_desc = "normal"

            output = PredictionOutput(
                predictionType=PREDICTION_TYPE_ANOMALY,
                riskLevel=risk_level,
                score=score,
                confidence=min(1.0, abs(score - 0.5) * 2),
                anomalyType=anomaly_type,
                remainingShelfLifeDays=SENTINEL_NUMERIC,
                demandUnitsForecast=SENTINEL_NUMERIC,
                replenishmentUnits=SENTINEL_NUMERIC,
                recommendedAction=(
                    f"Sensor status: {status_desc}. "
                    f"{'Investigate sensor immediately.' if status_desc == 'anomaly' else 'Normal operation.'}"
                ),
            )
            outputs.append(output)

        return outputs

    @staticmethod
    def _score_to_risk_level(score: float) -> str:
        """Map anomaly score to risk level."""
        if score >= 0.9:
            return "CRITICAL"
        elif score >= 0.7:
            return "HIGH"
        elif score >= 0.5:
            return "MEDIUM"
        else:
            return "LOW"
