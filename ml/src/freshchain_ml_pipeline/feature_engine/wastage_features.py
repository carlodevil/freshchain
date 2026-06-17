"""Wastage feature engineering for the FreshChain ML Pipeline.

Computes sales-behaviour and inventory-dynamics features relevant to
wastage prediction:
- Sell-through rate (unitsSold / unitsAvailable) per store/SKU/day
- Rolling 7-day mean and standard deviation of unitsSold per store/SKU
- Stock age in days since batch placement
- Price deviation (current price / 30-day rolling average price)
- 7-day sales trend (slope of linear fit over trailing 7 days)
- Product category as categorical feature

All features are computed using only data strictly before the prediction
timestamp to prevent temporal data leakage.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")


def compute_wastage_features(
    sales_observations: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """Compute wastage prediction features from raw data.

    Produces a feature DataFrame suitable for the wastage predictor,
    with one row per store/SKU/day. All rolling and trend computations
    use only data strictly before the prediction timestamp (no future
    data leakage).

    Parameters
    ----------
    sales_observations : pd.DataFrame
        Daily sales with columns: storeCode, sku, businessDate,
        unitsSold, unitsWasted, averagePrice.
    inventory_placements : pd.DataFrame
        Inventory placements with columns: placementId, batchId,
        storeCode, zoneCode, placedAt, quantityPlaced.
    batches : pd.DataFrame
        Batch metadata with columns: batchId, sku, productionDate,
        expiryDate, quantityUnits.
    products : pd.DataFrame
        Product metadata with columns: sku, productName, category,
        baseShelfLifeDays, storageRequirement.

    Returns
    -------
    pd.DataFrame
        Feature DataFrame with columns: storeCode, sku, businessDate,
        sell_through_rate, sales_rolling_mean_7d, sales_rolling_std_7d,
        stock_age_days, price_deviation, sales_trend_7d, category.
    """
    output_columns = [
        "storeCode",
        "sku",
        "businessDate",
        "sell_through_rate",
        "sales_rolling_mean_7d",
        "sales_rolling_std_7d",
        "stock_age_days",
        "price_deviation",
        "sales_trend_7d",
        "category",
    ]

    if sales_observations.empty:
        return pd.DataFrame(columns=output_columns)

    # Prepare sales data
    sales = sales_observations.copy()
    sales["businessDate"] = pd.to_datetime(sales["businessDate"])
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # --- Sell-through rate ---
    sales = _compute_sell_through_rate(sales, inventory_placements, batches)

    # --- Rolling 7-day mean and std of unitsSold ---
    sales = _compute_rolling_sales_stats(sales)

    # --- Stock age in days since batch placement ---
    sales = _compute_stock_age(sales, inventory_placements, batches)

    # --- Price deviation ---
    sales = _compute_price_deviation(sales)

    # --- 7-day sales trend (slope of linear fit) ---
    sales = _compute_sales_trend(sales)

    # --- Product category ---
    sales = _attach_product_category(sales, products)

    return sales[output_columns].reset_index(drop=True)


def _compute_sell_through_rate(
    sales: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
) -> pd.DataFrame:
    """Compute sell-through rate = unitsSold / unitsAvailable.

    unitsAvailable is derived from the total placed quantity for the
    store/SKU up to (and including) the business date. When
    unitsAvailable is 0, sell_through_rate is set to 0.0 to handle
    division by zero.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations with businessDate as datetime.
    inventory_placements : pd.DataFrame
        Inventory placements data.
    batches : pd.DataFrame
        Batch metadata with sku.

    Returns
    -------
    pd.DataFrame
        Sales with sell_through_rate column added.
    """
    # Build placement lookup: store/SKU/date → cumulative quantity placed
    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    # Join placements with batches to get sku
    placements_with_sku = placements.merge(
        batches[["batchId", "sku"]], on="batchId", how="left"
    )

    # Aggregate total placed per store/SKU/day
    placements_with_sku["placedDate"] = placements_with_sku["placedAt"].dt.normalize()
    placed_daily = (
        placements_with_sku.groupby(["storeCode", "sku", "placedDate"])[
            "quantityPlaced"
        ]
        .sum()
        .reset_index()
        .rename(columns={"placedDate": "businessDate"})
    )

    # Merge placed quantities onto sales
    sales = sales.merge(
        placed_daily, on=["storeCode", "sku", "businessDate"], how="left"
    )
    sales["quantityPlaced"] = sales["quantityPlaced"].fillna(0)

    # Compute cumulative placed per store/SKU (total available over time)
    sales = sales.sort_values(["storeCode", "sku", "businessDate"])
    sales["cumulative_placed"] = sales.groupby(["storeCode", "sku"])[
        "quantityPlaced"
    ].cumsum()

    # Compute cumulative sold and wasted (consumed) up to previous day
    # to get unitsAvailable = cumulative_placed - cumulative_consumed_before_today
    sales["cumulative_sold"] = sales.groupby(["storeCode", "sku"])[
        "unitsSold"
    ].cumsum()
    sales["cumulative_wasted"] = sales.groupby(["storeCode", "sku"])[
        "unitsWasted"
    ].cumsum()

    # unitsAvailable on day t = cumulative placed up to t - cumulative consumed before t
    # cumulative consumed before t = cumulative_sold shifted by 1 + cumulative_wasted shifted by 1
    sales["prev_cumulative_sold"] = sales.groupby(["storeCode", "sku"])[
        "cumulative_sold"
    ].shift(1).fillna(0)
    sales["prev_cumulative_wasted"] = sales.groupby(["storeCode", "sku"])[
        "cumulative_wasted"
    ].shift(1).fillna(0)

    sales["unitsAvailable"] = (
        sales["cumulative_placed"]
        - sales["prev_cumulative_sold"]
        - sales["prev_cumulative_wasted"]
    )

    # Sell-through rate with division-by-zero handling
    sales["sell_through_rate"] = np.where(
        sales["unitsAvailable"] > 0,
        sales["unitsSold"] / sales["unitsAvailable"],
        0.0,
    )

    # Clean up intermediate columns
    sales = sales.drop(
        columns=[
            "quantityPlaced",
            "cumulative_placed",
            "cumulative_sold",
            "cumulative_wasted",
            "prev_cumulative_sold",
            "prev_cumulative_wasted",
            "unitsAvailable",
        ]
    )

    return sales


def _compute_rolling_sales_stats(sales: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling 7-day mean and std of unitsSold per store/SKU.

    Uses shift(1) before rolling to prevent data leakage: the rolling
    statistics at time t are computed from values strictly before t.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations sorted by storeCode, sku, businessDate.

    Returns
    -------
    pd.DataFrame
        Sales with sales_rolling_mean_7d and sales_rolling_std_7d added.
    """
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # Shift unitsSold by 1 within each group to exclude current day (no leakage)
    sales["unitsSold_shifted"] = sales.groupby(["storeCode", "sku"])[
        "unitsSold"
    ].shift(1)

    # Compute rolling stats on shifted values
    rolling_results = []
    for (store, sku), group in sales.groupby(["storeCode", "sku"]):
        group = group.copy()
        group = group.set_index("businessDate")

        group["sales_rolling_mean_7d"] = (
            group["unitsSold_shifted"].rolling("7D", min_periods=1).mean()
        )
        group["sales_rolling_std_7d"] = (
            group["unitsSold_shifted"].rolling("7D", min_periods=1).std()
        )

        group = group.reset_index()
        rolling_results.append(group)

    sales = pd.concat(rolling_results, ignore_index=True)

    # Fill NaN values (insufficient history) with 0
    sales["sales_rolling_mean_7d"] = sales["sales_rolling_mean_7d"].fillna(0.0)
    sales["sales_rolling_std_7d"] = sales["sales_rolling_std_7d"].fillna(0.0)

    # Drop intermediate column
    sales = sales.drop(columns=["unitsSold_shifted"])

    return sales


