"""Anomaly detection feature engineering for the FreshChain ML Pipeline.

Computes derived sensor features relevant to anomaly detection:
- Rate of change (first difference) for temperatureC, humidityPct, co2Ppm per sensor
- Z-score relative to trailing 14-day mean and std per sensor
- Door-open frequency (count in trailing 24-hour window) per zone

All features are computed using only data strictly before the prediction
timestamp to prevent temporal data leakage.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger("freshchain_ml_pipeline")


def compute_anomaly_features(
    sensor_readings: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """Compute anomaly detection features from raw sensor data.

    Produces a feature DataFrame suitable for the anomaly detector,
    with one row per scheduled sensor reading timestamp. All rolling
    and cumulative computations use only data strictly before the
    prediction timestamp (no future data leakage).

    Parameters
    ----------
    sensor_readings : pd.DataFrame
        Sensor readings with columns: messageId, storeCode, zoneCode,
        sensorId, measuredAt, temperatureC, humidityPct, co2Ppm,
        oxygenPct, lightLux, doorOpen.
    zones : pd.DataFrame
        Zone metadata with columns: zoneCode, storeCode, zoneType,
        targetTemperatureC.

    Returns
    -------
    pd.DataFrame
        Feature DataFrame with columns: storeCode, zoneCode, sensorId,
        measuredAt, temp_rate_of_change, humidity_rate_of_change,
        co2_rate_of_change, temp_zscore, humidity_zscore, co2_zscore,
        door_open_freq_24h, door_open_duration_24h,
        temp_rolling_std_6h, humidity_rolling_std_6h, temp_deviation_from_target.
    """
    output_columns = [
        "storeCode",
        "zoneCode",
        "sensorId",
        "measuredAt",
        "temp_rate_of_change",
        "humidity_rate_of_change",
        "co2_rate_of_change",
        "temp_zscore",
        "humidity_zscore",
        "co2_zscore",
        "door_open_freq_24h",
        "door_open_duration_24h",
        "temp_rolling_std_6h",
        "humidity_rolling_std_6h",
        "temp_deviation_from_target",
    ]

    if sensor_readings.empty:
        return pd.DataFrame(columns=output_columns)

    # Ensure measuredAt is datetime
    readings = sensor_readings.copy()
    readings["measuredAt"] = pd.to_datetime(readings["measuredAt"])

    # Sort by sensor and time for correct sequential computation
    readings = readings.sort_values(["sensorId", "measuredAt"]).reset_index(drop=True)

    # --- Rate of change (first difference) per sensor ---
    readings = _compute_rate_of_change(readings)

    # --- Z-score relative to trailing 14-day mean and std per sensor ---
    readings = _compute_zscores(readings)

    # --- Short-term rolling volatility (6-hour std) ---
    readings = _compute_rolling_volatility(readings)

    # --- Temperature deviation from zone target ---
    readings = _compute_target_deviation(readings, zones)

    # --- Door-open frequency (count in trailing 24h window) per zone ---
    readings = _compute_door_open_frequency(readings, sensor_readings)

    return readings[output_columns].reset_index(drop=True)


def _compute_rate_of_change(readings: pd.DataFrame) -> pd.DataFrame:
    """Compute rate of change (first difference) per sensor.

    rate_of_change[t] = value[t] - value[t-1] for each sensor.
    The first reading per sensor will have NaN (filled with 0.0).

    Parameters
    ----------
    readings : pd.DataFrame
        Sorted sensor readings with measuredAt as datetime.

    Returns
    -------
    pd.DataFrame
        Readings with rate_of_change columns added.
    """
    result = readings.copy()

    grouped = result.groupby("sensorId")

    # First difference: value[t] - value[t-1]
    result["temp_rate_of_change"] = (
        result["temperatureC"] - grouped["temperatureC"].shift(1)
    )
    result["humidity_rate_of_change"] = (
        result["humidityPct"] - grouped["humidityPct"].shift(1)
    )
    result["co2_rate_of_change"] = (
        result["co2Ppm"] - grouped["co2Ppm"].shift(1)
    )

    # Fill NaN for first reading per sensor with 0.0
    result["temp_rate_of_change"] = result["temp_rate_of_change"].fillna(0.0)
    result["humidity_rate_of_change"] = result["humidity_rate_of_change"].fillna(0.0)
    result["co2_rate_of_change"] = result["co2_rate_of_change"].fillna(0.0)

    return result


def _compute_zscores(readings: pd.DataFrame) -> pd.DataFrame:
    """Compute z-score relative to trailing 14-day mean and std per sensor.

    z_score[t] = (value[t] - trailing_14d_mean) / trailing_14d_std

    Uses shift(1) before rolling to prevent data leakage: the trailing
    mean and std at time t are computed from values strictly before t.
    When std is 0 (constant values), z-score is set to 0.0.

    Parameters
    ----------
    readings : pd.DataFrame
        Sorted sensor readings with measuredAt as datetime.

    Returns
    -------
    pd.DataFrame
        Readings with z-score columns added.
    """
    result = readings.copy()

    # Shift values by 1 within each sensor group to exclude current reading
    grouped = result.groupby("sensorId")
    result["temp_shifted"] = grouped["temperatureC"].shift(1)
    result["humidity_shifted"] = grouped["humidityPct"].shift(1)
    result["co2_shifted"] = grouped["co2Ppm"].shift(1)

    # Compute rolling 14-day mean and std on shifted values per sensor
    zscore_results = []
    for sensor_id, group in result.groupby("sensorId"):
        group = group.copy()
        group = group.set_index("measuredAt")

        # Rolling mean and std on shifted values (backward-looking only)
        temp_mean = group["temp_shifted"].rolling("14D", min_periods=1).mean()
        temp_std = group["temp_shifted"].rolling("14D", min_periods=1).std()

        humidity_mean = group["humidity_shifted"].rolling("14D", min_periods=1).mean()
        humidity_std = group["humidity_shifted"].rolling("14D", min_periods=1).std()

        co2_mean = group["co2_shifted"].rolling("14D", min_periods=1).mean()
        co2_std = group["co2_shifted"].rolling("14D", min_periods=1).std()

        # Z-score = (current_value - trailing_mean) / trailing_std
        # Handle division by zero: when std is 0 or NaN, z-score = 0.0
        group["temp_zscore"] = np.where(
            (temp_std > 0) & temp_std.notna(),
            (group["temperatureC"] - temp_mean) / temp_std,
            0.0,
        )
        group["humidity_zscore"] = np.where(
            (humidity_std > 0) & humidity_std.notna(),
            (group["humidityPct"] - humidity_mean) / humidity_std,
            0.0,
        )
        group["co2_zscore"] = np.where(
            (co2_std > 0) & co2_std.notna(),
            (group["co2Ppm"] - co2_mean) / co2_std,
            0.0,
        )

        group = group.reset_index()
        zscore_results.append(group)

    result = pd.concat(zscore_results, ignore_index=True)

    # Drop intermediate shifted columns
    result = result.drop(columns=["temp_shifted", "humidity_shifted", "co2_shifted"])

    return result


def _compute_rolling_volatility(readings: pd.DataFrame) -> pd.DataFrame:
    """Compute short-term rolling volatility (6-hour std) per sensor.

    High short-term volatility in temperature or humidity can indicate
    sensor malfunctions or environmental disturbances that precede anomalies.
    Uses shift(1) to only use past data.

    Parameters
    ----------
    readings : pd.DataFrame
        Sorted sensor readings with measuredAt as datetime.

    Returns
    -------
    pd.DataFrame
        Readings with temp_rolling_std_6h and humidity_rolling_std_6h columns added.
    """
    result = readings.copy()

    # Compute 6-hour rolling std per sensor (using shifted values to prevent leakage)
    vol_results = []
    for sensor_id, group in result.groupby("sensorId"):
        group = group.copy()
        group = group.set_index("measuredAt")

        shifted_temp = group["temperatureC"].shift(1)
        shifted_humidity = group["humidityPct"].shift(1)

        group["temp_rolling_std_6h"] = shifted_temp.rolling("6h", min_periods=2).std()
        group["humidity_rolling_std_6h"] = shifted_humidity.rolling("6h", min_periods=2).std()

        group = group.reset_index()
        vol_results.append(group)

    result = pd.concat(vol_results, ignore_index=True)

    # Fill NaN with 0 (insufficient history)
    result["temp_rolling_std_6h"] = result["temp_rolling_std_6h"].fillna(0.0)
    result["humidity_rolling_std_6h"] = result["humidity_rolling_std_6h"].fillna(0.0)

    return result


def _compute_target_deviation(readings: pd.DataFrame, zones: pd.DataFrame) -> pd.DataFrame:
    """Compute temperature deviation from zone target temperature.

    A large deviation from the zone's target temperature is a strong
    signal for anomalous conditions (equipment failure, door left open).

    Parameters
    ----------
    readings : pd.DataFrame
        Sorted sensor readings with measuredAt as datetime.
    zones : pd.DataFrame
        Zone metadata with targetTemperatureC column.

    Returns
    -------
    pd.DataFrame
        Readings with temp_deviation_from_target column added.
    """
    result = readings.copy()

    # Merge zone target temperature
    if "targetTemperatureC" in zones.columns:
        zone_targets = zones[["storeCode", "zoneCode", "targetTemperatureC"]].drop_duplicates()
        result = result.merge(zone_targets, on=["storeCode", "zoneCode"], how="left")
        result["temp_deviation_from_target"] = (
            result["temperatureC"] - result["targetTemperatureC"]
        ).abs()
        result = result.drop(columns=["targetTemperatureC"])
    else:
        result["temp_deviation_from_target"] = 0.0

    result["temp_deviation_from_target"] = result["temp_deviation_from_target"].fillna(0.0)

    return result


def _compute_door_open_frequency(
    readings: pd.DataFrame,
    original_readings: pd.DataFrame,
) -> pd.DataFrame:
    """Compute door-open frequency and duration in trailing 24-hour window per zone.

    For each reading at time t in a zone, counts the number of
    False→True transitions (rising edges) of the doorOpen boolean in the
    interval (t-24h, t] for that zone, and computes the total hours the
    door was open in that window.

    Parameters
    ----------
    readings : pd.DataFrame
        Current feature DataFrame.
    original_readings : pd.DataFrame
        Full sensor readings including doorOpen boolean column.

    Returns
    -------
    pd.DataFrame
        Readings with door_open_freq_24h and door_open_duration_24h columns added.
    """
    result = readings.copy()

    # Extract door state from original readings
    door_data = original_readings.copy()
    door_data["measuredAt"] = pd.to_datetime(door_data["measuredAt"])
    door_data = door_data.sort_values(["storeCode", "zoneCode", "measuredAt"]).reset_index(drop=True)

    # Identify rising edges (False→True transitions) per zone
    # A rising edge occurs when doorOpen is True and the previous reading in the same zone was False
    door_data["_prev_door"] = door_data.groupby(["storeCode", "zoneCode"])["doorOpen"].shift(1)
    door_data["_rising_edge"] = (door_data["doorOpen"] == True) & (door_data["_prev_door"] == False)

    rising_edges = door_data[door_data["_rising_edge"]][
        ["storeCode", "zoneCode", "measuredAt"]
    ].copy()

    if rising_edges.empty and (not door_data["doorOpen"].any() if "doorOpen" in door_data.columns else True):
        result["door_open_freq_24h"] = 0
        result["door_open_duration_24h"] = 0.0
        return result

    # Compute door-open frequency and duration per zone per timestamp
    freq_results = []
    for (store, zone), group in result.groupby(["storeCode", "zoneCode"]):
        group = group.copy()

        # --- Door open frequency (rising edges in 24h window) ---
        zone_edges = rising_edges[
            (rising_edges["storeCode"] == store)
            & (rising_edges["zoneCode"] == zone)
        ]["measuredAt"].values
        zone_edge_times = pd.to_datetime(zone_edges)

        if len(zone_edge_times) == 0:
            group["door_open_freq_24h"] = 0
        else:
            counts = []
            for t in group["measuredAt"]:
                window_start = t - pd.Timedelta(hours=24)
                count = int(((zone_edge_times > window_start) & (zone_edge_times <= t)).sum())
                counts.append(count)
            group["door_open_freq_24h"] = counts

        # --- Door open duration (total hours open in 24h window) ---
        zone_door_data = door_data[
            (door_data["storeCode"] == store)
            & (door_data["zoneCode"] == zone)
        ][["measuredAt", "doorOpen"]].copy()
        zone_door_data = zone_door_data.sort_values("measuredAt").reset_index(drop=True)

        if zone_door_data.empty or not zone_door_data["doorOpen"].any():
            group["door_open_duration_24h"] = 0.0
        else:
            durations = []
            zone_times = zone_door_data["measuredAt"].values
            zone_open = zone_door_data["doorOpen"].values.astype(bool)

            for t in group["measuredAt"]:
                window_start = t - pd.Timedelta(hours=24)
                # Get readings in (window_start, t] for this zone
                mask = (zone_times > window_start.to_numpy()) & (zone_times <= t.to_numpy())
                window_times = zone_times[mask]
                window_open = zone_open[mask]

                if len(window_times) == 0:
                    durations.append(0.0)
                    continue

                # Compute total open duration by summing intervals where door is open
                total_open_seconds = 0.0
                for i in range(len(window_times) - 1):
                    if window_open[i]:
                        interval = (pd.Timestamp(window_times[i + 1]) - pd.Timestamp(window_times[i])).total_seconds()
                        total_open_seconds += interval

                # For the last reading, if door is open, count time until t
                if window_open[-1]:
                    interval = (t - pd.Timestamp(window_times[-1])).total_seconds()
                    total_open_seconds += interval

                durations.append(total_open_seconds / 3600.0)

            group["door_open_duration_24h"] = durations

        freq_results.append(group)

    result = pd.concat(freq_results, ignore_index=True)

    return result
