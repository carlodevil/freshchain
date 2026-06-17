"""Pipeline configuration module.

Provides the PipelineConfig dataclass with type-safe defaults, validation,
and YAML-based override capability.
"""

from dataclasses import dataclass, fields
from pathlib import Path
from typing import Union

import yaml


@dataclass
class PipelineConfig:
    """Central configuration for the FreshChain ML Pipeline.

    Controls data generation scale, model training parameters, and output
    paths. All fields have sensible defaults for rapid development iteration
    (1 store / 30 days).

    Parameters
    ----------
    num_stores : int
        Number of retail stores to simulate.
    num_skus_per_store : int
        Number of SKUs (products) per store.
    num_sensors_per_zone : int
        Number of sensors deployed per storage zone.
    num_days : int
        Number of days to simulate.
    random_seed : int
        Global random seed for reproducibility.
    sensor_anomaly_pct : float
        Fraction of sensor readings to inject with anomalies (0.0–1.0).
    demand_shock_pct : float
        Fraction of sales observations to inject with demand shocks (0.0–1.0).
    output_dir : str
        Directory path for pipeline output files.
    reference_data_dir : str
        Directory path containing reference CSV data.
    test_split_pct : float
        Fraction of time range reserved for the test set (0.0–1.0).
    cv_folds : int
        Number of cross-validation folds for temporal evaluation.
    min_pbt_iterations : int
        Minimum iterations for property-based tests.
    """

    num_stores: int = 1
    num_skus_per_store: int = 10
    num_sensors_per_zone: int = 2
    num_days: int = 30
    random_seed: int = 42
    sensor_anomaly_pct: float = 0.05
    demand_shock_pct: float = 0.03
    output_dir: str = "output/"
    reference_data_dir: str = "Synthetic data context/"
    test_split_pct: float = 0.20
    cv_folds: int = 3
    min_pbt_iterations: int = 100

    def validate(self) -> None:
        """Validate configuration parameters and raise on invalid combinations.

        Raises
        ------
        ValueError
            If any parameter is outside its valid range. The error message
            describes which parameter failed and what the valid range is.
        """
        if self.num_stores <= 0:
            raise ValueError(
                f"num_stores must be > 0, got {self.num_stores}"
            )
        if self.num_skus_per_store <= 0:
            raise ValueError(
                f"num_skus_per_store must be > 0, got {self.num_skus_per_store}"
            )
        if self.num_sensors_per_zone <= 0:
            raise ValueError(
                f"num_sensors_per_zone must be > 0, got {self.num_sensors_per_zone}"
            )
        if self.num_days <= 0:
            raise ValueError(
                f"num_days must be > 0, got {self.num_days}"
            )
        if not (0.0 <= self.sensor_anomaly_pct <= 1.0):
            raise ValueError(
                f"sensor_anomaly_pct must be between 0.0 and 1.0, "
                f"got {self.sensor_anomaly_pct}"
            )
        if not (0.0 <= self.demand_shock_pct <= 1.0):
            raise ValueError(
                f"demand_shock_pct must be between 0.0 and 1.0, "
                f"got {self.demand_shock_pct}"
            )
        if not (0.0 <= self.test_split_pct <= 1.0):
            raise ValueError(
                f"test_split_pct must be between 0.0 and 1.0, "
                f"got {self.test_split_pct}"
            )
        if self.cv_folds < 2:
            raise ValueError(
                f"cv_folds must be >= 2, got {self.cv_folds}"
            )

    @classmethod
    def load_from_yaml(cls, path: Union[str, Path]) -> "PipelineConfig":
        """Load configuration from a YAML file, overriding defaults.

        Reads the YAML file and applies any matching keys as overrides to
        the default PipelineConfig values. Unknown keys in the YAML file
        are ignored.

        Parameters
        ----------
        path : str or Path
            Path to the YAML configuration file.

        Returns
        -------
        PipelineConfig
            A new PipelineConfig instance with YAML overrides applied.

        Raises
        ------
        FileNotFoundError
            If the specified YAML file does not exist.
        ValueError
            If the loaded configuration has invalid parameter values.
        """
        path = Path(path)
        with open(path, "r") as f:
            raw = yaml.safe_load(f)

        if raw is None:
            raw = {}

        # Filter to only known fields
        valid_field_names = {field.name for field in fields(cls)}
        overrides = {k: v for k, v in raw.items() if k in valid_field_names}

        config = cls(**overrides)
        config.validate()
        return config
