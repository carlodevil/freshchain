"""Visualisation module for generating feature importance and partial dependence plots.

Produces matplotlib/seaborn charts for each trained model and saves them
to the configured output directory.

Requirements: 13.5
"""

import logging
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for headless environments

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

logger = logging.getLogger("freshchain_ml_pipeline")


def generate_importance_chart(
    model_name: str,
    importance_df: pd.DataFrame,
    output_dir: str,
) -> Path:
    """Generate a feature importance bar chart for a model.

    Creates a horizontal bar chart showing feature importance scores,
    sorted by importance descending. Saves the chart as a PNG file.

    Parameters
    ----------
    model_name : str
        Name of the model (used in title and filename).
    importance_df : pd.DataFrame
        DataFrame with columns: feature_name, importance_score.
    output_dir : str
        Directory path where the chart will be saved.

    Returns
    -------
    Path
        Path to the saved chart file.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Limit to top 15 features for readability
    plot_df = importance_df.head(15).copy()

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.barplot(
        data=plot_df,
        x="importance_score",
        y="feature_name",
        ax=ax,
        color="steelblue",
    )
    ax.set_title(f"Feature Importance — {model_name}", fontsize=14)
    ax.set_xlabel("Importance Score", fontsize=11)
    ax.set_ylabel("Feature", fontsize=11)
    plt.tight_layout()

    filename = f"feature_importance_{_sanitize_name(model_name)}.png"
    filepath = output_path / filename
    plt.savefig(filepath, dpi=100, bbox_inches="tight")
    plt.close(fig)

    logger.info("Saved feature importance chart: %s", filepath)
    return filepath


def generate_pdp_chart(
    model_name: str,
    model,
    X: pd.DataFrame,
    feature_names: list,
    output_dir: str,
) -> Path:
    """Generate partial dependence plots for a model.

    Creates partial dependence plots for the top features (up to 4).
    For models that support sklearn's partial_dependence, uses that;
    otherwise generates a simple marginal effect plot.

    Parameters
    ----------
    model_name : str
        Name of the model (used in title and filename).
    model : object
        Trained model with a predict method.
    X : pd.DataFrame
        Feature matrix used for computing partial dependence.
    feature_names : list
        List of feature names to plot (uses top 4).
    output_dir : str
        Directory path where the chart will be saved.

    Returns
    -------
    Path
        Path to the saved chart file.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Select top features (up to 4) that exist in X
    plot_features = [f for f in feature_names[:4] if f in X.columns]

    if not plot_features:
        # If no matching features, use first 4 columns of X
        plot_features = list(X.columns[:4])

    n_features = len(plot_features)
    if n_features == 0:
        logger.warning("No features available for PDP chart")
        # Create an empty placeholder chart
        fig, ax = plt.subplots(figsize=(8, 6))
        ax.text(0.5, 0.5, "No features available", ha="center", va="center")
        ax.set_title(f"Partial Dependence — {model_name}")
        filename = f"pdp_{_sanitize_name(model_name)}.png"
        filepath = output_path / filename
        plt.savefig(filepath, dpi=100, bbox_inches="tight")
        plt.close(fig)
        return filepath

    # Try sklearn partial_dependence first
    try:
        from sklearn.inspection import partial_dependence

        fig, axes = plt.subplots(
            1, n_features, figsize=(4 * n_features, 4), squeeze=False
        )

        sample_size = min(200, len(X))
        X_sample = X.iloc[:sample_size]

        for i, feature in enumerate(plot_features):
            feature_idx = list(X.columns).index(feature)
            pdp_result = partial_dependence(
                model,
                X_sample,
                features=[feature_idx],
                kind="average",
            )
            ax = axes[0, i]
            ax.plot(pdp_result["grid_values"][0], pdp_result["average"][0])
            ax.set_xlabel(feature, fontsize=10)
            ax.set_ylabel("Partial Dependence", fontsize=10)
            ax.set_title(feature, fontsize=11)

        fig.suptitle(
            f"Partial Dependence Plots — {model_name}", fontsize=13, y=1.02
        )
        plt.tight_layout()

    except Exception as e:
        logger.warning(
            "sklearn partial_dependence failed for %s: %s. "
            "Generating marginal effect plots instead.",
            model_name,
            str(e),
        )
        fig, axes = plt.subplots(
            1, n_features, figsize=(4 * n_features, 4), squeeze=False
        )

        sample_size = min(200, len(X))
        X_sample = X.iloc[:sample_size].copy()

        for i, feature in enumerate(plot_features):
            ax = axes[0, i]
            # Simple marginal effect: sort by feature, plot predictions
            sorted_idx = X_sample[feature].argsort()
            x_vals = X_sample[feature].iloc[sorted_idx].values
            try:
                preds = model.predict(X_sample.iloc[sorted_idx])
                if isinstance(preds, pd.DataFrame):
                    preds = preds.iloc[:, 0].values
                elif isinstance(preds, np.ndarray) and preds.ndim > 1:
                    preds = preds[:, 0]
                ax.scatter(x_vals, preds, alpha=0.3, s=10)
                ax.set_xlabel(feature, fontsize=10)
                ax.set_ylabel("Prediction", fontsize=10)
                ax.set_title(feature, fontsize=11)
            except Exception:
                ax.text(0.5, 0.5, "Error", ha="center", va="center")
                ax.set_title(feature, fontsize=11)

        fig.suptitle(
            f"Marginal Effect Plots — {model_name}", fontsize=13, y=1.02
        )
        plt.tight_layout()

    filename = f"pdp_{_sanitize_name(model_name)}.png"
    filepath = output_path / filename
    plt.savefig(filepath, dpi=100, bbox_inches="tight")
    plt.close(fig)

    logger.info("Saved PDP chart: %s", filepath)
    return filepath


def _sanitize_name(name: str) -> str:
    """Sanitize a model name for use in filenames.

    Parameters
    ----------
    name : str
        Model name to sanitize.

    Returns
    -------
    str
        Sanitized name with spaces and special characters replaced.
    """
    return name.lower().replace(" ", "_").replace("/", "_").replace("\\", "_")
