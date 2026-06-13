"""Shelf-life estimation feature engineering for the FreshChain ML Pipeline.

Computes cumulative exposure and temporal features relevant to shelf-life
estimation:
- Cumulative temperature-time exposure (degree-hours above zone target) per batch
- Cumulative humidity exposure (hours where humidity > 85%) per batch
- Days since production from batch production date
- Product category as categorical feature

All features are computed using only data strictly before the prediction
timestamp to prevent temporal data leakage.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")


def compute_shelf_life_features(
    sensor_readings: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    products: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """Compute shelf-life estimation features from raw data.

    Produces a feature DataFrame suitable for the shelf-life estimator,
    with one row per batch/timestamp combination. All cumulative
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
        Feature DataFrame with columns: batchId, storeCode, zoneCode,
        measuredAt, cumulative_temp_exposure, cumulative_humidity_exposure,
        days_since_production, category.
    """
    output_columns = [
        "batchId",
        "storeCode",
        "zoneCode",
        "measuredAt",
        "cumulative_temp_exposure",
        "cumulative_humidity_exposure",
        "cumulative_co2_exposure",
        "days_since_production",
        "baseShelfLifeDays",
        "category",
    ]

    if sensor_readings.empty or inventory_placements.empty:
        return pd.DataFrame(columns=output_columns)

    # Prepare data
    readings = sensor_readings.copy()
    readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])

    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    batch_data = batches.copy()
    batch_data["productionDate"] = pd.to_datetime(batch_data["productionDate"])

    # Merge zone target temperature onto readings
    zone_targets = zones[["zoneCode", "targetTemperatureC"]].drop_duplicates()
    readings = readings.merge(zone_targets, on="zoneCode", how="left")

    # Build batch-placement lookup: batchId → storeCode, zoneCode, placedAt
    batch_placements = placements[
        ["batchId", "storeCode", "zoneCode", "placedAt"]
    ].copy()

    # Join batch metadata to get productionDate and sku
    batch_placements = batch_placements.merge(
        batch_data[["batchId", "sku", "productionDate"]], on="batchId", how="left"
    )

    # Join product category and contractual shelf life.
    batch_placements = batch_placements.merge(
        products[["sku", "category", "baseShelfLifeDays"]], on="sku", how="left"
    )
    batch_placements["category"] = batch_placements["category"].fillna("unknown")
    batch_placements["baseShelfLifeDays"] = (
        pd.to_numeric(batch_placements["baseShelfLifeDays"], errors="coerce")
        .fillna(7.0)
        .clip(lower=1.0)
    )

    # For each batch placement, compute features at each sensor reading time
    # in the same store/zone after placement
    feature_rows = []

    for _, placement in batch_placements.iterrows():
        batch_id = placement["batchId"]
        store_code = placement["storeCode"]
        zone_code = placement["zoneCode"]
        placed_at = placement["placedAt"]
        production_date = placement["productionDate"]
        category = placement["category"]
        base_shelf_life_days = placement["baseShelfLifeDays"]

        # Get readings for this store/zone after placement
        zone_readings = readings[
            (readings["storeCode"] == store_code)
            & (readings["zoneCode"] == zone_code)
            & (readings["measuredAt"] >= placed_at)
        ].sort_values("measuredAt").copy()

        if zone_readings.empty:
            continue

        target_temp = zone_readings["targetTemperatureC"].iloc[0]

        # Compute excess temperature for each reading (degree-hours above target)
        # Each hourly reading contributes 1 hour of exposure
        zone_readings["excess_temp"] = np.maximum(
            0.0, zone_readings["temperatureC"] - target_temp
        )

        # Compute humidity flag: 1 if humidity > 85%, else 0
        zone_readings["high_humidity_hour"] = (
            zone_readings["humidityPct"] > 85
        ).astype(float)

        # Cumulative sums with shift(1) to prevent leakage
        # shift(1) ensures we only use data strictly before current timestamp
        zone_readings["cumulative_temp_exposure"] = (
            zone_readings["excess_temp"].cumsum().shift(1).fillna(0.0)
        )
        zone_readings["cumulative_humidity_exposure"] = (
            zone_readings["high_humidity_hour"].cumsum().shift(1).fillna(0.0)
        )

        # CO2 excess exposure (above zone-typical levels)
        # Use a simple threshold: ambient ~310, chiller ~250, freezer ~200
        zone_type_upper = zone_code.upper()
        if "FREEZER" in zone_type_upper:
            co2_baseline = 200.0
        elif "CHILLER" in zone_type_upper:
            co2_baseline = 250.0
        else:
            co2_baseline = 310.0

        if "co2Ppm" in zone_readings.columns:
            zone_readings["co2_excess"] = np.maximum(
                0.0, zone_readings["co2Ppm"] - co2_baseline
            )
        else:
            zone_readings["co2_excess"] = 0.0

        zone_readings["cumulative_co2_exposure"] = (
            zone_readings["co2_excess"].cumsum().shift(1).fillna(0.0)
        )

        # Days since production
        zone_readings["days_since_production"] = (
            zone_readings["measuredAt"].dt.normalize() - production_date
        ).dt.days

        # Ensure non-negative days_since_production
        zone_readings["days_since_production"] = zone_readings[
            "days_since_production"
        ].clip(lower=0)

        # Add batch and category info
        zone_readings["batchId"] = batch_id
        zone_readings["category"] = category
        zone_readings["baseShelfLifeDays"] = base_shelf_life_days

        feature_rows.append(
            zone_readings[
                [
                    "batchId",
                    "storeCode",
                    "zoneCode",
                    "measuredAt",
                    "cumulative_temp_exposure",
                    "cumulative_humidity_exposure",
                    "cumulative_co2_exposure",
                    "days_since_production",
                    "baseShelfLifeDays",
                    "category",
                ]
            ]
        )

    if not feature_rows:
        return pd.DataFrame(columns=output_columns)

    result = pd.concat(feature_rows, ignore_index=True)

    return result[output_columns].reset_index(drop=True)
