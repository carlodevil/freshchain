"""Feature engine orchestrator for the FreshChain ML Pipeline.

Dispatches feature computation to use-case-specific builders, handling
missing values and data quality issues gracefully. Each builder method
loads CSVs from the DataManifest, computes features, and returns a
clean DataFrame ready for model training.
"""

import logging

import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.data_generator.generator import DataManifest
from freshchain_ml_pipeline.feature_engine.anomaly_features import (
    compute_anomaly_features,
)
from freshchain_ml_pipeline.feature_engine.demand_features import (
    compute_demand_features,
)
from freshchain_ml_pipeline.feature_engine.shelf_life_features import (
    compute_shelf_life_features,
)
from freshchain_ml_pipeline.feature_engine.spoilage_features import (
    compute_spoilage_features,
)
from freshchain_ml_pipeline.feature_engine.wastage_features import (
    compute_wastage_features,
)

logger = logging.getLogger("freshchain_ml_pipeline")


class FeatureEngine:
    """Orchestrates feature computation across all use cases.

    Loads raw CSV data from a DataManifest, delegates to use-case-specific
    feature builders, and applies consistent missing-value handling.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling feature computation parameters.
    """

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def build_spoilage_features(self, manifest: DataManifest) -> pd.DataFrame:
        """Build spoilage classification features from raw data.

        Loads sensor readings, inventory placements, batches, products,
        and zones from the manifest paths, computes rolling temperature
        and humidity features, cumulative exposure, and high humidity flags.
        Merges the spoilage target (is_spoiled) if available.

        Parameters
        ----------
        manifest : DataManifest
            Manifest with paths to all generated CSV files.

        Returns
        -------
        pd.DataFrame
            Feature DataFrame suitable for the spoilage classifier.
        """
        logger.info("Building spoilage features")

        sensor_readings = pd.read_csv(manifest.sensor_readings_path)
        inventory_placements = pd.read_csv(manifest.inventory_placements_path)
        batches = pd.read_csv(manifest.batches_path)
        products = pd.read_csv(manifest.products_path)
        zones = pd.read_csv(manifest.zones_path)

        # Handle missing values in input data
        sensor_readings = self._handle_missing_values_timeseries(
            sensor_readings, "measuredAt"
        )
        inventory_placements = self._handle_missing_values_exclude(
            inventory_placements
        )
        batches = self._handle_missing_values_exclude(batches)
        products = self._handle_missing_values_exclude(products)
        zones = self._handle_missing_values_exclude(zones)

        features = compute_spoilage_features(
            sensor_readings, inventory_placements, batches, products, zones
        )

        # Merge spoilage target if available
        if manifest.spoilage_targets_path is not None:
            try:
                spoilage_targets = pd.read_csv(manifest.spoilage_targets_path)
                spoilage_targets["measuredAt"] = pd.to_datetime(
                    spoilage_targets["measuredAt"]
                )
                features["measuredAt"] = pd.to_datetime(features["measuredAt"])
                features = features.merge(
                    spoilage_targets[["storeCode", "zoneCode", "sensorId", "measuredAt", "is_spoiled"]],
                    on=["storeCode", "zoneCode", "sensorId", "measuredAt"],
                    how="left",
                )
                features["is_spoiled"] = features["is_spoiled"].fillna(0).astype(int)
                logger.info("Merged spoilage targets: %d positive labels", features["is_spoiled"].sum())
            except Exception as e:
                logger.warning("Could not merge spoilage targets: %s", str(e))

        logger.info("Spoilage features built: %d rows", len(features))
        return features

    def build_wastage_features(self, manifest: DataManifest) -> pd.DataFrame:
        """Build wastage prediction features from raw data.

        Loads sales observations, inventory placements, batches, and
        products from the manifest paths, computes sell-through rate,
        rolling sales stats, stock age, price deviation, and sales trend.
        Includes unitsWasted from sales as the target column.

        Parameters
        ----------
        manifest : DataManifest
            Manifest with paths to all generated CSV files.

        Returns
        -------
        pd.DataFrame
            Feature DataFrame suitable for the wastage predictor.
        """
        logger.info("Building wastage features")

        sales_observations = pd.read_csv(manifest.sales_observations_path)
        inventory_placements = pd.read_csv(manifest.inventory_placements_path)
        batches = pd.read_csv(manifest.batches_path)
        products = pd.read_csv(manifest.products_path)

        # Handle missing values in input data
        sales_observations = self._handle_missing_values_timeseries(
            sales_observations, "businessDate"
        )
        inventory_placements = self._handle_missing_values_exclude(
            inventory_placements
        )
        batches = self._handle_missing_values_exclude(batches)
        products = self._handle_missing_values_exclude(products)

        # Keep unitsWasted from sales for target column
        sales_with_target = sales_observations[["storeCode", "sku", "businessDate", "unitsWasted"]].copy()
        sales_with_target["businessDate"] = pd.to_datetime(sales_with_target["businessDate"])

        features = compute_wastage_features(
            sales_observations, inventory_placements, batches, products
        )

        # Handle division by zero in sell-through rate (already handled in
        # compute_wastage_features, but ensure no NaN/inf slipped through)
        if "sell_through_rate" in features.columns:
            inf_mask = features["sell_through_rate"].isin(
                [float("inf"), float("-inf")]
            )
            if inf_mask.any():
                logger.warning(
                    "Division by zero detected in sell_through_rate for %d rows, "
                    "setting to 0.0",
                    inf_mask.sum(),
                )
                features.loc[inf_mask, "sell_through_rate"] = 0.0

        # Merge unitsWasted target from sales
        if "businessDate" in features.columns:
            features["businessDate"] = pd.to_datetime(features["businessDate"])
            features = features.merge(
                sales_with_target,
                on=["storeCode", "sku", "businessDate"],
                how="left",
            )
            features["unitsWasted"] = features["unitsWasted"].fillna(0)

        logger.info("Wastage features built: %d rows", len(features))
        return features

    def build_demand_features(self, manifest: DataManifest) -> pd.DataFrame:
        """Build demand forecasting features from raw data.

        Loads sales observations and products from the manifest paths,
        computes cyclical date encodings, historical sales lags, and
        attaches product category. Includes unitsSold from sales as the
        target column.

        Parameters
        ----------
        manifest : DataManifest
            Manifest with paths to all generated CSV files.

        Returns
        -------
        pd.DataFrame
            Feature DataFrame suitable for the demand forecaster.
        """
        logger.info("Building demand features")

        sales_observations = pd.read_csv(manifest.sales_observations_path)
        products = pd.read_csv(manifest.products_path)

        # Handle missing values in input data
        sales_observations = self._handle_missing_values_timeseries(
            sales_observations, "businessDate"
        )
        products = self._handle_missing_values_exclude(products)

        # Keep unitsSold from sales for target column
        sales_with_target = sales_observations[["storeCode", "sku", "businessDate", "unitsSold"]].copy()
        sales_with_target["businessDate"] = pd.to_datetime(sales_with_target["businessDate"])

        features = compute_demand_features(sales_observations, products)

        # Merge unitsSold target from sales
        if "businessDate" in features.columns:
            features["businessDate"] = pd.to_datetime(features["businessDate"])
            features = features.merge(
                sales_with_target,
                on=["storeCode", "sku", "businessDate"],
                how="left",
            )
            features["unitsSold"] = features["unitsSold"].fillna(0)

        logger.info("Demand features built: %d rows", len(features))
        return features

    def build_anomaly_features(self, manifest: DataManifest) -> pd.DataFrame:
        """Build anomaly detection features from raw data.

        Loads sensor readings and zones from the manifest paths, computes
        rate of change, z-scores, and door-open frequency features.

        Parameters
        ----------
        manifest : DataManifest
            Manifest with paths to all generated CSV files.

        Returns
        -------
        pd.DataFrame
            Feature DataFrame suitable for the anomaly detector.
        """
        logger.info("Building anomaly features")

        sensor_readings = pd.read_csv(manifest.sensor_readings_path)
        zones = pd.read_csv(manifest.zones_path)

        # Handle missing values in input data
        sensor_readings = self._handle_missing_values_timeseries(
            sensor_readings, "measuredAt"
        )
        zones = self._handle_missing_values_exclude(zones)

        features = compute_anomaly_features(sensor_readings, zones)

        # Add anomaly ground truth from _anomaly_injected column if available
        if "_anomaly_injected" in sensor_readings.columns:
            # Build lookup from sensor readings to get ground truth
            anomaly_lookup = sensor_readings[["storeCode", "zoneCode", "sensorId", "measuredAt", "_anomaly_injected"]].copy()
            anomaly_lookup["measuredAt"] = pd.to_datetime(anomaly_lookup["measuredAt"])
            anomaly_lookup = anomaly_lookup.rename(columns={"_anomaly_injected": "is_anomaly"})
            anomaly_lookup["is_anomaly"] = anomaly_lookup["is_anomaly"].fillna(False).astype(int)

            features["measuredAt"] = pd.to_datetime(features["measuredAt"])
            features = features.merge(
                anomaly_lookup,
                on=["storeCode", "zoneCode", "sensorId", "measuredAt"],
                how="left",
            )
            features["is_anomaly"] = features["is_anomaly"].fillna(0).astype(int)
            logger.info("Merged anomaly ground truth: %d anomalies", features["is_anomaly"].sum())

        logger.info("Anomaly features built: %d rows", len(features))
        return features

    def build_shelf_life_features(self, manifest: DataManifest) -> pd.DataFrame:
        """Build shelf-life estimation features from raw data.

        Loads sensor readings, inventory placements, batches, products,
        and zones from the manifest paths, computes cumulative temperature
        and humidity exposure, and days since production. Merges the
        shelf-life target (days_remaining) if available.

        Parameters
        ----------
        manifest : DataManifest
            Manifest with paths to all generated CSV files.

        Returns
        -------
        pd.DataFrame
            Feature DataFrame suitable for the shelf-life estimator.
        """
        logger.info("Building shelf-life features")

        sensor_readings = pd.read_csv(manifest.sensor_readings_path)
        inventory_placements = pd.read_csv(manifest.inventory_placements_path)
        batches = pd.read_csv(manifest.batches_path)
        products = pd.read_csv(manifest.products_path)
        zones = pd.read_csv(manifest.zones_path)

        # Handle missing values in input data
        sensor_readings = self._handle_missing_values_timeseries(
            sensor_readings, "measuredAt"
        )
        inventory_placements = self._handle_missing_values_exclude(
            inventory_placements
        )
        batches = self._handle_missing_values_exclude(batches)
        products = self._handle_missing_values_exclude(products)
        zones = self._handle_missing_values_exclude(zones)

        features = compute_shelf_life_features(
            sensor_readings, inventory_placements, batches, products, zones
        )

        # Merge shelf-life target if available
        if manifest.shelf_life_targets_path is not None:
            try:
                shelf_life_targets = pd.read_csv(manifest.shelf_life_targets_path)
                shelf_life_targets["measuredAt"] = pd.to_datetime(
                    shelf_life_targets["measuredAt"]
                )
                features["measuredAt"] = pd.to_datetime(features["measuredAt"])
                features = features.merge(
                    shelf_life_targets[["batchId", "storeCode", "zoneCode", "measuredAt", "days_remaining"]],
                    on=["batchId", "storeCode", "zoneCode", "measuredAt"],
                    how="left",
                )
                # Drop rows without a matching target: these are readings for
                # batches that have already expired or hit zero remaining life.
                # Filling with 0.0 would artificially inflate the CRITICAL class.
                before_drop = len(features)
                features = features.dropna(subset=["days_remaining"]).reset_index(drop=True)
                dropped = before_drop - len(features)
                if dropped > 0:
                    logger.info(
                        "Dropped %d shelf-life feature rows with no matching target "
                        "(expired/removed batches)",
                        dropped,
                    )
                logger.info(
                    "Merged shelf-life targets: mean=%.1f days",
                    features["days_remaining"].mean(),
                )
            except Exception as e:
                logger.warning("Could not merge shelf-life targets: %s", str(e))

        logger.info("Shelf-life features built: %d rows", len(features))
        return features

    def _handle_missing_values_timeseries(
        self, df: pd.DataFrame, time_column: str
    ) -> pd.DataFrame:
        """Handle missing values in time-series data using forward-fill.

        For time-series DataFrames, applies forward-fill on numeric columns
        after sorting by the time column. Logs a warning if NaN values are
        detected.

        Parameters
        ----------
        df : pd.DataFrame
            Input DataFrame with potential missing values.
        time_column : str
            Name of the timestamp/date column for sorting.

        Returns
        -------
        pd.DataFrame
            DataFrame with missing numeric values forward-filled.
        """
        if df.empty:
            return df

        nan_count = df.isna().sum().sum()
        if nan_count > 0:
            logger.warning(
                "Detected %d missing values in time-series data, "
                "applying forward-fill on numeric columns",
                nan_count,
            )

        result = df.copy()

        # Sort by time column if it exists
        if time_column in result.columns:
            result = result.sort_values(time_column).reset_index(drop=True)

        # Forward-fill numeric columns
        numeric_cols = result.select_dtypes(include=["number"]).columns
        result[numeric_cols] = result[numeric_cols].ffill()

        # After forward-fill, any remaining NaN (at the start) gets backfilled
        result[numeric_cols] = result[numeric_cols].bfill()

        return result

    def _handle_missing_values_exclude(self, df: pd.DataFrame) -> pd.DataFrame:
        """Handle missing values in reference data by excluding rows.

        For non-time-series DataFrames (reference/lookup tables), drops
        rows that contain any NaN in key columns. Logs a warning if rows
        are excluded.

        Parameters
        ----------
        df : pd.DataFrame
            Input DataFrame with potential missing values.

        Returns
        -------
        pd.DataFrame
            DataFrame with rows containing NaN values removed.
        """
        if df.empty:
            return df

        nan_count = df.isna().sum().sum()
        if nan_count > 0:
            original_len = len(df)
            result = df.dropna().reset_index(drop=True)
            excluded = original_len - len(result)
            logger.warning(
                "Excluded %d rows with missing values from reference data "
                "(%d NaN values detected)",
                excluded,
                nan_count,
            )
            return result

        return df