def _compute_stock_age(
    sales: pd.DataFrame,
    inventory_placements: pd.DataFrame,
    batches: pd.DataFrame,
) -> pd.DataFrame:
    """Compute stock age in days since earliest batch placement per store/SKU.

    For each store/SKU/day, stock_age_days is the number of days since
    the earliest batch placement for that store/SKU combination.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations with businessDate as datetime.
    inventory_placements : pd.DataFrame
        Inventory placements data.
    batches : pd.DataFrame
        Batch metadata with sku.

    Returns
    -------
    pd.DataFrame
        Sales with stock_age_days column added.
    """
    placements = inventory_placements.copy()
    placements["placedAt"] = pd.to_datetime(placements["placedAt"])

    # Join placements with batches to get sku
    placements_with_sku = placements.merge(
        batches[["batchId", "sku"]], on="batchId", how="left"
    )

    # Find earliest placement per store/SKU
    earliest_placement = (
        placements_with_sku.groupby(["storeCode", "sku"])["placedAt"]
        .min()
        .reset_index()
        .rename(columns={"placedAt": "earliest_placement"})
    )

    # Merge onto sales
    sales = sales.merge(earliest_placement, on=["storeCode", "sku"], how="left")

    # Compute stock age in days
    sales["stock_age_days"] = (
        sales["businessDate"] - sales["earliest_placement"]
    ).dt.days

    # If no placement found, stock age is 0
    sales["stock_age_days"] = sales["stock_age_days"].fillna(0).clip(lower=0)

    # Drop intermediate column
    sales = sales.drop(columns=["earliest_placement"])

    return sales


