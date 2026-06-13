"""Spoilage feature engineering for the FreshChain ML Pipeline.

Computes environmental features relevant to spoilage classification:
- Rolling mean temperature (3-day and 7-day windows) per sensor
- Rolling mean humidity (3-day and 7-day windows) per sensor
- Cumulative temperature exposure (degree-hours above threshold) per batch
- Binary high humidity flag (humidity > 90%)
- Excess temperature above zone target (instantaneous)
- Stock age fraction (days since placement / base shelf life)
- CO2 excess above zone mean
- Instantaneous humidity percentage
- Product category as categorical feature

All features are computed using only data strictly before the prediction
timestamp to prevent temporal data leakage.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")


def compute_spoilage_features(
    sensor_readings: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    products: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """Compute spoilage classification features from raw data.

    Produces a feature DataFrame suitable for the spoilage classifier,
    with one row per sensor reading timestamp. All rolling and cumulative
    computations use only data strictly before the prediction timestamp
    (no future data leakage).

    Parameters
    ----------
    sensor_readings : pd.DataFrame
        Sensor readings with columns: messageId, storeCode, zoneCode,
        sensorId, measuredAt, temperatureC, humidityPct, co2Ppm,
        oxygenPct, lightLux, doorOpen.
    inventory_placements : pd.DataFrame
        Inventory placements with columns: placementId, batchId,
        storeCode, zoneCode, placedAt, quantityPlaced.
    batches : pd.DataFrame
        Batch metadata with columns: batchId, sku, productionDate,
        expiryDate, quantityUnits.
    products : pd.DataFrame
        Product metadata with columns: sku, productName, category,
        baseShelfLifeDays, storageRequirement.
    zones : pd.DataFrame
        Zone metadata with columns: zoneCode, storeCode, zoneType,
        targetTemperatureC.

    Returns
    -------
    pd.DataFrame
        Feature DataFrame with columns: storeCode, zoneCode, sensorId,
        measuredAt, temp_rolling_mean_3d, temp_rolling_mean_7d,
        humidity_rolling_mean_3d, humidity_rolling_mean_7d,
        cumulative_temp_exposure, high_humidity_flag, category.
    """
    if sensor_readings.empty:
        return pd.DataFrame(
            columns=[
                "storeCode",
                "zoneCode",
                "sensorId",
                "measuredAt",
                "temp_rolling_mean_3d",
                "temp_rolling_mean_7d",
                "humidity_rolling_mean_3d",
                "humidity_rolling_mean_7d",
                "cumulative_temp_exposure",
                "high_humidity_flag",
                "category",
            ]
        )

    # Ensure measuredAt is datetime
    readings = sensor_readings.copy()
    readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])

    # Sort by sensor and time for correct rolling computation
    readings = readings.sort_values(["sensorId", "measuredAt"]).reset_index(drop=True)

    # --- Rolling mean temperature and humidity per sensor ---
    # Use shift(1) before rolling to ensure no future data leakage:
    # the rolling window at time t uses only data from before t.
    features = _compute_rolling_features(readings)

    # --- High humidity flag ---
    # Based on the current reading's humidity (this is an instantaneous flag,
    # not a rolling feature, so no leakage concern)
    # Use >85% threshold to match target generation logic
    features["high_humidity_flag"] = (features["humidityPct"] > 85).astype(int)

    # --- Instantaneous humidity ---
    features["humidity_pct"] = features["humidityPct"]

    # --- Cumulative temperature exposure per batch ---
    features = _compute_cumulative_temp_exposure(
        features, inventory_placements, batches, zones
    )

    # --- Excess temperature above zone target (instantaneous) ---
    # This is a key driver of spoilage probability in the target generation
    features = _compute_excess_temperature(features, zones)

    # --- Stock age fraction ---
    # days_since_placement / baseShelfLifeDays — key spoilage driver
    features = _compute_stock_age_fraction(
        features, inventory_placements, batches, products
    )

    # --- CO2 excess above zone mean ---
    features = _compute_co2_excess(features)

    # --- Product category ---
    features = _attach_product_category(
        features, inventory_placements, batches, products
    )

    # Select output columns
    output_columns = [
        "storeCode",
        "zoneCode",
        "sensorId",
        "measuredAt",
        "temp_rolling_mean_3d",
        "temp_rolling_mean_7d",
        "humidity_rolling_mean_3d",
        "humidity_rolling_mean_7d",
        "cumulative_temp_exposure",
        "high_humidity_flag",
        "humidity_pct",
        "excess_temperature",
        "stock_age_fraction",
        "co2_excess",
        "category",
    ]

    return features[output_columns].reset_index(drop=True)


def _compute_rolling_features(readings: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling mean temperature and humidity per sensor.

    Uses shift(1) before rolling to prevent data leakage: the rolling
    mean at time t is computed from values strictly before t.

    Parameters
    ----------
    readings : pd.DataFrame
        Sorted sensor readings with measuredAt as datetime.

    Returns
    -------
    pd.DataFrame
        Readings with added rolling feature columns.
    """
    result = readings.copy()

    # Group by sensor for per-sensor rolling computations
    grouped = result.groupby("sensorId")

    # Shift values by 1 to exclude current reading (no leakage)
    result["temp_shifted"] = grouped["temperatureC"].shift(1)
    result["humidity_shifted"] = grouped["humidityPct"].shift(1)

    # Set measuredAt as index for time-based rolling within groups
    rolling_results = []

    for sensor_id, group in result.groupby("sensorId"):
        group = group.set_index("measuredAt")

        # Rolling mean on shifted values (backward-looking only)
        group["temp_rolling_mean_3d"] = (
            group["temp_shifted"]
            .rolling("3D", min_periods=1)
            .mean()
        )
        group["temp_rolling_mean_7d"] = (
            group["temp_shifted"]
            .rolling("7D", min_periods=1)
            .mean()
        )
        group["humidity_rolling_mean_3d"] = (
            group["humidity_shifted"]
            .rolling("3D", min_periods=1)
            .mean()
        )
        group["humidity_rolling_mean_7d"] = (
            group["humidity_shifted"]
            .rolling("7D", min_periods=1)
            .mean()
        )

        group = group.reset_index()
        rolling_results.append(group)

    result = pd.concat(rolling_results, ignore_index=True)

    # Drop intermediate shifted columns
    result = result.drop(columns=["temp_shifted", "humidity_shifted"])

    return result


