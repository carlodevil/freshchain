"""Data generator orchestrator for the FreshChain ML Pipeline.

Coordinates the generation of all synthetic datasets in the correct order:
reference data → sensor readings → anomaly injection → sales observations.
Produces a DataManifest with paths to all output CSV files and metadata.
"""

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.data_generator.anomaly_injector import inject_anomalies
from freshchain_ml_pipeline.data_generator.reference_gen import generate_reference_data
from freshchain_ml_pipeline.data_generator.sales_gen import generate_sales_observations
from freshchain_ml_pipeline.data_generator.sensor_gen import generate_sensor_readings
from freshchain_ml_pipeline.data_generator.target_gen import generate_targets

logger = logging.getLogger("freshchain_ml_pipeline")


@dataclass
class DataManifest:
    """Manifest describing all generated CSV files and generation metadata.

    Attributes
    ----------
    sensor_readings_path : Path
        Path to the sensor_readings.csv file.
    sales_observations_path : Path
        Path to the sales_observations.csv file.
    stores_path : Path
        Path to the stores.csv file.
    zones_path : Path
        Path to the zones.csv file.
    products_path : Path
        Path to the products.csv file.
    batches_path : Path
        Path to the batches.csv file.
    inventory_placements_path : Path
        Path to the inventory_placements.csv file.
    metadata : dict
        Dictionary containing row counts and generation timing information.
    """

    sensor_readings_path: Path
    sales_observations_path: Path
    stores_path: Path
    zones_path: Path
    products_path: Path
    batches_path: Path
    inventory_placements_path: Path
    spoilage_targets_path: Path | None = None
    shelf_life_targets_path: Path | None = None
    metadata: dict = field(default_factory=dict)


