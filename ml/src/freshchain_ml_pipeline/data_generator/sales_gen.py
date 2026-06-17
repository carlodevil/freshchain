"""Sales observations generator for the FreshChain ML Pipeline.

Generates daily sales observations with realistic demand patterns including
weekly and monthly seasonality, category-specific Poisson demand, demand
shocks, wastage correlated with temperature exposure and stock age, and
log-normal price variability.
"""

import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig

logger = logging.getLogger("freshchain_ml_pipeline")

# Base Poisson lambda (mean daily units sold) per product category
CATEGORY_BASE_LAMBDA = {
    "produce": 15.0,
    "dairy": 12.0,
    "poultry": 8.0,
    "cooked_starch": 6.0,
    "ready_made_salad": 10.0,  # Moderate demand
}

# Weekend multiplier for demand (Saturday/Sunday have higher sales)
WEEKEND_MULTIPLIER = 1.35

# Monthly seasonality multipliers (index 0 = January)
MONTHLY_SEASONALITY = [
    0.90,  # Jan - post-holiday dip
    0.92,  # Feb
    0.95,  # Mar
    1.00,  # Apr
    1.02,  # May
    1.05,  # Jun
    1.08,  # Jul
    1.05,  # Aug
    1.00,  # Sep
    1.02,  # Oct
    1.10,  # Nov - pre-holiday ramp
    1.15,  # Dec - holiday peak
]

# Base price per category (ZAR)
CATEGORY_BASE_PRICE = {
    "produce": 25.0,
    "dairy": 35.0,
    "poultry": 65.0,
    "cooked_starch": 20.0,
    "ready_made_salad": 45.0,  # Premium ready-made
}

# Log-normal sigma for price variability
PRICE_LOG_SIGMA = 0.08

# Wastage base rate (fraction of available inventory wasted per day)
# Realistic retail wastage: ~2-5% of stock overall
WASTAGE_BASE_RATE = {
    "produce": 0.04,
    "dairy": 0.03,
    "poultry": 0.025,
    "cooked_starch": 0.03,
    "ready_made_salad": 0.15,  # High wastage for short-life salads
}

# Temperature exposure threshold per zone type (°C above target triggers waste)
ZONE_TEMP_THRESHOLD = {
    "chiller": 4.0,
    "ambient": 26.0,
    "freezer": -15.0,
}


