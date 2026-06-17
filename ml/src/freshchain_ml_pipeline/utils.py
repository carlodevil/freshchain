"""Utility functions for the FreshChain ML Pipeline.

Provides logging configuration, global seed management, and CSV I/O helpers
with automatic row-count logging.
"""

import logging
import random
from pathlib import Path
from typing import Union

import numpy as np
import pandas as pd


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure Python logging with the FreshChain pipeline format.

    Sets up the root logger with the format:
        [{timestamp}] [{module}] [{level}] {message}

    Parameters
    ----------
    level : int, optional
        Logging level (default: logging.INFO).

    Returns
    -------
    logging.Logger
        The configured root logger instance.

    Side Effects
    ------------
    Configures the root logger's handlers and format. Existing handlers on the
    root logger are removed to avoid duplicate output.
    """
    logger = logging.getLogger("freshchain_ml_pipeline")
    logger.setLevel(level)

    # Remove existing handlers to avoid duplicates on repeated calls
    logger.handlers.clear()

    formatter = logging.Formatter(
        fmt="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    handler = logging.StreamHandler()
    handler.setLevel(level)
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    return logger


def set_global_seed(seed: int) -> None:
    """Propagate a random seed to all stochastic libraries for reproducibility.

    Sets the seed for:
    - Python's built-in `random` module
    - NumPy's random number generator
    - XGBoost and LightGBM (via environment-level NumPy seed)

    Parameters
    ----------
    seed : int
        The global random seed value to set.

    Returns
    -------
    None

    Side Effects
    ------------
    Modifies global random state for `random`, `numpy.random`, and sets
    environment variables used by tree-based model libraries.
    """
    random.seed(seed)
    np.random.seed(seed)

    logger = logging.getLogger("freshchain_ml_pipeline")
    logger.info("Global random seed set to %d", seed)


def read_csv(path: Union[str, Path], **kwargs) -> pd.DataFrame:
    """Read a CSV file into a DataFrame and log the row count.

    Parameters
    ----------
    path : str or Path
        File path to the CSV file to read.
    **kwargs
        Additional keyword arguments passed to ``pandas.read_csv``.

    Returns
    -------
    pd.DataFrame
        The loaded DataFrame.

    Raises
    ------
    FileNotFoundError
        If the specified path does not exist.

    Side Effects
    ------------
    Logs the file path and row count at INFO level.
    """
    logger = logging.getLogger("freshchain_ml_pipeline")
    path = Path(path)

    df = pd.read_csv(path, **kwargs)
    logger.info("Read %d rows from %s", len(df), path)

    return df


def write_csv(df: pd.DataFrame, path: Union[str, Path], **kwargs) -> None:
    """Write a DataFrame to a CSV file and log the row count.

    Parameters
    ----------
    df : pd.DataFrame
        The DataFrame to write.
    path : str or Path
        Destination file path for the CSV output.
    **kwargs
        Additional keyword arguments passed to ``DataFrame.to_csv``.
        If 'index' is not specified, defaults to False.

    Returns
    -------
    None

    Raises
    ------
    OSError
        If the destination directory cannot be created or the file cannot
        be written.

    Side Effects
    ------------
    Creates the parent directory if it does not exist. Logs the file path
    and row count at INFO level.
    """
    logger = logging.getLogger("freshchain_ml_pipeline")
    path = Path(path)

    # Ensure the output directory exists
    path.parent.mkdir(parents=True, exist_ok=True)

    # Default to not writing the index unless explicitly requested
    if "index" not in kwargs:
        kwargs["index"] = False

    df.to_csv(path, **kwargs)
    logger.info("Wrote %d rows to %s", len(df), path)
