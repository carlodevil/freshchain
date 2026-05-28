def _number(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _risk(score):
    if score >= 0.85:
        return "CRITICAL"
    if score >= 0.65:
        return "HIGH"
    if score >= 0.38:
        return "MEDIUM"
    return "LOW"


def _recommendation(anomaly_type, replenishment_units, route_priority):
    if anomaly_type == "COMPRESSOR_FAILURE":
        return "Move exposed stock immediately, raise maintenance, and run batch quality inspection."
    if anomaly_type == "DOOR_LEFT_OPEN":
        return "Close the case, verify recovery time, and mark exposed batches for quality review."
    if anomaly_type == "TEMPERATURE_EXCURSION":
        return "Prioritize markdown or rotation for affected batches and inspect airflow."
    if anomaly_type == "STALE_SENSOR":
        return "Replace or reconnect the stale sensor before relying on automated replenishment decisions."
    if anomaly_type == "DEMAND_SPIKE":
        return f"Increase near-term replenishment by {round(replenishment_units)} units and monitor availability."
    if anomaly_type == "WASTE_RISK":
        return "Reduce replenishment, rotate short-life stock forward, and prioritize markdown."
    if replenishment_units > 10:
        return f"Replenish {round(replenishment_units)} units and keep transfer priority {route_priority}."
    return "Maintain standard replenishment and continue monitoring."


def predict(features):
    zone = features.get("zone") or {}
    reading = features.get("latestReading") or {}
    aggregate = features.get("aggregate") or {}
    product = features.get("product") or {}
    sales = features.get("sales") or []
    scenario = reading.get("scenarioCode") or "NORMAL"

    temp = _number(reading.get("temperatureC"), _number(zone.get("safeTempMaxC")))
    temp_max = _number(zone.get("safeTempMaxC"))
    temp_min = _number(zone.get("safeTempMinC"))
    temp_excursion = max(0.0, temp - temp_max, temp_min - temp)
    door_open_seconds = _number(aggregate.get("doorOpenSeconds"))
    co2_slope = max(0.0, _number(aggregate.get("co2Slope")))
    oxygen_drop = max(0.0, _number(aggregate.get("oxygenDrop")))
    excursion_minutes = _number(aggregate.get("excursionMinutes"))
    base_shelf_life = _number(product.get("standardShelfLifeDays"), 5.0)

    if sales:
        daily_sales = sum(_number(row.get("unitsSold")) for row in sales) / len(sales)
        sold_total = max(1.0, sum(_number(row.get("unitsSold")) for row in sales))
        waste_rate = sum(_number(row.get("unitsWasted")) for row in sales) / sold_total
    else:
        daily_sales = max(4.0, base_shelf_life * 1.5)
        waste_rate = 0.04

    score = min(
        0.99,
        0.08
        + temp_excursion * 0.16
        + min(0.22, door_open_seconds / 1200)
        + min(0.16, co2_slope / 1000)
        + min(0.13, oxygen_drop / 3)
        + min(0.18, excursion_minutes / 10)
        + min(0.12, waste_rate * 2),
    )
    demand_units = max(1.0, daily_sales * (0.92 if score > 0.65 else 1.05))
    replenishment_units = max(0.0, round(demand_units * 3 - max(0.0, base_shelf_life - score * 4)))
    remaining_shelf_life = max(0.2, base_shelf_life - temp_excursion * 1.4 - door_open_seconds / 900 - excursion_minutes * 0.45)
    route_priority = 1 if score > 0.75 else 2 if score > 0.5 else 4

    if scenario == "COMPRESSOR_FAILURE" or temp_excursion > 4:
        anomaly_type = "COMPRESSOR_FAILURE"
    elif scenario == "STALE_SENSOR":
        anomaly_type = "STALE_SENSOR"
    elif scenario == "DEMAND_SPIKE":
        anomaly_type = "DEMAND_SPIKE"
    elif scenario == "WASTE_RISK":
        anomaly_type = "WASTE_RISK"
    elif door_open_seconds >= 180 or scenario == "DOOR_LEFT_OPEN":
        anomaly_type = "DOOR_LEFT_OPEN"
    elif temp_excursion > 0:
        anomaly_type = "TEMPERATURE_EXCURSION"
    elif score > 0.45:
        anomaly_type = "DEMAND_WASTE_IMBALANCE"
    else:
        anomaly_type = "NORMAL"

    action = _recommendation(anomaly_type, replenishment_units, route_priority)
    return {
        "predictionType": "REAL_TIME_INTELLIGENCE",
        "riskLevel": _risk(score),
        "score": round(score, 3),
        "confidence": 0.9 if sales else 0.78,
        "anomalyType": anomaly_type,
        "remainingShelfLifeDays": round(remaining_shelf_life, 2),
        "demandUnitsForecast": round(demand_units, 3),
        "replenishmentUnits": replenishment_units,
        "routePriority": route_priority,
        "recommendedAction": action,
        "businessImpact": {
            "forecastUnits": round(demand_units, 1),
            "replenishmentUnits": replenishment_units,
            "expectedWasteAvoidedUnits": 4 if score > 0.65 else 1,
            "expectedLostSalesAvoidedUnits": 3 if replenishment_units > 0 else 0,
        },
    }