def generate_sales_observations(
    config: PipelineConfig,
    stores_df: pd.DataFrame,
    products_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    inventory_placements_df: pd.DataFrame,
    sensor_readings_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate daily sales observations with realistic demand patterns.

    Produces one row per store/SKU/day with unitsSold sampled from a
    Poisson distribution modulated by category, day-of-week, and monthly
    seasonality. Wastage is positively correlated with cumulative temperature
    exposure and stock age. Demand shocks are injected at the configured rate.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling scale and demand_shock_pct.
    stores_df : pd.DataFrame
        Stores DataFrame with storeCode column.
    products_df : pd.DataFrame
        Products DataFrame with sku, category, baseShelfLifeDays,
        storageRequirement columns.
    batches_df : pd.DataFrame
        Batches DataFrame with batchId, sku, productionDate, expiryDate,
        quantityUnits columns.
    inventory_placements_df : pd.DataFrame
        Inventory placements DataFrame with placementId, batchId, storeCode,
        zoneCode, placedAt, quantityPlaced columns.
    sensor_readings_df : pd.DataFrame
        Sensor readings DataFrame with storeCode, zoneCode, measuredAt,
        temperatureC columns.
    rng : np.random.Generator
        NumPy random generator for reproducible output.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: storeCode, sku, businessDate, unitsSold,
        unitsWasted, averagePrice.
    """
    sim_start = datetime(2024, 1, 1)
    sim_end = sim_start + timedelta(days=config.num_days)

    # Build lookup structures
    sku_to_category = dict(zip(products_df["sku"], products_df["category"]))
    sku_to_shelf_life = dict(
        zip(products_df["sku"], products_df["baseShelfLifeDays"])
    )
    sku_to_storage = dict(
        zip(products_df["sku"], products_df["storageRequirement"])
    )

    # Compute cumulative temperature exposure per store/zone/day
    temp_exposure_map = _compute_daily_temp_exposure(
        sensor_readings_df, sim_start, config.num_days
    )

    # Build inventory tracking: available stock per store/SKU/day
    inventory_tracker = _build_inventory_tracker(
        inventory_placements_df, batches_df, stores_df, products_df,
        sim_start, config.num_days
    )

    store_codes = stores_df["storeCode"].tolist()
    skus = products_df["sku"].tolist()

    records = []

    for day_offset in range(config.num_days):
        current_date = sim_start + timedelta(days=day_offset)
        day_of_week = current_date.weekday()  # 0=Monday, 6=Sunday
        month_idx = current_date.month - 1  # 0-indexed

        # Seasonality factors
        is_weekend = day_of_week >= 5  # Saturday=5, Sunday=6
        weekly_factor = WEEKEND_MULTIPLIER if is_weekend else 1.0
        monthly_factor = MONTHLY_SEASONALITY[month_idx]

        for store_code in store_codes:
            for sku in skus:
                category = sku_to_category[sku]
                storage_req = sku_to_storage[sku]

                # Get available inventory for this store/SKU/day
                available = inventory_tracker.get(
                    (store_code, sku, day_offset), 0
                )

                if available <= 0:
                    # No inventory available, no sales or waste
                    continue

                # --- Units Sold ---
                base_lambda = CATEGORY_BASE_LAMBDA[category]
                effective_lambda = (
                    base_lambda * weekly_factor * monthly_factor
                )

                # Inject demand shock
                if rng.random() < config.demand_shock_pct:
                    # Shock: either spike (2x-3x) or drop (0.2x-0.5x)
                    if rng.random() < 0.5:
                        shock_factor = rng.uniform(2.0, 3.0)
                    else:
                        shock_factor = rng.uniform(0.2, 0.5)
                    effective_lambda *= shock_factor

                units_sold = int(rng.poisson(effective_lambda))
                # Cannot sell more than available
                units_sold = min(units_sold, available)

                # --- Units Wasted ---
                remaining_after_sales = available - units_sold

                # Compute wastage based on temperature exposure and stock age
                wastage_rate = _compute_wastage_rate(
                    store_code=store_code,
                    sku=sku,
                    category=category,
                    storage_req=storage_req,
                    day_offset=day_offset,
                    temp_exposure_map=temp_exposure_map,
                    inventory_tracker=inventory_tracker,
                    sku_to_shelf_life=sku_to_shelf_life,
                    rng=rng,
                )

                # Expected waste from remaining inventory
                expected_waste = remaining_after_sales * wastage_rate
                # Sample actual waste (Poisson around expected)
                if expected_waste > 0:
                    units_wasted = int(rng.poisson(max(0.1, expected_waste)))
                else:
                    units_wasted = 0

                # Ensure wastage does not exceed remaining inventory
                units_wasted = min(units_wasted, remaining_after_sales)

                # --- Average Price ---
                base_price = CATEGORY_BASE_PRICE[category]
                # Log-normal variability around base price
                price = base_price * float(
                    rng.lognormal(mean=0.0, sigma=PRICE_LOG_SIGMA)
                )
                price = round(price, 2)

                records.append(
                    {
                        "storeCode": store_code,
                        "sku": sku,
                        "businessDate": current_date.strftime("%Y-%m-%d"),
                        "unitsSold": units_sold,
                        "unitsWasted": units_wasted,
                        "averagePrice": price,
                    }
                )

                # Update inventory tracker: deduct sold + wasted for future days
                _deduct_inventory(
                    inventory_tracker, store_code, sku,
                    day_offset, units_sold + units_wasted, config.num_days
                )

    df = pd.DataFrame(records)

    logger.info(
        "Generated %d sales observations spanning %d days for %d stores",
        len(df),
        config.num_days,
        len(store_codes),
    )

    return df


def _compute_daily_temp_exposure(
    sensor_readings_df: pd.DataFrame,
    sim_start: datetime,
    num_days: int,
) -> dict:
    """Compute cumulative temperature exposure per store/zone/day.

    Temperature exposure is the sum of degree-hours above the zone's
    threshold temperature, accumulated day by day.

    Parameters
    ----------
    sensor_readings_df : pd.DataFrame
        Sensor readings with storeCode, zoneCode, measuredAt, temperatureC.
    sim_start : datetime
        Simulation start date.
    num_days : int
        Number of simulation days.

    Returns
    -------
    dict
        Mapping of (storeCode, zoneCode, day_offset) -> cumulative_exposure.
    """
    exposure_map = {}

    if sensor_readings_df.empty:
        return exposure_map

    # Parse measuredAt to datetime if needed
    readings = sensor_readings_df.copy()
    if readings["measuredAt"].dtype == object:
        readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])

    # Determine zone type from zone code (e.g., STORE-001-CHILLER -> chiller)
    readings["_zone_type"] = readings["zoneCode"].apply(_extract_zone_type)
    readings["_day_offset"] = (
        readings["measuredAt"] - pd.Timestamp(sim_start)
    ).dt.days

    # Filter to simulation period
    readings = readings[
        (readings["_day_offset"] >= 0) & (readings["_day_offset"] < num_days)
    ]

    # Compute daily excess temperature per store/zone/day
    for (store_code, zone_code, day_offset), group in readings.groupby(
        ["storeCode", "zoneCode", "_day_offset"]
    ):
        zone_type = group["_zone_type"].iloc[0]
        threshold = ZONE_TEMP_THRESHOLD.get(zone_type, 26.0)

        # Degree-hours above threshold for this day
        excess = (group["temperatureC"] - threshold).clip(lower=0).sum()
        exposure_map[(store_code, zone_code, int(day_offset))] = float(excess)

    # Convert to cumulative exposure
    cumulative_map = {}
    # Get unique store/zone pairs
    store_zone_pairs = set()
    for key in exposure_map:
        store_zone_pairs.add((key[0], key[1]))

    for store_code, zone_code in store_zone_pairs:
        cumulative = 0.0
        for day in range(num_days):
            daily = exposure_map.get((store_code, zone_code, day), 0.0)
            cumulative += daily
            cumulative_map[(store_code, zone_code, day)] = cumulative

    return cumulative_map


def _extract_zone_type(zone_code: str) -> str:
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


def _build_inventory_tracker(
    inventory_placements_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    stores_df: pd.DataFrame,
    products_df: pd.DataFrame,
    sim_start: datetime,
    num_days: int,
) -> dict:
    """Build a mapping of (storeCode, sku, day_offset) -> available inventory.

    Inventory becomes available on the day the batch is placed and expires
    on the batch expiry date.

    Parameters
    ----------
    inventory_placements_df : pd.DataFrame
        Placements with batchId, storeCode, zoneCode, placedAt, quantityPlaced.
    batches_df : pd.DataFrame
        Batches with batchId, sku, expiryDate.
    stores_df : pd.DataFrame
        Stores DataFrame.
    products_df : pd.DataFrame
        Products DataFrame.
    sim_start : datetime
        Simulation start date.
    num_days : int
        Number of simulation days.

    Returns
    -------
    dict
        Mapping of (storeCode, sku, day_offset) -> available_units.
    """
    tracker = {}

    # Build batch lookup: batchId -> (sku, expiryDate)
    batch_lookup = {}
    for _, batch in batches_df.iterrows():
        batch_lookup[batch["batchId"]] = {
            "sku": batch["sku"],
            "expiryDate": batch["expiryDate"],
        }

    for _, placement in inventory_placements_df.iterrows():
        batch_id = placement["batchId"]
        store_code = placement["storeCode"]
        quantity = placement["quantityPlaced"]

        if batch_id not in batch_lookup:
            continue

        batch_info = batch_lookup[batch_id]
        sku = batch_info["sku"]

        # Parse placement date
        placed_at_str = placement["placedAt"]
        if isinstance(placed_at_str, str):
            placed_at = datetime.strptime(
                placed_at_str[:10], "%Y-%m-%d"
            )
        else:
            placed_at = placed_at_str

        # Parse expiry date
        expiry_str = batch_info["expiryDate"]
        if isinstance(expiry_str, str):
            expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d")
        else:
            expiry_date = expiry_str

        # Determine day range when this batch is available
        placement_day = (placed_at - sim_start).days
        expiry_day = (expiry_date - sim_start).days

        # Batch is available from placement day until expiry (exclusive)
        start_day = max(0, placement_day)
        end_day = min(num_days, expiry_day)

        for day in range(start_day, end_day):
            key = (store_code, sku, day)
            tracker[key] = tracker.get(key, 0) + quantity

    return tracker


def _deduct_inventory(
    inventory_tracker: dict,
    store_code: str,
    sku: str,
    from_day: int,
    units_consumed: int,
    num_days: int,
) -> None:
    """Deduct consumed units from future days' available inventory.

    Parameters
    ----------
    inventory_tracker : dict
        The inventory tracker mapping to update in place.
    store_code : str
        Store code.
    sku : str
        SKU code.
    from_day : int
        Day offset from which to start deducting (inclusive of next day).
    units_consumed : int
        Number of units to deduct.
    num_days : int
        Total simulation days.
    """
    for day in range(from_day + 1, num_days):
        key = (store_code, sku, day)
        if key in inventory_tracker:
            inventory_tracker[key] = max(
                0, inventory_tracker[key] - units_consumed
            )


def _compute_wastage_rate(
    store_code: str,
    sku: str,
    category: str,
    storage_req: str,
    day_offset: int,
    temp_exposure_map: dict,
    inventory_tracker: dict,
    sku_to_shelf_life: dict,
    rng: np.random.Generator,
) -> float:
    """Compute wastage rate incorporating temperature exposure and stock age.

    The wastage rate increases with:
    - Higher cumulative temperature exposure (positive correlation)
    - Greater stock age relative to shelf life (positive correlation)

    Parameters
    ----------
    store_code : str
        Store code.
    sku : str
        SKU code.
    category : str
        Product category.
    storage_req : str
        Storage requirement (zone type).
    day_offset : int
        Current day offset in simulation.
    temp_exposure_map : dict
        Cumulative temperature exposure map.
    inventory_tracker : dict
        Inventory tracker for stock age estimation.
    sku_to_shelf_life : dict
        SKU to base shelf life days mapping.
    rng : np.random.Generator
        Random generator.

    Returns
    -------
    float
        Wastage rate (fraction of remaining inventory expected to waste).
    """
    base_rate = WASTAGE_BASE_RATE.get(category, 0.02)

    # Temperature exposure factor
    # Find the zone for this store/sku combination
    zone_code = f"{store_code}-{storage_req.upper()}"
    cumulative_exposure = temp_exposure_map.get(
        (store_code, zone_code, day_offset), 0.0
    )

    # Normalize exposure: higher exposure -> higher wastage
    # Use a sigmoid-like scaling to keep rate bounded
    temp_factor = 1.0 + min(2.0, cumulative_exposure / 50.0)

    # Stock age factor: older stock wastes more
    shelf_life = sku_to_shelf_life.get(sku, 7)
    # Estimate average stock age as fraction of shelf life elapsed
    # Simple heuristic: stock age increases with day_offset modulo shelf_life
    age_fraction = min(1.0, (day_offset % max(1, shelf_life)) / max(1, shelf_life))
    age_factor = 1.0 + age_fraction * 1.5

    # Combined wastage rate with some random noise
    wastage_rate = base_rate * temp_factor * age_factor
    # Add small random perturbation
    wastage_rate *= (1.0 + rng.normal(0, 0.1))

    # Clamp to reasonable range
    return max(0.0, min(0.5, wastage_rate))
