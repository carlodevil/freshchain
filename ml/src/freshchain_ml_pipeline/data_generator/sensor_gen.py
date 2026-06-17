"""Sensor readings generator for the FreshChain ML Pipeline.

Generates hourly scheduled sensor readings and Poisson-distributed door
open/close events with zone-appropriate environmental distributions and
AR(1) temporal autocorrelation for realistic time-series behaviour.

The output contains a boolean `doorOpen` field that reflects the current
door state for each zone at each timestamp (forward-filled from door events).
"""

import logging
import uuid
from datetime import datetime, timedelta

import numpy as np
import pandas as pd



from freshchain_ml_pipeline.config import PipelineConfig

logger = logging.getLogger("freshchain_ml_pipeline")

# Zone-specific distribution parameters: (mean, std)
ZONE_DISTRIBUTIONS = {
    "ambient": {
        "temperatureC": (24.0, 1.0),
        "humidityPct": (85.0, 5.0),
        "co2Ppm": (310.0, 80.0),
        "lightLux": (500.0, 50.0),
    },
    "chiller": {
        "temperatureC": (3.0, 0.5),
        "humidityPct": (70.0, 5.0),
        "co2Ppm": (250.0, 50.0),
        "lightLux": (100.0, 20.0),
    },
    "freezer": {
        "temperatureC": (-18.0, 0.3),
        "humidityPct": (50.0, 5.0),
        "co2Ppm": (200.0, 30.0),
        "lightLux": (50.0, 10.0),
    },
}

# AR(1) autocorrelation coefficient
AR1_ALPHA = 0.8

# Door event Poisson rates (events per hour)
DOOR_LAMBDA_BUSINESS = 3.0  # 06:00-22:00
DOOR_LAMBDA_NIGHT = 0.5  # 22:00-06:00