def _compute_price_deviation(sales: pd.DataFrame) -> pd.DataFrame:
    """Compute price deviation = current price / 30-day rolling average price.

    Uses shift(1) before rolling to prevent data leakage: the rolling
    average at time t uses only prices strictly before t.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations sorted by storeCode, sku, businessDate.

    Returns
    -------
    pd.DataFrame
        Sales with price_deviation column added.
    """
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # Shift price by 1 within each group to exclude current day
    sales["price_shifted"] = sales.groupby(["storeCode", "sku"])[
        "averagePrice"
    ].shift(1)

    # Compute 30-day rolling average on shifted prices
    rolling_results = []
    for (store, sku), group in sales.groupby(["storeCode", "sku"]):
        group = group.copy()
        group = group.set_index("businessDate")

        group["rolling_avg_price_30d"] = (
            group["price_shifted"].rolling("30D", min_periods=1).mean()
        )

        group = group.reset_index()
        rolling_results.append(group)

    sales = pd.concat(rolling_results, ignore_index=True)

    # Price deviation = current price / rolling average
    # Handle division by zero: if rolling average is 0 or NaN, set deviation to 1.0
    sales["price_deviation"] = np.where(
        (sales["rolling_avg_price_30d"] > 0) & sales["rolling_avg_price_30d"].notna(),
        sales["averagePrice"] / sales["rolling_avg_price_30d"],
        1.0,
    )

    # Drop intermediate columns
    sales = sales.drop(columns=["price_shifted", "rolling_avg_price_30d"])

    return sales


def _compute_sales_trend(sales: pd.DataFrame) -> pd.DataFrame:
    """Compute 7-day sales trend (slope of linear fit) per store/SKU.

    For each day, fits a linear regression to the preceding 7 days of
    unitsSold (using shift(1) to exclude the current day) and returns
    the slope as the trend indicator.

    Uses only data strictly before the prediction timestamp to prevent
    data leakage.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations sorted by storeCode, sku, businessDate.

    Returns
    -------
    pd.DataFrame
        Sales with sales_trend_7d column added.
    """
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # Shift unitsSold by 1 to exclude current day (no leakage)
    sales["unitsSold_shifted"] = sales.groupby(["storeCode", "sku"])[
        "unitsSold"
    ].shift(1)

    # Compute slope over rolling 7-day window per store/SKU
    trend_results = []
    for (store, sku), group in sales.groupby(["storeCode", "sku"]):
        group = group.copy()
        slopes = _rolling_slope(group["unitsSold_shifted"].values, window=7)
        group["sales_trend_7d"] = slopes
        trend_results.append(group)

    sales = pd.concat(trend_results, ignore_index=True)

    # Fill NaN trends with 0 (insufficient history)
    sales["sales_trend_7d"] = sales["sales_trend_7d"].fillna(0.0)

    # Drop intermediate column
    sales = sales.drop(columns=["unitsSold_shifted"])

    return sales


def _rolling_slope(values: np.ndarray, window: int) -> np.ndarray:
    """Compute rolling slope of linear fit over a window.

    For each position i, fits a linear regression to
    values[max(0, i-window+1):i+1] and returns the slope.
    NaN values within the window are excluded from the fit.

    Parameters
    ----------
    values : np.ndarray
        1-D array of values (may contain NaN).
    window : int
        Size of the rolling window.

    Returns
    -------
    np.ndarray
        Array of slopes, same length as values. Positions with
        fewer than 2 valid points return NaN.
    """
    n = len(values)
    slopes = np.full(n, np.nan)

    for i in range(n):
        start = max(0, i - window + 1)
        window_vals = values[start : i + 1]

        # Filter out NaN values
        valid_mask = ~np.isnan(window_vals)
        valid_vals = window_vals[valid_mask]

        if len(valid_vals) < 2:
            continue

        # x-coordinates: 0, 1, 2, ... for valid positions
        x = np.arange(len(valid_vals), dtype=np.float64)
        y = valid_vals.astype(np.float64)

        # Linear fit: slope = (n*sum(xy) - sum(x)*sum(y)) / (n*sum(x^2) - sum(x)^2)
        n_valid = len(x)
        sum_x = x.sum()
        sum_y = y.sum()
        sum_xy = (x * y).sum()
        sum_x2 = (x * x).sum()

        denom = n_valid * sum_x2 - sum_x * sum_x
        if denom == 0:
            slopes[i] = 0.0
        else:
            slopes[i] = (n_valid * sum_xy - sum_x * sum_y) / denom

    return slopes


def _attach_product_category(
    sales: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """Attach product category to sales rows based on SKU.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations with sku column.
    products : pd.DataFrame
        Product metadata with sku and category.

    Returns
    -------
    pd.DataFrame
        Sales with category column added.
    """
    sales = sales.merge(products[["sku", "category"]], on="sku", how="left")
    sales["category"] = sales["category"].fillna("unknown")
    return sales
