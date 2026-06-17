from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from freshchain_model import FreshChainPipeline


class InferenceRequest(BaseModel):
    features: dict


app = FastAPI(title="FreshChain AI Core Serving")
pipeline = FreshChainPipeline()


@app.get("/health")
@app.get("/v2/health")
def health():
    return {"status": "ready", "models": pipeline.model_names}


@app.post("/")
@app.post("/v2/predict")
def infer(request: InferenceRequest):
    if not request.features.get("zone"):
        raise HTTPException(status_code=400, detail="features.zone is required")
    try:
        return pipeline.predict(request.features)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
