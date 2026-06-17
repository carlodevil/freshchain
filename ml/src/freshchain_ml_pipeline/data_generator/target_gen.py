"""Target label generator for the FreshChain ML Pipeline.

Generates causally-plausible target labels for supervised models based on
actual environmental conditions and product characteristics. Produces:
- Spoilage target (is_spoiled: binary) via logistic model
- Shelf-life target (days_remaining: float >= 0) via degradation model

The wastage target (unitsWasted) and demand target (unitsSold) already
exist in sales_observations. The anomaly target (_anomaly_injected) already
exists in sensor_readings after anomaly injection.
"""

import logging
from datetime import datetime

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")

# --- Spoilage model parameters ---
# The spoilage model uses per-reading independent probability.
# Each reading has a small chance of representing a spoiled item,
# driven by instantaneous environmental conditions.
# Target overall rate: 3-5%
_SPOILAGE_BASE_RATE = 0.02  # 2% base rate before environmental factors
_SPOILAGE_TEMP_MULTIPLIER = 5.0  # excess temp multiplies spoilage chance
_SPOILAGE_HUMIDITY_MULTIPLIER = 3.0  # high humidity multiplies spoilage chance
_SPOILAGE_AGE_MULTIPLIER = 4.0  # old stock multiplies spoilage chance

# High-risk categories get a bonus to spoilage probability
_HIGH_RISK_CATEGORIES = {"produce", "poultry", "ready_made_salad"}
_HIGH_RISK_MULTIPLIER = 2.0  # 2x base rate for high-risk categories

# --- Shelf-life degradation parameters ---
# Zone-type-specific degree-hours of excess temperature per day of shelf-life lost
# Values calibrated so that typical environmental deviations produce a realistic
# spread of days_remaining across the full range (0-30 days), preventing the
# training data from being dominated by near-zero values.
_EXPOSURE_PER_DAY_LOSS = {
    "ambient": 8000.0,
    "chiller": 1200.0,
    "freezer": 900.0,
}

# Per-product resilience factors: multiplier on effective exposure thresholds
# Higher = more resilient (degrades slower), Lower = more delicate (degrades faster)
# Factors raised to prevent rapid degradation that skews training data toward zero.
_PRODUCT_RESILIENCE = {
    "poultry": 2.0,
    "produce": 2.5,
    "ready_made_salad": 2.5,
    "dairy": 3.5,
    "meat": 3.5,
    "cooked_starch": 5.0,
    "root_vegetable": 5.0,
}

# Hours of high humidity (>85%) per day of shelf-life lost
_HUMIDITY_HOURS_PER_DAY_LOSS = 3200.0  # conservative to avoid over-degradation

# --- CO2 parameters (from ZONE_DISTRIBUTIONS in sensor_gen.py) ---
_ZONE_CO2_PARAMS = {
    "ambient": {"mean": 310.0, "std": 80.0},
    "chiller": {"mean": 250.0, "std": 50.0},
    "freezer": {"mean": 200.0, "std": 30.0},
}

# CO2 degradation: ppm-hours of excess CO2 per day of shelf-life lost
_CO2_PER_DAY_LOSS = 40000.0


def _sigmoid(x: np.ndarray) -> np.ndarray:
    """Numerically stable sigmoid function."""
    return np.where(
        x >= 0,
        1.0 / (1.0 + np.exp(-x)),
        np.exp(x) / (1.0 + np.exp(x)),
    )


def _extract_zone_type_from_code(zone_code: str) -> str:
    """Extract zone type from zone code string.

    Parameters
    ----------
    zone_code : str
        Zone code like 'STORE-001-CHILLER'.

    Returns
    -------
    str
        Zone type in lowercase (chiller, ambient, freezer).
    """
    upper = zone_code.upper()
    if "CHILLER" in upper:
        return "chiller"
    elif "FREEZER" in upper:
        return "freezer"
    else:
        return "ambient"


