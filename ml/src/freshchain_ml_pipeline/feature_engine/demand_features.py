"""Demand feature engineering for the FreshChain ML Pipeline.

Computes temporal and sales-behaviour features relevant to demand
forecasting:
- Day-of-week as cyclical encoded features (sin/cos)
- Month-of-year as cyclical encoded features (sin/cos)
- Historical sales lags (1, 7, 14 days) per store/SKU
- Rolling statistics (7-day mean, std, min, max) per store/SKU
- Demand trend (difference between recent and older rolling means)
- Seasonality components via cyclical encoding
- Price features (averagePrice)
- Product category as categorical feature

All features are computed using only data strictly before the prediction
timestamp to prevent temporal data leakage. Lags are backward-looking
by definition (shift unitsSold by N days).
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")


def compute_demand_features(
    sales_observations: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """Compute demand forecasting features from raw data.

    Produces a feature DataFrame suitable for the demand forecaster,
    with one row per store/SKU/day. All lag computations use only data
    strictly before the prediction timestamp (no future data leakage).

    Parameters
    ----------
    sales_observations : pd.DataFrame
        Daily sales with columns: storeCode, sku, businessDate,
        unitsSold, unitsWasted, averagePrice.
    products : pd.DataFrame
        Product metadata with columns: sku, productName, category,
        baseShelfLifeDays, storageRequirement.

    Returns
    -------
    pd.DataFrame
        Feature DataFrame with columns: storeCode, sku, businessDate,
        day_of_week_sin, day_of_week_cos, month_of_year_sin,
        month_of_year_cos, sales_lag_1, sales_lag_7, sales_lag_14,
        rolling_mean_7, rolling_std_7, rolling_min_7, rolling_max_7,
        demand_trend, averagePrice, category.
    """
    output_columns = [
        "storeCode",
        "sku",
        "businessDate",
        "day_of_week_sin",
        "day_of_week_cos",
        "month_of_year_sin",
        "month_of_year_cos",
        "sales_lag_1",
        "sales_lag_7",
        "sales_lag_14",
        "rolling_mean_7",
        "rolling_std_7",
        "rolling_min_7",
        "rolling_max_7",
        "demand_trend",
        "averagePrice",
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

    # --- Cyclical day-of-week encoding ---
    sales = _compute_day_of_week_cyclical(sales)

    # --- Cyclical month-of-year encoding ---
    sales = _compute_month_of_year_cyclical(sales)

    # --- Historical sales lags (1, 7, 14 days) ---
    sales = _compute_sales_lags(sales)

    # --- Rolling statistics (7-day window) ---
    sales = _compute_rolling_statistics(sales)

    # --- Product category ---
    sales = _attach_product_category(sales, products)

    return sales[output_columns].reset_index(drop=True)


def _compute_day_of_week_cyclical(sales: pd.DataFrame) -> pd.DataFrame:
    """Encode day-of-week as cyclical sin/cos features.

    Uses the formula:
        sin(2π * day_of_week / 7) and cos(2π * day_of_week / 7)

    where day_of_week is 0 (Monday) through 6 (Sunday).

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations with businessDate as datetime.

    Returns
    -------
    pd.DataFrame
        Sales with day_of_week_sin and day_of_week_cos columns added.
    """
    day_of_week = sales["businessDate"].dt.dayofweek  # 0=Monday, 6=Sunday
    sales["day_of_week_sin"] = np.sin(2 * np.pi * day_of_week / 7)
    sales["day_of_week_cos"] = np.cos(2 * np.pi * day_of_week / 7)
    return sales


def _compute_month_of_year_cyclical(sales: pd.DataFrame) -> pd.DataFrame:
    """Encode month-of-year as cyclical sin/cos features.

    Uses the formula:
        sin(2π * (month - 1) / 12) and cos(2π * (month - 1) / 12)

    where month is 1 (January) through 12 (December).

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations with businessDate as datetime.

    Returns
    -------
    pd.DataFrame
        Sales with month_of_year_sin and month_of_year_cos columns added.
    """
    month = sales["businessDate"].dt.month  # 1=January, 12=December
    sales["month_of_year_sin"] = np.sin(2 * np.pi * (month - 1) / 12)
    sales["month_of_year_cos"] = np.cos(2 * np.pi * (month - 1) / 12)
    return sales


def _compute_sales_lags(sales: pd.DataFrame) -> pd.DataFrame:
    """Compute historical sales lags (1, 7, 14 days) per store/SKU.

    Lags are backward-looking by definition: lag_N at time t uses the
    unitsSold value from time t-N. This ensures no future data leakage
    since we only look at past observations.

    NaN values (insufficient history) are filled with 0.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations sorted by storeCode, sku, businessDate.

    Returns
    -------
    pd.DataFrame
        Sales with sales_lag_1, sales_lag_7, sales_lag_14 columns added.
    """
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # Compute lags within each store/SKU group
    grouped = sales.groupby(["storeCode", "sku"])["unitsSold"]
    sales["sales_lag_1"] = grouped.shift(1)
    sales["sales_lag_7"] = grouped.shift(7)
    sales["sales_lag_14"] = grouped.shift(14)

    # Fill NaN lags with 0 (insufficient history)
    sales["sales_lag_1"] = sales["sales_lag_1"].fillna(0.0)
    sales["sales_lag_7"] = sales["sales_lag_7"].fillna(0.0)
    sales["sales_lag_14"] = sales["sales_lag_14"].fillna(0.0)

    return sales


def _compute_rolling_statistics(sales: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling window statistics (7-day) per store/SKU.

    Computes rolling mean, std, min, and max over a 7-day backward-looking
    window. Also computes a demand trend feature as the difference between
    the 3-day and 7-day rolling means (positive = rising demand).

    Uses shift(1) before rolling to prevent data leakage: rolling stats
    at time t are computed from values strictly before t.

    NaN values (insufficient history) are filled with 0.

    Parameters
    ----------
    sales : pd.DataFrame
        Sales observations sorted by storeCode, sku, businessDate.

    Returns
    -------
    pd.DataFrame
        Sales with rolling_mean_7, rolling_std_7, rolling_min_7,
        rolling_max_7, and demand_trend columns added.
    """
    sales = sales.sort_values(["storeCode", "sku", "businessDate"]).reset_index(
        drop=True
    )

    # Shift unitsSold by 1 to use only past data (exclude current day)
    grouped = sales.groupby(["storeCode", "sku"])
    shifted_sales = grouped["unitsSold"].shift(1)

    # 7-day rolling statistics on shifted values
    sales["rolling_mean_7"] = grouped["unitsSold"].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).mean()
    )
    sales["rolling_std_7"] = grouped["unitsSold"].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).std()
    )
    sales["rolling_min_7"] = grouped["unitsSold"].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).min()
    )
    sales["rolling_max_7"] = grouped["unitsSold"].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).max()
    )

    # Demand trend: difference between 3-day and 7-day rolling means
    rolling_mean_3 = grouped["unitsSold"].transform(
        lambda x: x.shift(1).rolling(window=3, min_periods=1).mean()
    )
    sales["demand_trend"] = rolling_mean_3 - sales["rolling_mean_7"]

    # Fill NaN with 0 (insufficient history)
    for col in ["rolling_mean_7", "rolling_std_7", "rolling_min_7", "rolling_max_7", "demand_trend"]:
        sales[col] = sales[col].fillna(0.0)

    return sales


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
