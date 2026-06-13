"""Online inference adapter for the complete FreshChain model wrappers."""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from freshchain_ml_pipeline.models.transfer_priority import TransferPriority


MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/model"))
RISK_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


def shelf_life_risk(days):
    if days <= 1:
        return "CRITICAL"
    if days <= 3:
        return "HIGH"
    if days <= 5:
        return "MEDIUM"
    return "LOW"


def combined_risk_score(output):
    score = min(1.0, max(0.0, number(output.score)))
    bands = {
        "LOW": (0.0, 0.39),
        "MEDIUM": (0.4, 0.59),
        "HIGH": (0.6, 0.79),
        "CRITICAL": (0.8, 1.0),
    }
    lower, upper = bands[output.riskLevel]
    return lower + score * (upper - lower)


def number(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def parse_date(value):
    if not value:
        return None
    timestamp = pd.Timestamp(value)
    return timestamp.tz_localize(None) if timestamp.tzinfo is not None else timestamp


def age_days(start, end):
    start_value = parse_date(start)
    end_value = parse_date(end)
    if start_value is None or end_value is None:
        return 0.0
    return max(0.0, (end_value - start_value).total_seconds() / 86400)


class FreshChainPipeline:
    def __init__(self, model_dir=MODEL_DIR):
        self.model_dir = Path(model_dir)
        metadata_path = self.model_dir / "metadata.json"
        if not metadata_path.exists():
            raise RuntimeError(f"FreshChain model metadata was not found at {metadata_path}")
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.models = {
            name: joblib.load(self.model_dir / f"{name}.joblib")
            for name in self.metadata["models"]
        }
        self.transfer_priority = TransferPriority()

    @property
    def model_names(self):
        return sorted(self.models)

    def _frame(self, model_name, values):
        columns = self.metadata["featureColumns"][model_name]
        mappings = self.metadata.get("categoricalMappings", {}).get(model_name, {})
        row = {}
        for column in columns:
            value = values.get(column)
            if column in mappings:
                row[column] = mappings[column].get(str(value), -1)
            else:
                row[column] = number(value)
        return pd.DataFrame([row])

    def _sensor_history(self, payload):
        readings = payload.get("sensorReadings") or []
        if not readings and payload.get("latestReading"):
            readings = [payload["latestReading"]]
        frame = pd.DataFrame(readings)
        if frame.empty:
            raise ValueError("At least one sensor reading is required")
        frame["measuredAt"] = pd.to_datetime(frame["measuredAt"], errors="coerce")
        frame = frame.dropna(subset=["measuredAt"]).sort_values("measuredAt")
        if frame.empty:
            raise ValueError("Sensor readings require valid measuredAt timestamps")
        for column in ["temperatureC", "humidityPct", "co2Ppm"]:
            values = frame[column] if column in frame else pd.Series(0.0, index=frame.index)
            frame[column] = pd.to_numeric(values, errors="coerce").fillna(0.0)
        door_values = frame["doorOpen"] if "doorOpen" in frame else pd.Series(False, index=frame.index)
        frame["doorOpen"] = door_values.fillna(False).astype(bool)
        return frame

    def _sales_history(self, payload):
        frame = pd.DataFrame(payload.get("sales") or [])
        if frame.empty:
            return frame
        frame["businessDate"] = pd.to_datetime(frame["businessDate"], errors="coerce")
        frame = frame.dropna(subset=["businessDate"]).sort_values("businessDate")
        for column in ["unitsSold", "unitsWasted", "averagePrice"]:
            values = frame[column] if column in frame else pd.Series(0.0, index=frame.index)
            frame[column] = pd.to_numeric(values, errors="coerce").fillna(0.0)
        return frame

    def _sensor_features(self, payload):
        zone = payload.get("zone") or {}
        product = payload.get("product") or {}
        batch = payload.get("batch") or {}
        placement = payload.get("placement") or {}
        readings = self._sensor_history(payload)
        latest = readings.iloc[-1]
        prior = readings.iloc[:-1]
        latest_at = latest["measuredAt"]
        safe_max = number(zone.get("safeTempMaxC"), 4.0)
        baseline = 200.0 if "FREEZER" in str(zone.get("type", "")).upper() else 250.0
        if "AMBIENT" in str(zone.get("type", "")).upper():
            baseline = 310.0

        def prior_mean(column, days):
            start = latest_at - pd.Timedelta(days=days)
            values = prior.loc[prior["measuredAt"] >= start, column]
            return number(values.mean(), number(latest[column]))

        excess = np.maximum(0.0, prior["temperatureC"] - safe_max)
        humidity_exposure = (prior["humidityPct"] > 85).sum()
        co2_exposure = np.maximum(0.0, prior["co2Ppm"] - baseline).sum()
        standard_life = max(1.0, number(product.get("standardShelfLifeDays"), 7.0))
        stock_age = age_days(placement.get("placedAt"), latest_at)

        spoilage = {
            "storeCode": (payload.get("store") or {}).get("storeCode"),
            "zoneCode": zone.get("zoneCode"),
            "sensorId": latest.get("sensorId"),
            "temp_rolling_mean_3d": prior_mean("temperatureC", 3),
            "temp_rolling_mean_7d": prior_mean("temperatureC", 7),
            "humidity_rolling_mean_3d": prior_mean("humidityPct", 3),
            "humidity_rolling_mean_7d": prior_mean("humidityPct", 7),
            "cumulative_temp_exposure": excess.sum(),
            "high_humidity_flag": 1.0 if latest["humidityPct"] > 85 else 0.0,
            "humidity_pct": latest["humidityPct"],
            "excess_temperature": max(0.0, latest["temperatureC"] - safe_max),
            "stock_age_fraction": min(2.0, stock_age / standard_life),
            "co2_excess": max(0.0, latest["co2Ppm"] - baseline),
            "category": product.get("category"),
        }
        shelf_life = {
            "batchId": batch.get("ID"),
            "storeCode": spoilage["storeCode"],
            "zoneCode": spoilage["zoneCode"],
            "cumulative_temp_exposure": excess.sum(),
            "cumulative_humidity_exposure": humidity_exposure,
            "cumulative_co2_exposure": co2_exposure,
            "days_since_production": age_days(batch.get("productionDate"), latest_at),
            "baseShelfLifeDays": standard_life,
            "category": spoilage["category"],
        }

        previous = prior.iloc[-1] if not prior.empty else latest
        trailing = prior.tail(14 * 24)

        def zscore(column):
            std = number(trailing[column].std())
            return 0.0 if std == 0 else (number(latest[column]) - number(trailing[column].mean())) / std

        anomaly = {
            "storeCode": spoilage["storeCode"],
            "zoneCode": spoilage["zoneCode"],
            "sensorId": spoilage["sensorId"],
            "temp_rate_of_change": latest["temperatureC"] - previous["temperatureC"],
            "humidity_rate_of_change": latest["humidityPct"] - previous["humidityPct"],
            "co2_rate_of_change": latest["co2Ppm"] - previous["co2Ppm"],
            "temp_zscore": zscore("temperatureC"),
            "humidity_zscore": zscore("humidityPct"),
            "co2_zscore": zscore("co2Ppm"),
            "door_open_freq_24h": prior.loc[prior["measuredAt"] >= latest_at - pd.Timedelta(hours=24), "doorOpen"].sum(),
            "door_open_duration_24h": prior.loc[prior["measuredAt"] >= latest_at - pd.Timedelta(hours=24), "doorOpen"].sum(),
            "temp_rolling_std_6h": number(prior.loc[prior["measuredAt"] >= latest_at - pd.Timedelta(hours=6), "temperatureC"].std()),
            "humidity_rolling_std_6h": number(prior.loc[prior["measuredAt"] >= latest_at - pd.Timedelta(hours=6), "humidityPct"].std()),
            "temp_deviation_from_target": latest["temperatureC"] - safe_max,
        }
        return spoilage, shelf_life, anomaly

    def _demand_features(self, payload):
        store = payload.get("store") or {}
        product = payload.get("product") or {}
        sales = self._sales_history(payload)
        today = sales.iloc[-1]["businessDate"] if not sales.empty else pd.Timestamp.now(tz=timezone.utc).normalize()
        units = sales["unitsSold"] if not sales.empty else pd.Series(dtype=float)

        def lag(days):
            return number(units.iloc[-days]) if len(units) >= days else 0.0

        prior = units.iloc[:-1].tail(7)
        day = today.dayofweek
        month = today.month - 1
        values = {
            "storeCode": store.get("storeCode"),
            "sku": product.get("sku"),
            "day_of_week_sin": math.sin(2 * math.pi * day / 7),
            "day_of_week_cos": math.cos(2 * math.pi * day / 7),
            "month_of_year_sin": math.sin(2 * math.pi * month / 12),
            "month_of_year_cos": math.cos(2 * math.pi * month / 12),
            "sales_lag_1": lag(2),
            "sales_lag_7": lag(8),
            "sales_lag_14": lag(15),
            "rolling_mean_7": number(prior.mean()),
            "rolling_std_7": number(prior.std()),
            "rolling_min_7": number(prior.min()),
            "rolling_max_7": number(prior.max()),
            "demand_trend": number(prior.tail(3).mean()) - number(prior.head(3).mean()),
            "averagePrice": number(sales.iloc[-1]["averagePrice"]) if not sales.empty else 0.0,
            "category": product.get("category"),
            "unitsSold": number(units.iloc[-1]) if not units.empty else 0.0,
            "mean_sell_through": 0.5,
        }
        return values

    def predict(self, payload):
        spoilage_values, shelf_values, anomaly_values = self._sensor_features(payload)
        demand_values = self._demand_features(payload)
        batch = payload.get("batch") or {}
        product = payload.get("product") or {}
        latest_at = self._sensor_history(payload).iloc[-1]["measuredAt"]
        standard_life = max(1.0, number(product.get("standardShelfLifeDays"), 7.0))

        outputs = {}
        for name, values in [
            ("spoilage_classifier", spoilage_values),
            ("shelf_life_estimator", shelf_values),
            ("demand_forecaster", demand_values),
            ("anomaly_detector", anomaly_values),
            ("replenishment_model", demand_values),
        ]:
            model = self.models[name]
            outputs[name] = model.to_prediction_output(model.predict(self._frame(name, values)))[0]

        priorities = self.transfer_priority.compute_priority(
            [outputs["spoilage_classifier"]],
            [outputs["shelf_life_estimator"]],
            [outputs["demand_forecaster"]],
            [outputs["anomaly_detector"]],
            [outputs["replenishment_model"]],
        )
        anomaly = outputs["anomaly_detector"]
        demand = outputs["demand_forecaster"]
        replenishment = outputs["replenishment_model"]
        shelf = outputs["shelf_life_estimator"]
        contractual_remaining = max(
            0.0,
            standard_life - age_days(batch.get("productionDate"), latest_at),
        )
        expiry_date = batch.get("bestBeforeDate") or batch.get("expiryDate")
        if expiry_date:
            contractual_remaining = min(
                contractual_remaining,
                max(0.0, age_days(latest_at, expiry_date)),
            )
        remaining_shelf_life = min(
            max(0.0, shelf.remainingShelfLifeDays),
            contractual_remaining,
        )
        shelf.remainingShelfLifeDays = remaining_shelf_life
        shelf.riskLevel = shelf_life_risk(remaining_shelf_life)
        shelf.score = min(1.0, max(0.0, 1.0 - remaining_shelf_life / 30.0))
        shelf.recommendedAction = (
            f"Estimated remaining shelf life: {remaining_shelf_life:.1f} days. "
            f"{'Urgent: remove from shelf.' if remaining_shelf_life <= 1 else 'Monitor closely.' if remaining_shelf_life <= 3 else 'Within acceptable range.'}"
        )

        safety_outputs = [
            outputs["spoilage_classifier"],
            shelf,
            anomaly,
        ]
        overall = max(
            safety_outputs,
            key=lambda item: (RISK_RANK[item.riskLevel], item.score),
        )
        score = combined_risk_score(overall)
        confidence = sum(item.confidence for item in outputs.values()) / len(outputs)
        anomaly_type = anomaly.anomalyType if anomaly.anomalyType != "N/A" else "NORMAL"

        return {
            "predictionType": "FRESHCHAIN_PIPELINE",
            "riskLevel": overall.riskLevel,
            "score": round(score, 4),
            "confidence": round(confidence, 4),
            "anomalyType": anomaly_type,
            "remainingShelfLifeDays": round(remaining_shelf_life, 2),
            "demandUnitsForecast": round(demand.demandUnitsForecast, 3),
            "replenishmentUnits": round(replenishment.replenishmentUnits, 3),
            "routePriority": priorities[0] if priorities else 5,
            "recommendedAction": overall.recommendedAction or "Continue monitoring.",
            "businessImpact": {
                "expectedWasteAvoidedUnits": 4 if overall.riskLevel in ("HIGH", "CRITICAL") else 1,
                "expectedLostSalesAvoidedUnits": 3 if replenishment.replenishmentUnits > 0 else 0,
            },
        }