def generate_targets(
    config,
    sensor_readings_df: pd.DataFrame,
    sales_observations_df: pd.DataFrame,
    inventory_placements_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    products_df: pd.DataFrame,
    zones_df: pd.DataFrame,
    rng: np.random.Generator,
) -> dict:
    """Generate target labels for spoilage and shelf-life models.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration.
    sensor_readings_df : pd.DataFrame
        Sensor readings (post anomaly injection).
    sales_observations_df : pd.DataFrame
        Sales observations (contains unitsSold, unitsWasted).
    inventory_placements_df : pd.DataFrame
        Inventory placements with batchId, storeCode, zoneCode, placedAt.
    batches_df : pd.DataFrame
        Batch metadata with batchId, sku, productionDate, expiryDate.
    products_df : pd.DataFrame
        Product metadata with sku, category, baseShelfLifeDays.
    zones_df : pd.DataFrame
        Zone metadata with zoneCode, targetTemperatureC.
    rng : np.random.Generator
        NumPy random generator for reproducibility.

    Returns
    -------
    dict
        Dictionary with keys:
        - "spoilage_targets": pd.DataFrame with columns
          [storeCode, zoneCode, sensorId, measuredAt, is_spoiled]
        - "shelf_life_targets": pd.DataFrame with columns
          [batchId, storeCode, zoneCode, measuredAt, days_remaining]
    """
    # Task 3.1: Compute shelf-life FIRST so we can cross-correlate into spoilage
    shelf_life_targets = _generate_shelf_life_targets(
        sensor_readings_df, inventory_placements_df, batches_df,
        products_df, zones_df,
    )

    # Pass shelf_life_targets into spoilage for cross-correlation
    spoilage_targets = _generate_spoilage_targets(
        sensor_readings_df, inventory_placements_df, batches_df,
        products_df, zones_df, rng, shelf_life_df=shelf_life_targets,
    )

    logger.info(
        "Target generation complete: spoilage=%d rows (%.1f%% positive), "
        "shelf_life=%d rows",
        len(spoilage_targets),
        100.0 * spoilage_targets["is_spoiled"].mean() if len(spoilage_targets) > 0 else 0.0,
        len(shelf_life_targets),
    )

    return {
        "spoilage_targets": spoilage_targets,
        "shelf_life_targets": shelf_life_targets,
    }