class DataGenerator:
    """Orchestrates synthetic data generation for the FreshChain pipeline.

    Coordinates the sequential execution of sub-generators in the correct
    dependency order and saves all outputs as CSV files.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling scale, seed, and output paths.
    """

    def __init__(self, config: PipelineConfig) -> None:
        self.config = config

    def generate_all(self) -> DataManifest:
        """Generate all synthetic datasets and save to CSV files.

        Execution order:
        1. Reference data (stores, zones, products, batches, placements)
        2. Sensor readings (hourly scheduled + door events)
        3. Anomaly injection into sensor readings
        4. Sales observations (daily per store/SKU)

        Returns
        -------
        DataManifest
            Manifest with paths to all generated CSV files and metadata
            including row counts and generation timing.
        """
        overall_start = time.time()
        metadata: dict = {}

        # Create output directory
        output_dir = Path(self.config.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Seed the random generator for reproducibility
        rng = np.random.default_rng(self.config.random_seed)

        # --- Step 1: Generate reference data ---
        logger.info("Starting reference data generation")
        ref_start = time.time()

        reference_data = generate_reference_data(self.config, rng)

        stores_df = reference_data["stores"]
        zones_df = reference_data["zones"]
        products_df = reference_data["products"]
        batches_df = reference_data["batches"]
        inventory_placements_df = reference_data["inventory_placements"]

        ref_end = time.time()
        logger.info(
            "Reference data generation complete in %.2fs: "
            "%d stores, %d zones, %d products, %d batches, %d placements",
            ref_end - ref_start,
            len(stores_df),
            len(zones_df),
            len(products_df),
            len(batches_df),
            len(inventory_placements_df),
        )
        metadata["reference_gen_seconds"] = round(ref_end - ref_start, 3)
        metadata["stores_rows"] = len(stores_df)
        metadata["zones_rows"] = len(zones_df)
        metadata["products_rows"] = len(products_df)
        metadata["batches_rows"] = len(batches_df)
        metadata["inventory_placements_rows"] = len(inventory_placements_df)

        # --- Step 2: Generate sensor readings ---
        logger.info("Starting sensor readings generation")
        sensor_start = time.time()

        sensor_readings_df = generate_sensor_readings(self.config, zones_df, rng)

        sensor_end = time.time()
        logger.info(
            "Sensor readings generation complete in %.2fs: %d rows",
            sensor_end - sensor_start,
            len(sensor_readings_df),
        )
        metadata["sensor_gen_seconds"] = round(sensor_end - sensor_start, 3)
        metadata["sensor_readings_rows_before_anomalies"] = len(sensor_readings_df)

        # --- Step 3: Inject anomalies ---
        logger.info("Starting anomaly injection")
        anomaly_start = time.time()

        sensor_readings_df = inject_anomalies(
            sensor_readings_df, self.config.sensor_anomaly_pct, rng
        )

        anomaly_end = time.time()
        logger.info(
            "Anomaly injection complete in %.2fs: %d total readings",
            anomaly_end - anomaly_start,
            len(sensor_readings_df),
        )
        metadata["anomaly_injection_seconds"] = round(
            anomaly_end - anomaly_start, 3
        )
        metadata["sensor_readings_rows"] = len(sensor_readings_df)

        # --- Step 4: Generate sales observations ---
        logger.info("Starting sales observations generation")
        sales_start = time.time()

        sales_observations_df = generate_sales_observations(
            self.config,
            stores_df,
            products_df,
            batches_df,
            inventory_placements_df,
            sensor_readings_df,
            rng,
        )

        sales_end = time.time()
        logger.info(
            "Sales observations generation complete in %.2fs: %d rows",
            sales_end - sales_start,
            len(sales_observations_df),
        )
        metadata["sales_gen_seconds"] = round(sales_end - sales_start, 3)
        metadata["sales_observations_rows"] = len(sales_observations_df)

        # --- Step 5: Generate target labels ---
        logger.info("Starting target label generation")
        target_start = time.time()

        targets = generate_targets(
            self.config,
            sensor_readings_df,
            sales_observations_df,
            inventory_placements_df,
            batches_df,
            products_df,
            zones_df,
            rng,
        )

        spoilage_targets_df = targets["spoilage_targets"]
        shelf_life_targets_df = targets["shelf_life_targets"]

        target_end = time.time()
        logger.info(
            "Target generation complete in %.2fs: spoilage=%d, shelf_life=%d",
            target_end - target_start,
            len(spoilage_targets_df),
            len(shelf_life_targets_df),
        )
        metadata["target_gen_seconds"] = round(target_end - target_start, 3)
        metadata["spoilage_targets_rows"] = len(spoilage_targets_df)
        metadata["shelf_life_targets_rows"] = len(shelf_life_targets_df)

        # --- Save all DataFrames to CSV ---
        stores_path = output_dir / "stores.csv"
        zones_path = output_dir / "zones.csv"
        products_path = output_dir / "products.csv"
        batches_path = output_dir / "batches.csv"
        inventory_placements_path = output_dir / "inventory_placements.csv"
        sensor_readings_path = output_dir / "sensor_readings.csv"
        sales_observations_path = output_dir / "sales_observations.csv"

        stores_df.to_csv(stores_path, index=False)
        zones_df.to_csv(zones_path, index=False)
        products_df.to_csv(products_path, index=False)
        batches_df.to_csv(batches_path, index=False)
        inventory_placements_df.to_csv(inventory_placements_path, index=False)
        sensor_readings_df.to_csv(sensor_readings_path, index=False)
        sales_observations_df.to_csv(sales_observations_path, index=False)

        # Save target CSVs
        spoilage_targets_path = output_dir / "spoilage_targets.csv"
        shelf_life_targets_path = output_dir / "shelf_life_targets.csv"
        spoilage_targets_df.to_csv(spoilage_targets_path, index=False)
        shelf_life_targets_df.to_csv(shelf_life_targets_path, index=False)

        overall_end = time.time()
        metadata["total_generation_seconds"] = round(
            overall_end - overall_start, 3
        )

        logger.info(
            "All data generation complete in %.2fs. Files saved to %s",
            overall_end - overall_start,
            output_dir,
        )

        return DataManifest(
            sensor_readings_path=sensor_readings_path,
            sales_observations_path=sales_observations_path,
            stores_path=stores_path,
            zones_path=zones_path,
            products_path=products_path,
            batches_path=batches_path,
            inventory_placements_path=inventory_placements_path,
            spoilage_targets_path=spoilage_targets_path,
            shelf_life_targets_path=shelf_life_targets_path,
            metadata=metadata,
        )