def generate_sensor_readings(
    config: PipelineConfig,
    zones_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate synthetic sensor readings with temporal autocorrelation.

    Produces hourly scheduled readings and Poisson-distributed door events
    for each sensor in each zone. Environmental values follow zone-appropriate
    distributions with AR(1) smoothing for realistic transitions.

    The door state is tracked per zone and forward-filled: after a door opens,
    all subsequent readings show doorOpen=True until a close event.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling scale (num_sensors_per_zone,
        num_days) and reproducibility.
    zones_df : pd.DataFrame
        Zones DataFrame with columns: zoneCode, storeCode, zoneType,
        targetTemperatureC.
    rng : np.random.Generator
        NumPy random generator for reproducible output.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: messageId, storeCode, zoneCode, sensorId,
        measuredAt, temperatureC, humidityPct, co2Ppm, oxygenPct, lightLux,
        doorOpen.
    """
    all_readings = []

    sim_start = datetime(2024, 1, 1)
    total_hours = config.num_days * 24

    for _, zone in zones_df.iterrows():
        zone_code = zone["zoneCode"]
        store_code = zone["storeCode"]
        zone_type = zone["zoneType"]

        # Generate scheduled readings for each sensor in this zone
        for sensor_idx in range(config.num_sensors_per_zone):
            sensor_id = f"{zone_code}-S{sensor_idx + 1:02d}"

            scheduled = _generate_scheduled_readings(
                sensor_id=sensor_id,
                store_code=store_code,
                zone_code=zone_code,
                zone_type=zone_type,
                sim_start=sim_start,
                total_hours=total_hours,
                rng=rng,
            )
            all_readings.extend(scheduled)

        # Generate door events for this zone (shared across sensors in zone)
        door_events = _generate_door_events(
            store_code=store_code,
            zone_code=zone_code,
            zone_type=zone_type,
            sim_start=sim_start,
            num_days=config.num_days,
            num_sensors=config.num_sensors_per_zone,
            rng=rng,
        )
        all_readings.extend(door_events)

    df = pd.DataFrame(all_readings)

    # Sort by measuredAt for temporal ordering
    df = df.sort_values("measuredAt").reset_index(drop=True)

    # Forward-fill door state per zone to produce the boolean doorOpen column
    df = _forward_fill_door_state(df)

    # Apply temperature increase correlated with door-open duration
    df = _apply_door_temp_effect(df, rng)

    logger.info(
        "Generated %d sensor readings (%d with door open)",
        len(df),
        int(df["doorOpen"].sum()),
    )

    return df


def _forward_fill_door_state(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill door state per zone to produce boolean doorOpen column.

    After sorting by time, for each zone:
    - Door events that set _door_event_state to True/False mark state changes
    - The state is forward-filled so all readings reflect the current door state
    - Initial state is False (closed)

    Parameters
    ----------
    df : pd.DataFrame
        Combined readings with _door_event_state column (True/False/NaN).

    Returns
    -------
    pd.DataFrame
        DataFrame with boolean doorOpen column, _door_event_state removed.
    """
    # Sort by time (should already be sorted, but ensure)
    df = df.sort_values("measuredAt").reset_index(drop=True)

    # Forward-fill per zone
    result_parts = []
    for zone_code, group in df.groupby("zoneCode"):
        group = group.copy()
        # Forward-fill the door event state within this zone
        # _door_event_state contains True/False/None (object dtype)
        # Convert to float (1.0/0.0/NaN) to avoid object-dtype ffill warnings
        raw = group["_door_event_state"]
        numeric_state = pd.array(
            [1.0 if v is True else (0.0 if v is False else float("nan")) for v in raw],
            dtype="Float64",
        )
        filled = pd.Series(numeric_state, index=group.index).ffill().fillna(0.0)
        group["doorOpen"] = filled.astype(float).astype(bool)
        result_parts.append(group)

    result = pd.concat(result_parts, ignore_index=True)
    # Re-sort by measuredAt after groupby
    result = result.sort_values("measuredAt").reset_index(drop=True)

    # Remove the intermediate column
    result = result.drop(columns=["_door_event_state"])

    return result


def _apply_door_temp_effect(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Apply temperature increase correlated with door-open duration.

    When a door is open, temperature rises cumulatively over time:
    - Chiller zones: +0.5°C to +1.5°C per hour, capped at +5°C
    - Freezer zones: +0.3°C to +1.0°C per hour, capped at +3°C
    - Ambient zones: +0.1°C (minimal effect)

    When the door closes, the offset resets and the AR(1) process in
    subsequent readings naturally returns temperature to normal.

    Parameters
    ----------
    df : pd.DataFrame
        Sensor readings with doorOpen boolean column and measuredAt timestamps.
    rng : np.random.Generator
        Random generator for sampling per-hour rate variability.

    Returns
    -------
    pd.DataFrame
        DataFrame with temperatureC adjusted for door-open effects.
    """
    if df.empty or "doorOpen" not in df.columns:
        return df

    df = df.copy()
    df["measuredAt"] = pd.to_datetime(df["measuredAt"])

    # Determine zone type from zone code
    df["_zone_type"] = df["zoneCode"].apply(_extract_zone_type_from_code)

    # Process each zone group independently
    for zone_code, group in df.groupby("zoneCode"):
        group_idx = group.index
        zone_type = group["_zone_type"].iloc[0]

        # Determine rate range and cap based on zone type
        if zone_type == "chiller":
            rate_min, rate_max = 0.5, 1.5
            cap = 5.0
        elif zone_type == "freezer":
            rate_min, rate_max = 0.3, 1.0
            cap = 3.0
        else:  # ambient
            rate_min, rate_max = 0.1, 0.1
            cap = 0.5

        # Track cumulative door-open hours and compute offsets
        door_open_vals = group["doorOpen"].values
        timestamps = group["measuredAt"].values

        offsets = np.zeros(len(group), dtype=np.float64)
        cumulative_hours = 0.0
        prev_open = False

        for i in range(len(group)):
            is_open = bool(door_open_vals[i])

            if is_open:
                if prev_open and i > 0:
                    # Accumulate hours since last reading
                    dt_hours = (
                        (timestamps[i] - timestamps[i - 1])
                        / np.timedelta64(1, "h")
                    )
                    cumulative_hours += max(0.0, float(dt_hours))
                elif not prev_open:
                    # Door just opened — start accumulating
                    cumulative_hours = 0.0

                # Sample a rate for this reading
                rate = rng.uniform(rate_min, rate_max)
                offsets[i] = min(rate * cumulative_hours, cap)
            else:
                # Door is closed — reset cumulative hours
                cumulative_hours = 0.0
                offsets[i] = 0.0

            prev_open = is_open

        # Apply offsets to temperature
        df.loc[group_idx, "temperatureC"] = (
            df.loc[group_idx, "temperatureC"].values + offsets
        )

    # Clean up helper column
    df = df.drop(columns=["_zone_type"])

    return df


def _extract_zone_type_from_code(zone_code: str) -> str:
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


def _generate_scheduled_readings(
    sensor_id: str,
    store_code: str,
    zone_code: str,
    zone_type: str,
    sim_start: datetime,
    total_hours: int,
    rng: np.random.Generator,
) -> list[dict]:
    """Generate hourly scheduled readings with AR(1) autocorrelation.

    Parameters
    ----------
    sensor_id : str
        Unique sensor identifier.
    store_code : str
        Store code for this sensor.
    zone_code : str
        Zone code for this sensor.
    zone_type : str
        Zone type (ambient, chiller, freezer).
    sim_start : datetime
        Simulation start timestamp.
    total_hours : int
        Total number of hours to simulate.
    rng : np.random.Generator
        Random generator for reproducibility.

    Returns
    -------
    list[dict]
        List of reading dictionaries.
    """
    dist = ZONE_DISTRIBUTIONS[zone_type]

    # Initialize AR(1) state at the target mean for each variable
    temp_state = dist["temperatureC"][0]
    humidity_state = dist["humidityPct"][0]
    co2_state = dist["co2Ppm"][0]
    light_state = dist["lightLux"][0]

    readings = []

    for hour_idx in range(total_hours):
        timestamp = sim_start + timedelta(hours=hour_idx)

        # AR(1) process: x[t] = alpha * x[t-1] + (1-alpha) * target + noise
        temp_state = _ar1_step(
            temp_state, dist["temperatureC"][0], dist["temperatureC"][1], rng
        )
        humidity_state = _ar1_step(
            humidity_state, dist["humidityPct"][0], dist["humidityPct"][1], rng
        )
        co2_state = _ar1_step(
            co2_state, dist["co2Ppm"][0], dist["co2Ppm"][1], rng
        )
        light_state = _ar1_step(
            light_state, dist["lightLux"][0], dist["lightLux"][1], rng
        )

        # Oxygen is approximately 20.9% with small noise
        oxygen_pct = 20.9 + rng.normal(0, 0.05)

        readings.append(
            {
                "messageId": _generate_uuid(rng),
                "storeCode": store_code,
                "zoneCode": zone_code,
                "sensorId": sensor_id,
                "measuredAt": timestamp.strftime("%Y-%m-%dT%H:%M:%S"),
                "temperatureC": round(temp_state, 2),
                "humidityPct": round(max(0.0, humidity_state), 2),
                "co2Ppm": round(max(0.0, co2_state), 2),
                "oxygenPct": round(oxygen_pct, 2),
                "lightLux": round(max(0.0, light_state), 2),
                "_door_event_state": None,  # Not a door event
            }
        )

    return readings


def _generate_uuid(rng: np.random.Generator) -> str:
    """Generate a reproducible UUID4-format string from the random generator.

    Parameters
    ----------
    rng : np.random.Generator
        Random generator for reproducibility.

    Returns
    -------
    str
        UUID4-format string.
    """
    # Generate 16 random bytes using the seeded generator
    random_bytes = rng.integers(0, 256, size=16, dtype=np.uint8).tobytes()
    return str(uuid.UUID(bytes=random_bytes, version=4))


def _ar1_step(
    current: float, target: float, noise_std: float, rng: np.random.Generator
) -> float:
    """Compute one step of an AR(1) process.

    Parameters
    ----------
    current : float
        Current state value.
    target : float
        Long-run mean (target value).
    noise_std : float
        Standard deviation of the innovation noise.
    rng : np.random.Generator
        Random generator.

    Returns
    -------
    float
        Next state value.
    """
    noise = rng.normal(0, noise_std * (1 - AR1_ALPHA))
    return AR1_ALPHA * current + (1 - AR1_ALPHA) * target + noise


def _generate_door_events(
    store_code: str,
    zone_code: str,
    zone_type: str,
    sim_start: datetime,
    num_days: int,
    num_sensors: int,
    rng: np.random.Generator,
) -> list[dict]:
    """Generate door open/close events with Poisson-distributed frequency.

    Door events alternate between open and close states per zone. Event
    frequency is higher during business hours (06:00-22:00) and lower
    overnight (22:00-06:00).

    Parameters
    ----------
    store_code : str
        Store code for this zone.
    zone_code : str
        Zone code.
    zone_type : str
        Zone type (ambient, chiller, freezer).
    sim_start : datetime
        Simulation start timestamp.
    num_days : int
        Number of days to simulate.
    num_sensors : int
        Number of sensors in this zone (first sensor reports door events).
    rng : np.random.Generator
        Random generator for reproducibility.

    Returns
    -------
    list[dict]
        List of door event reading dictionaries.
    """
    dist = ZONE_DISTRIBUTIONS[zone_type]
    events = []

    # Door state alternates: starts closed, first event is "open"
    door_is_open = False

    # Generate events hour by hour using Poisson process
    for day in range(num_days):
        for hour in range(24):
            timestamp_base = sim_start + timedelta(days=day, hours=hour)

            # Determine lambda based on business hours
            if 6 <= hour < 22:
                lam = DOOR_LAMBDA_BUSINESS
            else:
                lam = DOOR_LAMBDA_NIGHT

            # Number of door events this hour (Poisson)
            num_events = int(rng.poisson(lam))

            # Generate sorted event offsets within this hour
            if num_events > 0:
                raw_offsets = rng.integers(0, 3600, size=num_events)
                offsets = sorted(set(raw_offsets.tolist()))
            else:
                offsets = []

            # Generate event timestamps within this hour
            for offset_seconds in offsets:
                event_time = timestamp_base + timedelta(seconds=int(offset_seconds))

                # Alternate door state
                door_is_open = not door_is_open

                # Use first sensor in zone for door event readings
                sensor_id = f"{zone_code}-S01"

                # Sample environmental values at event time (snapshot)
                temp = rng.normal(dist["temperatureC"][0], dist["temperatureC"][1])
                humidity = max(0.0, rng.normal(dist["humidityPct"][0], dist["humidityPct"][1]))
                co2 = max(0.0, rng.normal(dist["co2Ppm"][0], dist["co2Ppm"][1]))
                oxygen = 20.9 + rng.normal(0, 0.05)
                light = max(0.0, rng.normal(dist["lightLux"][0], dist["lightLux"][1]))

                events.append(
                    {
                        "messageId": _generate_uuid(rng),
                        "storeCode": store_code,
                        "zoneCode": zone_code,
                        "sensorId": sensor_id,
                        "measuredAt": event_time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "temperatureC": round(temp, 2),
                        "humidityPct": round(humidity, 2),
                        "co2Ppm": round(co2, 2),
                        "oxygenPct": round(oxygen, 2),
                        "lightLux": round(light, 2),
                        "_door_event_state": door_is_open,  # True=open, False=close
                    }
                )

    logger.debug(
        "Generated %d door events for zone %s", len(events), zone_code
    )

    return events