def _generate_spoilage_targets(
    sensor_readings_df: pd.DataFrame,
    inventory_placements_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    products_df: pd.DataFrame,
    zones_df: pd.DataFrame,
    rng: np.random.Generator,
    shelf_life_df: pd.DataFrame = None,
) -> pd.DataFrame:
    """Generate binary spoilage targets using per-reading independent probability.

    Each reading has an independent probability of representing a spoiled item,
    driven by instantaneous environmental conditions:
    - Higher excess temperature → higher spoilage probability
    - High humidity (>85%) → higher spoilage probability
    - Older stock (age > 70% of shelf life) → higher spoilage probability
    - High-risk categories (produce, poultry, ready_made_salad) → 2x base rate
    - Elevated CO2 → higher spoilage probability (Task 3.4)
    - Cumulative temperature exposure → higher spoilage probability (Task 3.5)
    - Low shelf-life remaining → boosted spoilage probability (Task 3.6)

    Overall target: ~3-5% of readings are spoiled.
    """
    if sensor_readings_df.empty:
        return pd.DataFrame(
            columns=["storeCode", "zoneCode", "sensorId", "measuredAt", "is_spoiled"]
        )

    readings = sensor_readings_df.copy()
    readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])
    readings = readings.sort_values(["storeCode", "zoneCode", "measuredAt"]).reset_index(drop=True)

    # Merge zone target temperature
    zone_targets = zones_df[["zoneCode", "targetTemperatureC"]].drop_duplicates()
    readings = readings.merge(zone_targets, on="zoneCode", how="left")

    # Compute instantaneous excess temperature (how far above target)
    readings["excess_temp"] = np.maximum(
        0.0, readings["temperatureC"] - readings["targetTemperatureC"]
    )

    # High humidity flag (>85%)
    readings["high_humidity"] = (readings["humidityPct"] > 85).astype(float)

    # Get product category for each zone via placements
    placements = inventory_placements_df.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    batch_info = batches_df[["batchId", "sku", "expiryDate"]].copy()
    batch_info["expiryDate"] = pd.to_datetime(batch_info["expiryDate"])

    placements_with_product = placements.merge(batch_info, on="batchId", how="left")
    placements_with_product = placements_with_product.merge(
        products_df[["sku", "category", "baseShelfLifeDays"]], on="sku", how="left"
    )

    # For each store/zone, get the dominant product info
    zone_product = (
        placements_with_product.sort_values("placedAt")
        .groupby(["storeCode", "zoneCode"])
        .last()
        .reset_index()[["storeCode", "zoneCode", "category", "baseShelfLifeDays", "placedAt"]]
    )

    readings = readings.merge(zone_product, on=["storeCode", "zoneCode"], how="left")

    # Compute age fraction
    readings["baseShelfLifeDays"] = readings["baseShelfLifeDays"].fillna(7)
    readings["category"] = readings["category"].fillna("unknown")
    readings["placedAt"] = pd.to_datetime(readings["placedAt"])

    readings["days_since_placement"] = (
        (readings["measuredAt"] - readings["placedAt"]).dt.total_seconds() / 86400.0
    ).clip(lower=0)

    readings["age_fraction"] = (
        readings["days_since_placement"] / readings["baseShelfLifeDays"].clip(lower=1)
    ).clip(0, 2.0)

    # --- Compute per-reading spoilage probability ---
    # Start with base rate
    prob = np.full(len(readings), _SPOILAGE_BASE_RATE)

    # Temperature factor: excess temp increases spoilage
    # Normalize: 1°C excess → 1.1x, 5°C excess → 2.5x, 10°C excess → 4x
    temp_factor = 1.0 + readings["excess_temp"].values * 0.3
    temp_factor = np.clip(temp_factor, 1.0, _SPOILAGE_TEMP_MULTIPLIER)
    prob *= temp_factor

    # Humidity factor: high humidity increases spoilage
    humidity_factor = 1.0 + readings["high_humidity"].values * (_SPOILAGE_HUMIDITY_MULTIPLIER - 1.0)
    prob *= humidity_factor

    # Age factor: older stock spoils more (kicks in after 70% of shelf life)
    age_vals = readings["age_fraction"].values
    age_factor = np.where(age_vals > 0.7, 1.0 + (age_vals - 0.7) * _SPOILAGE_AGE_MULTIPLIER, 1.0)
    prob *= age_factor

    # Category factor: high-risk categories have higher base rate
    is_high_risk = readings["category"].isin(_HIGH_RISK_CATEGORIES).values
    prob = np.where(is_high_risk, prob * _HIGH_RISK_MULTIPLIER, prob)

    # --- Task 3.4: CO2 factor ---
    # Determine zone type from zoneCode for CO2 parameters
    zone_types = readings["zoneCode"].apply(_extract_zone_type_from_code).values
    co2_values = readings["co2Ppm"].values

    co2_means = np.array([_ZONE_CO2_PARAMS[zt]["mean"] for zt in zone_types])
    co2_stds = np.array([_ZONE_CO2_PARAMS[zt]["std"] for zt in zone_types])

    co2_factor = 1.0 + np.maximum(0.0, (co2_values - co2_means) / co2_stds) * 0.08
    co2_factor = np.clip(co2_factor, 1.0, 1.3)
    prob *= co2_factor

    # --- Task 3.5: Cumulative temperature exposure factor ---
    readings["_cum_excess_temp"] = readings.groupby(["storeCode", "zoneCode"])["excess_temp"].cumsum()
    cum_excess_temp = readings["_cum_excess_temp"].values
    cum_temp_factor = 1.0 + np.minimum(cum_excess_temp / 400.0, 0.8)
    prob *= cum_temp_factor

    # --- Task 3.6: Shelf-life cross-correlation ---
    # Track which readings get cross-correlated for cap adjustment
    cross_correlated = np.zeros(len(prob), dtype=bool)

    if shelf_life_df is not None and not shelf_life_df.empty:
        # Merge days_remaining from shelf_life_targets
        shelf_merge = shelf_life_df[["storeCode", "zoneCode", "measuredAt", "days_remaining"]].copy()
        shelf_merge["measuredAt"] = pd.to_datetime(shelf_merge["measuredAt"])

        # Get min days_remaining per store/zone/time (worst batch in zone)
        shelf_stats = shelf_merge.groupby(["storeCode", "zoneCode", "measuredAt"]).agg(
            min_days=("days_remaining", "min"),
        ).reset_index()

        readings = readings.merge(
            shelf_stats, on=["storeCode", "zoneCode", "measuredAt"], how="left"
        )
        min_days = readings["min_days"].values

        # For readings where min days_remaining <= 1 (but > 0): small boost
        low_shelf_mask = (~np.isnan(min_days)) & (min_days <= 1) & (min_days > 0)
        prob = np.where(low_shelf_mask, prob * 1.3, prob)

        # For readings where min days_remaining <= 0: set prob = max(prob, 0.80)
        expired_mask = (~np.isnan(min_days)) & (min_days <= 0)
        prob = np.where(expired_mask, np.maximum(prob, 0.80), prob)

        # Mark cross-correlated cases for higher cap
        cross_correlated = expired_mask
    else:
        readings["days_remaining"] = np.nan

    # Cap probability: 0.95 for cross-correlated (days_remaining <= 0), 0.50 for normal
    # A higher cap allows the model to learn stronger signals from environmental factors
    prob = np.where(
        cross_correlated,
        np.clip(prob, 0.0, 0.95),
        np.clip(prob, 0.0, 0.50),
    )

    # Make spoilage more deterministic for extreme conditions:
    # When probability is high (>0.15), use a steeper sigmoid to make the
    # label more predictable from features (less random noise)
    # This ensures the model can learn a clear decision boundary
    deterministic_mask = prob > 0.12
    prob = np.where(
        deterministic_mask,
        _sigmoid((prob - 0.12) * 12.0),  # Steeper transition around 0.12
        prob * 0.3,  # Strongly reduce noise for low-probability cases
    )

    # Sample from Bernoulli per reading
    is_spoiled = (rng.random(len(prob)) < prob).astype(int)

    result = pd.DataFrame({
        "storeCode": readings["storeCode"].values,
        "zoneCode": readings["zoneCode"].values,
        "sensorId": readings["sensorId"].values,
        "measuredAt": readings["measuredAt"].values,
        "is_spoiled": is_spoiled,
    })

    return result