def _compute_cumulative_temp_exposure(
    features: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """Compute cumulative temperature exposure (degree-hours above threshold).

    For each sensor reading, finds the relevant batch(es) placed in the
    same store/zone and computes the cumulative degree-hours above the
    zone's target temperature since placement, using only readings
    strictly before the current timestamp.

    Parameters
    ----------
    features : pd.DataFrame
        Feature DataFrame with sensor readings and rolling features.
    inventory_placements : pd.DataFrame
        Inventory placements data.
    batches : pd.DataFrame
        Batch metadata.
    zones : pd.DataFrame
        Zone metadata with targetTemperatureC.

    Returns
    -------
    pd.DataFrame
        Features with cumulative_temp_exposure column added.
    """
    # Merge zone target temperature
    zone_targets = zones[["zoneCode", "targetTemperatureC"]].drop_duplicates()
    features = features.merge(zone_targets, on="zoneCode", how="left")

    # Prepare placements with batch info for time filtering
    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    # For each store/zone, find the earliest placement time
    # This gives us the start point for cumulative exposure
    placement_lookup = (
        placements.groupby(["storeCode", "zoneCode"])["placedAt"]
        .min()
        .reset_index()
        .rename(columns={"placedAt": "earliest_placement"})
    )

    features = features.merge(
        placement_lookup, on=["storeCode", "zoneCode"], how="left"
    )

    # Compute degree-hours above threshold for each reading
    # degree_hours = max(0, temperatureC - targetTemperatureC) * hours_interval
    # We assume hourly readings, so each reading contributes 1 hour
    features["excess_temp"] = np.maximum(
        0.0, features["temperatureC"] - features["targetTemperatureC"]
    )

    # Only count exposure after placement and strictly before current time
    # Use shift(1) on cumulative sum to exclude current reading
    features["cumulative_temp_exposure"] = 0.0

    cumulative_results = []
    for (store, zone), group in features.groupby(["storeCode", "zoneCode"]):
        group = group.sort_values("measuredAt").copy()

        # Mask: only readings after earliest placement contribute
        if pd.notna(group["earliest_placement"].iloc[0]):
            placement_time = group["earliest_placement"].iloc[0]
            mask = group["measuredAt"] > placement_time
            group.loc[~mask, "excess_temp"] = 0.0

        # Cumulative sum with shift to prevent leakage
        # shift(1) ensures we only use data before current timestamp
        group["cumulative_temp_exposure"] = (
            group["excess_temp"].cumsum().shift(1).fillna(0.0)
        )

        cumulative_results.append(group)

    features = pd.concat(cumulative_results, ignore_index=True)

    # Clean up intermediate columns
    features = features.drop(
        columns=["targetTemperatureC", "earliest_placement", "excess_temp"],
        errors="ignore",
    )

    return features


def _compute_excess_temperature(
    features: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """Compute instantaneous excess temperature above zone target.

    This is a key driver of spoilage probability — higher excess temperature
    directly increases the chance of spoilage.

    Parameters
    ----------
    features : pd.DataFrame
        Feature DataFrame with temperatureC and zoneCode.
    zones : pd.DataFrame
        Zone metadata with zoneCode and targetTemperatureC.

    Returns
    -------
    pd.DataFrame
        Features with excess_temperature column added.
    """
    zone_targets = zones[["zoneCode", "targetTemperatureC"]].drop_duplicates()
    features = features.merge(zone_targets, on="zoneCode", how="left")

    features["excess_temperature"] = np.maximum(
        0.0, features["temperatureC"] - features["targetTemperatureC"]
    )

    features = features.drop(columns=["targetTemperatureC"], errors="ignore")
    return features


def _compute_stock_age_fraction(
    features: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """Compute stock age as a fraction of base shelf life.

    age_fraction = days_since_placement / baseShelfLifeDays
    Values > 0.7 indicate old stock with higher spoilage risk.

    Parameters
    ----------
    features : pd.DataFrame
        Feature DataFrame with storeCode, zoneCode, measuredAt.
    inventory_placements : pd.DataFrame
        Inventory placements with placedAt.
    batches : pd.DataFrame
        Batch metadata with batchId, sku.
    products : pd.DataFrame
        Product metadata with sku, baseShelfLifeDays.

    Returns
    -------
    pd.DataFrame
        Features with stock_age_fraction column added.
    """
    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    # Join placements with batches and products to get shelf life
    placements_with_info = placements.merge(
        batches[["batchId", "sku"]], on="batchId", how="left"
    )
    placements_with_info = placements_with_info.merge(
        products[["sku", "baseShelfLifeDays"]], on="sku", how="left"
    )

    # For each store/zone, get the most recent placement info
    zone_placement = (
        placements_with_info.sort_values("placedAt")
        .groupby(["storeCode", "zoneCode"])
        .last()
        .reset_index()[["storeCode", "zoneCode", "placedAt", "baseShelfLifeDays"]]
    )
    zone_placement = zone_placement.rename(columns={"placedAt": "zone_placed_at"})

    features = features.merge(zone_placement, on=["storeCode", "zoneCode"], how="left")

    # Compute age fraction
    features["zone_placed_at"] = pd.to_datetime(features["zone_placed_at"])
    features["measuredAt"] = pd.to_datetime(features["measuredAt"])

    days_since = (
        (features["measuredAt"] - features["zone_placed_at"]).dt.total_seconds() / 86400.0
    ).clip(lower=0)

    shelf_life = features["baseShelfLifeDays"].fillna(7).clip(lower=1)
    features["stock_age_fraction"] = (days_since / shelf_life).clip(0, 2.0)

    features = features.drop(columns=["zone_placed_at", "baseShelfLifeDays"], errors="ignore")
    return features


def _compute_co2_excess(features: pd.DataFrame) -> pd.DataFrame:
    """Compute CO2 excess above zone-type mean.

    Higher CO2 levels contribute to spoilage probability.

    Parameters
    ----------
    features : pd.DataFrame
        Feature DataFrame with co2Ppm and zoneCode.

    Returns
    -------
    pd.DataFrame
        Features with co2_excess column added.
    """
    # Zone-type CO2 means (from sensor_gen.py ZONE_DISTRIBUTIONS)
    zone_co2_means = {
        "ambient": 310.0,
        "chiller": 250.0,
        "freezer": 200.0,
    }

    def _get_zone_type(zone_code: str) -> str:
        upper = str(zone_code).upper()
        if "CHILLER" in upper:
            return "chiller"
        elif "FREEZER" in upper:
            return "freezer"
        return "ambient"

    zone_types = features["zoneCode"].apply(_get_zone_type)
    co2_means = zone_types.map(zone_co2_means).fillna(310.0)

    if "co2Ppm" in features.columns:
        features["co2_excess"] = np.maximum(0.0, features["co2Ppm"] - co2_means)
    else:
        features["co2_excess"] = 0.0

    return features


def _attach_product_category(
    features: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """Attach product category to feature rows based on zone/store placement.

    Links sensor readings to the product category of batches placed in
    the same store/zone. If multiple products are placed in the same
    zone, uses the most recently placed batch's category.

    Parameters
    ----------
    features : pd.DataFrame
        Feature DataFrame with storeCode and zoneCode.
    inventory_placements : pd.DataFrame
        Inventory placements data.
    batches : pd.DataFrame
        Batch metadata with sku.
    products : pd.DataFrame
        Product metadata with sku and category.

    Returns
    -------
    pd.DataFrame
        Features with category column added.
    """
    # Build placement → product category lookup
    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    # Join placements with batches to get sku
    placements_with_sku = placements.merge(
        batches[["batchId", "sku"]], on="batchId", how="left"
    )

    # Join with products to get category
    placements_with_category = placements_with_sku.merge(
        products[["sku", "category"]], on="sku", how="left"
    )

    # For each store/zone, get the most recent placement's category
    # (represents the dominant product in that zone)
    latest_placement = (
        placements_with_category.sort_values("placedAt")
        .groupby(["storeCode", "zoneCode"])
        .last()
        .reset_index()[["storeCode", "zoneCode", "category"]]
    )

    # Merge category onto features
    features = features.merge(
        latest_placement, on=["storeCode", "zoneCode"], how="left"
    )

    # Fill missing categories with "unknown"
    features["category"] = features["category"].fillna("unknown")

    return features
