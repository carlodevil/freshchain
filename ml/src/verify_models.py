"""Verify that exported FreshChain wrapper artifacts load and predict."""

import json
import os
from pathlib import Path

import joblib
import pandas as pd


MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/model"))


def main():
    metadata = json.loads((MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
    verified = {}

    for name in metadata["models"]:
        model = joblib.load(MODEL_DIR / f"{name}.joblib")
        features = pd.DataFrame(
            [{column: 0.0 for column in metadata["featureColumns"][name]}]
        )
        raw = model.predict(features)
        output = model.to_prediction_output(raw)[0]
        verified[name] = {
            "wrapperType": type(model).__name__,
            "predictionType": output.predictionType,
            "riskLevel": output.riskLevel,
        }

    print(json.dumps({"status": "ok", "models": verified}, indent=2))


if __name__ == "__main__":
    main()