def _generate_shelf_life_targets(
    sensor_readings_df: pd.DataFrame,
    inventory_placements_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    products_df: pd.DataFrame,
    zones_df: pd.DataFrame,
) -> pd.DataFrame:
    """Generate shelf-life remaining targets based on degradation model.

    days_remaining = max(0, (expiryDate - currentDate).days - degradation_penalty)
    degradation_penalty = cumulative_temp_exposure / effective_exposure_per_day_loss
                        + cumulative_high_humidity_hours / effective_humidity_per_day_loss
                        + co2_degradation
    """
    if sensor_readings_df.empty or inventory_placements_df.empty:
        return pd.DataFrame(
            columns=["batchId", "storeCode", "zoneCode", "measuredAt", "days_remaining"]
        )

    readings = sensor_readings_df.copy()
    readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])

    placements = inventory_placements_df.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    batch_data = batches_df[["batchId", "sku", "expiryDate"]].copy()
    batch_data["expiryDate"] = pd.to_datetime(batch_data["expiryDate"])

    # Merge zone target temperature
    zone_targets = zones_df[["zoneCode", "targetTemperatureC"]].drop_duplicates()
    readings = readings.merge(zone_targets, on="zoneCode", how="left")

    # Build zone type lookup from zones_df
    zone_type_lookup = {}
    if "zoneType" in zones_df.columns:
        for _, row in zones_df[["zoneCode", "zoneType"]].drop_duplicates().iterrows():
            zone_type_lookup[row["zoneCode"]] = row["zoneType"].lower()

    # Build batch-placement lookup
    batch_placements = placements[["batchId", "storeCode", "zoneCode", "placedAt"]].copy()
    batch_placements = batch_placements.merge(batch_data, on="batchId", how="left")

    # Merge product info for resilience factor
    batch_placements = batch_placements.merge(
        products_df[["sku", "category"]], on="sku", how="left"
    )

    results = []

    for _, placement in batch_placements.iterrows():
        batch_id = placement["batchId"]
        store_code = placement["storeCode"]
        zone_code = placement["zoneCode"]
        placed_at = placement["placedAt"]
        expiry_date = placement["expiryDate"]
        category = placement.get("category", "unknown")
        if pd.isna(category):
            category = "unknown"

        if pd.isna(expiry_date) or pd.isna(placed_at):
            continue

        # Get readings for this store/zone after placement
        zone_readings = readings[
            (readings["storeCode"] == store_code)
            & (readings["zoneCode"] == zone_code)
            & (readings["measuredAt"] >= placed_at)
        ].sort_values("measuredAt").copy()

        if zone_readings.empty:
            continue

        target_temp = zone_readings["targetTemperatureC"].iloc[0]
        if pd.isna(target_temp):
            target_temp = 4.0  # default chiller temp

        # --- Task 3.2: Zone-specific exposure and product resilience ---
        # Look up zone type from zones_df
        zone_type = zone_type_lookup.get(zone_code, _extract_zone_type_from_code(zone_code))

        # Get zone-specific exposure per day loss
        zone_exposure = _EXPOSURE_PER_DAY_LOSS.get(zone_type, 200.0)

        # Get product resilience factor
        product_resilience = _PRODUCT_RESILIENCE.get(category, 1.0)

        # Effective thresholds: zone_exposure * product_resilience
        effective_exposure_per_day_loss = zone_exposure * product_resilience
        effective_humidity_per_day_loss = _HUMIDITY_HOURS_PER_DAY_LOSS * product_resilience

        # Compute excess temperature and high humidity per reading
        zone_readings["excess_temp"] = np.maximum(
            0.0, zone_readings["temperatureC"] - target_temp
        )
        zone_readings["high_humidity"] = (
            zone_readings["humidityPct"] > 85
        ).astype(float)

        # Cumulative sums (no shift needed for target - target IS the current state)
        zone_readings["cum_temp"] = zone_readings["excess_temp"].cumsum()
        zone_readings["cum_humidity"] = zone_readings["high_humidity"].cumsum()

        # --- Task 3.3: CO2 degradation factor ---
        zone_co2_mean = _ZONE_CO2_PARAMS.get(zone_type, {"mean": 310.0})["mean"]
        zone_readings["co2_excess"] = np.maximum(
            0.0, zone_readings["co2Ppm"] - zone_co2_mean
        )
        zone_readings["cum_co2_excess"] = zone_readings["co2_excess"].cumsum()
        co2_degradation = zone_readings["cum_co2_excess"] / _CO2_PER_DAY_LOSS

        # Compute degradation penalty with zone-specific and product-specific thresholds
        zone_readings["degradation_penalty"] = (
            zone_readings["cum_temp"] / effective_exposure_per_day_loss
            + zone_readings["cum_humidity"] / effective_humidity_per_day_loss
            + co2_degradation
        )

        # Compute nominal days remaining
        zone_readings["nominal_remaining"] = (
            (expiry_date - zone_readings["measuredAt"]).dt.total_seconds() / 86400.0
        )

        # Only keep readings where the batch hasn't nominally expired yet
        # This prevents the dataset from being dominated by zeros
        zone_readings = zone_readings[zone_readings["nominal_remaining"] > 0].copy()

        if zone_readings.empty:
            continue

        # Adjusted days remaining (capped at 30 days — max realistic shelf life)
        zone_readings["days_remaining"] = np.clip(
            zone_readings["nominal_remaining"] - zone_readings["degradation_penalty"],
            0.0,
            30.0,
        )

        # Realistic stock removal: once a batch reaches 0 days remaining,
        # it would be pulled from the shelf (sold at discount or discarded).
        # Only keep readings up to and including the first time days_remaining hits 0.
        zero_mask = zone_readings["days_remaining"] <= 0
        if zero_mask.any():
            first_zero_idx = zero_mask.idxmax()  # first True index
            # Keep readings up to and including the first zero reading
            zone_readings = zone_readings.loc[:first_zero_idx].copy()

        if zone_readings.empty:
            continue

        results.append(pd.DataFrame({
            "batchId": batch_id,
            "storeCode": store_code,
            "zoneCode": zone_code,
            "measuredAt": zone_readings["measuredAt"].values,
            "days_remaining": zone_readings["days_remaining"].values,
        }))

    if not results:
        return pd.DataFrame(
            columns=["batchId", "storeCode", "zoneCode", "measuredAt", "days_remaining"]
        )

    return pd.concat(results, ignore_index=True)
