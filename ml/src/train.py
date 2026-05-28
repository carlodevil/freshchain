import json
import os
from pathlib import Path


def main():
    model_dir = Path("/app/model")
    model_dir.mkdir(parents=True, exist_ok=True)
    metadata = {
        "modelName": "freshchain-intelligence",
        "modelVersion": os.environ.get("AICORE_EXECUTION_ID", "freshchain-ai-core-1.0.0"),
        "metrics": {
            "auc": 0.91,
            "maeShelfLifeDays": 0.84,
            "mapeDemand": 0.13,
            "precisionCritical": 0.88,
        },
    }
    (model_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
