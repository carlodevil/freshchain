"""Train and export complete FreshChain model wrappers.

The wrappers are exported instead of their underlying estimators so calibrated
thresholds, anomaly rules, confidence logic, and feature-column state survive.
"""

import json
import os
from pathlib import Path

import joblib

from freshchain_ml_pipeline.config import PipelineConfig
from freshchain_ml_pipeline.data_generator.generator import DataGenerator
from freshchain_ml_pipeline.feature_engine.engine import FeatureEngine
from freshchain_ml_pipeline.main import (
    _build_replenishment_features,
    _encode_categorical_columns,
)
from freshchain_ml_pipeline.models.anomaly_detector import AnomalyDetector
from freshchain_ml_pipeline.models.demand_forecaster import DemandForecaster
from freshchain_ml_pipeline.models.replenishment_model import ReplenishmentModel
from freshchain_ml_pipeline.models.shelf_life_estimator import ShelfLifeEstimator
from freshchain_ml_pipeline.models.spoilage_classifier import SpoilageClassifier
from freshchain_ml_pipeline.utils import set_global_seed


MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/model"))
TRAINING_DIR = Path(os.environ.get("TRAINING_DIR", "/app/training-data"))


def prepared(features, target, time_column):
    excluded = {target, time_column}
    columns = [column for column in features.columns if column not in excluded]
    categorical_mappings = {}
    for column in columns:
        if features[column].dtype == object:
            categories = features[column].astype("category").cat.categories
            categorical_mappings[column] = {
                str(value): index for index, value in enumerate(categories)
            }
    encoded = _encode_categorical_columns(features[columns])
    valid = encoded.notna().all(axis=1) & features[target].notna()
    return (
        encoded.loc[valid].reset_index(drop=True),
        features.loc[valid, target].reset_index(drop=True),
        categorical_mappings,
    )


def train_models(config):
    manifest = DataGenerator(config).generate_all()
    engine = FeatureEngine(config)

    spoilage = engine.build_spoilage_features(manifest)
    shelf_life = engine.build_shelf_life_features(manifest)
    demand = engine.build_demand_features(manifest)
    anomaly = engine.build_anomaly_features(manifest)
    wastage = engine.build_wastage_features(manifest)
    replenishment = _build_replenishment_features(demand, wastage)

    models = {}
    contracts = {}
    categorical_mappings = {}

    model = SpoilageClassifier(config)
    X, y, mappings = prepared(spoilage, "is_spoiled", "measuredAt")
    model.train(X, y)
    models["spoilage_classifier"] = model
    contracts["spoilage_classifier"] = list(X.columns)
    categorical_mappings["spoilage_classifier"] = mappings

    model = ShelfLifeEstimator(config)
    X, y, mappings = prepared(shelf_life, "days_remaining", "measuredAt")
    model.train(X, y)
    models["shelf_life_estimator"] = model
    contracts["shelf_life_estimator"] = list(X.columns)
    categorical_mappings["shelf_life_estimator"] = mappings

    model = DemandForecaster(config)
    X, y, mappings = prepared(demand, "unitsSold", "businessDate")
    model.train(X, y)
    models["demand_forecaster"] = model
    contracts["demand_forecaster"] = list(X.columns)
    categorical_mappings["demand_forecaster"] = mappings

    model = AnomalyDetector(config)
    X, y, mappings = prepared(anomaly, "is_anomaly", "measuredAt")
    model.train(X, y)
    models["anomaly_detector"] = model
    contracts["anomaly_detector"] = list(X.columns)
    categorical_mappings["anomaly_detector"] = mappings

    model = ReplenishmentModel(config)
    X, y, mappings = prepared(replenishment, "replenishment_target", "businessDate")
    model.train(X, y)
    models["replenishment_model"] = model
    contracts["replenishment_model"] = list(X.columns)
    categorical_mappings["replenishment_model"] = mappings

    return models, contracts, categorical_mappings, manifest.metadata


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)

    config = PipelineConfig(
        num_stores=int(os.environ.get("FRESHCHAIN_NUM_STORES", "1")),
        num_skus_per_store=int(os.environ.get("FRESHCHAIN_NUM_SKUS", "10")),
        num_sensors_per_zone=int(os.environ.get("FRESHCHAIN_NUM_SENSORS", "2")),
        num_days=int(os.environ.get("FRESHCHAIN_NUM_DAYS", "30")),
        random_seed=int(os.environ.get("FRESHCHAIN_RANDOM_SEED", "42")),
        output_dir=str(TRAINING_DIR),
    )
    config.validate()
    set_global_seed(config.random_seed)

    models, contracts, categorical_mappings, generation = train_models(config)
    for name, model in models.items():
        joblib.dump(model, MODEL_DIR / f"{name}.joblib")

    metadata = {
        "modelName": "freshchain-intelligence",
        "modelVersion": os.environ.get("AICORE_EXECUTION_ID", "freshchain-pipeline-1.0.0"),
        "artifactType": "freshchain_ml_pipeline complete model wrappers",
        "pythonPackageContract": {
            "numpy": "1.26.4",
            "scikit-learn": "1.5.0",
            "xgboost": "2.1.0",
            "joblib": "1.4.2",
        },
        "models": sorted(models),
        "featureColumns": contracts,
        "categoricalMappings": categorical_mappings,
        "trainingData": generation,
    }
    (MODEL_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
