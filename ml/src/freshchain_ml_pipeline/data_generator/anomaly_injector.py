"""Anomaly injection module for the FreshChain ML Pipeline.

Injects realistic sensor faults into generated sensor readings to enable
training and evaluation of anomaly detection models. Supports three fault
types: stuck values, sudden spikes, and drift patterns.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")

# Anomaly type distribution: roughly equal thirds
_ANOMALY_TYPES = ["stuck", "spike", "drift"]

# Spike magnitude range (degrees Celsius added to temperature)
_SPIKE_OFFSET_MIN = 10.0
_SPIKE_OFFSET_MAX = 20.0

# Drift cumulative offset per consecutive reading (degrees Celsius)
_DRIFT_INCREMENT_MIN = 0.5
_DRIFT_INCREMENT_MAX = 1.5

# Minimum consecutive readings for a drift pattern
_DRIFT_MIN_LENGTH = 3
_DRIFT_MAX_LENGTH = 8


def inject_anomalies(
    readings_df: pd.DataFrame,
    anomaly_pct: float = 0.05,
    rng: np.random.Generator = None,
) -> pd.DataFrame:
    """Inject realistic sensor anomalies into a readings DataFrame.

    Selects a configurable fraction of readings and applies one of three
    anomaly types: stuck values, sudden spikes, or drift patterns. Adds
    internal flag columns for later evaluation.

    Parameters
    ----------
    readings_df : pd.DataFrame
        Sensor readings DataFrame with columns including temperatureC,
        sensorId, measuredAt, and doorOpen (boolean).
    anomaly_pct : float, optional
        Fraction of readings to inject with anomalies (0.0–1.0).
        Default is 0.05 (5%).
    rng : np.random.Generator, optional
        NumPy random generator for reproducibility. If None, a default
        generator is created.

    Returns
    -------
    pd.DataFrame
        Modified DataFrame with two additional columns:
        - _anomaly_injected (bool): True for readings with injected anomalies.
        - _anomaly_type (str or None): "stuck", "spike", "drift", or None.

    Notes
    -----
    All readings are eligible for anomaly injection. The doorOpen boolean
    column is left unchanged. The anomaly types are distributed roughly
    equally (1/3 each).
    """
    if rng is None:
        rng = np.random.default_rng()

    # Work on a copy to avoid mutating the input
    df = readings_df.copy()

    # Initialize flag columns
    df["_anomaly_injected"] = False
    df["_anomaly_type"] = None

    # Inject into all readings
    scheduled_mask = pd.Series(True, index=df.index)
    scheduled_indices = df.index[scheduled_mask].tolist()

    if len(scheduled_indices) == 0:
        logger.warning("No readings found; skipping anomaly injection.")
        return df

    # Determine how many readings to inject
    num_to_inject = max(1, int(len(scheduled_indices) * anomaly_pct))

    if num_to_inject == 0:
        logger.info("Anomaly percentage too low for dataset size; no anomalies injected.")
        return df

    # Randomly select readings for injection
    selected_indices = rng.choice(
        scheduled_indices, size=num_to_inject, replace=False
    )

    # Assign anomaly types roughly equally
    anomaly_assignments = rng.choice(_ANOMALY_TYPES, size=num_to_inject)

    # Group by anomaly type for batch processing
    stuck_indices = selected_indices[anomaly_assignments == "stuck"]
    spike_indices = selected_indices[anomaly_assignments == "spike"]
    drift_indices = selected_indices[anomaly_assignments == "drift"]

    # Apply stuck values
    _apply_stuck_values(df, stuck_indices)

    # Apply sudden spikes
    _apply_spikes(df, spike_indices, rng)

    # Apply drift patterns
    _apply_drift(df, drift_indices, rng)

    injected_count = int(df["_anomaly_injected"].sum())
    logger.info(
        "Injected %d anomalies into %d readings (%.1f%%): "
        "%d stuck, %d spike, %d drift",
        injected_count,
        len(scheduled_indices),
        100.0 * injected_count / len(scheduled_indices),
        len(stuck_indices),
        len(spike_indices),
        int(df["_anomaly_type"].eq("drift").sum()),
    )

    return df


def _apply_stuck_values(df: pd.DataFrame, indices: np.ndarray) -> None:
    """Apply stuck-value anomalies by copying the previous reading's temperature.

    For each selected index, the temperature is set to the same value as
    the preceding reading from the same sensor. If no previous reading
    exists, the value is left unchanged but still flagged.

    Parameters
    ----------
    df : pd.DataFrame
        The readings DataFrame (modified in place).
    indices : np.ndarray
        Array of DataFrame indices to apply stuck values to.
    """
    for idx in indices:
        sensor_id = df.at[idx, "sensorId"]

        # Find the previous reading from the same sensor
        sensor_mask = (
            (df["sensorId"] == sensor_id)
            & (df.index < idx)
        )
        prev_readings = df.loc[sensor_mask]

        if len(prev_readings) > 0:
            prev_idx = prev_readings.index[-1]
            df.at[idx, "temperatureC"] = df.at[prev_idx, "temperatureC"]

        df.at[idx, "_anomaly_injected"] = True
        df.at[idx, "_anomaly_type"] = "stuck"


def _apply_spikes(
    df: pd.DataFrame, indices: np.ndarray, rng: np.random.Generator
) -> None:
    """Apply sudden spike anomalies by adding a large offset to temperature.

    Each spike adds a random offset between +10°C and +20°C to the
    existing temperature value.

    Parameters
    ----------
    df : pd.DataFrame
        The readings DataFrame (modified in place).
    indices : np.ndarray
        Array of DataFrame indices to apply spikes to.
    rng : np.random.Generator
        Random generator for offset magnitude.
    """
    if len(indices) == 0:
        return

    offsets = rng.uniform(_SPIKE_OFFSET_MIN, _SPIKE_OFFSET_MAX, size=len(indices))

    for i, idx in enumerate(indices):
        df.at[idx, "temperatureC"] = round(
            df.at[idx, "temperatureC"] + offsets[i], 2
        )
        df.at[idx, "_anomaly_injected"] = True
        df.at[idx, "_anomaly_type"] = "spike"


def _apply_drift(
    df: pd.DataFrame, indices: np.ndarray, rng: np.random.Generator
) -> None:
    """Apply drift pattern anomalies with cumulative temperature increase.

    For each selected index, a drift pattern is applied over a sequence of
    consecutive readings from the same sensor, gradually increasing the
    temperature with a cumulative offset.

    Parameters
    ----------
    df : pd.DataFrame
        The readings DataFrame (modified in place).
    indices : np.ndarray
        Array of DataFrame indices that serve as drift start points.
    rng : np.random.Generator
        Random generator for drift parameters.
    """
    for idx in indices:
        sensor_id = df.at[idx, "sensorId"]

        # Find consecutive readings from the same sensor
        sensor_readings = df[df["sensorId"] == sensor_id]
        sensor_indices = sensor_readings.index.tolist()

        # Find position of current index in sensor's reading sequence
        try:
            pos = sensor_indices.index(idx)
        except ValueError:
            continue

        # Determine drift length
        drift_length = int(rng.integers(_DRIFT_MIN_LENGTH, _DRIFT_MAX_LENGTH + 1))
        drift_increment = rng.uniform(_DRIFT_INCREMENT_MIN, _DRIFT_INCREMENT_MAX)

        # Apply cumulative drift to consecutive readings
        for step in range(drift_length):
            target_pos = pos + step
            if target_pos >= len(sensor_indices):
                break

            target_idx = sensor_indices[target_pos]
            cumulative_offset = drift_increment * (step + 1)

            df.at[target_idx, "temperatureC"] = round(
                df.at[target_idx, "temperatureC"] + cumulative_offset, 2
            )
            df.at[target_idx, "_anomaly_injected"] = True
            df.at[target_idx, "_anomaly_type"] = "drift"
